import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { type EditPlan, type PieceContent, type Phrase, videoRenders } from "../db/schema";
import { StudioError } from "../errors";
import { languageInfo, type Language } from "../language";
import { VIDEO_FORMATS, type VideoPlatform } from "../platforms";
import { ANIMATION_VERSION, animationHtml, pipBox, themeOf, type PipBox } from "./animation";
import {
  captionChunks,
  captionFile,
  EXPLAINER_FADE,
  explainerWindows,
  formatTime,
  keepRanges,
  outputDuration,
  phraseOutputStart,
  type Silence,
  type ExplainerWindow,
  type Range,
} from "./edit";
import { chromeFrames, type DrawFrames } from "./frames";
import { footagePath, isRunning, startJob } from "./footage";
import { DEFAULT_COLORS, getProfile } from "../profile";
import {
  OVERLAY_VERSION,
  overlayHtml,
  overlayPosition,
  THUMBNAIL_PLATFORMS,
  thumbnailHtml,
  thumbnailSize,
  videoBrand,
  type OverlayKind,
  type VideoBrand,
} from "./overlays";
import { FFMPEG, filterPath, FONT_DIR, run, VIDEO_DIR } from "./tools";

/** Change this when the editing changes, so videos made the old way are made again. */
export const RENDER_VERSION = 2;
/** Change this when shortening pauses changes: only videos that shorten them are made again. */
const PAUSES_VERSION = 1;

const TITLE_AT = 0.3;
const TITLE_FOR = 3.2;
const CALLOUT_FOR = 2.4;
const END_FOR = 3.5;
const ZOOM = 0.1;

export type Clip = {
  id: string;
  file: string;
  duration: number;
  width: number;
  height: number;
  phrases: Phrase[];
  /** The pauses heard in the audio, which "shorten long pauses" takes out. */
  silences: Silence[];
};
export type Card = { kind: OverlayKind; text: string; start: number; duration: number };

const PLAIN_BRAND: VideoBrand = { name: "", instagram: "", headline: "", colors: DEFAULT_COLORS, headingStyle: "serif" };

/** The name, headline and colours the cards are drawn with, from Setup. */
export async function brandForVideo(db: Db, language: Language): Promise<VideoBrand> {
  const profile = await getProfile(db);
  return profile ? videoBrand(profile, language) : PLAIN_BRAND;
}

