import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Feedback, Review, WritingContext, WritingModel } from "../ai/types";
import type { Db } from "../db/client";
import { agentInstructions, agentLessons, agentRuns, agentSignals, teamSettings } from "../db/schema";
import { StudioError } from "../errors";
import type { Language } from "../language";
import { AGENT_IDS, LEARNING_AGENTS, PASS_SCORE, type AgentId } from "./roster";

export { PASS_SCORE };
/** The coach runs once this many new pieces of feedback have built up, so learning costs one AI request per batch. */
export const LEARN_AFTER = 6;
/** A change of yours to work the manager scored this high tells the manager it missed something. */
const CONFIDENT_SCORE = 8;
const MAX_LESSONS = 8;
const LESSON_LENGTH = 300;
const DETAIL_LENGTH = 1500;
const SIGNALS_PER_LESSON_RUN = 60;
/** A lesson run that never finished, because the app stopped, frees its feedback after this long. */
const STALE_CLAIM_MINUTES = 15;

/** Kinds of feedback that come from you rather than the manager. */
export const OWNER_KINDS = ["rejected", "refined", "edit", "ai-change"] as const;

export async function getTeamSettings(db: Db) {
  await db.insert(teamSettings).values({ id: 1 }).onConflictDoNothing();
  const [row] = await db.select().from(teamSettings).where(eq(teamSettings.id, 1));
  return row;
}

export async function setManagerEnabled(db: Db, enabled: boolean) {
  await getTeamSettings(db);
  await db.update(teamSettings).set({ managerEnabled: enabled }).where(eq(teamSettings.id, 1));
}

/** Each agent's lessons for work in this language, as instructions in English. */
export async function lessonsFor(db: Db, language: Language): Promise<Partial<Record<AgentId, string[]>>> {
  const rows = await db
    .select()
    .from(agentLessons)
    .where(inArray(agentLessons.appliesTo, [language, "both"]))
    .orderBy(asc(agentLessons.createdAt));
  const lessons: Partial<Record<AgentId, string[]>> = {};
  for (const row of rows) (lessons[row.agent as AgentId] ??= []).push(row.textEn);
  return lessons;
}

// ---- Your instructions ----

/** Long enough for a full brief, short enough that every prompt stays cheap on the free models. */
export const INSTRUCTIONS_LENGTH = 3000;

/** both is for every language; byLanguage holds each content language's own part, by language code. */
export type Instructions = { both: string; byLanguage: Record<string, string> };
const NO_INSTRUCTIONS: Instructions = { both: "", byLanguage: {} };

/** The general instructions about you, which every agent follows ahead of its own. Stored as one more row. */
export const GENERAL = "general";
export type InstructionsOwner = AgentId | typeof GENERAL;

/** One agent's instructions (or the general ones) as you wrote them. */
export async function getInstructions(db: Db, agent: InstructionsOwner): Promise<Instructions & { updatedAt: Date | null }> {
  const [row] = await db.select().from(agentInstructions).where(eq(agentInstructions.agent, agent));
  return row ? { both: row.both, byLanguage: row.byLanguage, updatedAt: row.updatedAt } : { ...NO_INSTRUCTIONS, updatedAt: null };
}

export async function allInstructions(db: Db): Promise<Partial<Record<AgentId, Instructions>>> {
  const rows = await db.select().from(agentInstructions);
  return Object.fromEntries(rows.map((row) => [row.agent, { both: row.both, byLanguage: row.byLanguage }]));
}

/** What an agent should follow when working in this language: the shared part, then that language's part. */
export function instructionsText(instructions: Instructions | undefined, language: Language): string {
  if (!instructions) return "";
  return [instructions.both, instructions.byLanguage[language] ?? ""].map((part) => part.trim()).filter(Boolean).join("\n\n");
}

/** Each agent's instructions for work in this language: the general ones first, then its own. Agents without any are left out. */
export async function instructionsFor(db: Db, language: Language): Promise<Partial<Record<AgentId, string>>> {
  const all = (await allInstructions(db)) as Partial<Record<InstructionsOwner, Instructions>>;
  const general = instructionsText(all[GENERAL], language);
  const result: Partial<Record<AgentId, string>> = {};
  for (const agent of AGENT_IDS) {
    const text = [general, instructionsText(all[agent], language)].filter(Boolean).join("\n\n");
    if (text) result[agent] = text;
  }
  return result;
}

