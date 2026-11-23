import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { studioDb } from "./fixtures/brand";
import { createLocalDb, type Db } from "@/lib/db/client";
import { footage, type EditPlan, type Phrase, type Word } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  addFootage,
  approveAndPublish,
  createPieces,
  getPieces,
  makeVideo,
  markPostedByHand,
  planVideoEdit,
  retryFootage,
  savePieceEdit,
  useFootage,
  videoState,
  type PublishDeps,
} from "@/lib/content";
import { StudioError } from "@/lib/errors";
import { contentProblem, postedText, type Platform } from "@/lib/platforms";
import { PUBLISHERS } from "@/lib/publishers";
import { createWriter } from "@/lib/ai/writer";
import { passingTeam } from "./fakes";
import { approveScenario, decideIdea, generateIdeas, getScenario, writeScenario, type StudioDeps } from "@/lib/studio";
import {
  buildPhrases,
  captionChunks,
  captionFile,
  chapterLines,
  cleanPlan,
  keepRanges,
  levelsOf,
  pausesFromLevels,
  spreadPiledWords,
  untrimPhrases,
  outputDuration,
  simplePlan,
  toOutputTime,
} from "@/lib/video/edit";
import { speechWindows, waitForJob, type Transcriber } from "@/lib/video/footage";
import { cardsFor, renderKey, zoomExpression, type DrawCards } from "@/lib/video/render";
import { FFMPEG, probe, run } from "@/lib/video/tools";

const word = (text: string, start: number, end: number): Word => ({ text, start, end });

/** "Hi, I'm Sam." then a false start, then the real take. */
const WORDS: Word[] = [
  word("Hi,", 0.1, 0.4),
  word("I'm", 0.6, 0.8),
  word("Sam.", 0.8, 1.3),
  word("Today", 2.6, 2.9),
  word("I", 2.9, 3.1),
  word("want", 3.1, 3.4),
  word("Let", 6.0, 6.2),
  word("me", 6.2, 6.4),
  word("start", 6.4, 6.8),
  word("again.", 6.8, 7.3),
  word("Agents", 8.0, 8.5),
  word("save", 8.5, 8.8),
  word("five", 9.8, 10.1),
  word("hours", 10.1, 10.5),
  word("a", 10.5, 10.6),
  word("week.", 10.6, 11.0),
];

const plan = (fields: Partial<EditPlan> = {}): EditPlan => ({ ...simplePlan("Save five hours"), ...fields });