/** Everything that changes the finished video, so the same inputs reuse the same file. */
export function renderKey(
  platform: VideoPlatform,
  language: Language,
  clipId: string,
  content: PieceContent,
  brand: VideoBrand = PLAIN_BRAND,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        RENDER_VERSION,
        OVERLAY_VERSION,
        platform,
        language,
        clipId,
        edit: content.edit,
        title: content.title ?? "",
        thumbnailAt: content.thumbnailAt ?? null,
        brand,
        // Shortened pauses now follow the audio itself, so videos that shortened them are made again.
        ...(content.edit?.tightenPauses ? { PAUSES_VERSION } : {}),
        // Explainers are drawn like animations, so a new animation design makes these videos again.
        ...(content.edit?.explainers?.length ? { ANIMATION_VERSION } : {}),
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

export const videoFile = (key: string) => path.join(/*turbopackIgnore: true*/ VIDEO_DIR(), `${key}.mp4`);
export const thumbnailFile = (key: string) => path.join(/*turbopackIgnore: true*/ VIDEO_DIR(), `${key}.jpg`);

/** The motion graphics on the finished video's timeline. Callouts are left out while an explainer plays. */
export function cardsFor(phrases: Phrase[], plan: EditPlan, ranges: Range[], total: number, explainers: ExplainerWindow[] = []): Card[] {
  const cards: Card[] = [];
  // The title card makes way for an explainer that starts early, and is left out if that leaves too little time to read it.
  const titleUntil = Math.min(TITLE_AT + TITLE_FOR, total - 0.5, ...explainers.map((window) => window.start));
  if (plan.titleCard.trim() && total > TITLE_AT + 2 && titleUntil - TITLE_AT >= 1.2) {
    cards.push({ kind: "title", text: plan.titleCard.trim(), start: TITLE_AT, duration: titleUntil - TITLE_AT });
  }
  let freeFrom = 0;
  for (const callout of [...plan.callouts].sort((a, b) => a.phrase - b.phrase)) {
    const phrase = phrases[callout.phrase];
    const start = phrase ? phraseOutputStart(ranges, phrase) : null;
    // Callouts never overlap each other. They sit above the end card, so they can share the last seconds.
    if (start === null || start < freeFrom || start > total - 1) continue;
    const duration = Math.min(CALLOUT_FOR, total - start - 0.1);
    if (explainers.some((window) => start < window.end && start + duration > window.start)) continue;
    cards.push({ kind: "callout", text: callout.text, start, duration });
    freeFrom = start + duration + 0.3;
  }
  if (plan.endCard && total >= 10) cards.push({ kind: "end", text: "", start: total - END_FOR, duration: END_FOR });
  return cards;
}

/** The zoom amount over time, as an FFmpeg expression: a quick ease in, a hold, and an ease out. */
export function zoomExpression(phrases: Phrase[], plan: EditPlan, ranges: Range[]): string | null {
  const windows = plan.zooms
    .map((index) => {
      const phrase = phrases[index];
      const start = phrase ? phraseOutputStart(ranges, phrase) : null;
      if (start === null) return null;
      const length = Math.min(4, Math.max(1.2, phrase.end - phrase.start));
      return `clip((t-${start.toFixed(2)})/0.3,0,1)*clip((${(start + length).toFixed(2)}-t)/0.3,0,1)`;
    })
    .filter(Boolean);
  return windows.length ? `1+${ZOOM}*min(1,${windows.join("+")})` : null;
}

/** The FFmpeg arguments for the whole edit, run from the folder holding the cards and captions. */
export function ffmpegArgs(input: {
  source: string;
  platform: VideoPlatform;
  plan: EditPlan;
  ranges: Range[];
  zoom: string | null;
  cards: (Card & { file: string })[];
  captions: boolean;
  output: string;
  /** Explainer videos already drawn, each as long as its window, and the card your clip plays in. */
  explainers?: { file: string; start: number; end: number; mode: ExplainerWindow["mode"] }[];
  pip?: { box: PipBox; mask: string } | null;
}): string[] {
  const { width: W, height: H } = VIDEO_FORMATS[input.platform];
  const keep = input.ranges.map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`).join("+");
  const graph: string[] = [];
  const explainers = input.explainers ?? [];
  const pips = input.pip ? explainers.filter((item) => item.mode === "pip") : [];
  // Inputs: the clip, the cards, the explainers, then for picture-in-picture the card's mask and the clip once more.
  const explainerInput = 1 + input.cards.length;
  const maskInput = explainerInput + explainers.length;
  const pipInput = maskInput + 1;

  /** The clip cut and framed to the finished video's size, from one of the clip's inputs. */
  const framed = (stream: number, name: string) => {
    graph.push(`[${stream}:v]fps=30,select='${keep}',setpts=N/(30*TB)[${name}c]`);
    if (input.plan.framing === "fit") {
      graph.push(
        `[${name}c]split[${name}a][${name}b];[${name}a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.08[${name}bg];` +
          `[${name}b]scale=${W}:${H}:force_original_aspect_ratio=decrease[${name}fg];[${name}bg][${name}fg]overlay=(W-w)/2:(H-h)/2[${name}]`,
      );
    } else {
      graph.push(`[${name}c]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[${name}]`);
    }
  };

  framed(0, "framed");
  let current = "framed";
  if (input.zoom) {
    graph.push(`[framed]scale=w='2*trunc(${W}*(${input.zoom})/2)':h=-2:eval=frame,crop=${W}:${H}[zoomed]`);
    current = "zoomed";
  }

  // The picture-in-picture card is cut from a second reading of the clip, so the main picture never
  // waits for an explainer that starts later, which would hold its frames in memory until then.
  if (input.pip && pips.length > 0) {
    const { box } = input.pip;
    framed(pipInput, "pipsrc");
    // Your framing stays as it is: the card shows head and shoulders, cut from the frame, not zoomed in.
    const ratio = box.w / box.h;
    const even = (value: number) => 2 * Math.floor(value / 2);
    const cw = even(Math.min(W, H * ratio));
    const ch = even(Math.min(H, cw / ratio));
    const cx = even((W - cw) / 2);
    const cy = even(W < H ? (H - ch) * 0.3 : (H - ch) / 2);
    const names = pips.map((_, index) => `pc${index}`);
    graph.push(`[pipsrc]crop=${cw}:${ch}:${cx}:${cy},scale=${box.w}:${box.h},split=${pips.length}${names.map((name) => `[${name}]`).join("")}`);
    graph.push(`[${maskInput}:v]format=gray,split=${pips.length}${names.map((_, index) => `[mk${index}]`).join("")}`);
  }

  explainers.forEach((item, index) => {
    const start = item.start.toFixed(3);
    const end = item.end.toFixed(3);
    const fadeOut = Math.max(item.start, item.end - EXPLAINER_FADE).toFixed(3);
    let layer = `ex${index}`;
    graph.push(`[${explainerInput + index}:v]setpts=PTS-STARTPTS+${start}/TB,format=rgba[${layer}]`);
    const pip = input.pip ? pips.indexOf(item) : -1;
    if (input.pip && pip >= 0) {
      const { box } = input.pip;
      graph.push(
        `[pc${pip}]trim=start=${start}:end=${end},format=rgba[pv${pip}];[pv${pip}][mk${pip}]alphamerge[pa${pip}];` +
          `[${layer}][pa${pip}]overlay=${box.x}:${box.y}:eof_action=pass,format=rgba[exc${index}]`,
      );
      layer = `exc${index}`;
    }
    // The explainer fades in over your clip and back out, so the switch is smooth both ways.
    graph.push(
      `[${layer}]fade=in:st=${start}:d=${EXPLAINER_FADE}:alpha=1,fade=out:st=${fadeOut}:d=${EXPLAINER_FADE}:alpha=1[exa${index}]`,
      `[${current}][exa${index}]overlay=0:0:enable='between(t,${start},${end})':eof_action=pass[exw${index}]`,
    );
    current = `exw${index}`;
  });

  input.cards.forEach((card, index) => {
    const stream = index + 1;
    const fadeOut = Math.max(0, card.duration - 0.3).toFixed(2);
    const start = card.start.toFixed(2);
    const end = (card.start + card.duration).toFixed(2);
    const { x, y } = overlayPosition(card.kind, input.platform);
    graph.push(
      `[${stream}:v]format=rgba,fade=in:st=0:d=0.25:alpha=1,fade=out:st=${fadeOut}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${start}/TB[card${index}]`,
    );
    // Each card rises into place as it fades in.
    graph.push(
      `[${current}][card${index}]overlay=x=${x}:y='${y}+36*(1-clip((t-${start})/0.3,0,1))':enable='between(t,${start},${end})':eof_action=pass[with${index}]`,
    );
    current = `with${index}`;
  });
  graph.push(
    input.captions
      ? `[${current}]subtitles=captions.ass:fontsdir=${filterPath(FONT_DIR())},setsar=1,format=yuv420p[vout]`
      : `[${current}]setsar=1,format=yuv420p[vout]`,
  );
  graph.push(`[0:a]aselect='${keep}',asetpts=N/SR/TB,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

  return [
    "-hide_banner", "-nostats", "-y",
    "-i", input.source,
    ...input.cards.flatMap((card) => ["-loop", "1", "-framerate", "30", "-t", card.duration.toFixed(2), "-i", card.file]),
    ...explainers.flatMap((item) => ["-i", item.file]),
    ...(input.pip && pips.length > 0 ? ["-loop", "1", "-framerate", "30", "-t", (Math.max(...pips.map((item) => item.end)) + 1).toFixed(2), "-i", input.pip.mask, "-i", input.source] : []),
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    input.output,
  ];
}

/** The moment of the clip shown at a point of the finished video. */
function sourceTime(ranges: Range[], at: number): number {
  let left = at;
  for (const range of ranges) {
    const length = range.end - range.start;
    if (left <= length) return range.start + left;
    left -= length;
  }
  return ranges[ranges.length - 1]?.end ?? 0;
}

export type DrawCards = (
  pages: { html: string; file: string; width: number; height: number; element: string | null }[],
) => Promise<void>;

/** Draws the cards and thumbnail with the Chrome on this computer, like the Instagram slides. */
export const chromeDraw: DrawCards = async (pages) => {
  if (pages.length === 0) return;
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  } catch {
    throw new StudioError("The studio needs Google Chrome to draw the video's titles. Install Chrome, or set CHROME_PATH in .env.local.");
  }
  try {
    for (const item of pages) {
      const page = await browser.newPage({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 1 });
      await page.setContent(item.html, { waitUntil: "networkidle", timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      if (item.element) await page.locator(item.element).screenshot({ path: item.file, omitBackground: true });
      else await page.screenshot({ path: item.file, type: "jpeg", quality: 90 });
      await page.close();
    }
  } finally {
    await browser.close();
  }
};

/** Checks a video can be made from this version, and says why not. */
export function renderProblem(platform: VideoPlatform, content: PieceContent, clip: Clip | null): string | null {
  if (!content.footage || !clip) return "Upload your clip first.";
  if (!content.edit) return "Plan the edit first.";
  const total = outputDuration(keepRanges(clip.phrases, content.edit, clip.duration, clip.silences));
  if (total < 1) return "The edit removes almost everything. Keep more of the clip.";
  const max = VIDEO_FORMATS[platform].maxSeconds;
  if (total > max) return `The edited video is ${formatTime(total)} long. This network allows up to ${formatTime(max)}, so cut more.`;
  return null;
}

/** Makes the finished video, and the thumbnail where the network uses one. */
export async function renderVideo(
  db: Db,
  input: { key: string; pieceId: string; platform: VideoPlatform; language: Language; content: PieceContent; clip: Clip; brand: VideoBrand },
  draw: DrawCards = chromeDraw,
  frames: DrawFrames = chromeFrames,
): Promise<void> {
  const { key, platform, language, content, clip, brand } = input;
  const plan = content.edit!;
  // Async, so a call runs at once even when nothing waits for it, as the progress updates don't:
  // a Drizzle query only runs when awaited.
  const set = async (fields: Partial<typeof videoRenders.$inferInsert>) => {
    await db.update(videoRenders).set({ ...fields, updatedAt: new Date() }).where(eq(videoRenders.key, key));
  };
  /** Saves progress without waiting; a progress update that fails never stops the work. */
  const report = (fields: Partial<typeof videoRenders.$inferInsert>) => void set(fields).catch((error) => console.error("Couldn't save progress:", error));
  const work = await mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "studio-render-"));
  try {
    const source = footagePath(clip.file);
    if (!source) throw new Error(`Bad clip file name ${clip.file}`);
    const ranges = keepRanges(clip.phrases, plan, clip.duration, clip.silences);
    const total = outputDuration(ranges);
    const { width, height } = VIDEO_FORMATS[platform];

    const windows = explainerWindows(clip.phrases, plan, ranges, total);
    const cards = cardsFor(clip.phrases, plan, ranges, total, windows).map((card, index) => ({
      ...card,
      file: path.join(/*turbopackIgnore: true*/ work, `card-${index}.png`),
    }));
    await draw(
      cards.map((card) => ({ html: overlayHtml(card.kind, card.text, platform, language, brand), file: card.file, width, height, element: "#card" })),
    );
    if (plan.captions) {
      await writeFile(
        /*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ work, "captions.ass"),
        captionFile(captionChunks(clip.phrases, plan, clip.duration, platform, clip.silences), plan, platform, language, brand.colors.highlight),
      );
    }

    // Explainers are drawn first, each as a short video, and take the first part of the progress bar.
    const share = windows.length > 0 ? 0.4 : 0;
    const explainers = await drawExplainers({ windows, plan, platform, language, brand, work, frames, onProgress: (progress) => report({ progress: share * progress }) });
    const box = pipBox(platform, languageInfo(language).dir === "rtl");
    let pip: { box: PipBox; mask: string } | null = null;
    if (explainers.some((item) => item.mode === "pip")) {
      pip = { box, mask: path.join(/*turbopackIgnore: true*/ work, "pip-mask.png") };
      await draw([{ html: pipMaskHtml(box), file: pip.mask, width, height, element: "#card" }]);
    }

    await mkdir(/*turbopackIgnore: true*/ VIDEO_DIR(), { recursive: true });
    const partial = path.join(/*turbopackIgnore: true*/ VIDEO_DIR(), `${key}.part.mp4`);
    let lastWrite = 0;
    await run(
      FFMPEG(),
      ffmpegArgs({ source, platform, plan, ranges, zoom: zoomExpression(clip.phrases, plan, ranges), cards, captions: plan.captions, output: partial, explainers, pip }),
      {
        cwd: work,
        onLine: (line) => {
          const match = line.match(/^out_time_us=(\d+)/);
          if (!match || Date.now() - lastWrite < 1000) return;
          lastWrite = Date.now();
          report({ progress: Math.min(0.99, share + (1 - share) * (Number(match[1]) / 1e6 / total)) });
        },
      },
    );
    await rename(/*turbopackIgnore: true*/ partial, videoFile(key));

    if (THUMBNAIL_PLATFORMS.includes(platform)) {
      const size = thumbnailSize(platform);
      const at = sourceTime(ranges, Math.min(content.thumbnailAt ?? Math.min(2, total / 3), Math.max(0, total - 0.1)));
      const frame = path.join(/*turbopackIgnore: true*/ work, "frame.jpg");
      await run(FFMPEG(), [
        "-hide_banner", "-y", "-ss", at.toFixed(2), "-i", source, "-frames:v", "1",
        "-vf", `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`,
        "-q:v", "3", frame,
      ]);
      const frameSrc = `data:image/jpeg;base64,${(await readFile(/*turbopackIgnore: true*/ frame)).toString("base64")}`;
      await draw([
        { html: thumbnailHtml(content.title || plan.titleCard, frameSrc, platform, language, brand), file: thumbnailFile(key), ...size, element: null },
      ]);
    }

    await set({ status: "ready", progress: 1, duration: total, error: null });
    await removeOldRenders(db, input.pieceId, key);
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    await set({
      status: "failed",
      progress: null,
      error: error instanceof StudioError ? error.message : "Making the video didn't work. Try again, and if it fails again, try a simpler edit.",
    });
  } finally {
    await rm(/*turbopackIgnore: true*/ work, { recursive: true, force: true });
  }
}

