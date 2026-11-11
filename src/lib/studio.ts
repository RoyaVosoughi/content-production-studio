import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  describeEdit,
  getTeamSettings,
  learnFromFeedback,
  instructionsFor,
  lessonsFor,
  managerCheck,
  PASS_SCORE,
  recordOwnerFeedback,
  recordSignal,
  saveVerdict,
  type Verdict,
} from "./agents/team";
import { tavilySearch } from "./ai/tavily";
import type { IdeaDraft, IdeaText, SearchProvider, WritingContext, WritingModel } from "./ai/types";
import { studioWriter } from "./ai/writer";
import { emptyBrandKit, type BrandKitFields } from "./brand-seed";
import { getDb, type Db } from "./db/client";
import {
  brandKits,
  ideas,
  scenarios,
  scenarioVersions,
  type IdeaSource,
  type ScenarioContent,
} from "./db/schema";
import { StudioError } from "./errors";
import { otherLanguage, type Language } from "./language";
import { getProfile, requireProfile } from "./profile";
import { performanceBrief } from "./results";
import { hasPlaceholder } from "./scenario";

export const IDEA_BATCH_SIZE = 10;
const MAX_SEARCH_QUERIES = 4;
const PAST_TITLES_LIMIT = 100;
const STALE_SCENARIO = "This scenario changed since you opened it. Reload and review the latest version.";

export type StudioDeps = { db: Db; writer: WritingModel; searcher: SearchProvider };

export async function defaultDeps(): Promise<StudioDeps> {
  return { db: await getDb(), writer: studioWriter, searcher: tavilySearch };
}

export async function getBrandKit(db: Db, language: Language) {
  await db
    .insert(brandKits)
    .values({ language, ...emptyBrandKit() })
    .onConflictDoNothing();
  const [kit] = await db.select().from(brandKits).where(eq(brandKits.language, language));
  return kit;
}

export async function saveBrandKit(db: Db, language: Language, fields: BrandKitFields) {
  await getBrandKit(db, language);
  await db
    .update(brandKits)
    .set({ ...fields, isDraft: false, updatedAt: new Date() })
    .where(eq(brandKits.language, language));
}

export async function writingContext(db: Db, language: Language): Promise<WritingContext> {
  const { positioning, audience, pillars, voiceGuide, avoid, samples, searchTopics } = await getBrandKit(
    db,
    language,
  );
  const profile = await getProfile(db);
  return {
    language,
    owner: profile ? { name: profile.name, languages: profile.languages } : undefined,
    brand: { positioning, audience, pillars, voiceGuide, avoid, samples, searchTopics },
    lessons: await lessonsFor(db, language),
    instructions: await instructionsFor(db, language),
  };
}

export async function requireIdea(db: Db, id: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!idea) throw new StudioError("This idea no longer exists.");
  return idea;
}

/** The same idea in the other content language. Null when the person writes in only one language. */
export async function getSibling(db: Db, idea: { id: string; pairId: string }) {
  const [sibling] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.pairId, idea.pairId), ne(ideas.id, idea.id)));
  return sibling ?? null;
}

function ideaText({ title, hook, angle, whyNow, pillar }: IdeaText): IdeaText {
  return { title, hook, angle, whyNow, pillar };
}

/** The most links read from one request, to keep the search credits and the prompt small. */
const MAX_LINKS = 5;

