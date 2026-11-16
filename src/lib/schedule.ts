import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { approveAndPublish, checkPostable, type PublishDeps } from "./content";
import type { Db } from "./db/client";
import { ideas, pieces, publications, scheduledPosts } from "./db/schema";
import { StudioError } from "./errors";
import { isPlatform, type Platform } from "./platforms";

// You approve a version to go out later. The studio runs on your computer, so it can only post
// while it's running: a post whose time passed while the studio was off waits for you to decide,
// unless it's less than an hour late, because a post hours late can be wrong for its moment.

export const LATE_LIMIT_MINUTES = 60;
const MAX_DAYS_AHEAD = 90;
/** A scheduled send that never finished, because the studio stopped mid-post, is resolved after this. */
const STUCK_MINUTES = 10;
const MINUTE = 60_000;

/** Reads the browser's date-and-time box, which is in your local time, the same as this computer's. */
export function parseLocalTime(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new StudioError("Choose a date and time.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) throw new StudioError("Choose a date and time.");
  return date;
}

/** The value for a date-and-time box, in this computer's local time. */
export function localTimeValue(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Approves this exact version to go out at a set time. Replaces any earlier schedule for the post. */
export async function schedulePost(
  deps: Pick<PublishDeps, "db" | "publishers">,
  pieceId: string,
  version: number,
  at: Date,
  now = new Date(),
) {
  if (at.getTime() < now.getTime() + MINUTE) throw new StudioError("Choose a time in the future, or post it now.");
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * MINUTE) {
    throw new StudioError(`Choose a time within the next ${MAX_DAYS_AHEAD} days.`);
  }
  // The same checks as posting now, so a scheduled post can't fail for a reason known today.
  await checkPostable(deps, pieceId, version);
  const [publication] = await deps.db.select().from(publications).where(eq(publications.pieceId, pieceId));
  if (publication && publication.status !== "failed") {
    throw new StudioError(publication.status === "posted" ? "This post is already live." : "This post may already have gone out. Check the platform first.");
  }
  const values = { version, at, status: "waiting" as const, error: null };
  await deps.db
    .insert(scheduledPosts)
    .values({ pieceId, ...values })
    .onConflictDoUpdate({ target: scheduledPosts.pieceId, set: { ...values, createdAt: new Date() } });
}

export async function cancelSchedule(db: Db, pieceId: string) {
  await db.delete(scheduledPosts).where(eq(scheduledPosts.pieceId, pieceId));
}

/** Posts everything whose time has come. Safe to run often: each post is claimed before it's sent. */
export async function runDueSchedules(deps: PublishDeps, now = new Date()): Promise<void> {
  const { db } = deps;
  await resolveStuck(db, now);
  const due = await db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "waiting"), lte(scheduledPosts.at, now)))
    .orderBy(asc(scheduledPosts.at));
  for (const row of due) {
    const claimed = await db
      .update(scheduledPosts)
      .set({ status: "sending" })
      .where(and(eq(scheduledPosts.pieceId, row.pieceId), eq(scheduledPosts.status, "waiting")))
      .returning();
    if (claimed.length === 0) continue;
    const mark = (status: "missed" | "failed" | "cancelled", error: string) =>
      db.update(scheduledPosts).set({ status, error }).where(eq(scheduledPosts.pieceId, row.pieceId));

    if (now.getTime() - row.at.getTime() > LATE_LIMIT_MINUTES * MINUTE) {
      await mark("missed", "The studio wasn't running at that time, so nothing was posted.");
      continue;
    }
    const [piece] = await db.select().from(pieces).where(eq(pieces.id, row.pieceId));
    if (!piece || piece.currentVersion !== row.version) {
      await mark("cancelled", "The post changed after you scheduled it, so the schedule was cancelled.");
      continue;
    }
    try {
      await approveAndPublish(deps, row.pieceId, row.version);
      // The post's own status now shows whether it went out.
      await cancelSchedule(db, row.pieceId);
    } catch (error) {
      if (!(error instanceof StudioError)) console.error("A scheduled post couldn't go out:", error);
      await mark("failed", error instanceof StudioError ? error.message : "Something went wrong at the scheduled time, so nothing was posted.");
    }
  }
}