/** The rounded card your clip plays in, as a white shape on a transparent page; FFmpeg uses it as a mask. */
export function pipMaskHtml(box: PipBox): string {
  return `<!doctype html><html><head><style>html,body{margin:0;background:transparent}#card{width:${box.w}px;height:${box.h}px;border-radius:${box.r}px;background:#fff}</style></head><body><div id="card"></div></body></html>`;
}

/** Draws each explainer as a silent video as long as its window, in the plan's look, over the work folder. */
export async function drawExplainers(input: {
  windows: ExplainerWindow[];
  plan: EditPlan;
  platform: VideoPlatform;
  language: Language;
  brand: VideoBrand;
  work: string;
  frames: DrawFrames;
  onProgress: (progress: number) => void;
}): Promise<{ file: string; start: number; end: number; mode: ExplainerWindow["mode"] }[]> {
  const { windows, plan, platform, language, brand, work, frames, onProgress } = input;
  const { width, height } = VIDEO_FORMATS[platform];
  const theme = themeOf(plan.explainerStyle ?? "tech");
  const box = pipBox(platform, languageInfo(language).dir === "rtl");
  const total = windows.reduce((sum, window) => sum + (window.end - window.start), 0) || 1;
  const drawn: { file: string; start: number; end: number; mode: ExplainerWindow["mode"] }[] = [];
  let done = 0;
  for (const [index, window] of windows.entries()) {
    const duration = window.end - window.start;
    const html = animationHtml({
      scenes: [window.scene],
      times: [{ start: 0, end: duration }],
      cues: [],
      platform,
      language,
      brand,
      theme,
      insert: { pip: window.mode === "pip" ? box : null },
    });
    const file = path.join(/*turbopackIgnore: true*/ work, `explainer-${index}.mp4`);
    await frames({ html, width, height, duration, audio: null, out: file, onProgress: (progress) => onProgress((done + progress * duration) / total) });
    done += duration;
    drawn.push({ file, start: window.start, end: window.end, mode: window.mode });
  }
  return drawn;
}

