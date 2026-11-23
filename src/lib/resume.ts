import { eq, sql } from "drizzle-orm";
import { retrySample, sampleJobKey } from "./agents/editor/samples";
import { animationState, makeAnimation, replanAnimation, retryNarration } from "./animations";
import { resumeVideo, retryFootage } from "./content";
import type { Db } from "./db/client";
import { animations, editorSamples, footage, jobResumes, videoRenders } from "./db/schema";
import { StudioError } from "./errors";
import type { StudioDeps } from "./studio";
import { isRunning, waitForJob, type Transcriber } from "./video/footage";
import type { DrawFrames } from "./video/frames";
import type { DrawCards } from "./video/render";

/**
 * Work cut off by a restart, a crash or a closed laptop picks up again by itself when the studio
 * starts: reading clips, measuring the editor's samples, reading narrations, planning scenes and
 * making videos. Each starts from the beginning, since none of them can continue halfway.
 *
 * The heavy ones run one after another, because two transcriptions at once on a laptop take longer
 * than one after the other. A job that was cut off twice in a row is left as failed with a message,
 * so a job that stops the studio every time can't keep stopping it.
 */
export const MAX_RESUMES = 2;

const GAVE_UP = "This stopped before it finished twice in a row, so the studio didn't start it again. Press Try again when you're ready.";

type Options = { transcribe?: Transcriber; draw?: DrawCards; frames?: DrawFrames };

/** Counts one more pick-up for this job. False once it has been picked up too often. */
async function mayResume(db: Db, key: string): Promise<boolean> {
  const [row] = await db
    .insert(jobResumes)
    .values({ key, count: 1 })
    .onConflictDoUpdate({ target: jobResumes.key, set: { count: sql`${jobResumes.count} + 1`, updatedAt: new Date() } })
    .returning({ count: jobResumes.count });
  if (row.count <= MAX_RESUMES) return true;
  await forget(db, key);
  return false;
}

const forget = (db: Db, key: string) => db.delete(jobResumes).where(eq(jobResumes.key, key));

/** Starts one job again, waits for it, and clears its count once it finished either way. */
async function resume(db: Db, key: string, start: () => Promise<unknown>, giveUp: (message: string) => Promise<unknown>) {
  if (isRunning(key)) return;
  try {
    if (!(await mayResume(db, key))) {
      await giveUp(GAVE_UP);
      return;
    }
    await start();
    await waitForJob(key);
    await forget(db, key);
  } catch (error) {
    // A job that can't be started now, such as a post edited since, says why and stays stopped.
    if (!(error instanceof StudioError)) console.error(`Couldn't pick up ${key} again:`, error);
    await giveUp(error instanceof StudioError ? error.message : "This stopped before it finished. Press Try again.").catch(() => {});
    await forget(db, key).catch(() => {});
  }
}

/** Finds every job that was cut off and starts it again. Returns how many were found. */
export async function resumeInterruptedWork(deps: Pick<StudioDeps, "db" | "writer">, options: Options = {}): Promise<number> {
  const { db } = deps;
  const { transcribe, draw, frames } = options;
  let found = 0;

  // Planning only waits for the AI, so it runs alongside the rest.
  const planning: Promise<void>[] = [];
  const animationRows = await db.select({ id: animations.id }).from(animations);
  const animationStates = await Promise.all(animationRows.map((row) => animationState(db, row.id)));
  for (const state of animationStates.filter((state) => state.planStopped)) {
    found++;
    const id = state.row.id;
    planning.push(
      resume(
        db,
        `plan:${id}`,
        () => replanAnimation(deps, id, "ai"),
        (message) => db.update(animations).set({ planStatus: "failed", planError: message, updatedAt: new Date() }).where(eq(animations.id, id)),
      ),
    );
  }

  // Speech first, since videos are made from it.
  const clips = await db.select({ id: footage.id }).from(footage).where(eq(footage.status, "processing"));
  for (const { id } of clips) {
    if (isRunning(`footage:${id}`)) continue;
    found++;
    await resume(
      db,
      `footage:${id}`,
      () => retryFootage(db, id, transcribe),
      (message) => db.update(footage).set({ status: "failed", stage: null, progress: null, error: message, updatedAt: new Date() }).where(eq(footage.id, id)),
    );
  }

  const samples = await db.select({ id: editorSamples.id }).from(editorSamples).where(eq(editorSamples.status, "processing"));
  for (const { id } of samples) {
    if (isRunning(sampleJobKey(id))) continue;
    found++;
    await resume(
      db,
      sampleJobKey(id),
      () => retrySample(db, id, transcribe),
      (message) => db.update(editorSamples).set({ status: "failed", stage: null, error: message, updatedAt: new Date() }).where(eq(editorSamples.id, id)),
    );
  }

  for (const state of animationStates.filter((state) => state.narrationStopped)) {
    found++;
    const id = state.row.id;
    await resume(
      db,
      `narration:${id}`,
      () => retryNarration(db, id, transcribe),
      (message) =>
        db
          .update(animations)
          .set({ narrationStatus: "failed", narrationStage: null, narrationProgress: null, narrationError: message, updatedAt: new Date() })
          .where(eq(animations.id, id)),
    );
  }

  // Videos: only the one for the post as it is now. A video for a version edited since is dropped.
  const renders = await db.select({ key: videoRenders.key }).from(videoRenders).where(eq(videoRenders.status, "working"));
  for (const { key } of renders) {
    const jobKey = `render:${key}`;
    if (isRunning(jobKey)) continue;
    found++;
    await resume(
      db,
      jobKey,
      () => resumeVideo(db, key, draw),
      (message) => db.update(videoRenders).set({ status: "failed", progress: null, error: message, updatedAt: new Date() }).where(eq(videoRenders.key, key)),
    );
  }

  // Animations, read again in case a narration above changed what the video will be.
  for (const { id } of animationRows) {
    const state = await animationState(db, id).catch(() => null);
    if (!state?.stopped) continue;
    found++;
    await resume(
      db,
      `animation:${state.key}`,
      () => makeAnimation(db, id, frames),
      (message) => db.update(animations).set({ renderStatus: "failed", renderProgress: null, renderError: message, updatedAt: new Date() }).where(eq(animations.id, id)),
    );
  }

  await Promise.all(planning);
  return found;
}

const store = globalThis as unknown as { __studioResumed?: boolean };

/** Picks up cut-off work once, a few seconds after the studio starts. */
export function startResuming(delayMs = 5_000) {
  if (store.__studioResumed) return;
  store.__studioResumed = true;
  setTimeout(async () => {
    try {
      const { defaultDeps } = await import("./studio");
      const count = await resumeInterruptedWork(await defaultDeps());
      if (count > 0) console.log(`The studio picked up ${count} job${count === 1 ? "" : "s"} that a restart had cut off.`);
    } catch (error) {
      console.error("The studio couldn't pick up cut-off work:", error);
    }
  }, delayMs);
}
