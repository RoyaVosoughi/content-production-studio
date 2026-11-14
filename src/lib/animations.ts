import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { animations } from "./db/schema";
import { StudioError } from "./errors";
import type { Language } from "./language";
import { isVideoPlatform, VIDEO_FORMATS, type VideoPlatform } from "./platforms";
import type { StudioDeps } from "./studio";
import { writingContext } from "./studio";
import {
  ANIMATION_VERSION,
  animationHtml,
  captionCues,
  cleanScenes,
  sceneTimeline,
  simpleScenes,
  totalDuration,
  type AnimationScene,
  type Narration,
} from "./video/animation";
import { detectSilences, isRunning, speechWindows, startJob, whisperTranscriber, type Transcriber } from "./video/footage";
import { brandForVideo } from "./video/render";
import type { VideoBrand } from "./video/overlays";
import { DATA_DIR, FFMPEG, FFPROBE, run, VIDEO_DIR } from "./video/tools";

// Animations made from any script. The scenes are planned by the video editor agent (or split
// without AI), timed by reading speed or by your narration, and drawn on this computer.

export type Animation = typeof animations.$inferSelect;

export const SCRIPT_LIMIT = 8000;
export const MAX_NARRATION_BYTES = 500 * 1024 ** 2;
export const NARRATION_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac", "webm", "mp4", "mov"];
const NARRATION_FILE = /^[0-9a-f-]{36}\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|webm|mp4|mov)$/;
const FPS = 30;

export const NARRATION_DIR = () => path.join(/*turbopackIgnore: true*/ DATA_DIR(), "narration");

export function narrationPath(file: string): string | null {
  return NARRATION_FILE.test(file) ? path.join(/*turbopackIgnore: true*/ NARRATION_DIR(), file) : null;
}

export const animationFile = (key: string) => path.join(/*turbopackIgnore: true*/ VIDEO_DIR(), `animation-${key}.mp4`);

export async function requireAnimation(db: Db, id: string): Promise<Animation> {
  const [row] = await db.select().from(animations).where(eq(animations.id, id));
  if (!row) throw new StudioError("This animation no longer exists.");
  return row;
}

export async function listAnimations(db: Db, language?: Language) {
  const rows = await db.select().from(animations).orderBy(desc(animations.updatedAt));
  return language ? rows.filter((row) => row.language === language) : rows;
}

const touch = (db: Db, id: string, fields: Partial<typeof animations.$inferInsert>) =>
  db.update(animations).set({ ...fields, updatedAt: new Date() }).where(eq(animations.id, id));

/**
 * Starts an animation from a script. The script is split into plain scenes at once; with the AI,
 * the video editor then plans better ones in the background, which can take a minute or two.
 */
export async function createAnimation(
  deps: Pick<StudioDeps, "db" | "writer">,
  input: { language: Language; platform: string; title: string; script: string; mode: "ai" | "simple" },
): Promise<string> {
  if (!isVideoPlatform(input.platform)) throw new StudioError("Choose where the video goes.");
  const script = input.script.trim();
  const title = input.title.trim().slice(0, 120);
  if (!script) throw new StudioError("Paste the script first.");
  if (script.length > SCRIPT_LIMIT) throw new StudioError(`A script can be up to ${SCRIPT_LIMIT.toLocaleString("en-US")} characters.`);
  const scenes = simpleScenes(title, script);
  const [row] = await deps.db
    .insert(animations)
    .values({
      language: input.language,
      platform: input.platform,
      title: title || scenes[0]?.heading || "Animation",
      script,
      scenes,
      planStatus: input.mode === "ai" ? "planning" : null,
    })
    .returning({ id: animations.id });
  if (input.mode === "ai") startPlanning(deps, row.id);
  return row.id;
}

export function startPlanning(deps: Pick<StudioDeps, "db" | "writer">, id: string) {
  startJob(`plan:${id}`, () => planScenes(deps, id));
}

/** Asks the video editor for scenes, and uses them unless you changed the scenes meanwhile. */
export async function planScenes({ db, writer }: Pick<StudioDeps, "db" | "writer">, id: string): Promise<void> {
  const row = await requireAnimation(db, id).catch(() => null);
  if (!row) return;
  try {
    const plan = await writer.planAnimation(await writingContext(db, row.language), {
      platform: row.platform as VideoPlatform,
      title: row.title,
      script: row.script,
    });
    const scenes = cleanScenes(plan.scenes);
    if (scenes.length === 0) throw new StudioError("The AI didn't return any scenes. Try again, or split the script without AI.");
    if (scenes[scenes.length - 1].kind !== "end") scenes.push({ kind: "end", say: "", heading: "", text: "", items: [] });
    const [now] = await db.select().from(animations).where(eq(animations.id, id));
    if (!now) return;
    const untouched = JSON.stringify(now.scenes) === JSON.stringify(row.scenes);
    await touch(db, id, { ...(untouched ? { scenes } : {}), planStatus: null, planError: null });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await touch(db, id, {
      planStatus: "failed",
      planError: error instanceof StudioError ? error.message : "The video editor couldn't plan the scenes. Try again.",
    }).catch(() => {});
  }
}