export async function saveInstructions(db: Db, agent: InstructionsOwner, instructions: Instructions) {
  const byLanguage: Record<string, string> = Object.fromEntries(
    Object.entries(instructions.byLanguage)
      .map(([code, text]) => [code, text.trim()])
      .filter(([, text]) => text),
  );
  const clean = { both: instructions.both.trim(), byLanguage };
  for (const part of [clean.both, ...Object.values(byLanguage)]) {
    if (part.length > INSTRUCTIONS_LENGTH) {
      throw new StudioError(`Keep each box under ${INSTRUCTIONS_LENGTH.toLocaleString("en-US")} characters.`);
    }
  }
  await db
    .insert(agentInstructions)
    .values({ agent, ...clean })
    .onConflictDoUpdate({ target: agentInstructions.agent, set: { ...clean, updatedAt: new Date() } });
}

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export async function recordSignal(
  db: Db,
  signal: { agent: AgentId; language: Language; kind: string; detail: string },
) {
  await db.insert(agentSignals).values({ ...signal, detail: clip(signal.detail, DETAIL_LENGTH) });
}

/**
 * Your feedback on an agent's work. When the manager had scored that work highly, the manager
 * gets the same feedback, so it learns what it missed.
 */
export async function recordOwnerFeedback(
  db: Db,
  feedback: { agent: AgentId; language: Language; kind: (typeof OWNER_KINDS)[number] | "approved"; detail: string; subject: string },
) {
  const { subject, ...signal } = feedback;
  await recordSignal(db, signal);
  if (feedback.kind === "approved") return;
  const [run] = await db
    .select({ score: agentRuns.score })
    .from(agentRuns)
    .where(and(eq(agentRuns.subject, subject), eq(agentRuns.agent, feedback.agent)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  if (run?.score != null && run.score >= CONFIDENT_SCORE) {
    await recordSignal(db, {
      agent: "manager",
      language: feedback.language,
      kind: "missed",
      detail: `You scored this ${feedback.agent} work ${run.score}/10, but then {OWNER} ${KIND_WORDS[feedback.kind]}: ${feedback.detail}`,
    });
  }
}

const KIND_WORDS: Record<(typeof OWNER_KINDS)[number], string> = {
  rejected: "rejected it",
  refined: "asked for a change",
  edit: "edited it themselves",
  "ai-change": "asked for a change",
};

/** The fields whose text changed, before and after, for the coach to compare. Null when nothing it writes changed. */
export function describeEdit(before: object, after: object, fields: string[]): string | null {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const field of fields) {
    const a = (before as Record<string, unknown>)[field];
    const b = (after as Record<string, unknown>)[field];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      old[field] = a;
      next[field] = b;
    }
  }
  if (Object.keys(next).length === 0) return null;
  return `Before: ${clip(JSON.stringify(old), 700)}\nAfter: ${clip(JSON.stringify(next), 700)}`;
}

export type Verdict = { score: number | null; revised: boolean; problems: string[]; note: { en: string; fa: string } };

const UNCHECKED: Verdict = {
  score: null,
  revised: false,
  problems: [],
  note: { en: "The manager couldn't check this draft.", fa: "مدیر نتوانست این پیش‌نویس را بررسی کند." },
};

function cleanScore(score: number) {
  return Math.min(10, Math.max(1, Math.round(score)));
}

/**
 * The manager's check of one draft. A broken platform rule is caught by the studio without an AI
 * request. Weak work goes back to its writer once, with the manager's reasons; the second draft is
 * kept either way, so a check never costs more than two extra requests.
 *
 * The check never blocks the work: if the manager or the rewrite fails, you get the draft you
 * would have had without the manager.
 */
