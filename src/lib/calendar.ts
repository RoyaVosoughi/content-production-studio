import { and, eq, inArray } from "drizzle-orm";
import { getTeamSettings } from "./agents/team";
import type { Db } from "./db/client";
import { ideas, pieces, publications, scheduledPosts, teamSettings, type WeekPlan } from "./db/schema";
import { StudioError } from "./errors";
import { isPlatform, TEXT_PLATFORMS, type Platform } from "./platforms";
import { cleanWeekPlan, planWeek, weekStart, type FixedPost, type ReadyPost } from "./plan-week";
import { schedulePost } from "./schedule";
import type { PublishDeps } from "./content";

export async function getWeekPlan(db: Db): Promise<WeekPlan> {
  return cleanWeekPlan((await getTeamSettings(db)).weekPlan);
}

export async function saveWeekPlan(db: Db, plan: Partial<WeekPlan>) {
  await getTeamSettings(db);
  await db.update(teamSettings).set({ weekPlan: cleanWeekPlan(plan) }).where(eq(teamSettings.id, 1));
}

/** Schedule states that free a post to be planned again. */
const OPEN_SCHEDULES = ["missed", "failed", "cancelled"];

/** Posts in one content language: those ready to plan, and those already scheduled or live. */
export async function calendarPosts(db: Db, language: string): Promise<{ ready: ReadyPost[]; fixed: FixedPost[] }> {
  const rows = await db
    .select({ piece: pieces, idea: ideas, publication: publications, schedule: scheduledPosts })
    .from(pieces)
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .leftJoin(publications, eq(publications.pieceId, pieces.id))
    .leftJoin(scheduledPosts, eq(scheduledPosts.pieceId, pieces.id))
    .where(and(eq(ideas.language, language), inArray(pieces.platform, [...TEXT_PLATFORMS])));
  const ready: ReadyPost[] = [];
  const fixed: FixedPost[] = [];
  for (const { piece, idea, publication, schedule } of rows) {
    if (!isPlatform(piece.platform)) continue;
    const base = { pieceId: piece.id, ideaId: idea.id, platform: piece.platform as Platform, idea: idea.pairId, title: idea.title };
    if (publication && publication.status !== "failed") {
      if (publication.status === "posted") fixed.push({ ...base, at: publication.postedAt ?? publication.updatedAt, state: "posted" });
      continue;
    }
    if (schedule && !OPEN_SCHEDULES.includes(schedule.status)) {
      fixed.push({ ...base, version: schedule.version, at: schedule.at, state: "scheduled" });
      continue;
    }
    ready.push({ ...base, version: piece.currentVersion, createdAt: piece.createdAt });
  }
  return { ready, fixed };
}

/** One week of the calendar, `weekOffset` weeks from this one. */
export async function loadWeek(db: Db, language: string, firstDay: number, weekOffset: number, now = new Date()) {
  const [plan, posts] = await Promise.all([getWeekPlan(db), calendarPosts(db, language)]);
  const start = weekStart(now, firstDay);
  start.setDate(start.getDate() + 7 * weekOffset);
  // Weeks before this one can't take new posts, so posts planned earlier in the line don't count against them.
  const earlier = weekOffset > 0 ? await plannedBefore(db, language, firstDay, weekOffset, now, plan, posts) : posts;
  return { plan, start, ...planWeek({ plan, start, now, ready: earlier.ready, fixed: earlier.fixed }) };
}

/** What's left to plan once the weeks between now and the chosen week have taken their share. */
async function plannedBefore(
  db: Db,
  language: string,
  firstDay: number,
  weekOffset: number,
  now: Date,
  plan: WeekPlan,
  posts: { ready: ReadyPost[]; fixed: FixedPost[] },
) {
  let { ready } = posts;
  const fixed = [...posts.fixed];
  for (let week = 0; week < weekOffset; week++) {
    const start = weekStart(now, firstDay);
    start.setDate(start.getDate() + 7 * week);
    const result = planWeek({ plan, start, now, ready, fixed });
    for (const day of result.days) {
      for (const slot of day.slots) {
        if (slot.kind === "suggested") fixed.push({ ...slot.post, at: slot.at, state: "scheduled" });
      }
    }
    ready = result.unplaced;
  }
  return { ready, fixed };
}

/**
 * Schedules every suggestion in the week as it stands. Each goes through the usual checks; a post
 * that can't be scheduled is skipped and named, so one problem doesn't hold up the rest.
 */
export async function scheduleWeek(
  deps: Pick<PublishDeps, "db" | "publishers">,
  language: string,
  firstDay: number,
  weekOffset: number,
  now = new Date(),
): Promise<{ scheduled: number; problems: string[] }> {
  const week = await loadWeek(deps.db, language, firstDay, weekOffset, now);
  let scheduled = 0;
  const problems: string[] = [];
  for (const day of week.days) {
    for (const slot of day.slots) {
      if (slot.kind !== "suggested") continue;
      try {
        await schedulePost(deps, slot.post.pieceId, slot.post.version, slot.at, now);
        scheduled++;
      } catch (error) {
        if (!(error instanceof StudioError)) throw error;
        problems.push(`${slot.post.title}: ${error.message}`);
      }
    }
  }
  return { scheduled, problems };
}