/** Saves the scenes as you changed them. */
export async function saveAnimation(db: Db, id: string, input: { title: string; scenes: Partial<AnimationScene>[]; captions: boolean; platform: string }) {
  await requireAnimation(db, id);
  if (!isVideoPlatform(input.platform)) throw new StudioError("Choose where the video goes.");
  const scenes = cleanScenes(input.scenes);
  if (scenes.length === 0) throw new StudioError("Keep at least one scene.");
  await touch(db, id, { title: input.title.trim().slice(0, 120) || "Animation", scenes, captions: input.captions, platform: input.platform });
}

/** Plans the scenes again from the script, replacing the ones on screen: with the AI in the background, or split at once. */
export async function replanAnimation(deps: Pick<StudioDeps, "db" | "writer">, id: string, mode: "ai" | "simple") {
  const row = await requireAnimation(deps.db, id);
  if (mode === "simple") {
    await touch(deps.db, id, { scenes: simpleScenes(row.title, row.script), planStatus: null, planError: null });
    return;
  }
  if (isRunning(`plan:${id}`)) return;
  await touch(deps.db, id, { planStatus: "planning", planError: null });
  startPlanning(deps, id);
}

export async function deleteAnimation(db: Db, id: string) {
  const row = await requireAnimation(db, id);
  await db.delete(animations).where(eq(animations.id, id));
  const file = row.narration ? narrationPath(row.narration) : null;
  if (file) await rm(/*turbopackIgnore: true*/ file, { force: true });
  if (row.renderKey) await rm(/*turbopackIgnore: true*/ animationFile(row.renderKey), { force: true });
}

// ---- Narration ----

