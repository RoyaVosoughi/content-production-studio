import { beforeEach, describe, expect, it, vi } from "vitest";
import { studioDb } from "./fixtures/brand";
import { createLocalDb, type Db } from "@/lib/db/client";
import { agentSignals, ideas, pieces, pieceVersions, publications } from "@/lib/db/schema";
import { StudioError } from "@/lib/errors";
import type { Platform } from "@/lib/platforms";
import { parseNumbers, performanceBrief, pillarSummary, rankResults, responseRate, resultsOverview, saveResults } from "@/lib/results";
import { generateIdeas, type StudioDeps } from "@/lib/studio";
import { passingTeam } from "./fakes";

describe("scoring", () => {
  it("weighs shares and follows above likes", () => {
    expect(responseRate("reel", { views: 100, likes: 10 })).toBeCloseTo(0.1);
    expect(responseRate("reel", { views: 100, shares: 10 })).toBeCloseTo(0.3);
    expect(responseRate("website", { views: 100 })).toBeNull();
    expect(responseRate("telegram", { views: 0, likes: 3 })).toBeNull();
  });

  it("doesn't compare a network until it has three posts", () => {
    const ranked = rankResults([
      { platform: "telegram" as Platform, numbers: { views: 10 } },
      { platform: "telegram" as Platform, numbers: { views: 1000 } },
    ]);
    expect(ranked.map((row) => row.standing)).toEqual(["early", "early"]);
  });

  it("compares each post only with the same network", () => {
    const row = (platform: Platform, views: number, likes: number) => ({ platform, numbers: { views, likes } });
    const ranked = rankResults([
      row("linkedin", 100, 5),
      row("linkedin", 100, 5),
      row("linkedin", 400, 20),
      row("linkedin", 30, 0),
      // Far more views than LinkedIn, but typical for Telegram.
      row("telegram", 5000, 50),
      row("telegram", 5000, 50),
      row("telegram", 5000, 50),
    ]);
    expect(ranked.map((entry) => entry.standing)).toEqual(["average", "average", "strong", "weak", "average", "average", "average"]);
  });

  it("scores the website by views alone", () => {
    const ranked = rankResults([
      { platform: "website" as Platform, numbers: { views: 50 } },
      { platform: "website" as Platform, numbers: { views: 50 } },
      { platform: "website" as Platform, numbers: { views: 150 } },
    ]);
    expect(ranked[2].score).toBeCloseTo(3);
  });

  it("reads typed numbers, including Farsi digits and separators", () => {
    expect(parseNumbers("telegram", { views: "۱۲۵۰", likes: "1,204", shares: "" })).toEqual({ views: 1250, likes: 1204 });
    expect(() => parseNumbers("telegram", { likes: "4" })).toThrow(StudioError);
    expect(() => parseNumbers("telegram", { views: "12.5" })).toThrow(StudioError);
    // Numbers a network doesn't show are ignored.
    expect(parseNumbers("website", { views: "9", likes: "4" })).toEqual({ views: 9 });
  });
});

let db: Db;

/** A live post for a new idea pair, in English, with its Farsi twin. */
async function livePost(title: string, platform: Platform, pillar = "Automation", posted = true) {
  const pairId = crypto.randomUUID();
  const [en] = await db
    .insert(ideas)
    .values([
      { pairId, language: "en", title, hook: "H", angle: "A", whyNow: "N", pillar, sources: [], status: "approved" as const },
      { pairId, language: "fa", title: `فا ${title}`, hook: "H", angle: "A", whyNow: "N", pillar, sources: [], status: "approved" as const },
    ])
    .returning();
  const [piece] = await db.insert(pieces).values({ ideaId: en.id, platform, currentVersion: 1 }).returning();
  await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content: { body: `${title} post body` }, origin: "ai", scenarioVersion: 1 });
  await db.insert(publications).values({
    pieceId: piece.id,
    version: 1,
    status: posted ? "posted" : "failed",
    url: "https://example.com/post",
    postedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
  });
  return { pieceId: piece.id, pairId };
}

beforeEach(async () => {
  db = await studioDb();
});

