import { describe, expect, it } from "vitest";
import { calendarPosts, getWeekPlan, loadWeek, saveWeekPlan, scheduleWeek } from "@/lib/calendar";
import { ideas, pieces, pieceVersions, publications, scheduledPosts } from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";
import type { Publisher } from "@/lib/publishers/types";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { cleanWeekPlan, DEFAULT_WEEK_PLAN, planWeek, weekStart, type ReadyPost } from "@/lib/plan-week";
import { studioDb } from "./fixtures/brand";

// Monday 2 November 2026, 08:00 local time.
const MONDAY = new Date(2026, 10, 2, 8, 0);
const everyDay = (platforms: string[]) => ({ days: Array.from({ length: 7 }, () => platforms), time: "09:00", gapDays: 2 });

const ready = (idea: string, platform: Platform, minutesOld: number): ReadyPost => ({
  pieceId: `${idea}-${platform}`,
  ideaId: idea,
  version: 1,
  platform,
  idea,
  title: idea,
  createdAt: new Date(MONDAY.getTime() - minutesOld * 60_000),
});

describe("planning a week", () => {
  it("fills each day's channels with the oldest ready post", () => {
    const { days, unplaced } = planWeek({
      plan: { ...DEFAULT_WEEK_PLAN, gapDays: 0 },
      start: weekStart(MONDAY, 1),
      now: MONDAY,
      ready: [ready("new", "linkedin", 1), ready("old", "linkedin", 100), ready("tg", "telegram", 5)],
      fixed: [],
    });
    expect(days[0].date.getDay()).toBe(1);
    expect(days[0].slots).toMatchObject([{ kind: "suggested", platform: "linkedin", post: { idea: "old" } }]);
    expect(days[0].slots[0].kind === "suggested" && days[0].slots[0].at.getHours()).toBe(9);
    expect(days[1].slots).toMatchObject([{ kind: "suggested", platform: "telegram" }]);
    expect(days[2].slots).toMatchObject([{ kind: "empty", platform: "instagram" }]);
    expect(unplaced.map((post) => post.idea)).toEqual(["new"]);
  });

  it("keeps one idea's posts apart by the gap you set", () => {
    const { days } = planWeek({
      plan: everyDay(["linkedin", "telegram"]),
      start: weekStart(MONDAY, 1),
      now: MONDAY,
      ready: [ready("a", "linkedin", 10), ready("a", "telegram", 9), ready("b", "telegram", 1)],
      fixed: [],
    });
    const ideaOn = (day: number) => days[day].slots.flatMap((slot) => (slot.kind === "suggested" ? [`${slot.platform}:${slot.post.idea}`] : []));
    expect(ideaOn(0)).toEqual(["linkedin:a", "telegram:b"]);
    expect(ideaOn(1)).toEqual([]);
    expect(ideaOn(2)).toEqual(["telegram:a"]);
  });

  it("keeps scheduled and live posts where they are, and plans nothing in the past", () => {
    const wednesday = new Date(2026, 10, 4, 12, 0);
    const { days } = planWeek({
      plan: everyDay(["telegram"]),
      start: weekStart(wednesday, 1),
      now: wednesday,
      ready: [ready("x", "telegram", 1)],
      fixed: [{ pieceId: "s", ideaId: "s", idea: "s", title: "S", platform: "telegram", at: new Date(2026, 10, 5, 18, 0), state: "scheduled" }],
    });
    expect(days[0].past).toBe(true);
    expect(days[2].slots).toEqual([]);
    expect(days[3].slots).toMatchObject([{ kind: "fixed", post: { pieceId: "s" } }]);
    expect(days[4].slots).toMatchObject([{ kind: "suggested", post: { idea: "x" } }]);
  });

  it("starts the week on Saturday in Farsi", () => {
    expect(weekStart(MONDAY, 6).getDay()).toBe(6);
    expect(weekStart(MONDAY, 6).getDate()).toBe(31);
  });

  it("cleans a pattern: real text channels only, a valid time and a sane gap", () => {
    const plan = cleanWeekPlan({ days: [["reel", "telegram", "nope"]], time: "25:00", gapDays: 99 });
    expect(plan.days[0]).toEqual(["telegram"]);
    expect(plan.days[1]).toEqual(DEFAULT_WEEK_PLAN.days[1]);
    expect(plan.time).toBe("09:00");
    expect(plan.gapDays).toBe(14);
  });
});