/** Only the newest video of each post is kept, because videos take a lot of disk space. */
async function removeOldRenders(db: Db, pieceId: string, keep: string) {
  const old = await db
    .delete(videoRenders)
    .where(and(eq(videoRenders.pieceId, pieceId), ne(videoRenders.key, keep)))
    .returning({ key: videoRenders.key });
  for (const { key } of old) {
    await rm(/*turbopackIgnore: true*/ videoFile(key), { force: true });
    await rm(/*turbopackIgnore: true*/ thumbnailFile(key), { force: true });
  }
}

export async function renderedFile(key: string): Promise<string | null> {
  try {
    await stat(/*turbopackIgnore: true*/ videoFile(key));
    return videoFile(key);
  } catch {
    return null;
  }
}

/** Starts making the video in the background. A video already made or being made is left alone. */
export async function startRender(
  db: Db,
  input: { pieceId: string; platform: VideoPlatform; language: Language; content: PieceContent; clip: Clip },
  draw?: DrawCards,
  frames?: DrawFrames,
): Promise<string> {
  const brand = await brandForVideo(db, input.language);
  const key = renderKey(input.platform, input.language, input.clip.id, input.content, brand);
  const [existing] = await db.select().from(videoRenders).where(eq(videoRenders.key, key));
  if (existing?.status === "ready" && (await renderedFile(key))) return key;
  if (existing?.status === "working" && isRunning(`render:${key}`)) return key;
  await db
    .insert(videoRenders)
    .values({ key, pieceId: input.pieceId, status: "working", progress: 0 })
    .onConflictDoUpdate({ target: videoRenders.key, set: { status: "working", progress: 0, error: null, updatedAt: new Date() } });
  startJob(`render:${key}`, () => renderVideo(db, { key, ...input, brand }, draw, frames));
  return key;
}
