import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { agentSignals, ideas, pieces, pieceVersions, publications, type PieceContent } from "@/lib/db/schema";
import { createPieces, getPieces, pickHook, rewritePieceFromScenario, savePieceEdit, suggestHooks } from "@/lib/content";
import { StudioError } from "@/lib/errors";
import {
  applyHook,
  cleanHooks,
  currentHook,
  finishHooks,
  hookKindOf,
  hookRecordLines,
  hookTally,
  type HookOption,
} from "@/lib/hooks";
import { createWriter } from "@/lib/ai/writer";
import { HookOptionsSchema } from "@/lib/ai/types";
import type { Platform } from "@/lib/platforms";
import { hookOverview, hookRecord, resultsOverview, saveResults } from "@/lib/results";
import { approveScenario, decideIdea, generateIdeas, writeScenario, type StudioDeps } from "@/lib/studio";
import { EXAMPLE_BRAND, studioDb } from "./fixtures/brand";
import { passingTeam } from "./fakes";

const HOOKS: HookOption[] = [
  { kind: "question", text: "Why do clinics still book by phone?" },
  { kind: "number", text: "Clinics lose 3 hours a week to booking calls." },
  { kind: "bold", text: "Phone booking is the most expensive habit in your clinic." },
];

const post = (hook = HOOKS[0].text): PieceContent => ({ body: `${hook}\n\nThe rest of the post.\n\n#clinics`, hooks: HOOKS });

describe("where the hook goes", () => {
  it("is the first line of a text post, the cover of a carousel and the title of an article or video", () => {
    expect(currentHook("linkedin", { body: "\n\nFirst line\nSecond" })).toBe("First line");
    expect(currentHook("instagram", { body: "Caption", slides: [{ title: "Cover", text: "" }] })).toBe("Cover");
    expect(currentHook("website", { body: "## Body", title: "Headline" })).toBe("Headline");
    expect(currentHook("short", { body: "Description", title: "Short title" })).toBe("Short title");
    expect(currentHook("reel", { body: "Caption line\nMore", title: "Cover text" })).toBe("Caption line");
  });

  it("swaps only the hook and leaves the rest of the post as it was", () => {
    const swapped = applyHook("linkedin", post(), HOOKS[1].text);
    expect(swapped.body).toBe(`${HOOKS[1].text}\n\nThe rest of the post.\n\n#clinics`);
    const slides = applyHook("instagram", { body: "Caption", slides: [{ title: "Old", text: "Sub" }, { title: "Two", text: "" }] }, "New cover");
    expect(slides.slides).toEqual([{ title: "New cover", text: "Sub" }, { title: "Two", text: "" }]);
    expect(applyHook("website", { body: "## Body", title: "Old" }, "New").title).toBe("New");
  });

  it("knows which hook is in use, and that none is when you wrote your own", () => {
    expect(hookKindOf("linkedin", post(HOOKS[2].text))).toBe("bold");
    expect(hookKindOf("linkedin", post("  why do clinics STILL book by phone? "))).toBe("question");
    expect(hookKindOf("linkedin", post("My own opening"))).toBeNull();
    expect(hookKindOf("linkedin", { body: "No hooks" })).toBeNull();
  });
});