export async function managerCheck<T>(
  db: Db,
  {
    enabled,
    agent,
    language,
    draft,
    ruleProblem,
    review,
    rewrite,
  }: {
    enabled: boolean;
    agent: AgentId;
    language: Language;
    draft: T;
    /** A rule the studio checks itself, such as a length limit. */
    ruleProblem?: (draft: T) => string | null;
    review: (draft: T) => Promise<Review>;
    rewrite: (feedback: Feedback) => Promise<T>;
  },
): Promise<{ draft: T; verdict: Verdict | null }> {
  if (!enabled) return { draft, verdict: null };

  let found: Review | null = null;
  const broken = ruleProblem?.(draft);
  if (broken) {
    found = {
      score: 3,
      problems: [broken],
      instructions: `Fix this and keep everything else: ${broken}`,
      noteEn: "The first draft broke a platform rule, so it was rewritten.",
      noteFa: "پیش‌نویس اول یکی از قوانین پلتفرم را رعایت نکرده بود، برای همین بازنویسی شد.",
    };
  } else {
    try {
      found = await review(draft);
    } catch (error) {
      console.error(`The manager couldn't check the ${agent}'s draft:`, error);
      return { draft, verdict: UNCHECKED };
    }
  }

  const score = cleanScore(found.score);
  const verdict: Verdict = {
    score,
    revised: false,
    problems: found.problems.map((problem) => clip(problem, 400)).slice(0, 8),
    note: { en: clip(found.noteEn, 400), fa: clip(found.noteFa, 400) },
  };
  if (score >= PASS_SCORE) return { draft, verdict };

  await recordSignal(db, {
    agent,
    language,
    kind: "manager",
    detail: `The manager sent a draft back (${score}/10): ${verdict.problems.join(" | ") || found.instructions}`,
  });
  try {
    const second = await rewrite({ previous: draft, problems: verdict.problems, instructions: found.instructions });
    return { draft: second, verdict: { ...verdict, revised: true } };
  } catch (error) {
    console.error(`The ${agent} couldn't rewrite its draft:`, error);
    return { draft, verdict };
  }
}

export async function saveVerdict(
  db: Db,
  run: { agent: AgentId; task: string; language: Language; subject: string; version?: number },
  verdict: Verdict | null,
) {
  if (!verdict) return;
  await db.insert(agentRuns).values({ ...run, version: run.version ?? null, ...verdict });
}

/** The manager's latest check of each subject, for showing next to the work. */
export async function latestVerdicts(db: Db, subjects: string[]) {
  if (subjects.length === 0) return new Map<string, typeof agentRuns.$inferSelect>();
  const rows = await db
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.subject, subjects))
    .orderBy(desc(agentRuns.createdAt));
  const latest = new Map<string, typeof agentRuns.$inferSelect>();
  for (const row of rows) if (!latest.has(row.subject)) latest.set(row.subject, row);
  return latest;
}

// ---- Learning ----

/** Feedback the coach hasn't learned from yet. Approvals ride along but don't start a lesson run on their own. */
export async function pendingFeedback(db: Db) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentSignals)
    .where(and(isNull(agentSignals.learnedAt), ne(agentSignals.kind, "approved")));
  return row?.count ?? 0;
}

/**
 * The coach studies the feedback since its last run and rewrites each affected agent's coach lessons.
 * Feedback is claimed first, so two runs at the same moment never learn the same thing twice.
 * Returns false when there was too little new feedback to start.
 */