describe("saving results", () => {
  it("lists live posts waiting for numbers, and not failed ones", async () => {
    await livePost("Live", "telegram");
    await livePost("Failed", "telegram", "Automation", false);
    const rows = await resultsOverview(db);
    expect(rows.map((row) => row.ideaTitle)).toEqual(["Live"]);
    expect(rows[0].standing).toBeNull();
    expect(rows[0].opening).toBe("Live post body");
  });

  it("refuses numbers for a post that isn't live", async () => {
    const { pieceId } = await livePost("Failed", "telegram", "Automation", false);
    await expect(saveResults(db, pieceId, { views: "10" }, "")).rejects.toBeInstanceOf(StudioError);
  });

  it("updates numbers, and tells the writer and the scout when a post stands out", async () => {
    const a = await livePost("A", "linkedin");
    const b = await livePost("B", "linkedin");
    const c = await livePost("C", "linkedin", "Leadership");
    await saveResults(db, a.pieceId, { views: "100", likes: "5" }, "");
    await saveResults(db, b.pieceId, { views: "100", likes: "5" }, "");
    expect(await db.select().from(agentSignals)).toHaveLength(0);
    const standing = await saveResults(db, c.pieceId, { views: "500", likes: "40", shares: "10" }, "Shared by a founder");
    expect(standing).toBe("strong");
    const signals = await db.select().from(agentSignals);
    expect(signals.map((signal) => signal.agent).sort()).toEqual(["linkedin", "scout"]);
    expect(signals[0].kind).toBe("results");
    expect(signals[0].detail).toContain("much better");
    expect(signals[0].detail).toContain("Shared by a founder");

    await saveResults(db, a.pieceId, { views: "120", likes: "6" }, "");
    const rows = await resultsOverview(db);
    expect(rows.find((row) => row.pieceId === a.pieceId)?.numbers).toEqual({ views: 120, likes: 6 });
    expect(pillarSummary(rows)[0].pillar).toBe("Leadership");
  });
});

describe("learning in new ideas", () => {
  async function threeLinkedInPosts() {
    const strong = await livePost("Agents for clinics", "linkedin", "Leadership");
    for (const title of ["Typical one", "Typical two"]) {
      const post = await livePost(title, "linkedin");
      await saveResults(db, post.pieceId, { views: "100", likes: "5" }, "");
    }
    await saveResults(db, strong.pieceId, { views: "500", likes: "40" }, "");
    return strong;
  }

  it("tells the scout how past ideas did, strongest first, in its language", async () => {
    await threeLinkedInPosts();
    const brief = await performanceBrief(db, "fa");
    expect(brief[0].title).toBe("فا Agents for clinics");
    expect(brief[0].results).toContain("LinkedIn (English): strong");
    expect(brief).toHaveLength(3);
  });

  it("records which past idea a new idea builds on, in both languages", async () => {
    const strong = await threeLinkedInPosts();
    const writer = {
      generateIdeas: vi.fn(async () => [
        { title: "Clinics, part two", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [], buildsOn: 1 },
        { title: "Fresh", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [], buildsOn: 0 },
      ]),
      adaptIdeas: vi.fn(async (_c: unknown, { ideas: list }: { ideas: object[] }) => list),
      ...passingTeam(),
    };
    const deps = {
      db,
      writer: writer as unknown as StudioDeps["writer"],
      searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] },
    };
    const saved = await generateIdeas(deps, "en", "");
    const input = writer.generateIdeas.mock.calls[0] as unknown as [unknown, { performance: { number: number; title: string }[] }];
    expect(input[1].performance[0]).toMatchObject({ number: 1, title: "Agents for clinics" });
    expect(saved.map((idea) => idea.buildsOn)).toEqual([strong.pairId, null]);
    const twins = await db.query.ideas.findMany({ where: (idea, { eq }) => eq(idea.pairId, saved[0].pairId) });
    expect(twins.every((idea) => idea.buildsOn === strong.pairId)).toBe(true);
  });

  it("sends no results when nothing could be compared", async () => {
    const post = await livePost("Only one", "telegram");
    await saveResults(db, post.pieceId, { views: "10" }, "");
    expect(await performanceBrief(db, "en")).toEqual([]);
  });
});
