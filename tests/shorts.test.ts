import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { studioDb } from "./fixtures/brand";
import { passingTeam } from "./fakes";
import type { Db } from "@/lib/db/client";
import { footage, pieces, publications, type Moment, type Phrase } from "@/lib/db/schema";
import { createPieces, findClipMoments, getPieces, makeHighlights, makeShortFromMoment, planVideoEdit, useFootage, useWholeClip } from "@/lib/content";
import { StudioError } from "@/lib/errors";
import { approveScenario, decideIdea, generateIdeas, getScenario, writeScenario, type StudioDeps } from "@/lib/studio";
import { cleanMoments, outsideParts, outsideWindow, partsSeconds, pickHighlights, windowSeconds } from "@/lib/video/edit";

/** A two-minute talk: twenty phrases of six seconds each. */
const PHRASES: Phrase[] = Array.from({ length: 20 }, (_, i) => ({
  start: i * 6,
  end: i * 6 + 5.5,
  text: `Point ${i} of the talk.`,
  words: [{ text: `Point ${i} of the talk.`, start: i * 6, end: i * 6 + 5.5 }],
}));
const moment = (fields: Partial<Moment>): Moment => ({ from: 0, to: 4, title: "A moment", hook: "Hook", why: "Why", score: 7, ...fields });

describe("moments of a long clip", () => {
  it("keeps moments on real phrases, a usable length, without overlaps, strongest first", () => {
    const cleaned = cleanMoments(
      [
        moment({ from: 2, to: 6, score: 6, title: "Second" }),
        moment({ from: 5, to: 9, score: 9, title: "Best" }),
        moment({ from: 12, to: 10, score: 7.6, title: "Backwards" }),
        moment({ from: 15, to: 15, score: 8, title: "Too short" }),
        moment({ from: 18, to: 40, score: 10, title: "Past the end" }),
        moment({ from: 0, to: 19, score: 9, title: "Too long" }),
        moment({ from: 16, to: 19, score: 99, title: "" }),
      ],
      PHRASES,
    );
    expect(cleaned.map((item) => item.title)).toEqual(["Best", "Backwards"]);
    expect(cleaned[1]).toMatchObject({ from: 10, to: 12, score: 8 });
    expect(outsideWindow({ from: 2, to: 4 }, 6)).toEqual([0, 1, 5]);
    expect(windowSeconds({ from: 2, to: 4 }, PHRASES)).toBeCloseTo(17.5);
  });

  it("keeps the strongest main moments that fit the time, in the clip's order", () => {
    // Each phrase is 5.5 seconds, so 0–2 is 17.5 s, 5–9 is 29.5 s, 12–13 is 11.5 s and 15–19 is 29.5 s.
    const picked = pickHighlights(
      [
        moment({ from: 15, to: 19, score: 9, title: "Strongest" }),
        moment({ from: 0, to: 2, score: 4, title: "Opening" }),
        moment({ from: 5, to: 9, score: 8, title: "Second" }),
        moment({ from: 12, to: 13, score: 6, title: "Short one" }),
      ],
      PHRASES,
      75,
    );
    // 29.5 + 29.5 = 59; the opening would make it 76.5, past 75, but the short one fits: 70.5.
    expect(picked.map((item) => item.title)).toEqual(["Second", "Short one", "Strongest"]);
    expect(partsSeconds(picked, PHRASES)).toBeCloseTo(70.5);
    expect(outsideParts([{ from: 1, to: 2 }, { from: 4, to: 4 }], 6)).toEqual([0, 3, 5]);
  });

  it("reads an answer given in seconds instead of phrase numbers", () => {
    const cleaned = cleanMoments(
      [
        moment({ from: 30, to: 60, score: 8, title: "First" }),
        moment({ from: 70, to: 100, score: 7, title: "Second" }),
      ],
      PHRASES,
    );
    // 30 s is said in phrase 5, 60 s after phrase 9 begins; 70 s in phrase 11, 100 s after phrase 16 begins.
    expect(cleaned.map(({ title, from, to }) => ({ title, from, to }))).toEqual([
      { title: "First", from: 5, to: 9 },
      { title: "Second", from: 11, to: 16 },
    ]);
  });
});