/** Separates the links someone pasted from the words around them. */
export function splitLinks(input: string): { request: string; links: string[] } {
  const found = input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const links = [...new Set(found.map((link) => link.replace(/[.,;:!?)\]]+$/, "")))].slice(0, MAX_LINKS);
  const request = input.replace(/https?:\/\/[^\s<>"']+/gi, " ").replace(/\s+/g, " ").trim();
  return { request, links };
}

async function adaptIdeasOrFail(writer: WritingModel, context: WritingContext, source: IdeaText[]) {
  const adapted = await writer.adaptIdeas(context, { ideas: source });
  if (adapted.length !== source.length) {
    throw new StudioError("The second language came back incomplete, so nothing was saved. Please try again.");
  }
  return adapted;
}

export async function generateIdeas({ db, writer, searcher }: StudioDeps, language: Language, focus: string) {
  const profile = await requireProfile(db);
  if (!profile.languages.includes(language)) throw new StudioError("Choose one of your content languages first.");
  const context = await writingContext(db, language);
  // What you asked for can hold links (a post, an article, a page); the scout reads them first.
  const { request, links } = splitLinks(focus);
  const shared = links.length && searcher.read ? await searcher.read(links) : { pages: [], failed: links };
  if (links.length > 0 && shared.pages.length === 0 && !request) {
    throw new StudioError(
      "The link couldn't be opened. Instagram and LinkedIn often hide posts from outside readers, so paste the post's text instead, or add a few words about what you want.",
    );
  }

  const queries = [...(request ? [request] : []), ...context.brand.searchTopics].slice(0, MAX_SEARCH_QUERIES);
  if (queries.length === 0 && shared.pages.length === 0) {
    throw new StudioError("Add at least one search topic to the Brand Kit.");
  }
  const found = queries.length ? await searcher.search(queries) : [];
  const sharedUrls = new Set(shared.pages.map((page) => page.url));
  const results = [...shared.pages, ...found.filter((result) => !sharedUrls.has(result.url))];
  if (results.length === 0) {
    throw new StudioError("The search found nothing recent. Try asking for something else or change your search topics.");
  }

  const past = await db
    .select({ title: ideas.title })
    .from(ideas)
    .where(eq(ideas.language, language))
    .orderBy(desc(ideas.createdAt))
    .limit(PAST_TITLES_LIMIT);

  // What went well once live, so the scout can build on it.
  const performance = await performanceBrief(db, language);
  const brief = {
    count: IDEA_BATCH_SIZE,
    focus: request,
    shared: { urls: shared.pages.map((page) => page.url), failed: shared.failed },
    results,
    pastTitles: past.map((idea) => idea.title),
    today: new Date().toISOString().slice(0, 10),
    performance: performance.map(({ number, title, pillar, results }) => ({ number, title, pillar, results })),
  };
  const first = await writer.generateIdeas(context, brief);
  if (first.length === 0) throw new StudioError("No ideas came back. Please try again.");
  const { drafts, verdicts } = await checkIdeas({ db, writer }, context, brief, first.slice(0, IDEA_BATCH_SIZE));

  // A source is kept only if the search really returned it, so a made-up link can't appear as evidence.
  const known = new Map(results.map((result) => [result.url, result]));
  const batch = drafts.slice(0, IDEA_BATCH_SIZE);
  const second = otherLanguage(language, profile.languages);
  const adapted = second ? await adaptIdeasOrFail(writer, await writingContext(db, second), batch.map(ideaText)) : [];

  // With two languages both are saved together, so an idea can never exist in only one of them.
  const rows = batch.flatMap((draft, index) => {
    const pairId = crypto.randomUUID();
    const sources = draft.sourceUrls.flatMap((url): IdeaSource[] => {
      const hit = known.get(url);
      return hit ? [{ url, title: hit.title, publishedDate: hit.publishedDate }] : [];
    });
    const buildsOn = performance.find((item) => item.number === Math.round(draft.buildsOn ?? 0))?.pairId ?? null;
    return [
      { pairId, language, sources, buildsOn, ...ideaText(draft) },
      ...(second ? [{ pairId, language: second, sources, buildsOn, ...ideaText(adapted[index]) }] : []),
    ];
  });
  const saved = await db.insert(ideas).values(rows).returning();
  const own = saved.filter((idea) => idea.language === language);
  for (const [index, idea] of own.entries()) {
    await saveVerdict(db, { agent: "scout", task: "idea", language, subject: idea.pairId }, verdicts[index] ?? null);
  }
  return own;
}

/**
 * The manager scores the scout's batch. If some ideas are weak, the scout replaces just those once,
 * keeping the rest. A failed check or rewrite keeps the first batch, so it never costs you your ideas.
 */
async function checkIdeas(
  { db, writer }: Pick<StudioDeps, "db" | "writer">,
  context: WritingContext,
  brief: Parameters<WritingModel["generateIdeas"]>[1],
  drafts: IdeaDraft[],
): Promise<{ drafts: IdeaDraft[]; verdicts: (Verdict | null)[] }> {
  const { managerEnabled } = await getTeamSettings(db);
  if (!managerEnabled) return { drafts, verdicts: [] };
  let review;
  try {
    review = await writer.reviewIdeas(context, { ideas: drafts, results: brief.results, pastTitles: brief.pastTitles });
  } catch (error) {
    console.error("The manager couldn't check the ideas:", error);
    return { drafts, verdicts: [] };
  }
  const items = drafts.map((_, index) => review.ideas.find((item) => item.number === index + 1));
  const verdicts: Verdict[] = items.map((item) => {
    if (!item) return { score: null, revised: false, problems: [], note: { en: "", fa: "" } };
    const score = Math.min(10, Math.max(1, Math.round(item.score)));
    return { score, revised: false, problems: item.problem ? [item.problem] : [], note: { en: item.noteEn, fa: item.noteFa } };
  });
  const weak = verdicts.flatMap((verdict, index) => (verdict.score != null && verdict.score < PASS_SCORE ? [index] : []));
  if (weak.length === 0) return { drafts, verdicts };

  const problems = weak.map((index) => `Idea ${index + 1}: ${verdicts[index].problems[0] || "too weak to show {OWNER}"}`);
  await recordSignal(db, {
    agent: "scout",
    language: context.language,
    kind: "manager",
    detail: `The manager sent back ${weak.length} of ${drafts.length} ideas. ${problems.join(" | ")}`,
  });
  try {
    const second = await writer.generateIdeas(context, {
      ...brief,
      count: drafts.length,
      feedback: { previous: drafts, problems, instructions: review.instructions },
    });
    // The rewrite must keep the batch's shape, or the manager's notes would land on the wrong ideas.
    if (second.length !== drafts.length) return { drafts, verdicts };
    const replaced = second.map((idea, index) => (weak.includes(index) ? idea : drafts[index]));
    return {
      drafts: replaced,
      verdicts: verdicts.map((verdict, index) =>
        weak.includes(index)
          ? {
              ...verdict,
              revised: true,
              note: {
                en: "The manager sent the first version back, so this is the scout's replacement.",
                fa: "مدیر نسخه‌ی اول را برگرداند، برای همین این ایده‌ی جایگزین است.",
              },
            }
          : verdict,
      ),
    };
  } catch (error) {
    console.error("The scout couldn't replace the weak ideas:", error);
    return { drafts, verdicts };
  }
}

export async function reviseIdea({ db, writer }: StudioDeps, id: string, request: string) {
  const idea = await requireIdea(db, id);
  if (idea.status !== "proposed") throw new StudioError("Only ideas waiting for a decision can be refined.");
  await recordOwnerFeedback(db, {
    agent: "scout",
    language: idea.language as Language,
    kind: "refined",
    subject: idea.pairId,
    detail: `{OWNER} asked to change the idea "${idea.title}" (hook: ${idea.hook}): ${request}`,
  });
  const revised = await writer.reviseIdea(await writingContext(db, idea.language as Language), {
    idea: {
      title: idea.title,
      hook: idea.hook,
      angle: idea.angle,
      whyNow: idea.whyNow,
      pillar: idea.pillar,
      sourceUrls: idea.sources.map((source) => source.url),
    },
    request,
  });
  const keep = new Set(revised.sourceUrls);
  const sources = idea.sources.filter((source) => keep.has(source.url));
  const sibling = await getSibling(db, idea);
  const [adapted] = sibling
    ? await adaptIdeasOrFail(writer, await writingContext(db, sibling.language as Language), [ideaText(revised)])
    : [];

  await db.transaction(async (tx) => {
    await tx.update(ideas).set({ ...ideaText(revised), sources }).where(eq(ideas.id, id));
    if (sibling) await tx.update(ideas).set({ ...ideaText(adapted), sources }).where(eq(ideas.id, sibling.id));
  });
}

/** A decision applies to every language of the idea. */
export async function decideIdea(db: Db, id: string, status: "approved" | "rejected") {
  const idea = await requireIdea(db, id);
  const updated = await db
    .update(ideas)
    .set({ status })
    .where(and(eq(ideas.pairId, idea.pairId), eq(ideas.status, "proposed")))
    .returning({ id: ideas.id });
  if (updated.length === 0) {
    if (idea.status !== status) throw new StudioError(`This idea was already ${idea.status}.`);
    return;
  }
  await recordOwnerFeedback(db, {
    agent: "scout",
    language: idea.language as Language,
    kind: status,
    subject: idea.pairId,
    detail: `{OWNER} ${status} the idea "${idea.title}" (pillar: ${idea.pillar}; hook: ${idea.hook}; angle: ${idea.angle})`,
  });
}

async function saveFirstVersion(db: Db, ideaId: string, content: ScenarioContent) {
  await db.transaction(async (tx) => {
    const created = await tx
      .insert(scenarios)
      .values({ ideaId, currentVersion: 1 })
      .onConflictDoNothing()
      .returning({ ideaId: scenarios.ideaId });
    if (created.length > 0) {
      await tx.insert(scenarioVersions).values({ ideaId, version: 1, content, origin: "ai" });
    }
  });
}

/**
 * Writes version 1 in whichever languages don't have one yet, so a double click costs nothing extra
 * and a retry after a partial failure only writes the language that's missing.
 */
export async function writeScenario({ db, writer }: StudioDeps, ideaId: string) {
  const idea = await requireIdea(db, ideaId);
  if (idea.status !== "approved") throw new StudioError("Approve this idea before writing its scenario.");
  const sibling = await getSibling(db, idea);

  let own = await getScenario(db, ideaId);
  const siblingScenario = sibling && (await getScenario(db, sibling.id));
  if (!own) {
    const language = idea.language as Language;
    const context = await writingContext(db, language);
    let content: ScenarioContent;
    let verdict: Verdict | null = null;
    if (siblingScenario) {
      content = await writer.adaptScenario(context, { scenario: siblingScenario.current.content });
    } else {
      const brief = { idea: ideaText(idea), sources: idea.sources.map(({ title, url }) => ({ title, url })) };
      const { managerEnabled } = await getTeamSettings(db);
      ({ draft: content, verdict } = await managerCheck(db, {
        enabled: managerEnabled,
        agent: "storyteller",
        language,
        draft: await writer.writeScenario(context, brief),
        review: (scenario) => writer.reviewScenario(context, { ...brief, scenario }),
        rewrite: (feedback) => writer.writeScenario(context, { ...brief, feedback }),
      }));
    }
    await saveFirstVersion(db, ideaId, content);
    await saveVerdict(db, { agent: "storyteller", task: "scenario", language, subject: ideaId, version: 1 }, verdict);
    own = await getScenario(db, ideaId);
  }
  if (sibling && !siblingScenario && own) {
    const context = await writingContext(db, sibling.language as Language);
    await saveFirstVersion(db, sibling.id, await writer.adaptScenario(context, { scenario: own.current.content }));
  }
}

export async function getScenario(db: Db, ideaId: string) {
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.ideaId, ideaId));
  if (!scenario) return null;
  const versions = await db
    .select()
    .from(scenarioVersions)
    .where(eq(scenarioVersions.ideaId, ideaId))
    .orderBy(desc(scenarioVersions.version));
  const current = versions.find((version) => version.version === scenario.currentVersion);
  if (!current) throw new Error(`Scenario ${ideaId} is missing version ${scenario.currentVersion}`);
  return { ...scenario, versions, current };
}