describe("editing logic", () => {
  const phrases = buildPhrases(WORDS);

  it("splits speech into phrases at pauses and sentence ends", () => {
    expect(phrases.map((phrase) => phrase.text)).toEqual([
      "Hi, I'm Sam.",
      "Today I want",
      "Let me start again.",
      "Agents save",
      "five hours a week.",
    ]);
  });

  it("cuts phrases, keeps natural pauses, and maps times to the finished video", () => {
    const ranges = keepRanges(phrases, plan({ cut: [1, 2] }), 12);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBe(0);
    expect(ranges[1].start).toBeCloseTo(7.88);
    expect(toOutputTime(ranges, 4)).toBeNull();
    expect(toOutputTime(ranges, 8.0)).toBeCloseTo(ranges[0].end + 0.12);
  });

  it("shortens long pauses only when asked", () => {
    const loose = outputDuration(keepRanges(phrases, plan({ cut: [1, 2] }), 12));
    const tight = outputDuration(keepRanges(phrases, plan({ cut: [1, 2], tightenPauses: true }), 12));
    expect(tight).toBeLessThan(loose - 0.5);
    // Without tightening, the short pause between the last two phrases stays in.
    expect(keepRanges(phrases, plan({ cut: [0, 1, 2] }), 12)).toHaveLength(1);
    const ranges = keepRanges(phrases, plan({ cut: [0, 1, 2], tightenPauses: true }), 12);
    expect(ranges).toHaveLength(2);
  });

  it("hears pauses against the clip's own loudness, so a soft sentence ending stays speech", () => {
    // A quiet room (-85 dB), a voice around -30 dB, and a sentence that fades to -55 dB before stopping.
    const levels = [...Array(20).fill(-30), ...Array(6).fill(-55), ...Array(30).fill(-85), ...Array(20).fill(-30)];
    expect(pausesFromLevels(levels)).toEqual([{ start: 1.3, end: expect.closeTo(2.8, 5) }]);
    // Too noisy to tell quiet from voice: no pauses at all, rather than cutting speech.
    expect(pausesFromLevels([...Array(20).fill(-30), ...Array(20).fill(-38)])).toEqual([]);
    // Loudness is measured in 50 ms steps.
    const samples = new Float32Array(1600).fill(0.1);
    expect(levelsOf(samples, 16000)).toHaveLength(2);
    expect(levelsOf(samples, 16000)[0]).toBeCloseTo(-20);
  });

  it("spreads words Whisper piled on one moment over the speech they came from", () => {
    // Whisper heard "one two three" but timed them all at 9 seconds, past the words that follow.
    const piled = [word("Hello.", 0, 0.5), word("one", 9, 9), word("two", 9, 9), word("three", 9, 9), word("Next", 6, 6.4)];
    const spread = spreadPiledWords(piled, [{ start: 3, end: 4 }], 10);
    const placed = spread.slice(1, 4);
    expect(placed[0].start).toBeCloseTo(0.5);
    expect(placed[2].end).toBeCloseTo(6);
    // In order, and never inside the pause.
    placed.forEach((item, index) => {
      expect(item.end).toBeGreaterThan(item.start);
      if (index > 0) expect(item.start).toBeGreaterThanOrEqual(placed[index - 1].end - 1e-9);
      expect(item.start >= 3 && item.end <= 4).toBe(false);
    });
    expect(spread[4]).toEqual(piled[4]);
    // Well-timed words are left alone.
    expect(spreadPiledWords(WORDS, [], 12)).toEqual(WORDS);
  });

  it("puts back word edges an earlier version trimmed to wrongly heard pauses", () => {
    const trimmed = buildPhrases([word("Do", 0, 0.4), word("it", 0.4, 0.85)]);
    const restored = untrimPhrases(trimmed, [{ start: 0.85, end: 3 }]);
    expect(restored[0].words[1].end).toBe(3);
    expect(restored[0].end).toBe(3);
  });

  it("takes out the pauses the audio has even where the word times are wrong", () => {
    // Whole words placed inside a four-second silence: the word times alone see no pause.
    const misplaced = buildPhrases([word("One", 0, 0.5), word("two", 0.5, 2.5), word("three", 2.5, 4.5), word("four.", 4.5, 5)]);
    const silences = [{ start: 0.6, end: 4.6 }];
    const tight = keepRanges(misplaced, plan({ tightenPauses: true }), 5.3, silences);
    expect(outputDuration(tight)).toBeLessThan(2);
    // Each cut leaves a breath of quiet on both sides.
    expect(tight[0].end).toBeCloseTo(0.9);
    expect(tight[1].start).toBeCloseTo(4.45);
    // Speech Whisper ended too early runs on to the pause that really ends it.
    const early = buildPhrases([word("Say", 0, 0.3), word("it", 0.3, 0.5)]);
    expect(keepRanges(early, plan({ tightenPauses: true }), 6, [{ start: 1.2, end: 5 }])[0].end).toBeCloseTo(1.5);
    // Only when asked.
    expect(outputDuration(keepRanges(misplaced, plan(), 6, silences))).toBeGreaterThan(5);
  });

  it("captions only kept speech, in short lines, with corrections", () => {
    const chunks = captionChunks(phrases, plan({ cut: [1, 2], fixes: [{ phrase: 0, text: "Hi, I'm Sam Rivera." }] }), 12, "reel");
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Hi, I'm Sam", "Rivera.", "Agents save", "five hours a", "week."]);
    expect(chunks.every((chunk, index) => index === 0 || chunk.start >= chunks[index - 1].end - 1e-9)).toBe(true);
    // Wide YouTube captions fit more words on a line.
    expect(captionChunks(phrases, plan(), 12, "youtube").length).toBeLessThan(captionChunks(phrases, plan(), 12, "reel").length);
  });

  it("writes captions in the brand font, with highlights and automatic text direction", () => {
    const file = captionFile([{ start: 1, end: 2, text: "با AI agent" }], plan({ highlights: ["agent"] }), "reel", "fa");
    expect(file).toContain("Style: Caption,Vazirmatn ExtraBold");
    expect(file).toMatch(/,-1\n/);
    expect(file).toContain("{\\c&H002FA7E3}agent{\\c&H00FFFFFF}");
    expect(captionFile([], plan(), "youtube", "en")).toContain("PlayResX: 1920");
  });

  it("keeps a plan within the clip, and never cuts everything", () => {
    const cleaned = cleanPlan(plan({ cut: [0, 1, 2, 3], zooms: [9, 1, 1], callouts: [{ phrase: 7, text: "x" }, { phrase: 1, text: " Key " }] }), 4);
    expect(cleaned.cut).toEqual([]);
    expect(cleaned.zooms).toEqual([1]);
    expect(cleaned.callouts).toEqual([{ phrase: 1, text: "Key" }]);
    expect(cleanPlan(plan({ cut: [2, 2, -1] }), 4).cut).toEqual([2]);
  });

  it("writes YouTube chapters only when they follow YouTube's rules", () => {
    const long: Phrase[] = Array.from({ length: 8 }, (_, index) => ({
      start: index * 15,
      end: index * 15 + 14,
      text: `Part ${index}`,
      words: [word("Part", index * 15, index * 15 + 14)],
    }));
    const chapters = [
      { phrase: 1, title: "Intro" },
      { phrase: 3, title: "Setup" },
      { phrase: 5, title: "Results" },
    ];
    expect(chapterLines(long, plan({ chapters }), 120)).toEqual(["0:00 Intro", "0:45 Setup", "1:15 Results"]);
    expect(chapterLines(long, plan({ chapters: chapters.slice(0, 2) }), 120)).toEqual([]);
  });

  it("places motion cards without overlaps, and zooms only kept phrases", () => {
    const ranges = keepRanges(phrases, plan(), 12);
    const cards = cardsFor(
      phrases,
      plan({ callouts: [{ phrase: 1, text: "One" }, { phrase: 1, text: "Dup" }, { phrase: 3, text: "Two" }] }),
      ranges,
      outputDuration(ranges),
    );
    expect(cards.map((card) => card.kind)).toEqual(["title", "callout", "callout"]);
    // A callout on the last phrase still shows, above the end card.
    const longRanges = [{ start: 0, end: 30 }];
    const late: Phrase[] = [{ start: 28, end: 29.5, text: "Follow", words: [word("Follow", 28, 29.5)] }];
    expect(cardsFor(late, plan({ callouts: [{ phrase: 0, text: "Follow" }] }), longRanges, 30).map((card) => card.kind)).toEqual([
      "title",
      "callout",
      "end",
    ]);
    // The end card needs at least 10 seconds of video.
    expect(cardsFor(phrases, plan(), [{ start: 0, end: 30 }], 30).at(-1)).toMatchObject({ kind: "end", start: 26.5 });
    for (let index = 1; index < cards.length - 1; index++) {
      if (cards[index - 1].kind === "callout") expect(cards[index].start).toBeGreaterThan(cards[index - 1].start + cards[index - 1].duration);
    }
    const cutRanges = keepRanges(phrases, plan({ cut: [3] }), 12);
    expect(zoomExpression(phrases, plan({ cut: [3], zooms: [3] }), cutRanges)).toBeNull();
    expect(zoomExpression(phrases, plan({ zooms: [3] }), ranges)).toContain("clip(");
  });

  it("splits long audio at pauses into parts Whisper can hear", () => {
    const windows = speechWindows(70, [{ start: 20, end: 21 }, { start: 26, end: 26.6 }, { start: 50, end: 50.4 }]);
    expect(windows[0]).toEqual([0, 26.3]);
    expect(windows.every(([start, end]) => end - start <= 28)).toBe(true);
    expect(windows[windows.length - 1][1]).toBe(70);
  });
});

