import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buildSystemPrompt, createWriter, type GenerateJson } from "@/lib/ai/writer";
import type { IdeaDraft, WritingModel } from "@/lib/ai/types";
import { addLesson, getInstructions, getTeamSettings, INSTRUCTIONS_LENGTH, recordSignal, saveInstructions, LEARN_AFTER, learnFromFeedback, lessonsFor, pendingFeedback, setManagerEnabled, teamOverview } from "@/lib/agents/team";
import { EXAMPLE_BRAND as BRAND_SEED, studioDb } from "./fixtures/brand";
import { createPieces, getPieces } from "@/lib/content";
import { createLocalDb, type Db } from "@/lib/db/client";
import { agentLessons, agentRuns, agentSignals } from "@/lib/db/schema";
import {
  approveScenario,
  changeScenarioWithAi,
  decideIdea,
  generateIdeas,
  getScenario,
  getSibling,
  saveScenarioEdit,
  writeScenario,
  writingContext,
  type StudioDeps,
} from "@/lib/studio";
import { passingTeam } from "./fakes";

const idea = (title: string): IdeaDraft => ({ title, hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [] });
const scenario = (title: string) => ({ title, hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" });
const review = (score: number, problems: string[] = []) => ({
  score,
  problems,
  instructions: score < 7 ? "Fix it" : "",
  noteEn: `Scored ${score}`,
  noteFa: `نمره ${score}`,
});

let db: Db;
let writer: { [K in keyof WritingModel]: ReturnType<typeof vi.fn> };
let deps: StudioDeps;

function makeWriter(): { [K in keyof WritingModel]: ReturnType<typeof vi.fn> } {
  return {
    generateIdeas: vi.fn(async () => [idea("One"), idea("Two")]),
    adaptIdeas: vi.fn(async (_c: unknown, { ideas }: { ideas: object[] }) => ideas),
    reviseIdea: vi.fn(async () => idea("Revised")),
    writeScenario: vi.fn(async () => scenario("First")),
    adaptScenario: vi.fn(async (_c: unknown, { scenario: source }: { scenario: object }) => source),
    reviseScenario: vi.fn(async () => scenario("Changed")),
    writePiece: vi.fn(async () => ({ body: "A Telegram note" })),
    revisePiece: vi.fn(),
    planEdit: vi.fn(),
    ...passingTeam(),
  };
}

beforeEach(async () => {
  db = await studioDb();
  writer = makeWriter();
  deps = {
    db,
    writer: writer as unknown as StudioDeps["writer"],
    searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] },
  };
});

async function approvedIdea() {
  const [first] = await generateIdeas(deps, "en", "");
  await decideIdea(db, first.id, "approved");
  return first;
}

