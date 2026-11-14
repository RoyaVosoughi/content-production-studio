import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buildSystemPrompt, createWriter, type GenerateJson } from "@/lib/ai/writer";
import type { IdeaDraft, WritingModel } from "@/lib/ai/types";
import { addLesson, GENERAL, getInstructions, getTeamSettings, recordSignal, saveInstructions, LEARN_AFTER, learnFromFeedback, lessonsFor, pendingFeedback, setManagerEnabled, teamOverview } from "@/lib/agents/team";
import { EXAMPLE_BRAND as BRAND_SEED, studioDb } from "./fixtures/brand";
import { defaultSkill, getSkill, resetSkill, saveSkill, SKILL_LENGTH } from "@/lib/agents/skills";
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

describe("each agent's Skill", () => {
  it("every agent works from its default Skill until you edit it", async () => {
    const en = await writingContext(db, "en");
    const scout = buildSystemPrompt(en, "scout");
    expect(scout).toContain("<skill>");
    expect(scout).toContain("idea scout on");
    expect(buildSystemPrompt(en, "linkedin")).toContain("business case");
    expect(scout).not.toContain("{OWNER}");
    expect((await teamOverview(db)).agents.every((agent) => !agent.customSkill)).toBe(true);
  });

  it("your edited Skill replaces the default for that agent only", async () => {
    await saveSkill(db, "telegram", "## Who you are\nThe Telegram writer. Always start with a question.");
    const en = await writingContext(db, "en");
    expect(buildSystemPrompt(en, "telegram")).toContain("Always start with a question.");
    expect(buildSystemPrompt(en, "telegram")).not.toContain("close circle of followers");
    expect(buildSystemPrompt(en, "linkedin")).not.toContain("Always start with a question.");
    expect((await teamOverview(db)).agents.find((agent) => agent.id === "telegram")!.customSkill).toBe(true);
  });

  it("is trimmed, kept to the limit, and never empty", async () => {
    await saveSkill(db, "linkedin", "  New skill  ");
    expect((await getSkill(db, "linkedin")).text).toBe("New skill");
    await expect(saveSkill(db, "linkedin", "x".repeat(SKILL_LENGTH + 1))).rejects.toThrow();
    await expect(saveSkill(db, "linkedin", "   ")).rejects.toThrow();
    expect((await getSkill(db, "linkedin")).text).toBe("New skill");
  });

  it("reset, or saving the default text unchanged, goes back to the default", async () => {
    await saveSkill(db, "blogger", "Mine");
    await resetSkill(db, "blogger");
    expect(await getSkill(db, "blogger")).toMatchObject({ text: defaultSkill("blogger"), custom: false });
    await saveSkill(db, "blogger", "Mine");
    await saveSkill(db, "blogger", defaultSkill("blogger"));
    expect((await getSkill(db, "blogger")).custom).toBe(false);
  });

  it("instructions written before Skills existed are kept, at the end of that agent's Skill", async () => {
    await saveInstructions(db, "editor", { both: "Never cut my laugh.", byLanguage: { fa: "زیرنویس با فونت وزیر." } });
    const skill = await getSkill(db, "editor");
    expect(skill.custom).toBe(true);
    expect(skill.text.startsWith(defaultSkill("editor"))).toBe(true);
    expect(skill.text).toContain("Never cut my laugh.");
    expect(skill.text).toContain("In Farsi (Persian) only: زیرنویس با فونت وزیر.");
    const en = await writingContext(db, "en");
    expect(buildSystemPrompt(en, "editor")).toContain("Never cut my laugh.");
    expect(buildSystemPrompt(en, "scout")).not.toContain("Never cut my laugh.");

    // Once you save the Skill you saw, the old boxes are gone and only the Skill is left.
    await saveSkill(db, "editor", `${skill.text}\nOne more rule.`);
    expect((await getInstructions(db, "editor")).both).toBe("");
    expect((await getSkill(db, "editor")).text).toContain("Never cut my laugh.");
  });

  it("the rules for the whole team go to every agent, with the part for the language it's working in", async () => {
    await saveInstructions(db, GENERAL, { both: "Sign off with 'Sam'.", byLanguage: { en: "British spelling.", fa: "نیم‌فاصله را رعایت کن." } });
    const en = await writingContext(db, "en");
    const fa = await writingContext(db, "fa");
    for (const agent of ["scout", "linkedin", "manager"] as const) {
      expect(buildSystemPrompt(en, agent)).toContain("<owner_instructions>");
      expect(buildSystemPrompt(en, agent)).toContain("Sign off with 'Sam'.");
    }
    expect(buildSystemPrompt(en, "telegram")).toContain("British spelling.");
    expect(buildSystemPrompt(en, "telegram")).not.toContain("نیم‌فاصله");
    expect(buildSystemPrompt(fa, "telegram")).toContain("نیم‌فاصله را رعایت کن.");
    expect((await getSkill(db, "telegram")).custom).toBe(false);
  });

  it("the manager checks a draft against its writer's edited Skill", async () => {
    await saveSkill(db, "linkedin", "## Rules\n- Open with a number.");
    await saveSkill(db, "manager", "## Rules\n- Be strict about hooks.");
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
    expect(calls[0].system).toContain("Be strict about hooks.");

    // A writer still on its default Skill: the manager checks the channel's job, with no extra rules.
    await createWriter(generate).reviewPiece(context, { platform: "telegram", ...input });
    expect(calls[1].prompt).not.toContain("<writer_instructions>");
    expect(calls[1].prompt).toContain("<channel_skill>");
  });

  it("the coach sees your edited Skill, so it never teaches against it", async () => {
    await saveSkill(db, "linkedin", "No hashtags, ever.");
    for (let i = 0; i < LEARN_AFTER; i++) {
      await recordSignal(db, { agent: "linkedin", language: "fa", kind: "edit", detail: `Edit ${i}` });
    }
    await learnFromFeedback(deps, await writingContext(db, "en"));
    const [, input] = writer.learn.mock.calls[0];
    expect(input.agents[0]).toMatchObject({ agent: "linkedin", ownerInstructions: { both: "No hashtags, ever.", byLanguage: {} } });
  });
});