describe("the writer's hooks", () => {
  it("keeps known kinds, one of each, on one line, short enough for their place", () => {
    const cleaned = cleanHooks("instagram", [
      { kind: "Question", text: "Why\nnow?" },
      { kind: "question", text: "A second question" },
      { kind: "statistic", text: "73% of clinics" },
      { kind: "joke", text: "Unknown kind" },
      { kind: "bold", text: "x".repeat(200) },
      { kind: "problem", text: "Booking hurts" },
      { kind: "story", text: "One too many" },
    ]);
    expect(cleaned).toEqual([
      { kind: "question", text: "Why now?" },
      { kind: "number", text: "73% of clinics" },
      { kind: "problem", text: "Booking hurts" },
    ]);
    expect(cleanHooks("linkedin", "not a list")).toEqual([]);
  });

  it("opens the post with the first hook when the writer opened it some other way", () => {
    const finished = finishHooks("linkedin", { body: "Something else\n\nRest", hooks: HOOKS });
    expect(finished.body).toBe(`${HOOKS[0].text}\n\nRest`);
    expect(finished.hooks).toEqual(HOOKS);
    // A post that already opens with one of them is left alone.
    expect(finishHooks("linkedin", post(HOOKS[1].text)).body.startsWith(HOOKS[1].text)).toBe(true);
    // Fewer than two usable hooks is no choice at all.
    expect(finishHooks("linkedin", { body: "Post", hooks: [{ kind: "nonsense", text: "x" }] })).toEqual({ body: "Post" });
  });

  it("asks for three kinds, and passes on what the record says", async () => {
    const generate = vi.fn(async () => ({ body: "Post", hooks: [] }));
    const writer = createWriter(generate as never);
    const context = { language: "en" as const, brand: EXAMPLE_BRAND.en };
    const scenario = { title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" };
    await writer.writePiece(context, { platform: "linkedin", scenario, sources: [], hookRecord: ["On LinkedIn, the author kept question 3 times."] });
    const prompt = (generate.mock.calls[0] as unknown as [string, string])[1];
    expect(prompt).toContain("three hooks");
    expect(prompt).toContain("- number:");
    expect(prompt).toContain("first line of the text");
    expect(prompt).toContain("<hook_record>\nOn LinkedIn, the author kept question 3 times.\n</hook_record>");

    generate.mockClear();
    await writer.writePiece(context, { platform: "website", scenario, sources: [] });
    const article = (generate.mock.calls[0] as unknown as [string, string])[1];
    expect(article).toContain("the hook is the title");
    expect(article).not.toContain("<hook_record>");
  });

  it("writes new hooks without the post's own hooks in the prompt", async () => {
    const generate = vi.fn(async () => ({ hooks: HOOKS }));
    const writer = createWriter(generate as never);
    expect(await writer.writeHooks({ language: "en", brand: EXAMPLE_BRAND.en }, { platform: "linkedin", content: post() })).toEqual(HOOKS);
    const [, prompt, schema] = generate.mock.calls[0] as unknown as [string, string, unknown];
    expect(schema).toBe(HookOptionsSchema);
    expect(prompt).toContain("not the opening the post has now");
    expect(prompt).not.toContain(HOOKS[1].text);
  });
});

describe("what works", () => {
  it("counts picks and averages live scores by kind, best first", () => {
    const tallies = hookTally(
      [{ kind: "question" }, { kind: "question" }, { kind: "story" }, { kind: null }],
      [
        { platform: "linkedin", kind: "number", score: 1.6 },
        { platform: "linkedin", kind: "number", score: 1.2 },
        { platform: "linkedin", kind: "question", score: 0.8 },
        { platform: "linkedin", kind: "question", score: 0.6 },
        { platform: "linkedin", kind: "story", score: 2 },
        { platform: "linkedin", kind: null, score: 1 },
      ],
    );
    expect(tallies.map((tally) => tally.kind)).toEqual(["number", "question", "story"]);
    expect(tallies[0]).toMatchObject({ picked: 0, live: 2, compared: 2 });
    expect(tallies[0].score).toBeCloseTo(1.4);
    // One live story post is luck, not a pattern.
    expect(tallies[2]).toMatchObject({ kind: "story", picked: 1, score: null });

    const lines = hookRecordLines("linkedin", tallies);
    expect(lines[0]).toBe("On LinkedIn, {OWNER} kept these kinds of hook: question 2 times, story 1 times.");
    expect(lines[1]).toContain("number 1.4 over 2 posts, question 0.7 over 2 posts");
  });

  it("says nothing until there is something to say", () => {
    expect(hookRecordLines("linkedin", hookTally([{ kind: "question" }], []))).toEqual([]);
  });
});

describe("in the studio", () => {
  let db: Db;
  let deps: StudioDeps;
  let writer: Record<string, ReturnType<typeof vi.fn>>;
  let ideaId: string;

  beforeEach(async () => {
    db = await studioDb();
    writer = {
      generateIdeas: vi.fn(async () => [{ title: "Clinic booking", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [] }]),
      adaptIdeas: vi.fn(async (_c: unknown, { ideas: list }: { ideas: object[] }) => list),
      writeScenario: vi.fn(async () => ({ title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" })),
      adaptScenario: vi.fn(async (_c: unknown, { scenario }: { scenario: object }) => scenario),
      writePiece: vi.fn(async () => ({ body: "Some opening\n\nThe rest of the post.", hooks: HOOKS })),
      writeHooks: vi.fn(async () => [
        { kind: "story", text: "Last Monday a clinic owner missed 14 calls." },
        { kind: "problem", text: "Your front desk is drowning in calls." },
        { kind: "question", text: "Why do clinics still book by phone?" },
      ]),
      ...passingTeam(),
    };
    deps = { db, writer: writer as unknown as StudioDeps["writer"], searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] } };
    const [idea] = await generateIdeas(deps, "en", "");
    ideaId = idea.id;
    await decideIdea(db, ideaId, "approved");
    await writeScenario(deps, ideaId);
    await approveScenario(db, ideaId, 1);
  });

  async function linkedInPost() {
    await createPieces(deps, ideaId, ["linkedin"], ["en"]);
    const [piece] = await getPieces(db, ideaId);
    return piece;
  }

  it("writes every post with three hooks, opening with the first", async () => {
    const piece = await linkedInPost();
    expect(piece.current.content.hooks).toEqual(HOOKS);
    expect(piece.current.content.body).toBe(`${HOOKS[0].text}\n\nThe rest of the post.`);
  });

  it("opens the post with the hook you pick, and tells the writer which kind won", async () => {
    const piece = await linkedInPost();
    await pickHook(db, piece.id, 1, 1);
    const [after] = await getPieces(db, ideaId);
    expect(after.currentVersion).toBe(2);
    expect(after.current.content.body).toBe(`${HOOKS[1].text}\n\nThe rest of the post.`);
    expect(after.current.content.hookChosen).toBe(true);

    const [signal] = await db.select().from(agentSignals).where(eq(agentSignals.kind, "hook-pick"));
    expect(signal.agent).toBe("linkedin");
    expect(signal.detail).toContain("picked the number hook");
    expect(signal.detail).toContain('question: "Why do clinics still book by phone?"');

    // The writer of the next LinkedIn post hears about it once there are two picks.
    await pickHook(db, piece.id, 2, 0);
    expect(await hookRecord(db, "linkedin")).toEqual([]);
    expect((await hookOverview(db, "linkedin"))[0]).toMatchObject({ kind: "question", picked: 1 });
  });

  it("refuses a pick on an old version or a hook that isn't there", async () => {
    const piece = await linkedInPost();
    await expect(pickHook(db, piece.id, 2, 0)).rejects.toBeInstanceOf(StudioError);
    await expect(pickHook(db, piece.id, 1, 7)).rejects.toThrow("no longer there");
  });

  it("forgets the pick when you write your own opening, and when the post is written again", async () => {
    const piece = await linkedInPost();
    await pickHook(db, piece.id, 1, 2);
    await savePieceEdit(db, piece.id, 2, { body: "My own words\n\nThe rest of the post." });
    let [now] = await getPieces(db, ideaId);
    expect(hookKindOf("linkedin", now.current.content)).toBeNull();

    await rewritePieceFromScenario(deps, piece.id, 3);
    [now] = await getPieces(db, ideaId);
    expect(now.current.content.hookChosen).toBe(false);
    expect(hookKindOf("linkedin", now.current.content)).toBe("question");
  });

  it("suggests new hooks for a post, keeping the one in use and leaving the text alone", async () => {
    const piece = await linkedInPost();
    await suggestHooks(deps, piece.id, 1);
    const [after] = await getPieces(db, ideaId);
    expect(after.current.content.body).toBe(piece.current.content.body);
    // The question in use stays; the writer's repeat of it is dropped.
    expect(after.current.content.hooks?.map((option) => option.kind)).toEqual(["question", "story", "problem"]);
    expect(after.current.origin).toBe("ai-change");
  });

  it("refuses suggestions the writer couldn't make usable", async () => {
    const piece = await linkedInPost();
    writer.writeHooks.mockResolvedValueOnce([{ kind: "joke", text: "No" }]);
    await expect(suggestHooks(deps, piece.id, 1)).rejects.toThrow("usable hooks");
  });
});

describe("results by hook", () => {
  let db: Db;
  beforeEach(async () => {
    db = await studioDb();
  });

  async function livePost(platform: Platform, content: PieceContent) {
    const pairId = crypto.randomUUID();
    const [idea] = await db
      .insert(ideas)
      .values({ pairId, language: "en", title: "T", hook: "H", angle: "A", whyNow: "N", pillar: "P", sources: [], status: "approved" })
      .returning();
    const [piece] = await db.insert(pieces).values({ ideaId: idea.id, platform, currentVersion: 1 }).returning();
    await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content, origin: "ai", scenarioVersion: 1 });
    await db.insert(publications).values({ pieceId: piece.id, version: 1, status: "posted", postedAt: new Date() });
    return piece.id;
  }

  it("tags each live post with the kind of hook it went out with, and tells the coach", async () => {
    const strong = await livePost("linkedin", post(HOOKS[1].text));
    const others = [await livePost("linkedin", post(HOOKS[0].text)), await livePost("linkedin", { body: "Own words" })];
    for (const id of others) await saveResults(db, id, { views: "100", likes: "5" }, "");
    await saveResults(db, strong, { views: "500", likes: "40" }, "");

    const rows = await resultsOverview(db);
    expect(rows.find((row) => row.pieceId === strong)?.hookKind).toBe("number");
    expect(rows.find((row) => row.pieceId === others[1])?.hookKind).toBeNull();
    const signals = await db.select().from(agentSignals);
    expect(signals.find((signal) => signal.agent === "linkedin")?.detail).toContain("It opened with a number hook.");
  });
});