export async function learnFromFeedback(
  { db, writer }: { db: Db; writer: WritingModel },
  context: WritingContext,
  { force = false }: { force?: boolean } = {},
): Promise<boolean> {
  const pending = await pendingFeedback(db);
  if (pending === 0 || (!force && pending < LEARN_AFTER)) {
    if (force) throw new StudioError("There's no new feedback to learn from yet.");
    return false;
  }

  const candidates = await db
    .select({ id: agentSignals.id })
    .from(agentSignals)
    .where(isNull(agentSignals.learnedAt))
    .orderBy(asc(agentSignals.createdAt))
    .limit(SIGNALS_PER_LESSON_RUN);
  const claimed = await db
    .update(agentSignals)
    .set({ claimedAt: new Date() })
    .where(
      and(
        inArray(
          agentSignals.id,
          candidates.map((row) => row.id),
        ),
        or(isNull(agentSignals.claimedAt), lt(agentSignals.claimedAt, sql`now() - make_interval(mins => ${STALE_CLAIM_MINUTES})`)),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    if (force) throw new StudioError("The coach is already learning. Try again in a minute.");
    return false;
  }

  const agents = LEARNING_AGENTS.filter((agent) => claimed.some((signal) => signal.agent === agent));
  const [lessons, instructions] = await Promise.all([
    db.select().from(agentLessons).where(inArray(agentLessons.agent, agents)),
    allInstructions(db),
  ]);
  try {
    const update = await writer.learn(context, {
      agents: agents.map((agent) => ({
        agent,
        coachLessons: lessons.filter((row) => row.agent === agent && row.source === "coach").map((row) => row.textEn),
        ownerLessons: lessons.filter((row) => row.agent === agent && row.source === "owner").map((row) => row.textEn),
        ownerInstructions: instructions[agent] ?? NO_INSTRUCTIONS,
        signals: claimed
          .filter((signal) => signal.agent === agent)
          .map(({ kind, language, detail }) => ({ kind, language, detail })),
      })),
    });

    // Only agents that had feedback can have their lessons replaced, and your own are never touched.
    const replaced = new Map<AgentId, { textEn: string; textFa: string; appliesTo: string }[]>();
    const languages = context.owner?.languages ?? [context.language];
    for (const entry of update.agents) {
      if (!agents.includes(entry.agent) || replaced.has(entry.agent)) continue;
      replaced.set(
        entry.agent,
        entry.lessons
          .map((lesson) => ({
            textEn: clip(lesson.en.trim(), LESSON_LENGTH),
            textFa: clip((lesson.fa || lesson.en).trim(), LESSON_LENGTH),
            appliesTo: languages.includes(lesson.appliesTo) ? lesson.appliesTo : "both",
          }))
          .filter((lesson) => lesson.textEn)
          .slice(0, MAX_LESSONS),
      );
    }
    await db.transaction(async (tx) => {
      for (const [agent, next] of replaced) {
        await tx.delete(agentLessons).where(and(eq(agentLessons.agent, agent), eq(agentLessons.source, "coach")));
        if (next.length > 0) await tx.insert(agentLessons).values(next.map((lesson) => ({ ...lesson, agent, source: "coach" as const })));
      }
      await tx
        .update(agentSignals)
        .set({ learnedAt: new Date() })
        .where(inArray(agentSignals.id, claimed.map((signal) => signal.id)));
      await tx.insert(teamSettings).values({ id: 1 }).onConflictDoNothing();
      await tx
        .update(teamSettings)
        .set({
          lastLearnedAt: new Date(),
          lastLearnError: null,
          lastLearnSummary: { en: clip(update.summaryEn, 500), fa: clip(update.summaryFa, 500) },
        })
        .where(eq(teamSettings.id, 1));
    });
    return true;
  } catch (error) {
    // The feedback is released, so the next run learns from it instead.
    await db
      .update(agentSignals)
      .set({ claimedAt: null })
      .where(inArray(agentSignals.id, claimed.map((signal) => signal.id)));
    await getTeamSettings(db);
    await db
      .update(teamSettings)
      .set({ lastLearnError: error instanceof StudioError ? error.message : "The coach couldn't finish. It will try again later." })
      .where(eq(teamSettings.id, 1));
    throw error;
  }
}

// ---- Lessons you manage ----

/** appliesTo is a content language code, or "both" for every language. */
export async function addLesson(db: Db, agent: AgentId, text: string, appliesTo: string) {
  const lesson = text.trim();
  if (!lesson) throw new StudioError("Write the lesson first.");
  if (lesson.length > LESSON_LENGTH) throw new StudioError(`Keep a lesson under ${LESSON_LENGTH} characters.`);
  await db.insert(agentLessons).values({ agent, textEn: lesson, textFa: lesson, appliesTo, source: "owner" });
}

export async function deleteLesson(db: Db, id: string) {
  await db.delete(agentLessons).where(eq(agentLessons.id, id));
}

// ---- The Team page ----

export async function teamOverview(db: Db) {
  const [settings, runs, lessons, signals, pending, instructions] = await Promise.all([
    getTeamSettings(db),
    db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)),
    db.select().from(agentLessons).orderBy(asc(agentLessons.createdAt)),
    db
      .select({ agent: agentSignals.agent, kind: agentSignals.kind, count: sql<number>`count(*)::int` })
      .from(agentSignals)
      .groupBy(agentSignals.agent, agentSignals.kind),
    pendingFeedback(db),
    allInstructions(db),
  ]);
  const agents = AGENT_IDS.map((id) => {
    const own = runs.filter((run) => run.agent === id);
    const scored = own.filter((run) => run.score != null);
    const count = (kinds: readonly string[]) =>
      signals.filter((row) => row.agent === id && kinds.includes(row.kind)).reduce((sum, row) => sum + row.count, 0);
    return {
      id,
      checked: scored.length,
      averageScore: scored.length ? scored.reduce((sum, run) => sum + run.score!, 0) / scored.length : null,
      sentBack: own.filter((run) => run.score != null && run.score < PASS_SCORE).length,
      ownerChanges: count(OWNER_KINDS),
      approvals: count(["approved"]),
      missed: count(["missed"]),
      lessons: lessons.filter((lesson) => lesson.agent === id),
      recent: own.filter((run) => run.problems.length > 0).slice(0, 3),
      hasInstructions: [instructions[id]?.both ?? "", ...Object.values(instructions[id]?.byLanguage ?? {})].some((part) => part.trim() !== ""),
    };
  });
  return { settings, agents, pending, reviews: runs.filter((run) => run.score != null).length };
}