/** A send that was cut off when the studio stopped: the post's own status says what happened. */
async function resolveStuck(db: Db, now: Date) {
  const stuck = await db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "sending"), lte(scheduledPosts.at, new Date(now.getTime() - STUCK_MINUTES * MINUTE))));
  for (const row of stuck) {
    const [publication] = await db.select().from(publications).where(eq(publications.pieceId, row.pieceId));
    if (publication) await cancelSchedule(db, row.pieceId);
    else {
      await db
        .update(scheduledPosts)
        .set({ status: "failed", error: "The studio stopped before this post went out, so nothing was posted." })
        .where(eq(scheduledPosts.pieceId, row.pieceId));
    }
  }
}

export type Schedule = typeof scheduledPosts.$inferSelect;

export async function schedulesFor(db: Db, pieceIds: string[]): Promise<Map<string, Schedule>> {
  if (pieceIds.length === 0) return new Map();
  const rows = await db.select().from(scheduledPosts).where(inArray(scheduledPosts.pieceId, pieceIds));
  return new Map(rows.map((row) => [row.pieceId, row]));
}

/** Everything scheduled or needing attention, soonest first, for the Ideas page. */
export async function upcomingPosts(db: Db) {
  const rows = await db
    .select({ schedule: scheduledPosts, piece: pieces, idea: ideas })
    .from(scheduledPosts)
    .innerJoin(pieces, eq(pieces.id, scheduledPosts.pieceId))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .orderBy(asc(scheduledPosts.at));
  return rows.flatMap(({ schedule, piece, idea }) =>
    isPlatform(piece.platform)
      ? [
          {
            ...schedule,
            platform: piece.platform as Platform,
            ideaId: idea.id,
            language: idea.language,
            title: idea.title,
            // An edit since scheduling cancels it; the studio marks it at the time, but it shows now.
            changed: schedule.status === "waiting" && piece.currentVersion !== schedule.version,
          },
        ]
      : [],
  );
}

// ---- The clock ----

const clock = globalThis as unknown as {
  __studioScheduler?: ReturnType<typeof setInterval>;
  __studioSchedulerBusy?: boolean;
  __studioInstagramSyncAt?: number;
};

/** Reads Instagram's numbers for live posts about once a day, when an Instagram token is set. */
async function syncInstagramDaily(now = Date.now()) {
  if (!process.env.INSTAGRAM_ACCESS_TOKEN) return;
  if (clock.__studioInstagramSyncAt && now - clock.__studioInstagramSyncAt < 24 * 3600 * 1000) return;
  clock.__studioInstagramSyncAt = now;
  try {
    const [{ getDb }, { fetchInstagramNumbers }, { syncInstagramResults }] = await Promise.all([
      import("./db/client"),
      import("./publishers/instagram"),
      import("./results"),
    ]);
    await syncInstagramResults(await getDb(), fetchInstagramNumbers);
  } catch (error) {
    console.error("The studio couldn't read Instagram's numbers:", error);
  }
}

/** Checks every 30 seconds for posts whose time has come. Started once when the studio starts. */
export function startScheduler(intervalMs = 30_000) {
  if (clock.__studioScheduler) return;
  const tick = async () => {
    if (clock.__studioSchedulerBusy) return;
    clock.__studioSchedulerBusy = true;
    try {
      const { defaultPublishDeps } = await import("./content");
      await runDueSchedules(await defaultPublishDeps());
      await syncInstagramDaily();
    } catch (error) {
      console.error("The scheduler couldn't check for posts:", error);
    } finally {
      clock.__studioSchedulerBusy = false;
    }
  };
  clock.__studioScheduler = setInterval(tick, intervalMs);
  setTimeout(tick, 5_000);
}
