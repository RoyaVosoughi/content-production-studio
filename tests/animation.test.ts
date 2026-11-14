import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { studioDb } from "./fixtures/brand";
import type { Db } from "@/lib/db/client";
import type { Word } from "@/lib/db/schema";
import {
  addNarration,
  animationFile,
  animationKey,
  animationState,
  chromeFrames,
  createAnimation,
  deleteAnimation,
  makeAnimation,
  pageFor,
  removeNarration,
  requireAnimation,
  saveAnimation,
  type DrawFrames,
} from "@/lib/animations";
import { getPieces, startQuickVideo } from "@/lib/content";
import { StudioError } from "@/lib/errors";
import {
  animationHtml,
  captionCues,
  cleanScenes,
  readingSeconds,
  sceneTimeline,
  simpleScenes,
  totalDuration,
  type AnimationScene,
} from "@/lib/video/animation";
import { waitForJob, type Transcriber } from "@/lib/video/footage";
import { DEFAULT_COLORS } from "@/lib/profile";
import { FFMPEG, probe, run } from "@/lib/video/tools";
import { getScenario, requireIdea, type StudioDeps } from "@/lib/studio";

const scene = (fields: Partial<AnimationScene>): AnimationScene => ({ kind: "statement", say: "", heading: "", text: "", items: [], ...fields });
const word = (text: string, start: number, end: number): Word => ({ text, start, end });
const BRAND = { name: "Sam", instagram: "@sam", headline: "AI for small teams", colors: DEFAULT_COLORS, headingStyle: "serif" as const };

const SCENES: AnimationScene[] = [
  scene({ kind: "title", say: "Agents save small teams time.", heading: "Agents save time" }),
  scene({ kind: "number", say: "Five hours a week, on average.", heading: "saved every week", text: "5 hours" }),
  scene({ kind: "end" }),
];