describe("the manager", () => {
  it("sends a weak scenario back once, with its reasons, and keeps the rewrite", async () => {
    writer.reviewScenario.mockResolvedValueOnce(review(4, ["The hook is generic"]));
    writer.writeScenario.mockResolvedValueOnce(scenario("First")).mockResolvedValueOnce(scenario("Second"));
    const { id } = await approvedIdea();
    await writeScenario(deps, id);

    expect(writer.writeScenario).toHaveBeenCalledTimes(2);
    expect(writer.reviewScenario).toHaveBeenCalledTimes(1);
    const feedback = writer.writeScenario.mock.calls[1][1].feedback;
    expect(feedback.problems).toEqual(["The hook is generic"]);
    expect(feedback.previous).toEqual(scenario("First"));
    expect((await getScenario(db, id))!.current.content.title).toBe("Second");

    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.subject, id));
    expect(run).toMatchObject({ agent: "storyteller", score: 4, revised: true, version: 1 });
    const signals = await db.select().from(agentSignals).where(eq(agentSignals.kind, "manager"));
    expect(signals.map((signal) => signal.agent)).toEqual(["storyteller"]);
  });

  it("passes good work straight through", async () => {
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    expect(writer.writeScenario).toHaveBeenCalledTimes(1);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.subject, id));
    expect(run).toMatchObject({ score: 9, revised: false });
  });

  it("never blocks the work when the manager or the rewrite fails", async () => {
    writer.reviewScenario.mockRejectedValueOnce(new Error("rate limit"));
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    expect((await getScenario(db, id))!.current.content.title).toBe("First");

    writer.reviewPiece.mockResolvedValueOnce(review(3));
    writer.writePiece.mockResolvedValueOnce({ body: "Draft" }).mockRejectedValueOnce(new Error("down"));
    await approveScenario(db, id, 1);
    await createPieces(deps, id, ["telegram"], ["en"]);
    const [piece] = await getPieces(db, id);
    expect(piece.current.content.body).toBe("Draft");
  });

  it("catches a broken platform rule itself, without spending a review", async () => {
    writer.writePiece.mockResolvedValueOnce({ body: "x".repeat(5000) }).mockResolvedValueOnce({ body: "Short enough" });
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    await approveScenario(db, id, 1);
    await createPieces(deps, id, ["telegram"], ["en"]);

    expect(writer.reviewPiece).not.toHaveBeenCalled();
    expect(writer.writePiece.mock.calls[1][1].feedback.problems[0]).toContain("too long");
    const [piece] = await getPieces(db, id);
    expect(piece.current.content.body).toBe("Short enough");
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.subject, piece.id));
    expect(run).toMatchObject({ agent: "telegram", revised: true });
  });

  it("flags links that didn't come from the search", async () => {
    writer.writePiece.mockResolvedValueOnce({ body: "See https://made-up.example/x" }).mockResolvedValueOnce({ body: "Clean" });
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    await approveScenario(db, id, 1);
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect(writer.writePiece.mock.calls[1][1].feedback.problems[0]).toContain("made-up.example");
  });

  it("replaces only the weak ideas and keeps the strong ones", async () => {
    writer.reviewIdeas.mockResolvedValueOnce({
      ideas: [
        { number: 1, score: 9, problem: "", noteEn: "Strong", noteFa: "قوی" },
        { number: 2, score: 3, problem: "Too generic", noteEn: "Weak", noteFa: "ضعیف" },
      ],
      instructions: "Replace idea 2",
    });
    writer.generateIdeas
      .mockResolvedValueOnce([idea("Keep me"), idea("Weak one")])
      .mockResolvedValueOnce([idea("Changed by mistake"), idea("Better one")]);
    const saved = await generateIdeas(deps, "en", "");

    expect(saved.map((row) => row.title)).toEqual(["Keep me", "Better one"]);
    expect(writer.generateIdeas.mock.calls[1][1].feedback.problems).toEqual(["Idea 2: Too generic"]);
    const runs = await db.select().from(agentRuns);
    const bySubject = new Map(runs.map((run) => [run.subject, run]));
    expect(bySubject.get(saved[0].pairId)).toMatchObject({ score: 9, revised: false });
    expect(bySubject.get(saved[1].pairId)).toMatchObject({ score: 3, revised: true });
  });

  it("costs nothing extra when paused", async () => {
    await setManagerEnabled(db, false);
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    expect(writer.reviewIdeas).not.toHaveBeenCalled();
    expect(writer.reviewScenario).not.toHaveBeenCalled();
    expect(await db.select().from(agentRuns)).toHaveLength(0);
    expect((await getTeamSettings(db)).managerEnabled).toBe(false);
  });

  it("doesn't check the second language, which is adapted from checked work", async () => {
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    expect(writer.reviewScenario).toHaveBeenCalledTimes(1);
    expect(writer.adaptScenario).toHaveBeenCalledTimes(1);
  });
});

