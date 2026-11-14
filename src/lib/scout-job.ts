import { StudioError } from "./errors";
import type { Language } from "./language";

/**
 * The idea scout's search runs in the background, so the page never waits on it: you can open the
 * map or any other page while it works, and stop it if you asked by mistake. The studio runs on your
 * own computer for one person, so one search at a time, kept in memory, is enough.
 */
export type ScoutJobStatus = "running" | "done" | "failed" | "stopped";

export type ScoutJob = {
  id: string;
  language: Language;
  status: ScoutJobStatus;
  /** How many ideas were saved, once done. */
  count: number;
  /** What went wrong, in words for the person, once failed. */
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  stopRequested: boolean;
  /** False while the work is still winding down, even after a stop has been shown as done. */
  settled: boolean;
};

/** Thrown inside the search when you stop it, so nothing half-done is saved. */
export class StoppedError extends StudioError {
  constructor() {
    super("Stopped. Nothing was saved.");
  }
}

// Kept on globalThis so a code reload in development doesn't lose a search that is still running.
const store = globalThis as unknown as { __studioScoutJob?: ScoutJob };

/** What the person sees about the latest search: a copy, so callers can't change it. */
export function currentScoutJob(): Omit<ScoutJob, "stopRequested" | "settled"> | null {
  const job = store.__studioScoutJob;
  if (!job) return null;
  const { stopRequested: _stop, settled: _settled, ...shown } = job;
  return shown;
}

/** True until the last search has fully finished, including one you stopped that is still winding down. */
export function scoutIsRunning(): boolean {
  const job = store.__studioScoutJob;
  return job ? !job.settled : false;
}

/**
 * Starts a search unless one is already running. `run` receives a check to call between steps;
 * it throws StoppedError once you've asked to stop. Returns the job, or null when one was running.
 */
export function startScoutJob(
  language: Language,
  run: (stopIfAsked: () => void) => Promise<number>,
  describe: (error: unknown) => string,
  onFinish?: () => void,
): ScoutJob | null {
  if (scoutIsRunning()) return null;
  const job: ScoutJob = {
    id: crypto.randomUUID(),
    language,
    status: "running",
    count: 0,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
    stopRequested: false,
    settled: false,
  };
  store.__studioScoutJob = job;
  const stopIfAsked = () => {
    if (job.stopRequested) throw new StoppedError();
  };
  void run(stopIfAsked)
    .then((count) => {
      // A stop that arrives after the last check is too late to undo the save, so the ideas stay.
      job.status = "done";
      job.count = count;
      job.endedAt = Date.now();
    })
    .catch((error: unknown) => {
      if (error instanceof StoppedError || job.stopRequested) {
        job.status = "stopped";
      } else {
        job.status = "failed";
        job.error = describe(error);
        job.endedAt = Date.now();
      }
    })
    .finally(() => {
      job.settled = true;
      onFinish?.();
    });
  return job;
}

/**
 * Stops the running search. It shows as stopped at once; an AI call already on its way is left to
 * finish in the background, and its result is thrown away at the next step, so nothing is saved.
 * Returns false when nothing is running.
 */
export function stopScoutJob(): boolean {
  const job = store.__studioScoutJob;
  if (!job || job.status !== "running") return false;
  job.stopRequested = true;
  job.status = "stopped";
  job.endedAt = Date.now();
  return true;
}
