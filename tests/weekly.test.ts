import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ideas, pieces, pieceVersions, postResults, publications } from "@/lib/db/schema";
import type { HookKind, HookTally } from "@/lib/hooks";
import type { Platform } from "@/lib/platforms";
import type { PlannedDay } from "@/lib/plan-week";
import type { RankedRow, Standing } from "@/lib/results";
import { ideasToWrite, loadWeeklyReport, nextWeekAdvice, reportWeekStart, summarisePlan, weekLessons } from "@/lib/weekly";
import { studioDb } from "./fixtures/brand";

// Wednesday 18 November 2026, midday. With Monday as the first day, the week began on the 16th.
const NOW = new Date(2026, 10, 18, 12);
const MONDAY = new Date(2026, 10, 16);

let count = 0;
function row(
  postedAt: Date,
  { platform = "telegram", score = null, standing = null, pillar = "Baking", views = 100, hookKind = null, measured = true }: {
    platform?: Platform;
    score?: number | null;
    standing?: Standing | null;
    pillar?: string;
    views?: number;
    hookKind?: HookKind | null;
    measured?: boolean;
  } = {},
): RankedRow {
  count++;
  return {
    pieceId: `p${count}`,
    platform,
    language: "en",
    ideaId: `i${count}`,
    pairId: `pair${count}`,
    ideaTitle: `Idea ${count}`,
    pillar,
    opening: "Opening",
    hookKind,
    url: null,
    externalId: null,
    postedAt,
    numbers: measured ? { views } : null,
    note: "",
    checkedAt: null,
    score,
    standing: measured ? (standing ?? (score === null ? "early" : score >= 1.3 ? "strong" : score <= 0.7 ? "weak" : "average")) : null,
  };
}

const day = (offset: number, hour = 10) => new Date(2026, 10, 16 + offset, hour);

describe("which week", () => {
  it("starts on the first day of the week and steps back whole weeks", () => {
    expect(reportWeekStart(NOW, 1, 0)).toEqual(MONDAY);
    expect(reportWeekStart(NOW, 1, -1)).toEqual(new Date(2026, 10, 9));
    // Farsi weeks start on Saturday.
    expect(reportWeekStart(NOW, 6, 0)).toEqual(new Date(2026, 10, 14));
  });
});

describe("what one week looked like", () => {
  it("keeps only that week's posts, in order, and compares with the week before", () => {
    const rows = [
      row(day(2), { score: 2, views: 900, hookKind: "question" }),
      row(day(0), { score: 0.5, views: 50, hookKind: "question", pillar: "Tools" }),
      row(day(1), { platform: "linkedin", measured: false }),
      row(day(7), { score: 1 }), // next week
      row(day(-3), { views: 300 }), // the week before
      row(day(6, 23), { score: 1.1, views: 200, hookKind: "bold" }), // last evening of the week
    ];
    const week = weekLessons(rows, MONDAY);
    expect(week.posts.map((post) => post.postedAt)).toEqual([day(0), day(1), day(2), day(6, 23)]);
    expect(week.totals).toEqual({ posted: 4, measured: 3, views: 1150, channels: 2 });
    expect(week.previous).toEqual({ posted: 1, measured: 1, views: 300, channels: 1 });
    expect(week.worked.map((post) => post.score)).toEqual([2, 1.1]);
    expect(week.weak.map((post) => post.score)).toEqual([0.5]);
    expect(week.topics.map((topic) => topic.key)).toEqual(["Baking", "Tools"]);
    expect(week.hooks.find((tally) => tally.kind === "question")).toMatchObject({ live: 2, score: 1.25 });
    expect(week.missingNumbers).toBe(1);
  });

  it("is empty for a quiet week", () => {
    const week = weekLessons([row(day(-10))], MONDAY);
    expect(week.posts).toEqual([]);
    expect(week.worked).toEqual([]);
    expect(week.totals.posted).toBe(0);
  });
});

describe("next week's plan", () => {
  it("counts booked, suggested and open slots by channel", () => {
    const at = day(7, 9);
    const post = { pieceId: "x", ideaId: "i", platform: "linkedin" as Platform, idea: "pair", title: "T" };
    const days: PlannedDay[] = [
      {
        date: day(7),
        past: false,
        slots: [
          { kind: "fixed", platform: "linkedin", post: { ...post, at, state: "scheduled" } },
          { kind: "suggested", platform: "telegram", at, post: { ...post, platform: "telegram", version: 1, createdAt: at } },
          { kind: "empty", platform: "instagram", at },
        ],
      },
      { date: day(8), past: false, slots: [{ kind: "empty", platform: "instagram", at }, { kind: "empty", platform: "website", at }] },
    ];
    expect(summarisePlan(day(7, 0), days)).toEqual({
      start: day(7, 0),
      scheduled: 1,
      suggested: 1,
      empty: [
        { platform: "instagram", count: 2 },
        { platform: "website", count: 1 },
      ],
    });
  });
});