describe("scenes", () => {
  it("cleans what the AI or the form sends", () => {
    const cleaned = cleanScenes([
      { kind: "points", heading: "  Three   ways ", items: ["one", "", "two", "three", "four", "five", "six"], say: "Say" },
      { kind: "bogus" as never, heading: "A line" },
      { kind: "title", heading: "", say: "", text: "", items: [] },
      { kind: "quote", text: "Q", items: ["dropped"] },
    ]);
    expect(cleaned).toEqual([
      { kind: "points", say: "Say", heading: "Three ways", text: "", items: ["one", "two", "three", "four", "five"] },
      { kind: "statement", say: "", heading: "A line", text: "", items: [] },
      { kind: "quote", say: "", heading: "", text: "Q", items: [] },
    ]);
  });

  it("splits a script without AI: title, a line per few sentences, end card", () => {
    const scenes = simpleScenes("My title", "First sentence here. Second one! Is this the third? " + "word ".repeat(30).trim() + ".");
    expect(scenes[0]).toMatchObject({ kind: "title", heading: "My title" });
    expect(scenes.at(-1)!.kind).toBe("end");
    // The says together are the whole script, so a narration can be timed against them.
    const said = scenes.map((item) => item.say).filter(Boolean).join(" ");
    expect(said.startsWith("First sentence here.")).toBe(true);
    expect(said.endsWith("word.")).toBe(true);
  });

  it("times scenes by reading speed without narration", () => {
    const times = sceneTimeline(SCENES, null);
    expect(times[0].start).toBe(0);
    expect(times[1].start).toBe(times[0].end);
    expect(times[2].end - times[2].start).toBeCloseTo(3.2);
    expect(readingSeconds(scene({ say: "a ".repeat(100) }))).toBe(16);
    expect(readingSeconds(scene({ heading: "Hi" }))).toBeGreaterThanOrEqual(2.4);
  });

  it("follows the narration: each scene starts as its words are spoken, the end card after the voice", () => {
    const words = [
      word("Agents", 0.2, 0.6), word("save", 0.6, 0.9), word("small", 0.9, 1.2), word("teams", 1.2, 1.5), word("time.", 1.5, 1.9),
      word("Five", 3.0, 3.3), word("hours", 3.3, 3.6), word("a", 3.6, 3.7), word("week,", 3.7, 4.0), word("on", 4.1, 4.2), word("average.", 4.2, 4.8),
    ];
    const times = sceneTimeline(SCENES, { words, duration: 5 });
    expect(times[0]).toEqual({ start: 0, end: times[1].start });
    expect(times[1].start).toBeCloseTo(2.85);
    expect(times[1].end).toBeCloseTo(5.4);
    expect(times[2].start).toBeCloseTo(5.4);
    expect(totalDuration(times)).toBeCloseTo(8.6);
  });

  it("captions the narration a few words at a time, breaking at sentence ends", () => {
    const words = [word("One", 0, 0.3), word("two.", 0.3, 0.6), word("Three", 0.7, 1), word("four", 1, 1.2), word("five", 1.2, 1.4), word("six", 1.4, 1.6), word("seven", 1.6, 1.8), word("eight", 1.8, 2)];
    const cues = captionCues(SCENES, sceneTimeline(SCENES, null), { words, duration: 2 }, "en");
    expect(cues.map((cue) => cue.text)).toEqual(["One two.", "Three four five six seven", "eight"]);
    // Short gaps are bridged, so captions don't flicker.
    expect(cues[0].end).toBe(cues[1].start);
  });

  it("captions each scene's line across its time when there is no narration", () => {
    const times = sceneTimeline(SCENES, null);
    const cues = captionCues(SCENES, times, null, "en");
    expect(cues.map((cue) => cue.text)).toEqual(["Agents save small teams time.", "Five hours a week, on", "average."]);
    expect(cues[1].start).toBeGreaterThanOrEqual(times[1].start);
    expect(cues[2].end).toBeLessThanOrEqual(times[1].end);
  });

  it("draws every scene kind in the brand's colours, escaping text, right to left for Farsi", () => {
    const all = cleanScenes([
      { kind: "title", heading: "<b>Hi</b>", text: "Sub" },
      { kind: "statement", heading: "Big line", text: "Label" },
      { kind: "number", text: "۷۳٪", heading: "of teams" },
      { kind: "points", heading: "Points", items: ["a", "b"] },
      { kind: "steps", heading: "Steps", items: ["a", "b"] },
      { kind: "quote", text: "Quote", heading: "Someone" },
      { kind: "compare", heading: "Before and after", text: "Before | After", items: ["slow | fast"] },
      { kind: "end" },
    ]);
    const times = sceneTimeline(all, null);
    const html = animationHtml({ scenes: all, times, cues: [], platform: "reel", language: "fa", brand: BRAND });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(html).toContain(DEFAULT_COLORS.highlight);
    expect(html).toContain("Before | After".split(" | ")[1]);
    expect(html).toContain("@sam");
    expect(html.match(/class="scene /g)).toHaveLength(8);
  });
});

let dataDir: string;
beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "studio-animation-test-"));
  process.env.VIDEO_DATA_DIR = dataDir;
});
afterAll(async () => {
  delete process.env.VIDEO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("animations", () => {
  let db: Db;
  let deps: Pick<StudioDeps, "db" | "writer">;
  const planAnimation = vi.fn();
  /** Starts an animation and waits for the background planning, like coming back to the page later. */
  const made = async (input: Parameters<typeof createAnimation>[1]) => {
    const id = await createAnimation(deps, input);
    await waitForJob(`plan:${id}`);
    return id;
  };

  beforeEach(async () => {
    db = await studioDb();
    planAnimation.mockReset();
    planAnimation.mockResolvedValue({ scenes: SCENES.slice(0, 2) });
    deps = { db, writer: { planAnimation } as unknown as StudioDeps["writer"] };
  });

  it("plans scenes with the AI, adding an end card, or splits the script without AI", async () => {
    const id = await createAnimation(deps, { language: "en", platform: "reel", title: "Agents", script: "Agents save time.", mode: "ai" });
    // The page opens at once with the script split plainly, while the AI plans in the background.
    expect((await requireAnimation(db, id)).planStatus).toBe("planning");
    await waitForJob(`plan:${id}`);
    const row = await requireAnimation(db, id);
    expect(row.planStatus).toBeNull();
    expect(planAnimation).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }), { platform: "reel", title: "Agents", script: "Agents save time." });
    expect(row.scenes.map((item) => item.kind)).toEqual(["title", "number", "end"]);

    const plain = await requireAnimation(db, await made({ language: "en", platform: "short", title: "T", script: "One. Two.", mode: "simple" }));
    expect(plain.scenes[0]).toMatchObject({ kind: "title", heading: "T" });
    expect(planAnimation).toHaveBeenCalledTimes(1);
  });

  it("says why the AI couldn't plan, and keeps the plain scenes", async () => {
    planAnimation.mockRejectedValueOnce(new StudioError("Gemini's free limit is used up for now."));
    const id = await made({ language: "en", platform: "reel", title: "T", script: "One. Two.", mode: "ai" });
    const row = await requireAnimation(db, id);
    expect(row).toMatchObject({ planStatus: "failed", planError: "Gemini's free limit is used up for now." });
    expect(row.scenes[0]).toMatchObject({ kind: "title", heading: "T" });
  });

  it("keeps your changes when you edit the scenes while the AI is still planning", async () => {
    let finish!: (value: { scenes: AnimationScene[] }) => void;
    planAnimation.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const id = await createAnimation(deps, { language: "en", platform: "reel", title: "T", script: "One. Two.", mode: "ai" });
    await saveAnimation(db, id, { title: "T", platform: "reel", captions: true, scenes: [scene({ heading: "Mine" })] });
    finish({ scenes: SCENES });
    await waitForJob(`plan:${id}`);
    expect((await requireAnimation(db, id)).scenes).toEqual([scene({ heading: "Mine" })]);
  });

  it("refuses an empty script or an unknown network", async () => {
    await expect(createAnimation(deps, { language: "en", platform: "reel", title: "", script: " ", mode: "simple" })).rejects.toThrow("Paste the script");
    await expect(createAnimation(deps, { language: "en", platform: "telegram", title: "", script: "Hi", mode: "simple" })).rejects.toBeInstanceOf(StudioError);
  });

  it("makes the video once for the same scenes, and again after they change", async () => {
    const id = await made({ language: "en", platform: "reel", title: "Agents", script: "x", mode: "ai" });
    const draw = vi.fn<DrawFrames>(async ({ out, onProgress }) => {
      onProgress(0.5);
      await writeFile(out, "video");
    });
    const key = await makeAnimation(db, id, draw);
    await waitForJob(`animation:${key}`);
    let state = await animationState(db, id);
    expect(state).toMatchObject({ ready: true, working: false, key });
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, audio: null }));

    expect(await makeAnimation(db, id, draw)).toBe(key);
    expect(draw).toHaveBeenCalledTimes(1);

    const row = await requireAnimation(db, id);
    await saveAnimation(db, id, { title: "Agents", scenes: [...row.scenes, scene({ heading: "More" })], captions: false, platform: "reel" });
    state = await animationState(db, id);
    expect(state.ready).toBe(false);
    expect(state.key).not.toBe(key);

    await deleteAnimation(db, id);
    await expect(requireAnimation(db, id)).rejects.toThrow("no longer exists");
  });

  it("reports a failed render with a message you can act on", async () => {
    const id = await made({ language: "en", platform: "reel", title: "Agents", script: "x", mode: "ai" });
    const key = await makeAnimation(db, id, async () => {
      throw new StudioError("The studio needs Google Chrome to draw animations.");
    });
    await waitForJob(`animation:${key}`);
    const row = await requireAnimation(db, id);
    expect(row).toMatchObject({ renderStatus: "failed", renderError: "The studio needs Google Chrome to draw animations." });
  });

  it("reads an uploaded narration and times the scenes to it", async () => {
    const id = await made({ language: "en", platform: "reel", title: "Agents", script: "x", mode: "ai" });
    await mkdir(path.join(dataDir, "narration"), { recursive: true });
    const file = "00000000-0000-4000-8000-000000000001.wav";
    await run(FFMPEG(), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=5", path.join(dataDir, "narration", file)]);
    const transcribe: Transcriber = async ({ onProgress }) => {
      onProgress("transcribing", 1);
      return [word("Agents", 0.2, 0.6), word("save", 0.6, 0.9), word("time.", 0.9, 1.4), word("Five", 3, 3.3), word("hours.", 3.3, 4)];
    };
    await addNarration(db, id, { file, originalName: "voice.wav" }, transcribe);
    await waitForJob(`narration:${id}`);
    const row = await requireAnimation(db, id);
    expect(row).toMatchObject({ narrationStatus: "ready", narrationName: "voice.wav" });
    expect(row.narrationDuration).toBeCloseTo(5, 0);
    const { duration } = pageFor(row, BRAND);
    expect(duration).toBeGreaterThan(5);

    const draw = vi.fn<DrawFrames>(async ({ out }) => writeFile(out, "video"));
    const key = await makeAnimation(db, id, draw);
    await waitForJob(`animation:${key}`);
    expect(draw.mock.calls[0][0].audio).toBe(path.join(dataDir, "narration", file));

    await removeNarration(db, id);
    const after = await requireAnimation(db, id);
    expect(after.narration).toBeNull();
    expect(animationKey(after, BRAND)).not.toBe(key);
  });

  it("says why a recording without speech can't be used", async () => {
    const id = await made({ language: "en", platform: "reel", title: "Agents", script: "x", mode: "ai" });
    await mkdir(path.join(dataDir, "narration"), { recursive: true });
    const file = "00000000-0000-4000-8000-000000000002.wav";
    await run(FFMPEG(), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", path.join(dataDir, "narration", file)]);
    await addNarration(db, id, { file, originalName: "silence.wav" }, async () => []);
    await waitForJob(`narration:${id}`);
    expect(await requireAnimation(db, id)).toMatchObject({ narrationStatus: "failed", narrationError: expect.stringContaining("No speech") });
  });
});