/**
 * Adds a version on top of the one the user was looking at, and clears any approval.
 * If `basedOn` is out of date nothing changes, so work from another tab can't be silently overwritten.
 */
async function addVersion(
  db: Db,
  ideaId: string,
  basedOn: number,
  content: ScenarioContent,
  origin: "edit" | "ai-change" | "restore",
) {
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(scenarios)
      .set({ currentVersion: sql`${scenarios.currentVersion} + 1`, approvedVersion: null })
      .where(and(eq(scenarios.ideaId, ideaId), eq(scenarios.currentVersion, basedOn)))
      .returning({ version: scenarios.currentVersion });
    if (moved.length === 0) throw new StudioError(STALE_SCENARIO);
    await tx.insert(scenarioVersions).values({ ideaId, version: moved[0].version, content, origin });
  });
}

export async function saveScenarioEdit(db: Db, ideaId: string, basedOn: number, content: ScenarioContent) {
  const before = await getScenario(db, ideaId);
  await addVersion(db, ideaId, basedOn, content, "edit");
  const change = before && describeEdit(before.current.content, content, SCENARIO_FIELDS);
  if (change) {
    const idea = await requireIdea(db, ideaId);
    await recordOwnerFeedback(db, {
      // The scenario writer writes every language's scenario.
      agent: "storyteller",
      language: idea.language as Language,
      kind: "edit",
      subject: ideaId,
      detail: `{OWNER} edited the scenario themselves. ${change}`,
    });
  }
}

