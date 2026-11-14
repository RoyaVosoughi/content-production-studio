import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { ideas, pieces, publications, scenarios, scheduledPosts } from "./db/schema";
import type { Language, UiLanguage } from "./language";
import { getProfile } from "./profile";
import { getBrandKit } from "./studio";

/**
 * The path through the studio, as steps you can see: who you are, your brand, an idea, its scenario,
 * its posts, then publishing. Each step is done once you've done it at least once, and links to where
 * you'd do it next, so there is always one clear next step.
 */
export const STEP_IDS = ["setup", "brand", "idea", "scenario", "posts", "publish"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type Step = { id: StepId; done: boolean; href: string };

export async function studioProgress(db: Db, ui: UiLanguage, view: Language): Promise<Step[]> {
  const profile = await getProfile(db);
  if (!profile) return STEP_IDS.map((id) => ({ id, done: false, href: `/${ui}/setup` }));

  const [kit, approved] = await Promise.all([
    getBrandKit(db, view),
    db
      .select({ id: ideas.id })
      .from(ideas)
      .where(and(eq(ideas.language, view), eq(ideas.status, "approved")))
      .orderBy(desc(ideas.createdAt)),
  ]);
  const ids = approved.map((idea) => idea.id);
  const [scenarioRows, pieceRows] = ids.length
    ? await Promise.all([
        db.select().from(scenarios).where(inArray(scenarios.ideaId, ids)),
        db.select({ id: pieces.id, ideaId: pieces.ideaId }).from(pieces).where(inArray(pieces.ideaId, ids)),
      ])
    : [[], []];
  const pieceIds = pieceRows.map((piece) => piece.id);
  const [posted, waiting] = pieceIds.length
    ? await Promise.all([
        db.select({ id: publications.pieceId }).from(publications).where(and(inArray(publications.pieceId, pieceIds), eq(publications.status, "posted"))),
        db.select({ id: scheduledPosts.pieceId }).from(scheduledPosts).where(and(inArray(scheduledPosts.pieceId, pieceIds), eq(scheduledPosts.status, "waiting"))),
      ])
    : [[], []];

  const scenarioApproved = (id: string) => scenarioRows.some((row) => row.ideaId === id && row.approvedVersion != null);
  const hasPieces = (id: string) => pieceRows.some((piece) => piece.ideaId === id);
  // The newest idea still waiting at each step is the one to continue with.
  const needsScenario = ids.find((id) => !scenarioApproved(id));
  const needsPosts = ids.find((id) => scenarioApproved(id) && !hasPieces(id));
  const withPosts = ids.find(hasPieces);

  return [
    { id: "setup", done: true, href: `/${ui}/setup` },
    { id: "brand", done: !kit.isDraft, href: `/${ui}/brand` },
    { id: "idea", done: ids.length > 0, href: `/${ui}` },
    {
      id: "scenario",
      done: ids.some(scenarioApproved),
      href: needsScenario ?? ids[0] ? `/${ui}/ideas/${needsScenario ?? ids[0]}` : `/${ui}/map?agent=storyteller`,
    },
    {
      id: "posts",
      done: withPosts !== undefined,
      href: needsPosts ?? withPosts ? `/${ui}/ideas/${needsPosts ?? withPosts}/content` : `/${ui}/map?agent=storyteller`,
    },
    {
      id: "publish",
      done: posted.length + waiting.length > 0,
      href: withPosts ? `/${ui}/ideas/${withPosts}/content` : `/${ui}/map?agent=live`,
    },
  ];
}

/** The first step not done yet, or null when you've been all the way through once. */
export function nextStep(steps: Step[]): Step | null {
  return steps.find((step) => !step.done) ?? null;
}
