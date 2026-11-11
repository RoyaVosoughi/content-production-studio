import { isContentLanguage } from "../../language";
import { rm } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { editorSamples, type SampleMeasures } from "../../db/schema";
import { StudioError } from "../../errors";
import { isVideoPlatform, type VideoPlatform } from "../../platforms";
import {
  detectSilences,
  ffmpegLog,
  isRunning,
  saveFootageStream,
  speechWindows,
  startJob,
  whisperTranscriber,
  type Transcriber,
} from "../../video/footage";
import { DATA_DIR, FFMPEG, probe, run } from "../../video/tools";

// The Video Editor's own space: videos you like the editing of, measured on this computer.
// The free AI can't watch video, so the editor learns from what is measured here and from your notes.

export const SAMPLE_DIR = () => path.join(/*turbopackIgnore: true*/ DATA_DIR(), "agents", "editor", "samples");
export const MAX_SAMPLE_BYTES = 2 * 1024 ** 3;
const MAX_SAMPLE_SECONDS = 15 * 60;
/** Speech is read from the opening only: enough for pace and hook, and quick on a laptop. */
const SPEECH_SECONDS = 120;
/** A pause this long or more is one an editor would usually cut. */
const PAUSE_SECONDS = 0.4;
/** How different two frames must be to count as a new shot, from 0 to 1. */
const SHOT_CHANGE = 0.3;
export const NOTE_LENGTH = 500;
/** The newest samples that go to the editor, so its prompt stays small on the free models. */
const SAMPLES_PER_EDIT = 5;
const FILE = /^[0-9a-f-]{36}\.(mp4|mov|m4v|webm|mkv)$/;

/** The language spoken in a sample, by its code, or "none". */
export type SampleLanguage = string;
export const isSampleLanguage = (value: string): value is SampleLanguage => value === "none" || isContentLanguage(value);