const SCENARIO_FIELDS = ["title", "hook", "mainPoints", "angle", "example", "callToAction"];


export async function changeScenarioWithAi(
  { db, writer }: StudioDeps,
  ideaId: string,
  basedOn: number,
  request: string,
) {
  const idea = await requireIdea(db, ideaId);
  const scenario = await getScenario(db, ideaId);
  if (!scenario) throw new StudioError("This idea has no scenario yet.");
  if (scenario.currentVersion !== basedOn) throw new StudioError(STALE_SCENARIO);
  await recordOwnerFeedback(db, {
    agent: "storyteller",
    language: idea.language as Language,
    kind: "ai-change",
    subject: ideaId,
    detail: `{OWNER} asked for a change to the scenario "${scenario.current.content.title}": ${request}`,
  });
  const content = await writer.reviseScenario(await writingContext(db, idea.language as Language), {
    scenario: scenario.current.content,
    request,
  });
  await addVersion(db, ideaId, basedOn, content, "ai-change");
}

/** Rewrites the other language from this version. It adds a new version there, which needs its own approval. */
export async function syncOtherLanguage({ db, writer }: StudioDeps, ideaId: string, basedOn: number) {
  const idea = await requireIdea(db, ideaId);
  const scenario = await getScenario(db, ideaId);
  if (!scenario || scenario.currentVersion !== basedOn) throw new StudioError(STALE_SCENARIO);
  const sibling = await getSibling(db, idea);
  const target = sibling && (await getScenario(db, sibling.id));
  if (!sibling || !target) throw new StudioError("The other language has no scenario yet.");
  const content = await writer.adaptScenario(await writingContext(db, sibling.language as Language), {
    scenario: scenario.current.content,
  });
  await addVersion(db, sibling.id, target.currentVersion, content, "ai-change");
}