async function post(db: Db, title: string, platform: Platform, body = "A short note") {
  const [idea] = await db.insert(ideas).values({ language: "en", title, hook: "", angle: "", whyNow: "", pillar: "", sources: [], status: "approved" }).returning();
  const [piece] = await db.insert(pieces).values({ ideaId: idea.id, platform, currentVersion: 1 }).returning();
  await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content: { body }, origin: "ai", scenarioVersion: 1 });
  return piece;
}

const publishers = Object.fromEntries(
  PLATFORMS.map((platform) => [platform, { missingSettings: () => [], publish: async () => ({ externalId: "1", url: "u" }) }]),
) as unknown as Record<Platform, Publisher>;

describe("the calendar", () => {
  it("saves your pattern", async () => {
    const db = await studioDb();
    expect(await getWeekPlan(db)).toEqual(DEFAULT_WEEK_PLAN);
    await saveWeekPlan(db, everyDay(["website"]));
    expect((await getWeekPlan(db)).days[3]).toEqual(["website"]);
  });

  it("knows which posts are ready, scheduled or live", async () => {
    const db = await studioDb();
    const free = await post(db, "Free", "telegram");
    const live = await post(db, "Live", "linkedin");
    const waiting = await post(db, "Waiting", "telegram");
    const missed = await post(db, "Missed", "telegram");
    await post(db, "Video", "reel");
    await db.insert(publications).values({ pieceId: live.id, version: 1, status: "posted", postedAt: MONDAY });
    await db.insert(scheduledPosts).values([
      { pieceId: waiting.id, version: 1, at: MONDAY, status: "waiting" },
      { pieceId: missed.id, version: 1, at: MONDAY, status: "missed" },
    ]);
    const { ready, fixed } = await calendarPosts(db, "en");
    expect(ready.map((item) => item.pieceId).sort()).toEqual([free.id, missed.id].sort());
    expect(fixed.map((item) => [item.title, item.state]).sort()).toEqual([["Live", "posted"], ["Waiting", "scheduled"]]);
  });

  it("schedules the week's suggestions and names the ones that can't go out", async () => {
    const db = await studioDb();
    await saveWeekPlan(db, everyDay(["telegram"]));
    await post(db, "Good", "telegram");
    await post(db, "Too long", "telegram", "x".repeat(5000));
    const result = await scheduleWeek({ db, publishers }, "en", 1, 0, MONDAY);
    expect(result.scheduled).toBe(1);
    expect(result.problems[0]).toContain("Too long");
    const week = await loadWeek(db, "en", 1, 0, MONDAY);
    expect(week.days.flatMap((day) => day.slots).filter((slot) => slot.kind === "fixed")).toHaveLength(1);
  });

  it("plans later weeks after the earlier ones have taken their share", async () => {
    const db = await studioDb();
    await saveWeekPlan(db, { days: [[], ["telegram"], [], [], [], [], []], time: "09:00", gapDays: 0 });
    await post(db, "First", "telegram");
    await post(db, "Second", "telegram");
    const titles = async (week: number) =>
      (await loadWeek(db, "en", 1, week, MONDAY)).days.flatMap((day) => day.slots.flatMap((slot) => (slot.kind === "suggested" ? [slot.post.title] : [])));
    expect(await titles(0)).toEqual(["First"]);
    expect(await titles(1)).toEqual(["Second"]);
    expect(await titles(2)).toEqual([]);
  });
});
