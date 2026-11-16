import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentInstructions, agentSkills } from "../db/schema";
import { StudioError } from "../errors";
import { languageInfo } from "../language";
import { AGENT_IDS, SKILL_LENGTH, type AgentId } from "./roster";

/**
 * Each agent works from one Skill: who it is on the team and how it does its job. The default Skill
 * is a Markdown file in src/lib/agents/skills/; edit those files to change the defaults for everyone.
 * When you edit an agent's Skill in the studio, your version is saved in the database instead.
 */
export const SKILLS_DIR = path.join(process.cwd(), "src", "lib", "agents", "skills");

export { SKILL_LENGTH };

export function defaultSkill(agent: AgentId): string {
  return readFileSync(path.join(SKILLS_DIR, `${agent}.md`), "utf8").trim();
}

/** text is what the agent follows; custom says whether it is yours rather than the default. */
export type Skill = { text: string; custom: boolean; updatedAt: Date | null };

type OldInstructions = { both: string; byLanguage: Record<string, string> } | undefined;

/**
 * Before Skills, each agent had its own instructions boxes. Until you save its Skill, those
 * instructions are added to the end of the default Skill, so nothing you wrote is lost or hidden.
 */
export function withOldInstructions(base: string, old: OldInstructions): string {
  if (!old) return base;
  const parts = [
    old.both.trim(),
    ...Object.entries(old.byLanguage)
      .filter(([, text]) => text.trim())
      .map(([code, text]) => `In ${languageInfo(code).name} only: ${text.trim()}`),
  ].filter(Boolean);
  if (parts.length === 0) return base;
  return `${base}\n\n## {OWNER}'s own rules\n${parts.join("\n\n")}`;
}

function skillFrom(agent: AgentId, saved: { text: string; updatedAt: Date } | undefined, old: OldInstructions): Skill {
  if (saved) return { text: saved.text, custom: true, updatedAt: saved.updatedAt };
  const base = defaultSkill(agent);
  const text = withOldInstructions(base, old);
  return { text, custom: text !== base, updatedAt: null };
}

export async function getSkill(db: Db, agent: AgentId): Promise<Skill> {
  const [[saved], [old]] = await Promise.all([
    db.select().from(agentSkills).where(eq(agentSkills.agent, agent)),
    db.select().from(agentInstructions).where(eq(agentInstructions.agent, agent)),
  ]);
  return skillFrom(agent, saved, old);
}

/** Every agent's Skill, read fresh for each run. */
export async function allSkills(db: Db): Promise<Record<AgentId, Skill>> {
  const [saved, old] = await Promise.all([db.select().from(agentSkills), db.select().from(agentInstructions)]);
  return Object.fromEntries(
    AGENT_IDS.map((agent) => [
      agent,
      skillFrom(
        agent,
        saved.find((row) => row.agent === agent),
        old.find((row) => row.agent === agent),
      ),
    ]),
  ) as Record<AgentId, Skill>;
}

/** Saves your version of a Skill. Saving the default text as it is goes back to the default. */
export async function saveSkill(db: Db, agent: AgentId, text: string) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) throw new StudioError("A Skill can't be empty. To go back to the default, use Reset.");
  if (clean.length > SKILL_LENGTH) {
    throw new StudioError(`Keep the Skill under ${SKILL_LENGTH.toLocaleString("en-US")} characters, so every request stays cheap.`);
  }
  // The old instructions boxes are now part of the Skill text you saw and saved.
  await db.delete(agentInstructions).where(eq(agentInstructions.agent, agent));
  if (clean === defaultSkill(agent)) {
    await db.delete(agentSkills).where(eq(agentSkills.agent, agent));
    return;
  }
  await db
    .insert(agentSkills)
    .values({ agent, text: clean })
    .onConflictDoUpdate({ target: agentSkills.agent, set: { text: clean, updatedAt: new Date() } });
}

/** Back to the default Skill file. */
export async function resetSkill(db: Db, agent: AgentId) {
  await Promise.all([
    db.delete(agentSkills).where(eq(agentSkills.agent, agent)),
    db.delete(agentInstructions).where(eq(agentInstructions.agent, agent)),
  ]);
}
