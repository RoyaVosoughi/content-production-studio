import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { IdeaDraft, SearchResult, WritingModel } from "@/lib/ai/types";
import { extractJson, openRouterJson } from "@/lib/ai/openrouter";
import { buildSystemPrompt } from "@/lib/ai/writer";
import { EXAMPLE_BRAND as BRAND_SEED, studioDb } from "./fixtures/brand";
import { createLocalDb } from "@/lib/db/client";
import type { ScenarioContent } from "@/lib/db/schema";
import { StudioError } from "@/lib/errors";
import { passingTeam } from "./fakes";
import {
  approveScenario,
  changeScenarioWithAi,
  decideIdea,
  generateIdeas,
  getBrandKit,
  getScenario,
  getSibling,
  restoreScenarioVersion,
  reviseIdea,
  saveBrandKit,
  saveScenarioEdit,
  syncOtherLanguage,
  writeScenario,
  type StudioDeps,
} from "@/lib/studio";

const RESULT: SearchResult = {
  title: "Real article",
  url: "https://example.com/real",
  content: "Details",
  publishedDate: "2026-11-01",
};

const draft = (overrides: Partial<IdeaDraft> = {}): IdeaDraft => ({
  title: "Idea",
  hook: "Hook",
  angle: "Angle",
  whyNow: "Now",
  pillar: "Pillar",
  sourceUrls: [RESULT.url],
  ...overrides,
});

const scenario = (title = "Scenario"): ScenarioContent => ({
  title,
  hook: "Hook",
  mainPoints: ["One", "Two"],
  angle: "Angle",
  example: "A team answering the same question all day",
  callToAction: "Book",
});

let deps: StudioDeps;
let writer: { [K in keyof WritingModel]: ReturnType<typeof vi.fn> };
let search: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  writer = {
    generateIdeas: vi.fn(async () => [draft()]),
    reviseIdea: vi.fn(async () => draft({ title: "Revised" })),
    adaptIdeas: vi.fn(async (_context, { ideas }) => ideas.map((idea: IdeaDraft) => ({ ...idea, title: `Other: ${idea.title}` }))),
    writeScenario: vi.fn(async () => scenario()),
    adaptScenario: vi.fn(async (_context, { scenario: source }) => ({ ...source, title: `Other: ${source.title}` })),
    reviseScenario: vi.fn(async () => scenario("AI changed")),
    writePiece: vi.fn(),
    revisePiece: vi.fn(),
    planEdit: vi.fn(),
    ...passingTeam(),
  };
  search = vi.fn(async () => [RESULT]);
  deps = {
    db: await studioDb(),
    writer: writer as unknown as WritingModel,
    searcher: { search: search as unknown as (queries: string[]) => Promise<SearchResult[]> },
  };
});

async function approvedIdeaWithScenario() {
  const [idea] = await generateIdeas(deps, "en", "");
  await decideIdea(deps.db, idea.id, "approved");
  await writeScenario(deps, idea.id);
  return idea.id;
}

describe("language button", () => {
  it("uses the selected language's Brand Kit from search through writing", async () => {
    const [idea] = await generateIdeas(deps, "fa", "");
    expect(search).toHaveBeenCalledWith(BRAND_SEED.fa.searchTopics, undefined);
    expect(writer.generateIdeas.mock.calls[0][0].language).toBe("fa");
    expect(idea.language).toBe("fa");

    await decideIdea(deps.db, idea.id, "approved");
    await writeScenario(deps, idea.id);
    const context = writer.writeScenario.mock.calls[0][0];
    expect(context.language).toBe("fa");
    expect(context.brand.voiceGuide).toBe(BRAND_SEED.fa.voiceGuide);
    const adaptContext = writer.adaptScenario.mock.calls[0][0];
    expect(adaptContext.language).toBe("en");
    expect(adaptContext.brand.voiceGuide).toBe(BRAND_SEED.en.voiceGuide);
  });

  it("keeps the two Brand Kits separate", async () => {
    await saveBrandKit(deps.db, "en", { ...BRAND_SEED.en, voiceGuide: "Changed" });
    expect((await getBrandKit(deps.db, "fa")).voiceGuide).toBe(BRAND_SEED.fa.voiceGuide);
    expect((await getBrandKit(deps.db, "fa")).isDraft).toBe(true);
    expect((await getBrandKit(deps.db, "en")).isDraft).toBe(false);
  });

  it("gives Claude Persian instructions only for a Farsi run", () => {
    const fa = buildSystemPrompt({ language: "fa", brand: BRAND_SEED.fa });
    const en = buildSystemPrompt({ language: "en", brand: BRAND_SEED.en });
    expect(fa).toContain("native Farsi");
    expect(fa).toContain(BRAND_SEED.fa.voiceGuide);
    expect(en).not.toContain("native Farsi");
  });
});

