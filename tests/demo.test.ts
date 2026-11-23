import { beforeAll, describe, expect, it } from "vitest";
import { loadWeek } from "@/lib/calendar";
import { createLocalDb, type Db } from "@/lib/db/client";
import { ideas, pieces, pieceVersions, profiles, scheduledPosts } from "@/lib/db/schema";
import { seedDemo } from "@/lib/demo";
import { contentProblem, isPlatform } from "@/lib/platforms";
import { studioProgress } from "@/lib/progress";
import { hookOverview, resultsOverview } from "@/lib/results";
import { loadWeeklyReport } from "@/lib/weekly";
import { and, eq } from "drizzle-orm";

// The demo has to make every page look like a studio in use, whatever day it is seeded on.
const NOW = new Date(2026, 10, 25, 14);

let db: Db;
beforeAll(async () => {
  db = await createLocalDb();
  expect(await seedDemo(db, NOW)).toBe(true);
});

describe("demo data", () => {
  it("never lands on a studio that already has work in it", async () => {
    expect(await seedDemo(db, NOW)).toBe(false);
    expect(await db.select().from(profiles)).toHaveLength(1);
  });

  it("walks through every step of the studio", async () => {
    for (const language of ["en", "fa"]) {
      const steps = await studioProgress(db, "en", language);
      expect(steps.every((step) => step.done)).toBe(true);
    }
  });

  it("has ideas at every stage", async () => {
    const statuses = (await db.select({ status: ideas.status }).from(ideas)).map((row) => row.status);
    expect(new Set(statuses)).toEqual(new Set(["proposed", "approved", "rejected"]));
  });

  it("writes only posts that could be posted", async () => {
    const rows = await db
      .select({ platform: pieces.platform, content: pieceVersions.content })
      .from(pieces)
      .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, pieces.currentVersion)));
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      expect(isPlatform(row.platform)).toBe(true);
      if (isPlatform(row.platform)) expect(contentProblem(row.platform, row.content)).toBeNull();
    }
  });

  it("fills Results with compared posts, and the hooks card with a clear winner", async () => {
    const ranked = await resultsOverview(db);
    expect(ranked.filter((row) => row.score !== null).length).toBeGreaterThanOrEqual(20);
    expect(ranked.some((row) => row.standing === "strong")).toBe(true);
    expect(ranked.some((row) => row.standing === "weak")).toBe(true);
    expect(ranked.some((row) => row.numbers === null)).toBe(true);
    const hooks = await hookOverview(db);
    expect(hooks[0].kind).toBe("story");
    expect(hooks.at(-1)!.score ?? 0).toBeLessThan(1);
  });

  it("gives last week's report real advice, not a request for more numbers", async () => {
    const report = await loadWeeklyReport(db, {
      language: "en",
      firstDay: 1,
      offset: -1,
      now: NOW,
      planFor: (weeks) => loadWeek(db, "en", 1, weeks, NOW),
    });
    expect(report.week.posts.length).toBeGreaterThan(3);
    expect(report.week.worked.length).toBeGreaterThan(0);
    expect(report.advice.some((entry) => entry.kind === "needData")).toBe(false);
    expect(report.advice.some((entry) => entry.kind === "topic")).toBe(true);
    expect(report.advice[0].kind).toBe("followUp");
  });

  it("has a full last week whichever day it is seeded on, in both week layouts", async () => {
    for (let day = 0; day < 7; day++) {
      const now = new Date(2026, 10, 22 + day, 8);
      const fresh = await createLocalDb();
      await seedDemo(fresh, now);
      for (const firstDay of [1, 6]) {
        const report = await loadWeeklyReport(fresh, { language: "en", firstDay, offset: -1, now, planFor: (weeks) => loadWeek(fresh, "en", firstDay, weeks, now) });
        expect(report.week.posts.length, `seeded ${now.toDateString()}, week from day ${firstDay}`).toBeGreaterThan(3);
        expect(report.advice.some((entry) => entry.kind === "needData")).toBe(false);
      }
    }
  }, 180000);

  it("leaves next week's calendar with booked, suggested and open slots", async () => {
    expect(await db.select().from(scheduledPosts)).toHaveLength(2);
    const week = await loadWeek(db, "en", 1, 1, NOW);
    const slots = week.days.flatMap((day) => day.slots);
    expect(slots.some((slot) => slot.kind === "fixed")).toBe(true);
    expect(slots.some((slot) => slot.kind === "suggested")).toBe(true);
  });
});