describe("learning", () => {
  it("records Sam's decisions, requests and edits for the agent that did the work", async () => {
    const [first, second] = await generateIdeas(deps, "en", "");
    await decideIdea(db, first.id, "approved");
    await decideIdea(db, second.id, "rejected");
    await writeScenario(deps, first.id);
    await saveScenarioEdit(db, first.id, 1, scenario("Sam's title"));
    await changeScenarioWithAi(deps, first.id, 2, "Make the hook warmer");
    const sibling = await getSibling(db, first);
    await saveScenarioEdit(db, sibling!.id, 1, scenario("Her Farsi title"));

    const signals = await db.select().from(agentSignals);
    const kinds = signals.map((signal) => `${signal.agent}:${signal.kind}`);
    expect(kinds).toEqual(
      expect.arrayContaining(["scout:approved", "scout:rejected", "storyteller:edit", "storyteller:ai-change"]),
    );
    expect(signals.find((signal) => signal.kind === "edit" && signal.agent === "storyteller")!.detail).toContain("Sam's title");
  });

  it("an edit that changes nothing teaches nothing", async () => {
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    await saveScenarioEdit(db, id, 1, scenario("First"));
    expect(await db.select().from(agentSignals).where(eq(agentSignals.kind, "edit"))).toHaveLength(0);
  });

  it("tells the manager when Sam rejects an idea it scored highly", async () => {
    const [first] = await generateIdeas(deps, "en", "");
    await decideIdea(db, first.id, "rejected");
    const [missed] = await db.select().from(agentSignals).where(eq(agentSignals.agent, "manager"));
    expect(missed.kind).toBe("missed");
    expect(missed.detail).toContain("9/10");
  });

  it("waits for enough feedback, then rewrites only the coach's lessons for agents with feedback", async () => {
    await addLesson(db, "scout", "Never suggest crypto topics", "both");
    await db.insert(agentLessons).values([
      { agent: "scout", textEn: "Old scout lesson", textFa: "درس قدیمی", appliesTo: "both", source: "coach" },
      { agent: "linkedin", textEn: "LinkedIn lesson", textFa: "درس لینکدین", appliesTo: "both", source: "coach" },
    ]);
    const context = await writingContext(db, "en");
    for (let i = 0; i < LEARN_AFTER - 1; i++) {
      await db.insert(agentSignals).values({ agent: "scout", language: "en", kind: "rejected", detail: `Rejected ${i}` });
    }
    expect(await learnFromFeedback(deps, context)).toBe(false);
    expect(writer.learn).not.toHaveBeenCalled();

    await db.insert(agentSignals).values({ agent: "scout", language: "en", kind: "rejected", detail: "Rejected again" });
    writer.learn.mockResolvedValueOnce({
      agents: [
        { agent: "scout", lessons: [{ en: "Tie every idea to a business owner's week", fa: "هر ایده را به هفته‌ی کاری صاحب کسب‌وکار وصل کن", appliesTo: "both" }] },
        // The coach can't touch an agent that had no feedback.
        { agent: "linkedin", lessons: [] },
      ],
      summaryEn: "The scout learned to stay practical.",
      summaryFa: "ایده‌یاب یاد گرفت کاربردی بماند.",
    });
    expect(await learnFromFeedback(deps, context)).toBe(true);

    const input = writer.learn.mock.calls[0][1];
    expect(input.agents.map((entry: { agent: string }) => entry.agent)).toEqual(["scout"]);
    expect(input.agents[0].ownerLessons).toEqual(["Never suggest crypto topics"]);
    expect(input.agents[0].coachLessons).toEqual(["Old scout lesson"]);

    const lessons = await lessonsFor(db, "en");
    expect(lessons.scout).toEqual(["Never suggest crypto topics", "Tie every idea to a business owner's week"]);
    expect(lessons.linkedin).toEqual(["LinkedIn lesson"]);
    expect(await pendingFeedback(db)).toBe(0);
    expect((await getTeamSettings(db)).lastLearnSummary?.en).toContain("practical");
  });

  it("keeps the feedback for next time when the coach fails", async () => {
    for (let i = 0; i < LEARN_AFTER; i++) {
      await db.insert(agentSignals).values({ agent: "telegram", language: "fa", kind: "edit", detail: `Edit ${i}` });
    }
    writer.learn.mockRejectedValueOnce(new Error("down"));
    await expect(learnFromFeedback(deps, await writingContext(db, "en"))).rejects.toThrow();
    expect(await pendingFeedback(db)).toBe(LEARN_AFTER);
    const unclaimed = await db.select().from(agentSignals);
    expect(unclaimed.every((signal) => signal.claimedAt === null)).toBe(true);
    expect((await getTeamSettings(db)).lastLearnError).toBeTruthy();
  });

  it("gives each agent only its own lessons, for the right language", async () => {
    await addLesson(db, "linkedin", "Open with the business problem", "both");
    await addLesson(db, "telegram", "Use one emoji at most", "fa");
    const fa = await writingContext(db, "fa");
    const en = await writingContext(db, "en");

    expect(buildSystemPrompt(fa, "telegram")).toContain("Use one emoji at most");
    expect(buildSystemPrompt(en, "telegram")).not.toContain("Use one emoji at most");
    expect(buildSystemPrompt(fa, "linkedin")).not.toContain("Use one emoji at most");
    expect(buildSystemPrompt(en, "linkedin")).toContain("Open with the business problem");
    expect(buildSystemPrompt(en, "linkedin")).toContain("LinkedIn writer");
    expect(buildSystemPrompt({ language: "en", brand: BRAND_SEED.en }, "scout")).not.toContain("<lessons>");
  });

  it("shows each member's record on the Team page", async () => {
    writer.reviewScenario.mockResolvedValueOnce(review(5, ["Weak example"]));
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    const overview = await teamOverview(db);
    const storyteller = overview.agents.find((agent) => agent.id === "storyteller")!;
    expect(storyteller).toMatchObject({ checked: 1, averageScore: 5, sentBack: 1 });
    expect(storyteller.recent[0].problems).toEqual(["Weak example"]);
    expect(overview.agents.find((agent) => agent.id === "scout")!.approvals).toBe(1);
  });
});

