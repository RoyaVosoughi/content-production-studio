import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { ideas, pieces } from "./db/schema";
import { hookTally, type HookKind, type HookTally } from "./hooks";
import { bestAndWorst, patternsOf, type Group } from "./insights";
import type { Language } from "./language";
import type { Platform } from "./platforms";
import { weekStart, type PlannedDay } from "./plan-week";
import { hookOverview, resultsOverview, type RankedRow } from "./results";

// The weekly report: what went out in one week, what worked, and what to make next week.
// Worked out by code from the posts' scores and the calendar, so it costs nothing to open.

/** Patterns across topics, days and channels need this many compared posts, as on the Results page. */
export const MIN_COMPARED_FOR_ADVICE = 5;
/** How many posts to name as having worked, or not. */
const TOP = 3;
/** How many waiting ideas to suggest writing. */
const IDEAS_TO_SUGGEST = 3;

export type WeekTotals = { posted: number; measured: number; views: number; channels: number };

export type WeekLessons = {
  start: Date;
  /** The start of the following week; the report covers everything before it. */
  end: Date;
  /** Oldest first, so the week reads in order. */
  posts: RankedRow[];
  totals: WeekTotals;
  previous: WeekTotals;
  /** Posts that did better than your usual on their channel, best first. */
  worked: RankedRow[];
  /** Posts that clearly did worse than your usual, weakest first. */
  weak: RankedRow[];
  /** Topics this week by average score, best first. */
  topics: Group<string>[];
  /** Hook kinds this week, best first. */
  hooks: HookTally[];
  /** Posts this week that still have no numbers, so the picture isn't complete. */
  missingNumbers: number;
};

function totalsOf(rows: RankedRow[]): WeekTotals {
  const measured = rows.filter((row) => row.numbers);
  return {
    posted: rows.length,
    measured: measured.length,
    views: measured.reduce((sum, row) => sum + (row.numbers?.views ?? 0), 0),
    channels: new Set(rows.map((row) => row.platform)).size,
  };
}

const within = (row: RankedRow, from: Date, until: Date) =>
  row.postedAt !== null && row.postedAt.getTime() >= from.getTime() && row.postedAt.getTime() < until.getTime();

/** The days `start` to `start + 7`, counted in calendar days so a clock change doesn't shift it. */
export function weekEnd(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
}

/** What one week looked like, from every live post with its score. */
export function weekLessons(rows: RankedRow[], start: Date): WeekLessons {
  const end = weekEnd(start);
  const before = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
  const posts = rows.filter((row) => within(row, start, end)).sort((a, b) => a.postedAt!.getTime() - b.postedAt!.getTime());
  const scored = posts.filter((row) => row.score !== null).sort((a, b) => b.score! - a.score!);
  return {
    start,
    end,
    posts,
    totals: totalsOf(posts),
    previous: totalsOf(rows.filter((row) => within(row, before, start))),
    worked: scored.filter((row) => row.score! >= 1).slice(0, TOP),
    weak: scored
      .filter((row) => row.standing === "weak")
      .reverse()
      .slice(0, TOP),
    topics: patternsOf(scored).topics,
    hooks: hookTally([], posts.map((row) => ({ platform: row.platform, kind: row.hookKind, score: row.score }))).filter((tally) => tally.live > 0),
    missingNumbers: posts.filter((row) => !row.numbers).length,
  };
}

export type WaitingIdea = { id: string; title: string; pillar: string; language: Language };

export type WeekPlanSummary = {
  start: Date;
  /** Posts already scheduled for that week. */
  scheduled: number;
  /** Ready posts the calendar would put in that week's open slots. */
  suggested: number;
  /** Open slots with no ready post, by channel. */
  empty: { platform: Platform; count: number }[];
};

/** Counts one planned week's slots: what's already booked, what could be, and what still needs writing. */
export function summarisePlan(start: Date, days: PlannedDay[]): WeekPlanSummary {
  const slots = days.flatMap((day) => day.slots);
  const empty = new Map<Platform, number>();
  for (const slot of slots) if (slot.kind === "empty") empty.set(slot.platform, (empty.get(slot.platform) ?? 0) + 1);
  return {
    start,
    scheduled: slots.filter((slot) => slot.kind === "fixed" && slot.post.state === "scheduled").length,
    suggested: slots.filter((slot) => slot.kind === "suggested").length,
    empty: [...empty].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
  };
}

/** One piece of advice for next week. The page puts it into words in the reader's language. */
export type Advice =
  | { kind: "topic"; topic: string; score: number; posts: number }
  | { kind: "easeTopic"; topic: string; score: number; posts: number }
  | { kind: "hook"; hook: HookKind; score: number; posts: number }
  | { kind: "day"; day: number; score: number; posts: number }
  | { kind: "channel"; platform: Platform; score: number; posts: number }
  | { kind: "followUp"; post: RankedRow }
  | { kind: "fill"; empty: WeekPlanSummary["empty"]; ideas: WaitingIdea[] }
  | { kind: "schedule"; count: number }
  | { kind: "numbers"; count: number }
  | { kind: "needData" };