describe("ideas", () => {
  it("drops sources the search did not return", async () => {
    writer.generateIdeas.mockResolvedValue([draft({ sourceUrls: [RESULT.url, "https://made-up.example/fake"] })]);
    const [idea] = await generateIdeas(deps, "en", "");
    expect(idea.sources).toEqual([
      { url: RESULT.url, title: RESULT.title, publishedDate: RESULT.publishedDate },
    ]);
  });

  it("searches the requested focus first and spends no writing cost when search finds nothing", async () => {
    search.mockResolvedValue([]);
    await expect(generateIdeas(deps, "en", "voice agents")).rejects.toBeInstanceOf(StudioError);
    expect(search.mock.calls[0][0][0]).toBe("voice agents");
    // The focus, then the Brand Kit's search topics.
    expect(search.mock.calls[0][0]).toEqual(["voice agents", ...BRAND_SEED.en.searchTopics]);
    expect(writer.generateIdeas).not.toHaveBeenCalled();
  });

  it("reads pasted links first and searches only the words around them", async () => {
    const post: SearchResult = { title: "A post", url: "https://www.linkedin.com/posts/someone-1", content: "Post text", publishedDate: null };
    const read = vi.fn(async () => ({ pages: [post], failed: ["https://instagram.com/p/abc"] }));
    deps.searcher.read = read;
    writer.generateIdeas.mockResolvedValue([draft({ sourceUrls: [post.url] })]);

    const [idea] = await generateIdeas(deps, "en", "Reply to this https://www.linkedin.com/posts/someone-1, and https://instagram.com/p/abc.");

    expect(read).toHaveBeenCalledWith(["https://www.linkedin.com/posts/someone-1", "https://instagram.com/p/abc"]);
    expect(search.mock.calls[0][0][0]).toBe("Reply to this and");
    const brief = writer.generateIdeas.mock.calls[0][1];
    expect(brief.results[0]).toEqual(post);
    expect(brief.shared).toEqual({ urls: [post.url], failed: ["https://instagram.com/p/abc"] });
    expect(idea.sources).toEqual([{ url: post.url, title: post.title, publishedDate: null }]);
  });

  it("asks for the text when a pasted link alone can't be opened", async () => {
    deps.searcher.read = vi.fn(async (urls: string[]) => ({ pages: [], failed: urls }));
    await expect(generateIdeas(deps, "en", "https://instagram.com/p/abc")).rejects.toThrow(/paste the post's text/);
    expect(search).not.toHaveBeenCalled();
    expect(writer.generateIdeas).not.toHaveBeenCalled();
  });

  it("tells the writer about past ideas in the language it is writing", async () => {
    await generateIdeas(deps, "en", "");
    await generateIdeas(deps, "fa", "");
    expect(writer.generateIdeas.mock.calls[1][1].pastTitles).toEqual(["Other: Idea"]);
    await generateIdeas(deps, "en", "");
    expect(writer.generateIdeas.mock.calls[2][1].pastTitles).toEqual(["Other: Idea", "Idea"]);
  });

  it("refining cannot add a source that was not already on the idea", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    writer.reviseIdea.mockResolvedValue(draft({ title: "Revised", sourceUrls: ["https://made-up.example/new"] }));
    await reviseIdea(deps, idea.id, "Sharper");
    const [saved] = await deps.db.query.ideas.findMany();
    expect(saved.title).toBe("Revised");
    expect(saved.sources).toEqual([]);
  });

  it("does not let a rejected idea be approved or get a scenario", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    await decideIdea(deps.db, idea.id, "rejected");
    await expect(decideIdea(deps.db, idea.id, "approved")).rejects.toBeInstanceOf(StudioError);
    await expect(writeScenario(deps, idea.id)).rejects.toBeInstanceOf(StudioError);
    expect(writer.writeScenario).not.toHaveBeenCalled();
  });
});

