import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { footage } from "../db/schema";
import { StudioError } from "../errors";
import { buildPhrases } from "./edit";
import { DATA_DIR, FFMPEG, FOOTAGE_DIR, MODEL_DIR, probe, run } from "./tools";

// Clips stay on this computer. Turning speech into text runs here too, with a free Whisper model.

export const MAX_FOOTAGE_BYTES = 4 * 1024 ** 3;
/** Room left on the disk after an upload, for the finished videos. */
const SPARE_BYTES = 1024 ** 3;
const EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv"];
const FILE = /^[0-9a-f-]{36}\.(mp4|mov|m4v|webm|mkv)$/;

/** Whisper hears at most 30 seconds at a time, so the audio is split at pauses into shorter parts. */
const WINDOW_SECONDS = 28;

export function footagePath(file: string): string | null {
  return FILE.test(file) ? path.join(/*turbopackIgnore: true*/ FOOTAGE_DIR(), file) : null;
}

async function freeBytes(dir: string): Promise<number> {
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const stats = await statfs(/*turbopackIgnore: true*/ DATA_DIR());
  return stats.bavail * stats.bsize;
}

/**
 * Saves an upload as it arrives, without holding the whole video in memory. Clips go to the
 * footage folder; an agent's samples go to that agent's own folder.
 */
export async function saveFootageStream(
  body: ReadableStream<Uint8Array>,
  originalName: string,
  size: number,
  { dir = FOOTAGE_DIR(), maxBytes = MAX_FOOTAGE_BYTES }: { dir?: string; maxBytes?: number } = {},
): Promise<string> {
  const extension = originalName.split(".").pop()?.toLowerCase() ?? "";
  const tooBig = `A video can be up to ${(maxBytes / 1024 ** 3).toFixed(0)} GB.`;
  if (!EXTENSIONS.includes(extension)) throw new StudioError("Use an MP4, MOV, M4V, WebM or MKV video.");
  if (!Number.isFinite(size) || size <= 0) throw new StudioError("Choose a video first.");
  if (size > maxBytes) throw new StudioError(tooBig);
  const free = await freeBytes(dir);
  if (free < size + SPARE_BYTES) {
    const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
    throw new StudioError(`There isn't enough room on this computer. The clip needs ${gb(size + SPARE_BYTES)} GB and ${gb(free)} GB is free. Free some space, then try again.`);
  }
  const file = `${randomUUID()}.${extension}`;
  const target = path.join(/*turbopackIgnore: true*/ dir, file);
  let written = 0;
  const counted = Readable.fromWeb(body as WebReadableStream<Uint8Array>).map((chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) throw new StudioError(tooBig);
    return chunk;
  });
  try {
    await pipeline(counted, createWriteStream(/*turbopackIgnore: true*/ target));
  } catch (error) {
    await rm(/*turbopackIgnore: true*/ target, { force: true });
    throw error instanceof StudioError ? error : new StudioError("The upload stopped before it finished. Please try again.");
  }
  if (written !== size) {
    await rm(/*turbopackIgnore: true*/ target, { force: true });
    throw new StudioError("The upload stopped before it finished. Please try again.");
  }
  return file;
}

// ---- Background work ----

// Running jobs, kept on globalThis so they survive hot reloads. A row marked as busy with no job
// here was interrupted, for example by a restart, and can be started again.
const jobs = ((globalThis as unknown as { __studioJobs?: Map<string, Promise<void>> }).__studioJobs ??= new Map());

export function isRunning(key: string): boolean {
  return jobs.has(key);
}

export function startJob(key: string, work: () => Promise<void>): void {
  if (jobs.has(key)) return;
  const job = work()
    .catch((error) => console.error(`Video job ${key} failed:`, error))
    .finally(() => jobs.delete(key));
  jobs.set(key, job);
}

/** For tests: waits until a job has finished. */
export async function waitForJob(key: string): Promise<void> {
  await jobs.get(key);
}

export type Transcriber = (input: {
  audioFile: string;
  language: string;
  windows: [number, number][];
  onProgress: (stage: "model" | "transcribing", progress: number) => void;
}) => Promise<{ text: string; start: number; end: number }[]>;

/** Runs scripts/transcribe.mjs, which uses Whisper on this computer. */
export const whisperTranscriber: Transcriber = async ({ audioFile, language, windows, onProgress }) => {
  let words: { text: string; start: number; end: number }[] | null = null;
  const script = path.resolve(/*turbopackIgnore: true*/ "scripts/transcribe.mjs");
  await run(process.execPath, [script, audioFile, language, MODEL_DIR(), JSON.stringify(windows)], {
    onLine: (line) => {
      if (!line.startsWith("{")) return;
      const message = JSON.parse(line) as { type: string; progress?: number; words?: typeof words };
      if (message.type === "download") onProgress("model", message.progress ?? 0);
      if (message.type === "progress") onProgress("transcribing", message.progress ?? 0);
      if (message.type === "done") words = message.words ?? [];
    },
  });
  if (!words) throw new Error("The transcription ended without a result.");
  return words;
};