export async function restoreScenarioVersion(db: Db, ideaId: string, basedOn: number, version: number) {
  const [old] = await db
    .select()
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.ideaId, ideaId), eq(scenarioVersions.version, version)));
  if (!old) throw new StudioError("That version no longer exists.");
  await addVersion(db, ideaId, basedOn, old.content, "restore");
}

/** Approval applies only to the exact version the user was looking at, and only once it has no placeholders left. */
export async function approveScenario(db: Db, ideaId: string, version: number) {
  const scenario = await getScenario(db, ideaId);
  if (!scenario || scenario.currentVersion !== version) throw new StudioError(STALE_SCENARIO);
  if (hasPlaceholder(scenario.current.content)) {
    throw new StudioError("Replace the text in square brackets, save, then approve.");
  }
  const updated = await db
    .update(scenarios)
    .set({ approvedVersion: version })
    .where(and(eq(scenarios.ideaId, ideaId), eq(scenarios.currentVersion, version)))
    .returning({ ideaId: scenarios.ideaId });
  if (updated.length === 0) throw new StudioError(STALE_SCENARIO);
}

/** The main content language, which the coach's context is built in. */
async function mainLanguage(db: Db): Promise<Language> {
  return (await getProfile(db))?.languages[0] ?? "en";
}

/** The coach learns whenever enough feedback has built up. Run after your actions, outside your wait. */
export async function learnInBackground() {
  try {
    const { db, writer } = await defaultDeps();
    await learnFromFeedback({ db, writer }, await writingContext(db, await mainLanguage(db)));
  } catch (error) {
    console.error("The learning coach couldn't finish:", error);
  }
}

/** "Learn now": the coach runs even with only a little new feedback. */
export async function learnNow({ db, writer }: Pick<StudioDeps, "db" | "writer">) {
  await learnFromFeedback({ db, writer }, await writingContext(db, await mainLanguage(db)), { force: true });
}