describe("each agent's own instructions", () => {
  it("go only to that agent, with the shared part and the part for the language it's working in", async () => {
    await saveInstructions(db, "editor", { both: "Never cut my laugh.", byLanguage: { en: "Captions in sentence case.", fa: "زیرنویس با فونت وزیر." } });
    const en = await writingContext(db, "en");
    const fa = await writingContext(db, "fa");

    const editorEn = buildSystemPrompt(en, "editor");
    expect(editorEn).toContain("<owner_instructions>");
    expect(editorEn).toContain("Never cut my laugh.");
    expect(editorEn).toContain("Captions in sentence case.");
    expect(editorEn).not.toContain("زیرنویس با فونت وزیر.");
    const editorFa = buildSystemPrompt(fa, "editor");
    expect(editorFa).toContain("Never cut my laugh.");
    expect(editorFa).toContain("زیرنویس با فونت وزیر.");
    expect(editorFa).not.toContain("Captions in sentence case.");

    for (const other of ["scout", "linkedin", "scriptwriter", "manager"] as const) {
      expect(buildSystemPrompt(en, other)).not.toContain("<owner_instructions>");
    }
  });

  it("are replaced when saved again, trimmed, and kept to the limit", async () => {
    await saveInstructions(db, "linkedin", { both: "  Old  ", byLanguage: {} });
    await saveInstructions(db, "linkedin", { both: "New ", byLanguage: {} });
    expect(await getInstructions(db, "linkedin")).toMatchObject({ both: "New", byLanguage: {} });

    await expect(saveInstructions(db, "linkedin", { both: "x".repeat(INSTRUCTIONS_LENGTH + 1), byLanguage: {} })).rejects.toThrow();
    expect((await getInstructions(db, "linkedin")).both).toBe("New");

    const overview = await teamOverview(db);
    expect(overview.agents.find((agent) => agent.id === "linkedin")!.hasInstructions).toBe(true);
    expect(overview.agents.find((agent) => agent.id === "telegram")!.hasInstructions).toBe(false);
  });

  it("clearing every box leaves the agent without instructions", async () => {
    await saveInstructions(db, "telegram", { both: "Short.", byLanguage: {} });
    await saveInstructions(db, "telegram", { both: " ", byLanguage: {} });
    expect(buildSystemPrompt(await writingContext(db, "en"), "telegram")).not.toContain("<owner_instructions>");
  });

  it("the manager checks a draft against its writer's instructions", async () => {
    await saveInstructions(db, "linkedin", { both: "Open with a number.", byLanguage: {} });
    await saveInstructions(db, "manager", { both: "Be strict about hooks.", byLanguage: {} });
    const calls: { system: string; prompt: string }[] = [];
    const generate = (async (system: string, prompt: string) => {
      calls.push({ system, prompt });
      return { score: 8, problems: [], instructions: "", noteEn: "", noteFa: "" };
    }) as GenerateJson;
    const context = await writingContext(db, "en");
    const input = { content: { body: "Post" }, scenario: scenario("S"), sources: [] };

    await createWriter(generate).reviewPiece(context, { platform: "linkedin", ...input });
    expect(calls[0].prompt).toContain("<writer_instructions>");
    expect(calls[0].prompt).toContain("Open with a number.");
    // The manager hears its own instructions too, as its standing brief.
    expect(calls[0].system).toContain("Be strict about hooks.");

    await createWriter(generate).reviewPiece(context, { platform: "telegram", ...input });
    expect(calls[1].prompt).not.toContain("Open with a number.");
  });

  it("the coach sees them, so it never teaches against them", async () => {
    await saveInstructions(db, "linkedin", { both: "", byLanguage: { fa: "بدون هشتگ." } });
    for (let i = 0; i < LEARN_AFTER; i++) {
      await recordSignal(db, { agent: "linkedin", language: "fa", kind: "edit", detail: `Edit ${i}` });
    }
    await learnFromFeedback(deps, await writingContext(db, "en"));
    const [, input] = writer.learn.mock.calls[0];
    expect(input.agents[0]).toMatchObject({ agent: "linkedin", ownerInstructions: { both: "", byLanguage: { fa: "بدون هشتگ." } } });
  });
});