describe("video rules", () => {
  it("needs a YouTube title, and only posted words can block posting", () => {
    expect(contentProblem("youtube", { body: "Description" })).toMatch(/title/);
    expect(contentProblem("reel", { body: "Caption" })).toBeNull();
    const content = { body: "Caption", script: [{ say: "[Sam: add your story]", show: "" }] };
    expect(JSON.stringify(postedText("reel", content))).not.toContain("Sam: add");
  });

  it("gives each video network its own job in the writing instructions", async () => {
    const generate = vi.fn(async () => ({ title: "T", script: [], body: "B", tags: [] }));
    const writer = createWriter(generate as never);
    const context = { language: "en" as const, brand: { positioning: "", audience: "", pillars: [], voiceGuide: "", avoid: "", samples: "", searchTopics: [] } };
    const prompts: string[] = [];
    for (const platform of ["reel", "short", "youtube", "linkedin_video"] as Platform[]) {
      await writer.writePiece(context, { platform, scenario: { title: "", hook: "", mainPoints: [], angle: "", example: "", callToAction: "" }, sources: [] });
      prompts.push((generate.mock.calls.at(-1) as unknown as string[])[1]);
    }
    expect(prompts[0]).toContain("Instagram Reel");
    expect(prompts[1]).toContain("YouTube Short");
    expect(prompts[2]).toContain("6 to 10 minutes");
    expect(prompts[3]).toContain("without sound");
    expect(new Set(prompts).size).toBe(4);
  });
});