describe("a talking-head video without an idea first", () => {
  it("makes an approved idea and one video post, with what you say as the script", async () => {
    const db = await studioDb();
    const { ideaId, platform } = await startQuickVideo(db, { language: "en", platform: "reel", title: "My take", script: "First part.\n\nSecond part." });
    expect(platform).toBe("reel");
    expect(await requireIdea(db, ideaId)).toMatchObject({ status: "approved", title: "My take" });
    expect((await getScenario(db, ideaId))?.approvedVersion).toBe(1);
    const [piece] = await getPieces(db, ideaId);
    expect(piece.platform).toBe("reel");
    expect(piece.current.content).toEqual({ body: "", title: "My take", script: [{ say: "First part.", show: "" }, { say: "Second part.", show: "" }] });
    await expect(startQuickVideo(db, { language: "en", platform: "reel", title: " ", script: "" })).rejects.toThrow("title");
  });
});

// ---- Real drawing with Chrome and FFmpeg: slow, so it runs only when asked: VIDEO_E2E=1 ----

describe.runIf(process.env.VIDEO_E2E === "1")("drawing an animation on this computer", () => {
  it("makes a playable video with sound from the scenes", async () => {
    const all = cleanScenes([
      { kind: "title", heading: "Agents save time", text: "For small teams", say: "Agents save small teams time." },
      { kind: "number", text: "73%", heading: "of teams use one", say: "Seventy three percent already do." },
      { kind: "end" },
    ]);
    const times = sceneTimeline(all, null);
    const html = animationHtml({ scenes: all, times, cues: captionCues(all, times, null, "en"), platform: "linkedin_video", language: "en", brand: BRAND });
    const out = path.join(dataDir, "e2e.mp4");
    await chromeFrames({ html, width: 1080, height: 1350, duration: totalDuration(times), audio: null, out, onProgress: () => {} });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 1080, height: 1350, hasAudio: true });
    expect(info.duration).toBeCloseTo(totalDuration(times), 0);
    if (process.env.ANIMATION_E2E_OUT) await copyFile(out, process.env.ANIMATION_E2E_OUT);
  }, 300_000);
});