/** The length of an audio or video file, from FFprobe. */
async function mediaDuration(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const out = await run(FFPROBE(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const info = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new StudioError("This file doesn't look like audio the studio can read. Try an MP3, M4A or WAV file.");
  return { duration, hasAudio: Boolean(info.streams?.some((stream) => stream.codec_type === "audio")) };
}

/** Uses an uploaded recording as the narration, and starts reading it. */
export async function addNarration(db: Db, id: string, upload: { file: string; originalName: string }, transcribe?: Transcriber) {
  const row = await requireAnimation(db, id);
  const old = row.narration ? narrationPath(row.narration) : null;
  await touch(db, id, {
    narration: upload.file,
    narrationName: upload.originalName.slice(0, 200),
    narrationStatus: "processing",
    narrationStage: "reading",
    narrationProgress: null,
    narrationError: null,
    narrationDuration: null,
    words: null,
  });
  if (old) await rm(/*turbopackIgnore: true*/ old, { force: true });
  startNarration(db, id, transcribe);
}

export function startNarration(db: Db, id: string, transcribe?: Transcriber) {
  startJob(`narration:${id}`, () => processNarration(db, id, transcribe));
}

export async function retryNarration(db: Db, id: string, transcribe?: Transcriber) {
  const row = await requireAnimation(db, id);
  if (!row.narration || row.narrationStatus === "ready") return;
  if (isRunning(`narration:${id}`)) return;
  await touch(db, id, { narrationStatus: "processing", narrationStage: "reading", narrationError: null });
  startNarration(db, id, transcribe);
}

export async function removeNarration(db: Db, id: string) {
  const row = await requireAnimation(db, id);
  if (isRunning(`narration:${id}`)) throw new StudioError("Wait until the narration has been read, then remove it.");
  const file = row.narration ? narrationPath(row.narration) : null;
  await touch(db, id, {
    narration: null,
    narrationName: null,
    narrationStatus: null,
    narrationStage: null,
    narrationProgress: null,
    narrationError: null,
    narrationDuration: null,
    words: null,
  });
  if (file) await rm(/*turbopackIgnore: true*/ file, { force: true });
}

/** Reads the narration with Whisper, on this computer, so the scenes and captions follow the voice. */
export async function processNarration(db: Db, id: string, transcribe: Transcriber = whisperTranscriber): Promise<void> {
  const row = await requireAnimation(db, id).catch(() => null);
  const file = row?.narration ? narrationPath(row.narration) : null;
  if (!row || !file) return;
  const audioFile = path.join(/*turbopackIgnore: true*/ NARRATION_DIR(), `${id}.f32`);
  // A newer upload replaces this one, so a finished read only counts while its file is still in use.
  const set = async (fields: Partial<typeof animations.$inferInsert>) => {
    const [current] = await db.select({ narration: animations.narration }).from(animations).where(eq(animations.id, id));
    if (current?.narration === row.narration) await touch(db, id, fields);
  };
  try {
    const info = await mediaDuration(file);
    if (!info.hasAudio) throw new StudioError("This file has no sound. Upload a recording of your voice.");
    await set({ narrationDuration: info.duration, narrationStage: "audio" });
    await run(FFMPEG(), ["-hide_banner", "-nostats", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", audioFile]);
    const silences = await detectSilences(file);
    let lastWrite = 0;
    const words = await transcribe({
      audioFile,
      language: row.language,
      windows: speechWindows(info.duration, silences),
      onProgress: (stage, progress) => {
        if (Date.now() - lastWrite < 1000 && progress < 1) return;
        lastWrite = Date.now();
        void set({ narrationStage: stage, narrationProgress: progress });
      },
    });
    const spoken = words.filter((word) => word.text.trim());
    if (spoken.length === 0) throw new StudioError("No speech was found in this recording. Check that your microphone recorded, then upload it again.");
    await set({ narrationStatus: "ready", narrationStage: null, narrationProgress: null, words: spoken });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await set({
      narrationStatus: "failed",
      narrationStage: null,
      narrationProgress: null,
      narrationError: error instanceof StudioError ? error.message : "Reading this recording didn't work. Try again, or export it as an MP3.",
    });
  } finally {
    await rm(/*turbopackIgnore: true*/ audioFile, { force: true });
  }
}

// ---- Making the video ----

/** The narration the timing follows, once it has been read. */
export function narrationOf(row: Animation): Narration | null {
  return row.narrationStatus === "ready" && row.words?.length && row.narrationDuration ? { words: row.words, duration: row.narrationDuration } : null;
}

/** The page that plays this animation, for drawing frames or for the preview. */
export function pageFor(row: Animation, brand: VideoBrand, preview?: { audio: string | null; playLabel: string }) {
  const platform = row.platform as VideoPlatform;
  const narration = narrationOf(row);
  const times = sceneTimeline(row.scenes, narration);
  const cues = row.captions ? captionCues(row.scenes, times, narration, row.language) : [];
  return { html: animationHtml({ scenes: row.scenes, times, cues, platform, language: row.language, brand, preview }), duration: totalDuration(times) };
}

/** Everything that changes the finished video, so the same inputs reuse the same file. */
export function animationKey(row: Animation, brand: VideoBrand): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ANIMATION_VERSION,
        platform: row.platform,
        language: row.language,
        scenes: row.scenes,
        captions: row.captions,
        narration: narrationOf(row) ? row.narration : null,
        brand,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

/** Why a video can't be made from the animation as it is, or null. */
export function animationProblem(row: Animation): string | null {
  if (!isVideoPlatform(row.platform)) return "Choose where the video goes.";
  if (row.scenes.length === 0) return "Add at least one scene.";
  if (row.planStatus === "planning" && isRunning(`plan:${row.id}`)) return "Wait until the scenes are planned.";
  if (row.narrationStatus === "processing") return "Wait until the narration has been read.";
  const narration = narrationOf(row);
  const length = totalDuration(sceneTimeline(row.scenes, narration));
  const max = VIDEO_FORMATS[row.platform].maxSeconds;
  if (length > max) return `The animation is ${Math.round(length)} seconds long. This network allows up to ${max} seconds, so shorten the script.`;
  return null;
}

export type DrawFrames = (input: {
  html: string;
  width: number;
  height: number;
  duration: number;
  audio: string | null;
  out: string;
  onProgress: (progress: number) => void;
}) => Promise<void>;

/**
 * Chrome shows each moment of the page in turn and takes a picture of it; FFmpeg joins the pictures
 * into a video, with the narration or silence underneath.
 */
export const chromeFrames: DrawFrames = async ({ html, width, height, duration, audio, out, onProgress }) => {
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  } catch {
    throw new StudioError("The studio needs Google Chrome to draw animations. Install Chrome, or set CHROME_PATH in .env.local.");
  }
  const sound = audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const ffmpeg = spawn(
    FFMPEG(),
    [
      "-hide_banner", "-nostats", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      ...sound,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-af", "apad", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-t", duration.toFixed(3),
      "-movflags", "+faststart",
      out,
    ],
    { windowsHide: true },
  );
  let log = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-3000);
  });
  const finished = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new StudioError("The studio needs FFmpeg to make videos. Install it, then restart the studio.") : error),
    );
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${log.trim().split("\n").slice(-5).join("\n")}`))));
  });
  // Without this, a failed FFmpeg would make the writes below throw instead of reporting why.
  ffmpeg.stdin.on("error", () => {});
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const frames = Math.ceil(duration * FPS);
    for (let frame = 0; frame < frames; frame++) {
      if (ffmpeg.exitCode !== null) break;
      await page.evaluate((t) => (window as unknown as { seek: (t: number) => void }).seek(t), frame / FPS);
      const shot = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ffmpeg.stdin.write(shot)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (frame % 15 === 0) onProgress(frame / frames);
    }
    ffmpeg.stdin.end();
    await finished;
  } catch (error) {
    ffmpeg.kill("SIGKILL");
    await finished.catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
};

/** Starts making the video for the animation as it is saved now. */
export async function makeAnimation(db: Db, id: string, draw: DrawFrames = chromeFrames): Promise<string> {
  const row = await requireAnimation(db, id);
  const problem = animationProblem(row);
  if (problem) throw new StudioError(problem);
  const brand = await brandForVideo(db, row.language);
  const key = animationKey(row, brand);
  if (row.renderKey === key && row.renderStatus === "ready" && (await exists(animationFile(key)))) return key;
  if (row.renderKey === key && row.renderStatus === "working" && isRunning(`animation:${key}`)) return key;
  await touch(db, id, { renderKey: key, renderStatus: "working", renderProgress: 0, renderError: null });
  startJob(`animation:${key}`, () => renderAnimation(db, row, key, brand, draw));
  return key;
}

async function exists(file: string) {
  return stat(/*turbopackIgnore: true*/ file).then(
    () => true,
    () => false,
  );
}

async function renderAnimation(db: Db, row: Animation, key: string, brand: VideoBrand, draw: DrawFrames) {
  const { width, height } = VIDEO_FORMATS[row.platform as VideoPlatform];
  const { html, duration } = pageFor(row, brand);
  const out = animationFile(key);
  const working = `${out}.part.mp4`;
  // Only the newest request writes its progress, in case the scenes changed while this one ran.
  const set = async (fields: Partial<typeof animations.$inferInsert>) => {
    const [current] = await db.select({ key: animations.renderKey }).from(animations).where(eq(animations.id, row.id));
    if (current?.key === key) await touch(db, row.id, fields);
  };
  try {
    await mkdir(/*turbopackIgnore: true*/ VIDEO_DIR(), { recursive: true });
    let lastWrite = 0;
    await draw({
      html,
      width,
      height,
      duration,
      audio: narrationOf(row) && row.narration ? narrationPath(row.narration) : null,
      out: working,
      onProgress: (progress) => {
        if (Date.now() - lastWrite < 1000) return;
        lastWrite = Date.now();
        void set({ renderProgress: progress });
      },
    });
    await rename(/*turbopackIgnore: true*/ working, out);
    await set({ renderStatus: "ready", renderProgress: null, duration });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await rm(/*turbopackIgnore: true*/ working, { force: true });
    await set({
      renderStatus: "failed",
      renderProgress: null,
      renderError: error instanceof StudioError ? error.message : "Making the animation didn't work. Try again.",
    });
  }
}

export type AnimationState = {
  row: Animation;
  /** The finished video for the scenes as saved now, when there is one. */
  ready: boolean;
  working: boolean;
  /** Making it was interrupted, for example by a restart. */
  stopped: boolean;
  narrationStopped: boolean;
  /** The video editor is planning the scenes right now. */
  planning: boolean;
  /** Planning was interrupted, for example by a restart. */
  planStopped: boolean;
  key: string;
  problem: string | null;
  duration: number;
};

/** Where an animation is: whether its narration is read, and whether the video for these scenes exists. */
export async function animationState(db: Db, id: string): Promise<AnimationState> {
  const row = await requireAnimation(db, id);
  const brand = await brandForVideo(db, row.language);
  const key = animationKey(row, brand);
  const current = row.renderKey === key;
  const ready = current && row.renderStatus === "ready" && (await exists(animationFile(key)));
  const working = current && row.renderStatus === "working";
  return {
    row,
    ready,
    working: working && isRunning(`animation:${key}`),
    stopped: working && !isRunning(`animation:${key}`),
    narrationStopped: row.narrationStatus === "processing" && !isRunning(`narration:${id}`),
    planning: row.planStatus === "planning" && isRunning(`plan:${id}`),
    planStopped: row.planStatus === "planning" && !isRunning(`plan:${id}`),
    key,
    problem: animationProblem(row),
    duration: totalDuration(sceneTimeline(row.scenes, narrationOf(row))),
  };
}

/** For the file name of a download. */
export const animationName = (row: Animation) =>
  `${(row.title || "animation").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "animation"}-${row.platform}`;