// ---- The whole flow, with real FFmpeg and a fake transcription ----

let dataDir: string;
let clipFile: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "studio-video-test-"));
  process.env.VIDEO_DATA_DIR = dataDir;
  // A 12-second landscape clip with the recorded speech.
  clipFile = path.join(dataDir, "clip.mp4");
  await run(FFMPEG(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=12",
    "-i", path.resolve("tests/fixtures/speech-en.wav"),
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", clipFile,
  ]);
}, 60_000);

afterAll(async () => {
  delete process.env.VIDEO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

const fakeTranscriber: Transcriber = async ({ onProgress }) => {
  onProgress("transcribing", 1);
  return WORDS;
};

/** Stands in for Chrome: solid cards and thumbnails made by FFmpeg. */
const fakeDraw: DrawCards = async (pages) => {
  for (const page of pages) {
    await run(FFMPEG(), [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", `color=c=0xe3a72f:s=${page.element ? "400x120" : `${page.width}x${page.height}`}`,
      "-frames:v", "1", page.file,
    ]);
  }
};

async function upload(db: Db, pieceId: string, version: number) {
  const { copyFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const file = `${randomUUID()}.mp4`;
  await (await import("node:fs/promises")).mkdir(path.join(dataDir, "footage"), { recursive: true });
  await copyFile(clipFile, path.join(dataDir, "footage", file));
  const id = await addFootage(db, pieceId, version, { file, originalName: "take1.mp4", size: (await stat(clipFile)).size }, fakeTranscriber);
  await waitForJob(`footage:${id}`);
  return id;
}

describe("videos Sam films", () => {
  let db: Db;
  let deps: StudioDeps;
  let reel: Awaited<ReturnType<typeof getPieces>>[number];
  const planEdit = vi.fn();

  beforeEach(async () => {
    db = await studioDb();
    const writer = {
      generateIdeas: vi.fn(async () => [{ title: "Agents", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [] }]),
      adaptIdeas: vi.fn(async (_c: unknown, { ideas }: { ideas: object[] }) => ideas),
      writeScenario: vi.fn(async () => ({ title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" })),
      adaptScenario: vi.fn(async (_c: unknown, { scenario }: { scenario: object }) => scenario),
      writePiece: vi.fn(async () => ({ title: "Save five hours", script: [{ say: "Hi", show: "Close-up" }], body: "Caption #ai", tags: [] })),
      planEdit,
      ...passingTeam(),
    };
    deps = { db, writer: writer as unknown as StudioDeps["writer"], searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] } };
    const [idea] = await generateIdeas(deps, "en", "");
    await decideIdea(db, idea.id, "approved");
    await writeScenario(deps, idea.id);
    await approveScenario(db, idea.id, (await getScenario(db, idea.id))!.currentVersion);
    await createPieces(deps, idea.id, ["reel", "youtube"], ["en"]);
    reel = (await getPieces(db, idea.id)).find((piece) => piece.platform === "reel")!;
    planEdit.mockReset();
  });

  it("writes a script and shot list for each video network", () => {
    expect(reel.current.content.script).toEqual([{ say: "Hi", show: "Close-up" }]);
  });

  it("reads an uploaded clip into phrases, as a new version of the video", async () => {
    const id = await upload(db, reel.id, 1);
    const state = await videoState(db, reel.id, "reel", "en", (await getPieces(db, reel.ideaId))[0].current.content);
    expect(state.clip?.id).toBe(id);
    expect(state.clip?.status).toBe("ready");
    expect(state.clip?.phrases).toHaveLength(5);
    expect(state.clip?.width).toBe(1280);
    expect(state.problem).toBe("Plan the edit first.");
  });

  it("shows how far the reading has got while it runs", async () => {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const file = "11111111-1111-4111-8111-111111111111.mp4";
    await mkdir(path.join(dataDir, "footage"), { recursive: true });
    await copyFile(clipFile, path.join(dataDir, "footage", file));
    const seen: (string | null)[] = [];
    let clipId = "";
    // Reports halfway, then looks at what the page would show before finishing.
    const watching: Transcriber = async ({ onProgress }) => {
      onProgress("transcribing", 0.5);
      for (let tries = 0; tries < 40; tries++) {
        const [row] = await db.select().from(footage).where(eq(footage.id, clipId));
        if (row?.stage === "transcribing") {
          seen.push(`${row.stage} ${row.progress}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return WORDS;
    };
    clipId = await addFootage(db, reel.id, 1, { file, originalName: "take1.mp4", size: (await stat(clipFile)).size }, watching);
    await waitForJob(`footage:${clipId}`);
    expect(seen).toEqual(["transcribing 0.5"]);
  });

  it("fails clearly on a file that isn't a video, and can try again", async () => {
    const file = "00000000-0000-4000-8000-000000000000.mp4";
    await (await import("node:fs/promises")).mkdir(path.join(dataDir, "footage"), { recursive: true });
    await writeFile(path.join(dataDir, "footage", file), "not a video");
    const id = await addFootage(db, reel.id, 1, { file, originalName: "notes.mp4", size: 11 }, fakeTranscriber);
    await waitForJob(`footage:${id}`);
    const [piece] = await getPieces(db, reel.ideaId);
    const state = await videoState(db, reel.id, "reel", "en", piece.current.content);
    expect(state.clip?.status).toBe("failed");
    expect(state.clip?.error).toMatch(/MP4/);
    await retryFootage(db, id, fakeTranscriber);
    await waitForJob(`footage:${id}`);
  });

  it("lets the AI choose the edit, and keeps its plan within the clip", async () => {
    await upload(db, reel.id, 1);
    planEdit.mockResolvedValue({
      level: "full",
      reason: "You restarted once, so the first take is cut.",
      cut: [1, 2, 99],
      tightenPauses: true,
      titleCard: "Save five hours",
      callouts: [{ phrase: 3, text: "5 hours" }],
      zooms: [3],
      highlights: ["hours"],
      chapters: [{ phrase: 0, title: "Only on YouTube" }],
    });
    await planVideoEdit(deps, reel.id, 2, "ai");
    const [piece] = await getPieces(db, reel.ideaId);
    const edit = piece.current.content.edit!;
    expect(edit.level).toBe("full");
    expect(edit.cut).toEqual([1, 2]);
    expect(edit.chapters).toEqual([]);
    expect(edit.captions).toBe(true);
    // The AI was given the transcript as numbered phrases.
    expect(planEdit.mock.calls[0][1].phrases[2]).toMatchObject({ number: 2, text: "Let me start again." });
  });

  it("makes the finished video for the exact version, then lets Sam record posting it", async () => {
    await upload(db, reel.id, 1);
    await planVideoEdit(deps, reel.id, 2, "simple");
    await savePieceEdit(db, reel.id, 3, {
      body: "Caption #ai",
      edit: plan({ cut: [1, 2], zooms: [3], callouts: [{ phrase: 3, text: "5 hours" }], tightenPauses: true }),
    });
    await expect(markPostedByHand(db, reel.id, 4)).rejects.toThrow("Make the video");

    const key = await makeVideo(db, reel.id, 4, fakeDraw);
    await waitForJob(`render:${key}`);
    let [piece] = await getPieces(db, reel.ideaId);
    const state = await videoState(db, reel.id, "reel", "en", piece.current.content);
    expect(state.render?.status).toBe("ready");
    const file = path.join(dataDir, "videos", `${key}.mp4`);
    const info = await probe(file);
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(info.duration).toBeCloseTo(state.render!.duration!, 0);
    expect(info.duration).toBeLessThan(9);
    // Reels get a cover image.
    await expect(stat(path.join(dataDir, "videos", `${key}.jpg`))).resolves.toBeTruthy();

    // Changing the edit needs a new video before it can be recorded.
    await savePieceEdit(db, reel.id, 4, { body: "Caption #ai", edit: plan({ titleCard: "Another title" }) });
    await expect(markPostedByHand(db, reel.id, 5)).rejects.toThrow("Make the video");
    await restoreAndRecord(db, reel.id);
    [piece] = await getPieces(db, reel.ideaId);
    expect(piece.publication?.status).toBe("posted");
  }, 120_000);

  it("needs no new video when only the caption changes", async () => {
    await upload(db, reel.id, 1);
    await planVideoEdit(deps, reel.id, 2, "simple");
    const key = await makeVideo(db, reel.id, 3, fakeDraw);
    await waitForJob(`render:${key}`);
    await savePieceEdit(db, reel.id, 3, { body: "A better caption #ai" });
    await markPostedByHand(db, reel.id, 4);
    const [piece] = await getPieces(db, reel.ideaId);
    expect(piece.publication).toMatchObject({ status: "posted", version: 4 });
  }, 120_000);

  it("reuses one clip for another video of the same idea, with its own edit", async () => {
    const id = await upload(db, reel.id, 1);
    const youtube = (await getPieces(db, reel.ideaId)).find((piece) => piece.platform === "youtube")!;
    await useFootage(db, youtube.id, 1, id);
    await planVideoEdit(deps, youtube.id, 2, "simple");
    const [, updated] = await getPieces(db, reel.ideaId);
    const content = updated.current.content;
    expect(content.footage).toBe(id);
    expect(content.edit?.cut).toEqual([]);
    expect(renderKey("youtube", "en", id, content)).not.toBe(renderKey("reel", "en", id, content));
  });

  it("never posts a video automatically", async () => {
    const publishDeps = { db, publishers: PUBLISHERS, slideImages: vi.fn() } as unknown as PublishDeps;
    await expect(approveAndPublish(publishDeps, reel.id, 1)).rejects.toThrow(StudioError);
  });
});

/** Saves the old caption back and records the post, which works because that version's video exists. */
async function restoreAndRecord(db: Db, pieceId: string) {
  const { restorePieceVersion } = await import("@/lib/content");
  await restorePieceVersion(db, pieceId, 5, 4);
  await markPostedByHand(db, pieceId, 6, "https://www.instagram.com/reel/abc/");
}

// ---- Real speech recognition: slow, so it runs only when asked: VIDEO_E2E=1 ----

describe.runIf(process.env.VIDEO_E2E === "1")("Whisper on this computer", () => {
  it("turns recorded English speech into timed words", async () => {
    const { whisperTranscriber } = await import("@/lib/video/footage");
    process.env.MODEL_DIR = path.resolve(".data/models");
    const audio = path.join(dataDir, "speech.f32");
    await run(FFMPEG(), ["-hide_banner", "-loglevel", "error", "-y", "-i", path.resolve("tests/fixtures/speech-en.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", audio]);
    const words = await whisperTranscriber({ audioFile: audio, language: "en", windows: [[0, 16.6]], onProgress: () => {} });
    const text = words.map((item) => item.text).join(" ");
    expect(text).toMatch(/AI agent/);
    expect(buildPhrases(words).length).toBeGreaterThan(2);
  }, 300_000);
});