describe("scenario approval", () => {
  it("does not charge for a second scenario on a double click", async () => {
    const id = await approvedIdeaWithScenario();
    await writeScenario(deps, id);
    expect(writer.writeScenario).toHaveBeenCalledTimes(1);
    expect(writer.adaptScenario).toHaveBeenCalledTimes(1);
  });

  it("an edit cancels approval and old versions can't be approved", async () => {
    const id = await approvedIdeaWithScenario();
    await approveScenario(deps.db, id, 1);
    expect((await getScenario(deps.db, id))?.approvedVersion).toBe(1);

    await saveScenarioEdit(deps.db, id, 1, scenario("Edited"));
    const edited = await getScenario(deps.db, id);
    expect(edited?.approvedVersion).toBeNull();
    expect(edited?.current.content.title).toBe("Edited");

    await expect(approveScenario(deps.db, id, 1)).rejects.toBeInstanceOf(StudioError);
    await approveScenario(deps.db, id, 2);
    expect((await getScenario(deps.db, id))?.approvedVersion).toBe(2);
  });

  it("rejects an edit based on an out-of-date version and keeps the newer work", async () => {
    const id = await approvedIdeaWithScenario();
    await saveScenarioEdit(deps.db, id, 1, scenario("Tab one"));
    await expect(saveScenarioEdit(deps.db, id, 1, scenario("Tab two"))).rejects.toBeInstanceOf(StudioError);
    expect((await getScenario(deps.db, id))?.current.content.title).toBe("Tab one");
  });

  it("refuses approval while a bracketed placeholder remains, in either language", async () => {
    const id = await approvedIdeaWithScenario();
    await saveScenarioEdit(deps.db, id, 1, { ...scenario(), example: "[Sam: add a real example]" });
    await expect(approveScenario(deps.db, id, 2)).rejects.toThrow("square brackets");
    await saveScenarioEdit(deps.db, id, 2, { ...scenario(), mainPoints: ["[سم: یک مثال واقعی اضافه کنید]"] });
    await expect(approveScenario(deps.db, id, 3)).rejects.toThrow("square brackets");
    await saveScenarioEdit(deps.db, id, 3, scenario());
    await approveScenario(deps.db, id, 4);
    expect((await getScenario(deps.db, id))?.approvedVersion).toBe(4);
  });

  it("an AI change also cancels approval and adds a version", async () => {
    const id = await approvedIdeaWithScenario();
    await approveScenario(deps.db, id, 1);
    await changeScenarioWithAi(deps, id, 1, "Warmer");
    const changed = await getScenario(deps.db, id);
    expect(changed?.approvedVersion).toBeNull();
    expect(changed?.currentVersion).toBe(2);
    expect(changed?.current.origin).toBe("ai-change");
  });

  it("restoring creates a new version that needs approval, and keeps the history", async () => {
    const id = await approvedIdeaWithScenario();
    await saveScenarioEdit(deps.db, id, 1, scenario("Edited"));
    await approveScenario(deps.db, id, 2);
    await restoreScenarioVersion(deps.db, id, 2, 1);
    const restored = await getScenario(deps.db, id);
    expect(restored?.currentVersion).toBe(3);
    expect(restored?.approvedVersion).toBeNull();
    expect(restored?.current.content.title).toBe("Scenario");
    expect(restored?.versions.map((version) => version.version)).toEqual([3, 2, 1]);
  });
});