describe("one long video into short ones", () => {
  let db: Db;
  let deps: StudioDeps;
  let youtubeId: string;
  const findMoments = vi.fn();
  const planEdit = vi.fn();

  beforeEach(async () => {
    db = await studioDb();
    const writer = {
      generateIdeas: vi.fn(async () => [{ title: "Agents", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [] }]),
      adaptIdeas: vi.fn(async (_c: unknown, { ideas }: { ideas: object[] }) => ideas),
      writeScenario: vi.fn(async () => ({ title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" })),
      adaptScenario: vi.fn(async (_c: unknown, { scenario }: { scenario: object }) => scenario),
      writePiece: vi.fn(async () => ({ title: "The long talk", script: [{ say: "Hi", show: "" }], body: "Description", tags: [] })),
      findMoments,
      planEdit,
      ...passingTeam(),
    };
    deps = { db, writer: writer as unknown as StudioDeps["writer"], searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] } };
    const [idea] = await generateIdeas(deps, "en", "");
    await decideIdea(db, idea.id, "approved");
    await writeScenario(deps, idea.id);
    await approveScenario(db, idea.id, (await getScenario(db, idea.id))!.currentVersion);
    await createPieces(deps, idea.id, ["youtube"], ["en"]);
    const youtube = (await getPieces(db, idea.id)).find((piece) => piece.platform === "youtube")!;
    youtubeId = youtube.id;
    const [clip] = await db
      .insert(footage)
      .values({ pairId: idea.pairId, language: "en", file: "talk.mp4", originalName: "talk.mp4", size: 1, duration: 120, width: 1920, height: 1080, status: "ready", phrases: PHRASES })
      .returning({ id: footage.id });
    await useFootage(db, youtubeId, youtube.currentVersion, clip.id);
    findMoments.mockReset();
    planEdit.mockReset();
  });

  it("finds the best moments with the editor and keeps them on the long video", async () => {
    findMoments.mockResolvedValue({ moments: [moment({ from: 3, to: 7, title: "The surprise", score: 8 }), moment({ from: 6, to: 8, score: 5 })] });
    await findClipMoments(deps, youtubeId, 2);
    const [youtube] = (await getPiecesFor(db, youtubeId)).filter((piece) => piece.platform === "youtube");
    expect(youtube.current.content.moments).toEqual([moment({ from: 3, to: 7, title: "The surprise", score: 8 })]);
    expect(findMoments.mock.calls[0][1].phrases).toHaveLength(20);
  });

  it("makes a moment into a Reel cut from the same clip, and replans only that part", async () => {
    findMoments.mockResolvedValue({ moments: [moment({ from: 3, to: 7, title: "The surprise", hook: "Nobody expected this." })] });
    await findClipMoments(deps, youtubeId, 2);
    const made = await makeShortFromMoment(db, youtubeId, 3, 0, "reel");
    expect(made.platform).toBe("reel");
    const reel = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "reel")!;
    const content = reel.current.content;
    expect(content).toMatchObject({ title: "The surprise", body: "Nobody expected this.", window: { from: 3, to: 7 } });
    expect(content.edit?.cut).toEqual(outsideWindow({ from: 3, to: 7 }, 20));
    expect(content.edit?.framing).toBe("fill");

    // Planning the Reel with the AI only shows the editor its part, and the rest stays cut.
    planEdit.mockResolvedValue({ level: "full", reason: "", cut: [5], tightenPauses: true, titleCard: "", callouts: [], zooms: [], highlights: [], chapters: [] });
    await planVideoEdit(deps, reel.id, 1, "ai");
    expect(planEdit.mock.calls[0][1].phrases.map((phrase: { number: number }) => phrase.number)).toEqual([3, 4, 5, 6, 7]);
    expect(planEdit.mock.calls[0][1].duration).toBeCloseTo(29.5);
    const replanned = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "reel")!;
    expect(replanned.current.content.edit?.cut).toEqual([...outsideWindow({ from: 3, to: 7 }, 20), 5].sort((a, b) => a - b));
  });

  it("lets a short from one moment use the whole clip again, so the editor can choose from all of it", async () => {
    findMoments.mockResolvedValue({ moments: [moment({ from: 3, to: 7, title: "The surprise" })] });
    await findClipMoments(deps, youtubeId, 2);
    const made = await makeShortFromMoment(db, youtubeId, 3, 0, "short");
    await useWholeClip(db, made.pieceId, 1);
    const short = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "short")!;
    expect(short.currentVersion).toBe(2);
    expect(short.current.content).toMatchObject({ title: "The surprise" });
    expect(short.current.content.window).toBeUndefined();
    expect(short.current.content.edit).toBeUndefined();

    planEdit.mockResolvedValue({ level: "full", reason: "", cut: [0, 1], tightenPauses: true, titleCard: "", callouts: [], zooms: [], highlights: [], chapters: [] });
    await planVideoEdit(deps, short.id, 2, "ai", "Only the main moments, about two minutes.");
    expect(planEdit.mock.calls[0][1].phrases).toHaveLength(20);
    expect(planEdit.mock.calls[0][1].request).toBe("Only the main moments, about two minutes.");
    const planned = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "short")!;
    expect(planned.current.content.edit?.cut).toEqual([0, 1]);
  });

  it("makes the main moments into one Short no longer than asked, and plans only those parts", async () => {
    findMoments.mockResolvedValue({
      moments: [
        moment({ from: 15, to: 19, score: 9, title: "Strongest", hook: "The one thing to remember." }),
        moment({ from: 0, to: 2, score: 4, title: "Opening" }),
        moment({ from: 5, to: 9, score: 8, title: "Second" }),
      ],
    });
    const made = await makeHighlights(deps, youtubeId, 2, "short", 60);
    expect(findMoments.mock.calls[0][1].highlights).toBe(60);
    const short = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "short")!;
    expect(short.id).toBe(made.pieceId);
    const content = short.current.content;
    expect(content).toMatchObject({ title: "The long talk", body: "The one thing to remember.", parts: [{ from: 5, to: 9 }, { from: 15, to: 19 }] });
    expect(content.edit?.cut).toEqual(outsideParts([{ from: 5, to: 9 }, { from: 15, to: 19 }], 20));

    // The editor then sees only those parts, and the rest stays cut.
    planEdit.mockResolvedValue({ level: "light", reason: "", cut: [], tightenPauses: true, titleCard: "", callouts: [], zooms: [], highlights: [], chapters: [] });
    await planVideoEdit(deps, short.id, 1, "ai");
    expect(planEdit.mock.calls[0][1].phrases.map((phrase: { number: number }) => phrase.number)).toEqual([5, 6, 7, 8, 9, 15, 16, 17, 18, 19]);
    expect(planEdit.mock.calls[0][1].duration).toBeCloseTo(59);

    // Never longer than the network allows, and never less than half a minute.
    findMoments.mockClear();
    await makeHighlights(deps, youtubeId, 2, "reel", 900);
    expect(findMoments.mock.calls[0][1].highlights).toBe(120);
    await makeHighlights(deps, youtubeId, 2, "reel", 5);
    expect(findMoments.mock.calls[1][1].highlights).toBe(30);
    await expect(makeHighlights(deps, youtubeId, 2, "youtube", 60)).rejects.toThrow("Choose a Reel, a Short or a LinkedIn video.");

    // Back to the whole clip.
    await useWholeClip(db, made.pieceId, 2);
    const whole = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "short")!;
    expect(whole.current.content.parts).toBeUndefined();
  });

  it("adds a new version to a video that already exists, but never changes a posted one", async () => {
    findMoments.mockResolvedValue({ moments: [moment({ from: 3, to: 7 }), moment({ from: 10, to: 14, title: "Other" })] });
    await findClipMoments(deps, youtubeId, 2);
    const first = await makeShortFromMoment(db, youtubeId, 3, 0, "short");
    await makeShortFromMoment(db, youtubeId, 3, 1, "short");
    const short = (await getPiecesFor(db, youtubeId)).find((piece) => piece.platform === "short")!;
    expect(short.id).toBe(first.pieceId);
    expect(short.currentVersion).toBe(2);
    expect(short.current.content.title).toBe("Other");

    await db.insert(publications).values({ pieceId: short.id, version: 2, status: "posted" });
    await expect(makeShortFromMoment(db, youtubeId, 3, 0, "short")).rejects.toThrow(StudioError);
    await expect(makeShortFromMoment(db, youtubeId, 3, 0, "youtube")).rejects.toThrow("Choose a Reel, a Short or a LinkedIn video.");
  });

  it("only looks for moments in clips longer than a minute", async () => {
    const [clip] = await db.select().from(footage);
    await db.update(footage).set({ duration: 40 }).where(eq(footage.id, clip.id));
    await expect(findClipMoments(deps, youtubeId, 2)).rejects.toThrow("This clip is already short.");
    expect(findMoments).not.toHaveBeenCalled();
  });
});

async function getPiecesFor(db: Db, pieceId: string) {
  const [piece] = await db.select().from(pieces).where(eq(pieces.id, pieceId));
  return getPieces(db, piece.ideaId);
}
