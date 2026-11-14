import { cleanSources, parseSources, pickFeedItems, readFeeds, type FetchText } from "./sources";
import { cleanChannelPicks } from "./channels";
import { allSkills } from "./agents/skills";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  describeEdit,
  learnFromFeedback,
  instructionsFor,
  lessonsFor,
  recordOwnerFeedback,
  recordSignal,
} from "./agents/team";
import { tavilySearch } from "./ai/tavily";
import type { IdeaText, SearchProvider, WritingContext, WritingModel } from "./ai/types";
import { studioWriter } from "./ai/writer";
import { emptyBrandKit, type BrandKitFields } from "./brand-seed";
import { getDb, type Db } from "./db/client";
import {
  brandKits,
  ideas,
  scenarios,
  scenarioVersions,
  scoutRuns,
  type ChannelPick,
  type IdeaSource,
  type ScoutLook,
  type ScenarioContent,
} from "./db/schema";
import { StudioError } from "./errors";
import { otherLanguage, type Language } from "./language";
import { getProfile, requireProfile } from "./profile";
import { performanceBrief } from "./results";
import { hasPlaceholder } from "./scenario";

/** Five strong ideas a run: fewer AI words to write and check, and fewer to read through. */
export const IDEA_BATCH_SIZE = 5;
const MAX_SEARCH_QUERIES = 4;
const PAST_TITLES_LIMIT = 100;
const STALE_SCENARIO = "This scenario changed since you opened it. Reload and review the latest version.";

export type StudioDeps = {
  db: Db;
  writer: WritingModel;
  searcher: SearchProvider;
  /** Reads an RSS feed; the real web unless a test passes its own. */
  fetchFeed?: FetchText;
};

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

export async function saveBrandKit(db: Db, language: Language, fields: BrandKitFields & { sources?: string[] }) {
  await getBrandKit(db, language);
  const { sources, ...kit } = fields;
  await db
    .update(brandKits)
    .set({ ...kit, ...(sources ? { sources: cleanSources(sources) } : {}), isDraft: false, updatedAt: new Date() })
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
    skills: await allSkills(db),
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

/**
 * Finds a batch of ideas. `stopIfAsked` is called between the slow steps; when you stop the search
 * it throws, so nothing is saved. Everything is saved at the very end, in one go.
 */
export async function generateIdeas(
  { db, writer, searcher, fetchFeed }: StudioDeps,
  language: Language,
  focus: string,
  stopIfAsked: () => void = () => {},
  { onlyMine = false }: { onlyMine?: boolean } = {},
) {
  const profile = await requireProfile(db);
  if (!profile.languages.includes(language)) throw new StudioError("Choose one of your content languages first.");
  const context = await writingContext(db, language);
  // What you asked for can hold links (a post, an article, a page); the scout reads them first.
  const { request, links } = splitLinks(focus);
  const shared = links.length && searcher.read ? await searcher.read(links) : { pages: [], failed: links };
  stopIfAsked();
  if (links.length > 0 && shared.pages.length === 0 && !request) {
    throw new StudioError(
      "The link couldn't be opened. Instagram and LinkedIn often hide posts from outside readers, so paste the post's text instead, or add a few words about what you want.",
    );
  }

  const queries = [...(request ? [request] : []), ...context.brand.searchTopics].slice(0, MAX_SEARCH_QUERIES);
  const { domains, feeds } = parseSources((await getBrandKit(db, language)).sources);
  if (onlyMine && domains.length === 0 && feeds.length === 0) {
    throw new StudioError("Add your sources to the Brand Kit first, or untick \"Only my sources\".");
  }
  if (queries.length === 0 && shared.pages.length === 0 && feeds.length === 0) {
    throw new StudioError("Add at least one search topic to the Brand Kit.");
  }
  // With only your sources, the web search is limited to your sites, and skipped when you have only feeds.
  const searched = queries.length > 0 && (!onlyMine || domains.length > 0) ? queries : [];
  const [found, read] = await Promise.all([
    searched.length ? searcher.search(searched, onlyMine ? { domains } : undefined) : Promise.resolve([]),
    feeds.length ? readFeeds(feeds, fetchFeed) : Promise.resolve({ items: [], report: [] }),
  ]);
  stopIfAsked();
  const feedItems = pickFeedItems(read.items, [request, ...context.brand.searchTopics]);
  const seen = new Set<string>();
  const results = [...shared.pages, ...found, ...feedItems].filter((result) => !seen.has(result.url) && seen.add(result.url));
  if (results.length === 0) {
    throw new StudioError(
      onlyMine
        ? "Your sources had nothing recent on this. Untick \"Only my sources\" to search the whole web, or add more sources."
        : "The search found nothing recent. Try asking for something else or change your search topics.",
    );
  }
  const looked: ScoutLook = {
    onlyMine,
    queries: searched,
    domains: onlyMine ? domains : [],
    feeds: read.report,
    links: shared.pages.map((page) => page.url),
    results: results.length,
  };

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
  stopIfAsked();
  // You check the ideas yourself, so the manager spends no requests on them.
  const drafts = first.slice(0, IDEA_BATCH_SIZE);

  // A source is kept only if the search really returned it, so a made-up link can't appear as evidence.
  const known = new Map(results.map((result) => [result.url, result]));
  const batch = drafts.slice(0, IDEA_BATCH_SIZE);
  const second = otherLanguage(language, profile.languages);
  const adapted = second ? await adaptIdeasOrFail(writer, await writingContext(db, second), batch.map(ideaText)) : [];
  stopIfAsked();

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
  await db.insert(scoutRuns).values({ language, looked, ideas: own.length });
  return own;
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

async function saveFirstVersion(db: Db, ideaId: string, content: ScenarioContent, channels: ChannelPick[] | null) {
  await db.transaction(async (tx) => {
    const created = await tx
      .insert(scenarios)
      .values({ ideaId, currentVersion: 1, channels })
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
    const context = await writingContext(db, idea.language as Language);
    if (siblingScenario) {
      const content = await writer.adaptScenario(context, { scenario: siblingScenario.current.content });
      await saveFirstVersion(db, ideaId, content, siblingScenario.channels);
    } else {
      // You review the scenario yourself, so it goes straight to you. The channel advice comes in the same request.
      const { channels, ...content } = await writer.writeScenario(context, {
        idea: ideaText(idea),
        sources: idea.sources.map(({ title, url }) => ({ title, url })),
      });
      await saveFirstVersion(db, ideaId, pickScenario(content), cleanChannelPicks(channels));
    }
    own = await getScenario(db, ideaId);
  }
  if (sibling && !siblingScenario && own) {
    const context = await writingContext(db, sibling.language as Language);
    await saveFirstVersion(db, sibling.id, await writer.adaptScenario(context, { scenario: own.current.content }), own.channels);
  }
}

/** Only the scenario's own fields are saved as its content. */
function pickScenario({ title, hook, mainPoints, angle, example, callToAction }: ScenarioContent): ScenarioContent {
  return { title, hook, mainPoints, angle, example, callToAction };
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