describe("both languages", () => {
  it("saves every idea in both languages, with the same sources", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    const sibling = await getSibling(deps.db, idea);
    expect(sibling?.language).toBe("fa");
    expect(sibling?.title).toBe("Other: Idea");
    expect(sibling?.sources).toEqual(idea.sources);
    expect(writer.adaptIdeas.mock.calls[0][0].brand.voiceGuide).toBe(BRAND_SEED.fa.voiceGuide);
  });

  it("saves nothing if the second language fails or comes back incomplete", async () => {
    writer.adaptIdeas.mockResolvedValue([]);
    await expect(generateIdeas(deps, "en", "")).rejects.toBeInstanceOf(StudioError);
    writer.adaptIdeas.mockRejectedValue(new StudioError("limit"));
    await expect(generateIdeas(deps, "en", "")).rejects.toBeInstanceOf(StudioError);
    expect(await deps.db.query.ideas.findMany()).toEqual([]);
  });

  it("applies a decision to both languages", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    await decideIdea(deps.db, idea.id, "rejected");
    expect((await getSibling(deps.db, idea))?.status).toBe("rejected");
  });

  it("refining updates both languages", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    await reviseIdea(deps, idea.id, "Sharper");
    expect((await getSibling(deps.db, idea))?.title).toBe("Other: Revised");
  });

  it("a retry after a partial failure writes only the missing language", async () => {
    const [idea] = await generateIdeas(deps, "en", "");
    await decideIdea(deps.db, idea.id, "approved");
    writer.adaptScenario.mockRejectedValueOnce(new StudioError("limit"));
    await expect(writeScenario(deps, idea.id)).rejects.toBeInstanceOf(StudioError);
    const sibling = await getSibling(deps.db, idea);
    expect(await getScenario(deps.db, idea.id)).not.toBeNull();
    expect(await getScenario(deps.db, sibling!.id)).toBeNull();

    await writeScenario(deps, idea.id);
    expect(writer.writeScenario).toHaveBeenCalledTimes(1);
    expect((await getScenario(deps.db, sibling!.id))?.current.content.title).toBe("Other: Scenario");
  });

  it("each language is approved separately, and an edit leaves the other language alone", async () => {
    const id = await approvedIdeaWithScenario();
    const [idea] = await deps.db.query.ideas.findMany({ where: (row, { eq }) => eq(row.id, id) });
    const sibling = await getSibling(deps.db, idea);
    await approveScenario(deps.db, id, 1);
    await approveScenario(deps.db, sibling!.id, 1);

    await saveScenarioEdit(deps.db, id, 1, scenario("Edited"));
    expect((await getScenario(deps.db, id))?.approvedVersion).toBeNull();
    const untouched = await getScenario(deps.db, sibling!.id);
    expect(untouched?.approvedVersion).toBe(1);
    expect(untouched?.current.content.title).toBe("Other: Scenario");
  });

  it("rewriting the other language adds a version there and cancels its approval", async () => {
    const id = await approvedIdeaWithScenario();
    const [idea] = await deps.db.query.ideas.findMany({ where: (row, { eq }) => eq(row.id, id) });
    const sibling = await getSibling(deps.db, idea);
    await approveScenario(deps.db, sibling!.id, 1);
    await saveScenarioEdit(deps.db, id, 1, scenario("Edited"));

    await expect(syncOtherLanguage(deps, id, 1)).rejects.toBeInstanceOf(StudioError);
    await syncOtherLanguage(deps, id, 2);
    const rewritten = await getScenario(deps.db, sibling!.id);
    expect(rewritten?.currentVersion).toBe(2);
    expect(rewritten?.approvedVersion).toBeNull();
    expect(rewritten?.current.content.title).toBe("Other: Edited");
  });
});

describe("free AI through OpenRouter", () => {
  const schema = z.object({ title: z.string() });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const answer = (content: string) => reply(200, { choices: [{ message: { content } }] });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads JSON wrapped in a code fence or a sentence", () => {
    expect(extractJson('Here you go:\n```json\n{"title":"A"}\n```')).toEqual({ title: "A" });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("asks only for free models and sends the schema", async () => {
    fetchMock.mockResolvedValue(answer('{"title":"A"}'));
    await expect(openRouterJson("system", "prompt", schema)).resolves.toEqual({ title: "A" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toMatch(/:free$/);
    expect(body.messages[1].content).toContain('"title"');
  });

  it("moves to the next free model when one is busy or answers with no text", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, { error: { code: 429 } }))
      .mockResolvedValueOnce(reply(200, { choices: [{ finish_reason: "length", message: { content: null } }] }))
      .mockResolvedValueOnce(answer('{"title":"A"}'));
    await expect(openRouterJson("system", "prompt", schema)).resolves.toEqual({ title: "A" });
    const models = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).model);
    expect(new Set(models).size).toBe(3);
    expect(models.every((model: string) => model.endsWith(":free"))).toBe(true);
  });

  it("retries once after an unusable answer, then stops", async () => {
    fetchMock.mockImplementation(async () => answer("not json"));
    await expect(openRouterJson("system", "prompt", schema)).rejects.toBeInstanceOf(StudioError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains a missing key, a bad key and the free limit without retrying", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(openRouterJson("s", "p", schema)).rejects.toThrow("OPENROUTER_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    fetchMock.mockResolvedValueOnce(reply(401, { error: { code: 401 } }));
    await expect(openRouterJson("s", "p", schema)).rejects.toThrow("rejected the key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The limit message appears only once every free model has refused.
    fetchMock.mockImplementation(async () => reply(429, { error: { code: 429 } }));
    await expect(openRouterJson("s", "p", schema)).rejects.toThrow("50 a day");
    fetchMock.mockImplementation(async () => reply(200, { error: { code: 429 } }));
    await expect(openRouterJson("s", "p", schema)).rejects.toThrow("50 a day");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