/** Splits audio into parts of up to 28 seconds, ending each at the pause nearest that limit. */
export function speechWindows(duration: number, silences: { start: number; end: number }[]): [number, number][] {
  const windows: [number, number][] = [];
  let start = 0;
  while (duration - start > WINDOW_SECONDS) {
    const limit = start + WINDOW_SECONDS;
    const pause = silences
      .map((silence) => (silence.start + silence.end) / 2)
      .filter((middle) => middle > start + 8 && middle <= limit)
      .pop();
    const end = pause ?? limit;
    windows.push([start, end]);
    start = end;
  }
  windows.push([start, duration]);
  return windows;
}

/** Reads the clip, turns its speech into phrases, and marks it ready or failed. */
export async function processFootage(db: Db, id: string, transcribe: Transcriber = whisperTranscriber): Promise<void> {
  const [clip] = await db.select().from(footage).where(eq(footage.id, id));
  if (!clip) return;
  const file = footagePath(clip.file);
  const set = (fields: Partial<typeof footage.$inferInsert>) =>
    db.update(footage).set({ ...fields, updatedAt: new Date() }).where(eq(footage.id, id));
  const audioFile = path.join(/*turbopackIgnore: true*/ FOOTAGE_DIR(), `${id}.f32`);

  try {
    if (!file) throw new Error(`Bad clip file name ${clip.file}`);
    await set({ status: "processing", stage: "reading", progress: null, error: null });
    const info = await probe(file);
    if (!info.hasAudio) throw new StudioError("This clip has no sound, so there's nothing to caption or edit by. Upload a clip with your voice.");
    await set({ duration: info.duration, width: info.width, height: info.height, stage: "audio" });

    // The audio Whisper needs, then the pauses to split it at.
    await run(FFMPEG(), ["-hide_banner", "-nostats", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", audioFile]);
    const silences = await detectSilences(file);

    let lastWrite = 0;
    const words = await transcribe({
      audioFile,
      language: clip.language,
      windows: speechWindows(info.duration, silences),
      onProgress: (stage, progress) => {
        // Progress is saved at most every second, so the database isn't flooded.
        if (Date.now() - lastWrite < 1000 && progress < 1) return;
        lastWrite = Date.now();
        void set({ stage, progress });
      },
    });
    const phrases = buildPhrases(words);
    if (phrases.length === 0) throw new StudioError("No speech was found in this clip. Check that your microphone recorded, then upload it again.");
    await set({ status: "ready", stage: null, progress: null, phrases });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await set({
      status: "failed",
      stage: null,
      progress: null,
      error: error instanceof StudioError ? error.message : "Reading this clip didn't work. Try again, or export it from your phone as an MP4.",
    });
  } finally {
    await rm(/*turbopackIgnore: true*/ audioFile, { force: true });
  }
}

/** Runs FFmpeg for what it reports in its log, such as pauses or changes of shot, and keeps the lines that match. */
export async function ffmpegLog(args: string[], keep: (line: string) => boolean): Promise<string[]> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG(), ["-hide_banner", "-nostats", ...args], { windowsHide: true });
    const lines: string[] = [];
    let partial = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const parts = (partial + chunk.toString()).split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) if (keep(line)) lines.push(line);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (partial && keep(partial)) lines.push(partial);
      if (code === 0) resolve(lines);
      else reject(new Error(`ffmpeg exited with ${code}`));
    });
  });
}

/** FFmpeg prints the pauses it finds as log lines: the pauses of at least this many seconds. */
export async function detectSilences(file: string, minSeconds = 0.25): Promise<{ start: number; end: number }[]> {
  const lines = await ffmpegLog(["-i", file, "-vn", "-af", `silencedetect=noise=-32dB:d=${minSeconds}`, "-f", "null", "-"], (line) =>
    line.includes("silence_"),
  );
  const silences: { start: number; end: number }[] = [];
  let pending: number | null = null;
  for (const line of lines) {
    const started = line.match(/silence_start: (-?[\d.]+)/);
    const ended = line.match(/silence_end: ([\d.]+)/);
    if (started) pending = Math.max(0, Number(started[1]));
    if (ended && pending !== null) {
      silences.push({ start: pending, end: Number(ended[1]) });
      pending = null;
    }
  }
  return silences;
}

/** Starts reading a clip in the background, unless that's already happening. */
export function startProcessing(db: Db, id: string, transcribe?: Transcriber): void {
  startJob(`footage:${id}`, () => processFootage(db, id, transcribe));
}