export function samplePath(file: string): string | null {
  return FILE.test(file) ? path.join(/*turbopackIgnore: true*/ SAMPLE_DIR(), file) : null;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Turns what FFmpeg and Whisper found into the numbers the editor is given. Pure, so it can be tested. */
export function measuresFrom({
  duration,
  width,
  height,
  shotChanges,
  silences,
  words,
  sampledSeconds,
}: {
  duration: number;
  width: number;
  height: number;
  shotChanges: number[];
  silences: { start: number; end: number }[];
  words: { text: string; start: number; end: number }[] | null;
  sampledSeconds: number;
}): SampleMeasures {
  const cuts = shotChanges.filter((time) => time > 0.2 && time < duration - 0.2).length;
  // Quiet before the first word and after the last isn't a pause the edit left in.
  const inner = silences.filter((pause) => pause.start > 0.05 && pause.end < duration - 0.05 && pause.end - pause.start >= PAUSE_SECONDS);
  let speech: SampleMeasures["speech"] = null;
  const spoken = (words ?? []).filter((word) => word.text.trim());
  if (spoken.length >= 5) {
    const first = spoken[0].start;
    const span = Math.max(spoken[spoken.length - 1].end - first, 1);
    const opening = spoken
      .filter((word) => word.start < first + 6)
      .map((word) => word.text.trim())
      .join(" ");
    speech = {
      wordsPerMinute: Math.round(spoken.length / (span / 60)),
      firstWordAt: round(first),
      opening: opening.length > 200 ? `${opening.slice(0, 199)}…` : opening,
      sampledSeconds: round(sampledSeconds, 0),
    };
  }
  return {
    duration: round(duration),
    width,
    height,
    cuts,
    cutsPerMinute: round(cuts / (duration / 60)),
    averageShot: round(duration / (cuts + 1)),
    pauses: inner.length,
    longestPause: round(inner.reduce((longest, pause) => Math.max(longest, pause.end - pause.start), 0)),
    speech,
  };
}

/** The times where the picture changes to a new shot. Read from a small copy of the picture, which is much faster. */
async function shotChanges(file: string): Promise<number[]> {
  const lines = await ffmpegLog(
    ["-i", file, "-an", "-vf", `scale=320:-2,select='gt(scene,${SHOT_CHANGE})',showinfo`, "-f", "null", "-"],
    (line) => line.includes("pts_time:"),
  );
  return lines.map((line) => Number(line.match(/pts_time:\s*([\d.]+)/)?.[1])).filter(Number.isFinite);
}

export async function addSample(
  db: Db,
  input: { file: string; originalName: string; size: number; language: SampleLanguage; platform: VideoPlatform | null; note: string },
  transcribe?: Transcriber,
): Promise<string> {
  const note = input.note.trim();
  if (note.length > NOTE_LENGTH) throw new StudioError(`Keep the note under ${NOTE_LENGTH} characters.`);
  const [row] = await db
    .insert(editorSamples)
    .values({ ...input, note, status: "processing", stage: "reading" })
    .returning({ id: editorSamples.id });
  startSampleProcessing(db, row.id, transcribe);
  return row.id;
}

/** Saves an uploaded sample into the editor's folder and starts measuring it. */
export async function receiveSample(
  db: Db,
  body: ReadableStream<Uint8Array>,
  meta: { originalName: string; size: number; language: string; platform: string; note: string },
): Promise<string> {
  if (!isSampleLanguage(meta.language)) throw new StudioError("Choose what language is spoken in the video.");
  const platform = meta.platform === "" ? null : meta.platform;
  if (platform !== null && !isVideoPlatform(platform)) throw new StudioError("Choose which network the video is an example for.");
  if (meta.note.trim().length > NOTE_LENGTH) throw new StudioError(`Keep the note under ${NOTE_LENGTH} characters.`);
  const file = await saveFootageStream(body, meta.originalName, meta.size, { dir: SAMPLE_DIR(), maxBytes: MAX_SAMPLE_BYTES });
  return addSample(db, { file, originalName: meta.originalName, size: meta.size, language: meta.language, platform, note: meta.note });
}

export async function processSample(db: Db, id: string, transcribe: Transcriber = whisperTranscriber): Promise<void> {
  const [sample] = await db.select().from(editorSamples).where(eq(editorSamples.id, id));
  if (!sample) return;
  const file = samplePath(sample.file);
  const set = (fields: Partial<typeof editorSamples.$inferInsert>) =>
    db.update(editorSamples).set({ ...fields, updatedAt: new Date() }).where(eq(editorSamples.id, id));
  const audioFile = path.join(/*turbopackIgnore: true*/ SAMPLE_DIR(), `${id}.f32`);

  try {
    if (!file) throw new Error(`Bad sample file name ${sample.file}`);
    await set({ status: "processing", stage: "reading", error: null });
    const info = await probe(file);
    if (info.duration > MAX_SAMPLE_SECONDS) throw new StudioError("Use a sample under 15 minutes. A short part of a video shows its editing just as well.");

    await set({ stage: "shots" });
    const changes = await shotChanges(file);
    const silences = info.hasAudio ? await detectSilences(file, 0.25) : [];

    let words: { text: string; start: number; end: number }[] | null = null;
    const sampledSeconds = Math.min(info.duration, SPEECH_SECONDS);
    if (info.hasAudio && sample.language !== "none") {
      await set({ stage: "speech" });
      await run(FFMPEG(), ["-hide_banner", "-nostats", "-y", "-i", file, "-t", String(sampledSeconds), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", audioFile]);
      words = await transcribe({
        audioFile,
        language: sample.language,
        windows: speechWindows(sampledSeconds, silences.filter((pause) => pause.end <= sampledSeconds)),
        onProgress: () => {},
      });
    }

    const measures = measuresFrom({ ...info, shotChanges: changes, silences, words, sampledSeconds });
    await set({ status: "ready", stage: null, measures });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await set({
      status: "failed",
      stage: null,
      error: error instanceof StudioError ? error.message : "Measuring this video didn't work. Try again, or export it as an MP4.",
    });
  } finally {
    await rm(/*turbopackIgnore: true*/ audioFile, { force: true });
  }
}

const jobKey = (id: string) => `sample:${id}`;
export const sampleJobKey = jobKey;

export function startSampleProcessing(db: Db, id: string, transcribe?: Transcriber): void {
  startJob(jobKey(id), () => processSample(db, id, transcribe));
}

export async function retrySample(db: Db, id: string, transcribe?: Transcriber) {
  const [sample] = await db.select().from(editorSamples).where(eq(editorSamples.id, id));
  if (!sample) throw new StudioError("This sample no longer exists.");
  if (isRunning(jobKey(id))) return;
  startSampleProcessing(db, id, transcribe);
}

export async function saveSampleNote(db: Db, id: string, note: string) {
  const clean = note.trim();
  if (clean.length > NOTE_LENGTH) throw new StudioError(`Keep the note under ${NOTE_LENGTH} characters.`);
  await db.update(editorSamples).set({ note: clean, updatedAt: new Date() }).where(eq(editorSamples.id, id));
}

export async function deleteSample(db: Db, id: string) {
  if (isRunning(jobKey(id))) throw new StudioError("Wait until this sample is measured, then remove it.");
  const [sample] = await db.delete(editorSamples).where(eq(editorSamples.id, id)).returning();
  const file = sample ? samplePath(sample.file) : null;
  if (file) await rm(/*turbopackIgnore: true*/ file, { force: true });
}

/** For the editor's page. A sample marked as busy with no job running was interrupted, for example by a restart. */
export async function listSamples(db: Db) {
  const rows = await db.select().from(editorSamples).orderBy(desc(editorSamples.createdAt));
  return rows.map((row) => ({ ...row, stopped: row.status === "processing" && !isRunning(jobKey(row.id)) }));
}

export type EditSample = { platform: VideoPlatform | null; note: string; measures: SampleMeasures };

/** The samples the editor studies before planning an edit for this network: its own first, then ones for any video. */
export async function samplesForEdit(db: Db, platform: VideoPlatform): Promise<EditSample[]> {
  const rows = await db.select().from(editorSamples).where(eq(editorSamples.status, "ready")).orderBy(desc(editorSamples.createdAt));
  const fitting = rows.filter((row) => row.measures && (row.platform === platform || row.platform === null));
  fitting.sort((a, b) => Number(b.platform === platform) - Number(a.platform === platform));
  return fitting.slice(0, SAMPLES_PER_EDIT).map((row) => ({
    platform: row.platform as VideoPlatform | null,
    note: row.note,
    measures: row.measures!,
  }));
}
