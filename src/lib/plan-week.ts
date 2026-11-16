import type { WeekPlan } from "./db/schema";
import { isPlatform, TEXT_PLATFORMS, type Platform } from "./platforms";

/**
 * The weekly calendar, worked out by code with no AI: your pattern says which channels go out on
 * which weekday; ready posts fill those slots, oldest first, keeping one idea's posts a few days apart.
 */

export const DEFAULT_WEEK_PLAN: WeekPlan = {
  // Sunday to Saturday.
  days: [[], ["linkedin"], ["telegram"], ["instagram"], ["website"], ["telegram"], []],
  time: "09:00",
  gapDays: 2,
};

export const MAX_GAP_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** Keeps only real channels and sane values, so a bad save can't break the calendar. */
export function cleanWeekPlan(plan: Partial<WeekPlan> | null | undefined): WeekPlan {
  const days = Array.from({ length: 7 }, (_, day) => {
    const chosen = plan?.days?.[day] ?? DEFAULT_WEEK_PLAN.days[day];
    // Videos are posted by hand, so only channels the studio can post to are planned.
    return TEXT_PLATFORMS.filter((platform) => chosen.includes(platform));
  });
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(plan?.time ?? "") ? plan!.time! : DEFAULT_WEEK_PLAN.time;
  const gap = Math.round(Number(plan?.gapDays));
  const gapDays = Number.isFinite(gap) ? Math.min(MAX_GAP_DAYS, Math.max(0, gap)) : DEFAULT_WEEK_PLAN.gapDays;
  return { days, time, gapDays };
}

/** The first day of the week holding `date`, at midnight local time: Saturday in Farsi, Monday in English. */
export function weekStart(date: Date, firstDay: number): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() - firstDay + 7) % 7));
  return start;
}

/** A post ready to go out: written, not live and not scheduled. */
export type ReadyPost = { pieceId: string; ideaId: string; version: number; platform: Platform; idea: string; title: string; createdAt: Date };
/** A post already on the calendar: scheduled, or live. */
export type FixedPost = { pieceId: string; ideaId: string; version?: number; platform: Platform; idea: string; title: string; at: Date; state: "scheduled" | "posted" };

export type Slot =
  | { kind: "fixed"; platform: Platform; post: FixedPost }
  | { kind: "suggested"; platform: Platform; at: Date; post: ReadyPost }
  | { kind: "empty"; platform: Platform; at: Date };

export type PlannedDay = { date: Date; past: boolean; slots: Slot[] };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayNumber = (date: Date) => Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / DAY);

/**
 * Lays out one week. Posts already scheduled or live stay where they are. Each slot in your pattern
 * that's still open gets the oldest ready post for that channel whose idea hasn't gone out, and isn't
 * planned, within `gapDays` of that day. Slots whose time has passed are dropped.
 */
export function planWeek({
  plan,
  start,
  now,
  ready,
  fixed,
}: {
  plan: WeekPlan;
  start: Date;
  now: Date;
  ready: ReadyPost[];
  fixed: FixedPost[];
}): { days: PlannedDay[]; unplaced: ReadyPost[] } {
  const [hour, minute] = plan.time.split(":").map(Number);
  // When each idea goes out, by day number, so its posts can be kept apart.
  const ideaDays = new Map<string, number[]>();
  const mark = (idea: string, date: Date) => ideaDays.set(idea, [...(ideaDays.get(idea) ?? []), dayNumber(date)]);
  for (const post of fixed) mark(post.idea, post.at);
  const tooClose = (idea: string, date: Date) =>
    (ideaDays.get(idea) ?? []).some((day) => Math.abs(day - dayNumber(date)) < Math.max(1, plan.gapDays));

  const waiting = [...ready].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const days: PlannedDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    const past = at.getTime() <= now.getTime();
    const onDay = fixed.filter((post) => sameDay(post.at, date)).sort((a, b) => a.at.getTime() - b.at.getTime());
    const slots: Slot[] = onDay.map((post) => ({ kind: "fixed", platform: post.platform, post }));
    for (const platform of plan.days[date.getDay()] ?? []) {
      if (!isPlatform(platform) || onDay.some((post) => post.platform === platform)) continue;
      // A slot whose time has passed is gone; only what actually went out stays on the day.
      if (past) continue;
      const index = waiting.findIndex((post) => post.platform === platform && !tooClose(post.idea, date));
      if (index === -1) {
        slots.push({ kind: "empty", platform, at });
        continue;
      }
      const [post] = waiting.splice(index, 1);
      mark(post.idea, date);
      slots.push({ kind: "suggested", platform, at, post });
    }
    days.push({ date, past: sameDay(date, now) ? false : date.getTime() < now.getTime(), slots });
  }
  return { days, unplaced: waiting };
}
