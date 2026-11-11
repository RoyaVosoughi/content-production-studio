import { beforeEach, describe, expect, it, vi } from "vitest";
import { studioDb } from "./fixtures/brand";
import type { Db } from "@/lib/db/client";
import { ideas, pieces, pieceVersions, publications, scheduledPosts } from "@/lib/db/schema";
import { StudioError } from "@/lib/errors";
import type { Platform } from "@/lib/platforms";
import type { PublishDeps } from "@/lib/content";
import type { Publisher } from "@/lib/publishers/types";
import { PublishRejected } from "@/lib/publishers/types";
import { cancelSchedule, localTimeValue, parseLocalTime, runDueSchedules, schedulePost, upcomingPosts } from "@/lib/schedule";

const MINUTE = 60_000;
let db: Db;
let publish: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<{ externalId: string; url: string }>>>;
let deps: PublishDeps;

function publisher(): Publisher {
  return { missingSettings: () => [], publish: (...args) => publish(...args) } as Publisher;
}

/** An approved Telegram post at version 1, not yet posted. */
async function draftPost(body = "A post about agents") {
  const pairId = crypto.randomUUID();
  const [idea] = await db
    .insert(ideas)
    .values({ pairId, language: "en", title: "Agents", hook: "H", angle: "A", whyNow: "N", pillar: "P", sources: [], status: "approved" })
    .returning();
  const [piece] = await db.insert(pieces).values({ ideaId: idea.id, platform: "telegram", currentVersion: 1 }).returning();
  await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content: { body }, origin: "ai", scenarioVersion: 1 });
  return piece.id;
}

async function scheduleRow(pieceId: string) {
  const [row] = await db.select().from(scheduledPosts).where((await import("drizzle-orm")).eq(scheduledPosts.pieceId, pieceId));
  return row;
}

async function publication(pieceId: string) {
  const [row] = await db.select().from(publications).where((await import("drizzle-orm")).eq(publications.pieceId, pieceId));
  return row;
}

beforeEach(async () => {
  db = await studioDb();
  publish = vi.fn(async () => ({ externalId: "7", url: "https://t.me/c/1/7" }));
  const all = Object.fromEntries(
    ["telegram", "linkedin", "instagram", "website", "reel", "short", "youtube", "linkedin_video"].map((p) => [p, publisher()]),
  ) as Record<Platform, Publisher>;
  deps = { db, publishers: all, slideImages: async () => [] };
});

describe("times", () => {
  it("reads the date-and-time box in local time, and back", () => {
    const date = parseLocalTime("2026-11-12T09:30");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 10, 12, 9, 30]);
    expect(localTimeValue(date)).toBe("2026-11-12T09:30");
    expect(() => parseLocalTime("tomorrow")).toThrow(StudioError);
  });
});

describe("scheduling", () => {
  it("posts the exact version at its time, not before", async () => {
    const pieceId = await draftPost();
    const now = new Date();
    const at = new Date(now.getTime() + 30 * MINUTE);
    await schedulePost(deps, pieceId, 1, at, now);
    await runDueSchedules(deps, new Date(at.getTime() - MINUTE));
    expect(publish).not.toHaveBeenCalled();
    await runDueSchedules(deps, new Date(at.getTime() + MINUTE));
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][0] as { content: { body: string } }).content.body).toBe("A post about agents");
    expect((await publication(pieceId)).status).toBe("posted");
    expect(await scheduleRow(pieceId)).toBeUndefined();
    // A second check doesn't post again.
    await runDueSchedules(deps, new Date(at.getTime() + 2 * MINUTE));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("refuses a time in the past, a stale version, and a post with a placeholder", async () => {
    const pieceId = await draftPost();
    const now = new Date();
    await expect(schedulePost(deps, pieceId, 1, new Date(now.getTime() - MINUTE), now)).rejects.toBeInstanceOf(StudioError);
    await expect(schedulePost(deps, pieceId, 2, new Date(now.getTime() + 60 * MINUTE), now)).rejects.toBeInstanceOf(StudioError);
    const unfinished = await draftPost("See [add link]");
    await expect(schedulePost(deps, unfinished, 1, new Date(now.getTime() + 60 * MINUTE), now)).rejects.toThrow(/square brackets/);
  });

  it("cancels the schedule when the post changed after scheduling", async () => {
    const pieceId = await draftPost();
    const now = new Date();
    const at = new Date(now.getTime() + 10 * MINUTE);
    await schedulePost(deps, pieceId, 1, at, now);
    await db.insert(pieceVersions).values({ pieceId, version: 2, content: { body: "Edited" }, origin: "edit", scenarioVersion: 1 });
    await db.update(pieces).set({ currentVersion: 2 });
    expect((await upcomingPosts(db))[0].changed).toBe(true);
    await runDueSchedules(deps, new Date(at.getTime() + MINUTE));
    expect(publish).not.toHaveBeenCalled();
    expect((await scheduleRow(pieceId)).status).toBe("cancelled");
  });

  it("doesn't post more than an hour late, and waits for you instead", async () => {
    const pieceId = await draftPost();
    const now = new Date();
    const at = new Date(now.getTime() + 10 * MINUTE);
    await schedulePost(deps, pieceId, 1, at, now);
    await runDueSchedules(deps, new Date(at.getTime() + 61 * MINUTE));
    expect(publish).not.toHaveBeenCalled();
    expect((await scheduleRow(pieceId)).status).toBe("missed");
    // Scheduling again replaces the missed one.
    await schedulePost(deps, pieceId, 1, new Date(now.getTime() + 120 * MINUTE), now);
    expect((await scheduleRow(pieceId)).status).toBe("waiting");
  });

  it("shows a refusal from the network as a failed post that can be tried again", async () => {
    const pieceId = await draftPost();
    publish.mockRejectedValueOnce(new PublishRejected("Telegram said the bot isn't an admin."));
    const now = new Date();
    const at = new Date(now.getTime() + 5 * MINUTE);
    await schedulePost(deps, pieceId, 1, at, now);
    await runDueSchedules(deps, new Date(at.getTime() + MINUTE));
    const row = await publication(pieceId);
    expect(row.status).toBe("failed");
    expect(row.error).toContain("admin");
    expect(await scheduleRow(pieceId)).toBeUndefined();
  });

  it("can be cancelled, and posting now clears it", async () => {
    const a = await draftPost();
    const now = new Date();
    await schedulePost(deps, a, 1, new Date(now.getTime() + 60 * MINUTE), now);
    await cancelSchedule(db, a);
    expect(await upcomingPosts(db)).toEqual([]);

    const { approveAndPublish } = await import("@/lib/content");
    const b = await draftPost();
    await schedulePost(deps, b, 1, new Date(now.getTime() + 60 * MINUTE), now);
    await approveAndPublish(deps, b, 1);
    expect(await scheduleRow(b)).toBeUndefined();
    await expect(schedulePost(deps, b, 1, new Date(now.getTime() + 90 * MINUTE), now)).rejects.toThrow(/already live/);
  });
});