/**
 * What to make next week, in order of how much it helps. Every line is backed by numbers: a pattern
 * needs several compared posts behind it, so one lucky post never becomes a rule.
 */
export function nextWeekAdvice({
  rows,
  week,
  hooks,
  plan,
  waitingIdeas,
}: {
  rows: RankedRow[];
  week: WeekLessons;
  hooks: HookTally[];
  plan: WeekPlanSummary | null;
  waitingIdeas: WaitingIdea[];
}): Advice[] {
  const advice: Advice[] = [];
  const compared = rows.filter((row) => row.score !== null);
  const strong = week.worked.find((row) => row.standing === "strong");
  if (strong) advice.push({ kind: "followUp", post: strong });

  if (compared.length >= MIN_COMPARED_FOR_ADVICE) {
    const patterns = patternsOf(compared);
    const topics = bestAndWorst(patterns.topics, 2);
    if (topics && topics.best.score >= 1) advice.push({ kind: "topic", topic: topics.best.key, score: topics.best.score, posts: topics.best.posts });
    const hook = hooks.find((tally) => tally.score !== null);
    if (hook && hook.score! > 1) advice.push({ kind: "hook", hook: hook.kind, score: hook.score!, posts: hook.compared });
    const days = bestAndWorst(patterns.weekdays, 2);
    if (days?.worst) advice.push({ kind: "day", day: days.best.key, score: days.best.score, posts: days.best.posts });
    const channels = bestAndWorst(patterns.channels, 2);
    if (channels?.worst) advice.push({ kind: "channel", platform: channels.best.key, score: channels.best.score, posts: channels.best.posts });
    if (topics?.worst && topics.worst.score < 1) {
      advice.push({ kind: "easeTopic", topic: topics.worst.key, score: topics.worst.score, posts: topics.worst.posts });
    }
  } else {
    advice.push({ kind: "needData" });
  }

  if (plan) {
    if (plan.suggested > 0) advice.push({ kind: "schedule", count: plan.suggested });
    if (plan.empty.length > 0) {
      // Ideas on the best topic come first, so the open slots go to what works.
      const best = advice.find((entry) => entry.kind === "topic")?.topic.trim().toLowerCase();
      const ideasFirst = [...waitingIdeas].sort(
        (a, b) => Number(b.pillar.trim().toLowerCase() === best) - Number(a.pillar.trim().toLowerCase() === best),
      );
      advice.push({ kind: "fill", empty: plan.empty, ideas: ideasFirst.slice(0, IDEAS_TO_SUGGEST) });
    }
  }
  if (week.missingNumbers > 0) advice.push({ kind: "numbers", count: week.missingNumbers });
  return advice;
}

/** Approved ideas in one language that have no posts written yet, newest first. */
export async function ideasToWrite(db: Db, language: Language, limit = 20): Promise<WaitingIdea[]> {
  const rows = await db
    .select({ id: ideas.id, title: ideas.title, pillar: ideas.pillar, language: ideas.language })
    .from(ideas)
    .leftJoin(pieces, eq(pieces.ideaId, ideas.id))
    .where(and(eq(ideas.language, language), eq(ideas.status, "approved"), isNull(pieces.id)))
    .orderBy(desc(ideas.createdAt))
    .limit(limit);
  return rows;
}

/** The first day of the week `offset` weeks from the one holding `now` (0 is this week, -1 last week). */
export function reportWeekStart(now: Date, firstDay: number, offset: number): Date {
  const start = weekStart(now, firstDay);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * offset);
}

/**
 * Everything the weekly report page shows. Next week's plan is only looked at when the week after the
 * report hasn't passed yet, since the calendar can't plan the past.
 */
export async function loadWeeklyReport(
  db: Db,
  {
    language,
    firstDay,
    offset,
    now = new Date(),
    planFor,
  }: {
    language: Language;
    firstDay: number;
    offset: number;
    now?: Date;
    /** Lays out a calendar week, `weeks` from this one. */
    planFor: (weeks: number) => Promise<{ start: Date; days: PlannedDay[] }>;
  },
) {
  const [rows, hooks, waiting] = await Promise.all([resultsOverview(db), hookOverview(db), ideasToWrite(db, language)]);
  const week = weekLessons(rows, reportWeekStart(now, firstDay, offset));
  const planned = offset + 1 >= 0 ? await planFor(offset + 1) : null;
  const plan = planned ? summarisePlan(planned.start, planned.days) : null;
  const advice = nextWeekAdvice({ rows, week, hooks, plan, waitingIdeas: waiting });
  const firstPost = rows.reduce<Date | null>((first, row) => (row.postedAt && (!first || row.postedAt < first) ? row.postedAt : first), null);
  // There is an earlier week to look at as long as something went out before this one.
  const hasEarlier = firstPost !== null && firstPost.getTime() < week.start.getTime();
  return { week, plan, advice, waitingCount: waiting.length, hasEarlier };
}
