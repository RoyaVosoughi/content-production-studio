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
  requireIdea,
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
    planAnimation: vi.fn(),
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

async function scenarioReady() {
  const { id } = await approvedIdea();
  await writeScenario(deps, id);
  await approveScenario(db, id, 1);
  return id;
}

describe("the manager", () => {
  it("leaves ideas and scenarios to you, so they cost no review", async () => {
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    expect(writer.generateIdeas).toHaveBeenCalledTimes(1);
    expect(writer.writeScenario).toHaveBeenCalledTimes(1);
    expect(writer.reviewPiece).not.toHaveBeenCalled();
    expect(await db.select().from(agentRuns)).toHaveLength(0);
  });

  it("sends a weak post back once, with its reasons, and keeps the rewrite", async () => {
    writer.reviewPiece.mockResolvedValueOnce(review(4, ["The hook is generic"]));
    writer.writePiece.mockResolvedValueOnce({ body: "First" }).mockResolvedValueOnce({ body: "Second" });
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);

    expect(writer.writePiece).toHaveBeenCalledTimes(2);
    expect(writer.reviewPiece).toHaveBeenCalledTimes(1);
    const feedback = writer.writePiece.mock.calls[1][1].feedback;
    expect(feedback.problems).toEqual(["The hook is generic"]);
    const [piece] = await getPieces(db, id);
    expect(piece.current.content.body).toBe("Second");

    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.subject, piece.id));
    expect(run).toMatchObject({ agent: "telegram", score: 4, revised: true, version: 1 });
    const signals = await db.select().from(agentSignals).where(eq(agentSignals.kind, "manager"));
    expect(signals.map((signal) => signal.agent)).toEqual(["telegram"]);
  });

  it("passes good work straight through", async () => {
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect(writer.writePiece).toHaveBeenCalledTimes(1);
    const [piece] = await getPieces(db, id);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.subject, piece.id));
    expect(run).toMatchObject({ score: 9, revised: false });
  });

  it("never blocks the work when the manager or the rewrite fails", async () => {
    writer.reviewPiece.mockRejectedValueOnce(new Error("rate limit"));
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect((await getPieces(db, id))[0].current.content.body).toBe("A Telegram note");

    writer.reviewPiece.mockResolvedValueOnce(review(3));
    writer.writePiece.mockResolvedValueOnce({ body: "Draft" }).mockRejectedValueOnce(new Error("down"));
    await createPieces(deps, id, ["linkedin"], ["en"]);
    const linkedin = (await getPieces(db, id)).find((piece) => piece.platform === "linkedin")!;
    expect(linkedin.current.content.body).toBe("Draft");
  });

  it("catches a broken platform rule itself, without spending a review", async () => {
    writer.writePiece.mockResolvedValueOnce({ body: "x".repeat(5000) }).mockResolvedValueOnce({ body: "Short enough" });
    const id = await scenarioReady();
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
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect(writer.writePiece.mock.calls[1][1].feedback.problems[0]).toContain("made-up.example");
  });

  it("costs nothing extra when paused, but the free rule checks still run", async () => {
    await setManagerEnabled(db, false);
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect(writer.reviewPiece).not.toHaveBeenCalled();
    expect(await db.select().from(agentRuns)).toHaveLength(0);
    expect((await getTeamSettings(db)).managerEnabled).toBe(false);

    writer.writePiece.mockResolvedValueOnce({ body: "x".repeat(5000) }).mockResolvedValueOnce({ body: "Fixed" });
    await createPieces(deps, id, ["linkedin"], ["en"]);
    expect(writer.reviewPiece).not.toHaveBeenCalled();
    const linkedin = (await getPieces(db, id)).find((piece) => piece.platform === "linkedin")!;
    expect(linkedin.current.content.body).toBe("Fixed");
  });
});

describe("channel advice", () => {
  const advice = [
    { platform: "linkedin", score: 5, recommended: true, angle: "The cost angle", brief: "Lead with the money saved." },
    { platform: "telegram", score: 4, recommended: true, angle: "Insider take", brief: "One sharp observation." },
    { platform: "linkedin", score: 1, recommended: false, angle: "Duplicate", brief: "Ignored" },
    { platform: "myspace", score: 5, recommended: true, angle: "Not a channel", brief: "Ignored" },
    { platform: "website", score: 9, recommended: false, angle: "Deep dive", brief: "Explain it fully." },
  ];

  it("saves the scenario writer's channel picks with the scenario, cleaned, for both languages", async () => {
    writer.writeScenario.mockResolvedValueOnce({ ...scenario("First"), channels: advice });
    const { id } = await approvedIdea();
    await writeScenario(deps, id);
    const own = (await getScenario(db, id))!;
    expect(own.current.content).toEqual(scenario("First"));
    expect(own.channels!.map((pick) => [pick.platform, pick.score, pick.recommended])).toEqual([
      ["linkedin", 5, true],
      ["telegram", 4, true],
      ["website", 5, false],
    ]);
    const sibling = (await getSibling(db, await requireIdea(db, id)))!;
    expect((await getScenario(db, sibling.id))!.channels).toEqual(own.channels);
  });

  it("gives each channel's writer its brief", async () => {
    writer.writeScenario.mockResolvedValueOnce({ ...scenario("First"), channels: advice });
    const id = await scenarioReady();
    await createPieces(deps, id, ["linkedin", "telegram"], ["en"]);
    const briefs = writer.writePiece.mock.calls.map((call) => [call[1].platform, call[1].channel?.brief]);
    expect(briefs).toEqual(
      expect.arrayContaining([
        ["linkedin", "Lead with the money saved."],
        ["telegram", "One sharp observation."],
      ]),
    );
  });

  it("still works for scenarios written before channel advice", async () => {
    const id = await scenarioReady();
    expect((await getScenario(db, id))!.channels).toBeNull();
    await createPieces(deps, id, ["telegram"], ["en"]);
    expect(writer.writePiece.mock.calls[0][1].channel).toBeUndefined();
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
    writer.reviewPiece.mockResolvedValueOnce(review(5, ["Weak example"]));
    const id = await scenarioReady();
    await createPieces(deps, id, ["telegram"], ["en"]);
    const overview = await teamOverview(db);
    const telegram = overview.agents.find((agent) => agent.id === "telegram")!;
    expect(telegram).toMatchObject({ checked: 1, averageScore: 5, sentBack: 1 });
    expect(telegram.recent[0].problems).toEqual(["Weak example"]);
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