describe("what to make next week", () => {
  const hooks: HookTally[] = [
    { kind: "number", picked: 3, live: 3, compared: 3, score: 1.6 },
    { kind: "question", picked: 2, live: 2, compared: 2, score: 0.8 },
  ];
  const history = () => [
    row(day(-20), { score: 1.6, pillar: "Baking" }),
    row(day(-13), { score: 1.4, pillar: "Baking" }),
    row(day(-6), { score: 0.6, pillar: "Tools" }),
    row(day(-5), { score: 0.5, pillar: "Tools" }),
  ];

  it("asks for numbers before it gives rules", () => {
    const rows = [row(day(1), { score: 1.5 })];
    const advice = nextWeekAdvice({ rows, week: weekLessons(rows, MONDAY), hooks, plan: null, waitingIdeas: [] });
    expect(advice.map((item) => item.kind)).toEqual(["followUp", "needData"]);
  });

  it("builds on the week's strong post, names the best topic and hook, and fills open slots with ideas on that topic", () => {
    const rows = [...history(), row(day(1), { score: 1.8, pillar: "Baking" }), row(day(2), { measured: false })];
    const week = weekLessons(rows, MONDAY);
    const advice = nextWeekAdvice({
      rows,
      week,
      hooks,
      plan: { start: day(7, 0), scheduled: 0, suggested: 2, empty: [{ platform: "linkedin", count: 1 }] },
      waitingIdeas: [
        { id: "a", title: "About tools", pillar: "Tools", language: "en" },
        { id: "b", title: "About baking", pillar: " baking ", language: "en" },
      ],
    });
    expect(advice.map((item) => item.kind)).toEqual(["followUp", "topic", "hook", "easeTopic", "schedule", "fill", "numbers"]);
    expect(advice[0]).toMatchObject({ post: { score: 1.8 } });
    expect(advice[1]).toMatchObject({ topic: "Baking", posts: 3 });
    expect(advice[2]).toMatchObject({ hook: "number", score: 1.6 });
    expect(advice[3]).toMatchObject({ topic: "Tools" });
    const fill = advice.find((item) => item.kind === "fill");
    expect(fill?.kind === "fill" && fill.ideas.map((idea) => idea.id)).toEqual(["b", "a"]);
    expect(advice.at(-1)).toEqual({ kind: "numbers", count: 1 });
  });

  it("doesn't push a hook kind that does no better than usual", () => {
    const rows = history().concat(row(day(1), { score: 1 }));
    const advice = nextWeekAdvice({
      rows,
      week: weekLessons(rows, MONDAY),
      hooks: [{ kind: "question", picked: 2, live: 2, compared: 2, score: 0.9 }],
      plan: null,
      waitingIdeas: [],
    });
    expect(advice.some((item) => item.kind === "hook")).toBe(false);
    expect(advice.some((item) => item.kind === "followUp")).toBe(false);
  });
});

describe("loading the report", () => {
  let db: Db;
  beforeEach(async () => {
    db = await studioDb();
  });

  async function idea(title: string, { status = "approved", language = "en" }: { status?: "approved" | "proposed"; language?: string } = {}) {
    const [made] = await db
      .insert(ideas)
      .values({ language, title, hook: "H", angle: "A", whyNow: "N", pillar: "Baking", sources: [], status })
      .returning();
    return made;
  }

  it("suggests only approved ideas with nothing written yet", async () => {
    const waiting = await idea("Waiting");
    await idea("Proposed", { status: "proposed" });
    await idea("Farsi", { language: "fa" });
    const written = await idea("Written");
    await db.insert(pieces).values({ ideaId: written.id, platform: "telegram", currentVersion: 1 });
    expect((await ideasToWrite(db, "en")).map((entry) => entry.id)).toEqual([waiting.id]);
  });

  it("puts the week's live posts together with next week's plan", async () => {
    const made = await idea("Live one");
    const [piece] = await db.insert(pieces).values({ ideaId: made.id, platform: "telegram", currentVersion: 1 }).returning();
    await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content: { body: "Hello there." }, origin: "ai", scenarioVersion: 1 });
    await db.insert(publications).values({ pieceId: piece.id, version: 1, status: "posted", postedAt: day(1) });
    await db.insert(postResults).values({ pieceId: piece.id, numbers: { views: 40 }, note: "" });

    const asked: number[] = [];
    const planFor = async (weeks: number) => {
      asked.push(weeks);
      return { start: day(7 * weeks, 0), days: [] };
    };
    const thisWeek = await loadWeeklyReport(db, { language: "en", firstDay: 1, offset: 0, now: NOW, planFor });
    expect(thisWeek.week.posts.map((post) => post.ideaTitle)).toEqual(["Live one"]);
    expect(thisWeek.week.totals.views).toBe(40);
    expect(thisWeek.plan).toMatchObject({ start: day(7, 0), suggested: 0 });
    expect(thisWeek.hasEarlier).toBe(false);

    const lastWeek = await loadWeeklyReport(db, { language: "en", firstDay: 1, offset: -1, now: NOW, planFor });
    expect(lastWeek.week.posts).toEqual([]);
    expect(lastWeek.plan).not.toBeNull();
    const longAgo = await loadWeeklyReport(db, { language: "en", firstDay: 1, offset: -3, now: NOW, planFor });
    expect(longAgo.plan).toBeNull();
    expect(asked).toEqual([1, 0]);
  });
});
