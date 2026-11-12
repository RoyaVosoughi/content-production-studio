import { samplesForEdit } from "./agents/editor/samples";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { agentForPlatform } from "./agents/roster";
import { describeEdit, getTeamSettings, managerCheck, recordOwnerFeedback, saveVerdict } from "./agents/team";
import type { Db } from "./db/client";
import { getDb } from "./db/client";
import {
  footage,
  ideas,
  pieces,
  pieceVersions,
  publications,
  scheduledPosts,
  videoRenders,
  type EditPlan,
  type PieceContent,
} from "./db/schema";
import { StudioError } from "./errors";
import { languageName, type Language } from "./language";
import { requireProfile } from "./profile";
import { slideBrand, type SlideBrand } from "./slides";
import {
  contentProblem,
  isPlatform,
  isVideoPlatform,
  MANUAL_POSTING,
  PLATFORM_NAMES,
  postedText,
  slugify,
  uncheckedLinks,
  type Platform,
  type VideoPlatform,
} from "./platforms";
import { cleanPlan, defaultFraming, simplePlan } from "./video/edit";
import { isRunning, startProcessing, type Transcriber } from "./video/footage";
import { brandForVideo, renderedFile, renderKey, renderProblem, startRender, type Clip, type DrawCards } from "./video/render";
import { PUBLISHERS } from "./publishers";
import { PublishRejected, type Publisher } from "./publishers/types";
import { hasPlaceholder } from "./scenario";
import { getScenario, getSibling, requireIdea, writingContext, type StudioDeps } from "./studio";
import type { WritingContext } from "./ai/types";
import type { ScenarioContent } from "./db/schema";

const STALE_PIECE = "This post changed since you opened it. Reload and review the latest version.";
/** A send that never reported back, because the app stopped mid-post, is treated as unknown after this long. */
const STUCK_AFTER_MINUTES = 5;

export type PublishDeps = {
  db: Db;
  publishers: Record<Platform, Publisher>;
  /** Draws the Instagram slides as JPEG images. */
  slideImages: (content: PieceContent, language: Language, brand: SlideBrand) => Promise<Buffer[]>;
};

export async function defaultPublishDeps(): Promise<PublishDeps> {
  const { renderSlides } = await import("./render");
  return { db: await getDb(), publishers: PUBLISHERS, slideImages: renderSlides };
}

function isScenarioApproved(scenario: Awaited<ReturnType<typeof getScenario>>) {
  return scenario !== null && scenario.approvedVersion === scenario.currentVersion;
}


/** The languages of this idea whose scenario is approved, so content can be written in them. */
export async function approvedLanguages(db: Db, idea: { id: string; pairId: string; language: string }) {
  const sibling = await getSibling(db, idea);
  const languages: Language[] = [];
  for (const version of sibling ? [idea, sibling] : [idea]) {
    if (isScenarioApproved(await getScenario(db, version.id))) languages.push(version.language as Language);
  }
  return languages;
}

/**
 * Writes a post for each chosen platform in each chosen language, from that language's approved scenario.
 * Each language needs only its own approval. Posts already written are skipped, so a retry after a
 * partial failure only writes what's missing.
 */
export async function createPieces(
  { db, writer }: StudioDeps,
  ideaId: string,
  platforms: Platform[],
  languages: Language[],
) {
  if (platforms.length === 0) throw new StudioError("Choose at least one platform.");
  if (languages.length === 0) throw new StudioError("Choose at least one language.");
  const idea = await requireIdea(db, ideaId);
  const sibling = await getSibling(db, idea);
  const pair = sibling ? [idea, sibling] : [idea];
  const versions = pair.filter((version) => languages.includes(version.language as Language));
  if (versions.length === 0) throw new StudioError("This idea doesn't have that language yet.");
  for (const version of versions) {
    if (!isScenarioApproved(await getScenario(db, version.id))) {
      throw new StudioError(`Approve the ${languageName(version.language)} scenario before writing content in it.`);
    }
  }

  const existing = await db
    .select({ ideaId: pieces.ideaId, platform: pieces.platform })
    .from(pieces)
    .where(inArray(pieces.ideaId, versions.map((version) => version.id)));
  const exists = (id: string, platform: Platform) =>
    existing.some((row) => row.ideaId === id && row.platform === platform);

  // Both language versions of an article share one web address, even when the second is written later.
  // It comes from the English title when there is one, otherwise from the first title in Latin letters.
  const titles = [...pair].sort((a, b) => Number(b.language === "en") - Number(a.language === "en")).map((version) => version.title);
  const slug = titles.map(slugify).find(Boolean) || `post-${idea.pairId.slice(0, 8)}`;

  const jobs = versions.flatMap((version) =>
    platforms.filter((platform) => !exists(version.id, platform)).map((platform) => ({ version, platform })),
  );
  const { managerEnabled } = await getTeamSettings(db);
  const outcomes = await Promise.allSettled(
    jobs.map(async ({ version, platform }) => {
      const scenario = await getScenario(db, version.id);
      if (!scenario) throw new StudioError("A scenario is missing.");
      const language = version.language as Language;
      const { draft: written, verdict } = await writeChecked(writer, db, managerEnabled, await writingContext(db, language), {
        platform,
        scenario: scenario.current.content,
        sources: version.sources.map(({ title, url }) => ({ title, url })),
        finish: (draft) => (platform === "website" ? { ...draft, slug } : draft),
      });
      const content = written;
      let pieceId: string | null = null;
      await db.transaction(async (tx) => {
        const [piece] = await tx
          .insert(pieces)
          .values({ ideaId: version.id, platform, currentVersion: 1 })
          .onConflictDoNothing()
          .returning({ id: pieces.id });
        if (piece) {
          pieceId = piece.id;
          await tx.insert(pieceVersions).values({
            pieceId: piece.id,
            version: 1,
            content,
            origin: "ai",
            scenarioVersion: scenario.currentVersion,
          });
        }
      });
      if (pieceId) {
        await saveVerdict(db, { agent: agentForPlatform(platform), task: platform, language, subject: pieceId, version: 1 }, verdict);
      }
    }),
  );

  const failed = outcomes.filter((outcome) => outcome.status === "rejected");
  if (failed.length > 0) {
    const reason = failed[0].reason;
    if (!(reason instanceof StudioError)) console.error(reason);
    throw new StudioError(
      `${failed.length} of ${jobs.length} posts weren't written. Try again to write only those. ${reason instanceof StudioError ? reason.message : ""}`.trim(),
    );
  }
}

/**
 * The platform's writer drafts the post and the manager checks it. Rules the studio knows, such as
 * length limits and links that didn't come from the search, are checked without an AI request.
 */
async function writeChecked(
  writer: StudioDeps["writer"],
  db: Db,
  enabled: boolean,
  context: WritingContext,
  {
    platform,
    scenario,
    sources,
    finish,
  }: {
    platform: Platform;
    scenario: ScenarioContent;
    sources: { title: string; url: string }[];
    /** Fields the studio adds to the writer's draft, such as the article's web address. */
    finish: (draft: PieceContent) => PieceContent;
  },
) {
  const brief = { platform, scenario, sources };
  return managerCheck(db, {
    enabled,
    agent: agentForPlatform(platform),
    language: context.language,
    draft: finish(await writer.writePiece(context, brief)),
    ruleProblem: (draft) => {
      const problem = contentProblem(platform, draft);
      if (problem) return problem;
      const links = uncheckedLinks(draft.body, sources);
      return links.length ? `It links to addresses that aren't in the sources: ${links.join(", ")}. Use only the supplied sources.` : null;
    },
    review: (content) => writer.reviewPiece(context, { ...brief, content }),
    rewrite: async (feedback) => finish(await writer.writePiece(context, { ...brief, feedback })),
  });
}

/** The parts of a post its writer wrote, for comparing your edit with the draft. */
const WRITTEN_FIELDS = ["body", "title", "excerpt", "tags", "slides", "script"];
const PLAN_FIELDS = ["level", "cut", "tightenPauses", "titleCard", "callouts", "zooms", "highlights", "chapters", "fixes", "endCard"];

/** Every post for one language version of an idea, with its history and publishing state. */
export async function getPieces(db: Db, ideaId: string) {
  const rows = await db.select().from(pieces).where(eq(pieces.ideaId, ideaId)).orderBy(asc(pieces.createdAt));
  return Promise.all(
    rows.map(async (piece) => {
      const versions = await db
        .select()
        .from(pieceVersions)
        .where(eq(pieceVersions.pieceId, piece.id))
        .orderBy(desc(pieceVersions.version));
      const current = versions.find((version) => version.version === piece.currentVersion);
      if (!current) throw new Error(`Post ${piece.id} is missing version ${piece.currentVersion}`);
      const [publication] = await db.select().from(publications).where(eq(publications.pieceId, piece.id));
      return { ...piece, versions, current, publication: publication ?? null };
    }),
  );
}

export type PublishState = "draft" | "sending" | "posted" | "failed" | "unknown";

export function publishState(
  publication: { status: string; updatedAt: Date } | null,
  now = Date.now(),
): PublishState {
  if (!publication) return "draft";
  if (publication.status === "sending" && now - publication.updatedAt.getTime() > STUCK_AFTER_MINUTES * 60_000) {
    return "unknown";
  }
  return publication.status as PublishState;
}

async function requirePiece(db: Db, id: string) {
  const [piece] = await db.select().from(pieces).where(eq(pieces.id, id));
  if (!piece) throw new StudioError("This post no longer exists.");
  if (!isPlatform(piece.platform)) throw new Error(`Unknown platform ${piece.platform}`);
  return { ...piece, platform: piece.platform as Platform };
}

async function pieceVersion(db: Db, pieceId: string, version: number) {
  const [row] = await db
    .select()
    .from(pieceVersions)
    .where(and(eq(pieceVersions.pieceId, pieceId), eq(pieceVersions.version, version)));
  if (!row) throw new StudioError("That version no longer exists.");
  return row;
}

/** Adds a version on top of the one on screen. Text that is or may be live can't be changed from here. */
async function addVersion(
  db: Db,
  pieceId: string,
  basedOn: number,
  content: PieceContent,
  origin: "edit" | "ai-change" | "restore" | "ai",
  scenarioVersion: number,
) {
  const [publication] = await db.select().from(publications).where(eq(publications.pieceId, pieceId));
  if (publication && publication.status !== "failed") {
    throw new StudioError("This post has already been sent, so it can't be changed here.");
  }
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(pieces)
      .set({ currentVersion: sql`${pieces.currentVersion} + 1` })
      .where(and(eq(pieces.id, pieceId), eq(pieces.currentVersion, basedOn)))
      .returning({ version: pieces.currentVersion });
    if (moved.length === 0) throw new StudioError(STALE_PIECE);
    await tx.insert(pieceVersions).values({ pieceId, version: moved[0].version, content, origin, scenarioVersion });
  });
}

export async function savePieceEdit(db: Db, pieceId: string, basedOn: number, content: PieceContent) {
  const old = await pieceVersion(db, pieceId, basedOn);
  // Fields this platform doesn't show are kept, and a post's text can't become an empty save.
  const next = { ...old.content, ...content };
  if (content.edit) {
    // An edit plan can only point at phrases of the clip it was made for.
    const clip = old.content.footage ? await readyClip(db, old.content.footage) : null;
    if (!clip) throw new StudioError("Upload your clip before planning the edit.");
    next.edit = cleanPlan(content.edit, clip.phrases.length);
  }
  if (next.thumbnailAt !== undefined && !(next.thumbnailAt >= 0)) delete next.thumbnailAt;
  await addVersion(db, pieceId, basedOn, next, "edit", old.scenarioVersion);

  const piece = await requirePiece(db, pieceId);
  const language = (await requireIdea(db, piece.ideaId)).language as Language;
  const written = describeEdit(old.content, next, WRITTEN_FIELDS);
  if (written) {
    await recordOwnerFeedback(db, {
      agent: agentForPlatform(piece.platform),
      language,
      kind: "edit",
      subject: pieceId,
      detail: `{OWNER} edited the ${PLATFORM_NAMES[piece.platform]} post themselves. ${written}`,
    });
  }
  // Changes to an edit plan teach the video editor, but only when the plan was the AI's to begin with.
  const plan = old.content.edit && next.edit && describeEdit(old.content.edit, next.edit, PLAN_FIELDS);
  if (plan && old.origin === "ai") {
    await recordOwnerFeedback(db, {
      agent: "editor",
      language,
      kind: "edit",
      subject: pieceId,
      detail: `{OWNER} changed the edit plan for a ${PLATFORM_NAMES[piece.platform]} video. ${plan}`,
    });
  }
}

export async function changePieceWithAi({ db, writer }: StudioDeps, pieceId: string, basedOn: number, request: string) {
  const piece = await requirePiece(db, pieceId);
  if (piece.currentVersion !== basedOn) throw new StudioError(STALE_PIECE);
  const old = await pieceVersion(db, pieceId, basedOn);
  const idea = await requireIdea(db, piece.ideaId);
  await recordOwnerFeedback(db, {
    agent: agentForPlatform(piece.platform),
    language: idea.language as Language,
    kind: "ai-change",
    subject: pieceId,
    detail: `{OWNER} asked for a change to the ${PLATFORM_NAMES[piece.platform]} post: ${request}`,
  });
  const revised = await writer.revisePiece(await writingContext(db, idea.language as Language), {
    platform: piece.platform,
    content: old.content,
    request,
  });
  await addVersion(db, pieceId, basedOn, { ...old.content, ...revised }, "ai-change", old.scenarioVersion);
}

/** Writes the post again from the scenario as it stands now. */
export async function rewritePieceFromScenario({ db, writer }: StudioDeps, pieceId: string, basedOn: number) {
  const piece = await requirePiece(db, pieceId);
  if (piece.currentVersion !== basedOn) throw new StudioError(STALE_PIECE);
  const idea = await requireIdea(db, piece.ideaId);
  const scenario = await getScenario(db, idea.id);
  if (!scenario || !isScenarioApproved(scenario)) throw new StudioError("Approve the scenario first.");
  const old = await pieceVersion(db, pieceId, basedOn);
  const language = idea.language as Language;
  const { managerEnabled } = await getTeamSettings(db);
  const { draft, verdict } = await writeChecked(writer, db, managerEnabled, await writingContext(db, language), {
    platform: piece.platform,
    scenario: scenario.current.content,
    sources: idea.sources.map(({ title, url }) => ({ title, url })),
    finish: (written) => ({ ...old.content, ...written }),
  });
  await addVersion(db, pieceId, basedOn, draft, "ai", scenario.currentVersion);
  await saveVerdict(
    db,
    { agent: agentForPlatform(piece.platform), task: piece.platform, language, subject: pieceId, version: basedOn + 1 },
    verdict,
  );
}

/** Adds or removes the Instagram cover photo, as a new version. */
export async function setPiecePhoto(db: Db, pieceId: string, basedOn: number, photo: string | null) {
  const piece = await requirePiece(db, pieceId);
  if (piece.platform !== "instagram") throw new StudioError("Only Instagram posts have a cover photo.");
  const old = await pieceVersion(db, pieceId, basedOn);
  const { photo: _previous, ...rest } = old.content;
  await addVersion(db, pieceId, basedOn, photo ? { ...rest, photo } : rest, "edit", old.scenarioVersion);
}

export async function restorePieceVersion(db: Db, pieceId: string, basedOn: number, version: number) {
  const old = await pieceVersion(db, pieceId, version);
  await addVersion(db, pieceId, basedOn, old.content, "restore", old.scenarioVersion);
}

/** Both languages of an article must share a web address, or the website can't link them to each other. */
async function requireMatchingSlug(db: Db, ideaId: string, slug: string | undefined) {
  const idea = await requireIdea(db, ideaId);
  const sibling = await getSibling(db, idea);
  if (!sibling) return;
  const [other] = await db
    .select({ content: pieceVersions.content })
    .from(pieces)
    .innerJoin(
      pieceVersions,
      and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, pieces.currentVersion)),
    )
    .where(and(eq(pieces.ideaId, sibling.id), eq(pieces.platform, "website")));
  if (other && other.content.slug !== slug) {
    throw new StudioError(`Use the same web address in both languages. The other version uses "${other.content.slug}".`);
  }
}

/**
 * Your single click: approves exactly this version and posts it.
 *
 * The attempt is recorded before anything is sent, so a double click or a second tab can't post twice.
 * After a lost connection the outcome is unknown, and nothing is sent again until you have checked
 * the platform and says it didn't post.
 */
/**
 * Everything that must be true before a version can go out, whether now or at a scheduled time.
 * Throws the reason when it can't.
 */
export async function checkPostable({ db, publishers }: Pick<PublishDeps, "db" | "publishers">, pieceId: string, version: number) {
  const piece = await requirePiece(db, pieceId);
  if (piece.currentVersion !== version) throw new StudioError(STALE_PIECE);
  const { content } = await pieceVersion(db, pieceId, version);

  if (hasPlaceholder(postedText(piece.platform, content))) throw new StudioError("Replace the text in square brackets, save, then post.");
  const problem = contentProblem(piece.platform, content);
  if (problem) throw new StudioError(problem);
  if (piece.platform === "website") await requireMatchingSlug(db, piece.ideaId, content.slug);

  if (isVideoPlatform(piece.platform)) {
    throw new StudioError("Videos are posted by hand for now: download the video, post it, then record it here.");
  }
  const publisher = publishers[piece.platform];
  const missing = publisher.missingSettings();
  if (missing.length > 0) {
    throw new StudioError(`Add ${missing.join(" and ")} to .env.local, then restart the app, to post to ${PLATFORM_NAMES[piece.platform]}.`);
  }
  return { piece, content, publisher };
}

export async function approveAndPublish(
  { db, publishers, slideImages }: PublishDeps,
  pieceId: string,
  version: number,
  { checkedNotPosted = false }: { checkedNotPosted?: boolean } = {},
) {
  const { piece, content, publisher } = await checkPostable({ db, publishers }, pieceId, version);

  const claimed = await db
    .insert(publications)
    .values({ pieceId, version, status: "sending" })
    .onConflictDoUpdate({
      target: publications.pieceId,
      set: { version, status: "sending", error: null, updatedAt: new Date() },
      where: sql`${publications.status} = 'failed' OR (${checkedNotPosted} AND (${publications.status} = 'unknown' OR (${publications.status} = 'sending' AND ${publications.updatedAt} < now() - make_interval(mins => ${STUCK_AFTER_MINUTES}))))`,
    })
    .returning({ pieceId: publications.pieceId });
  if (claimed.length === 0) {
    const [current] = await db.select().from(publications).where(eq(publications.pieceId, pieceId));
    throw new StudioError(
      current?.status === "posted"
        ? "This post is already live."
        : "This post may already have gone out. Check the platform first, then choose what happened.",
    );
  }

  const idea = await requireIdea(db, piece.ideaId);
  const finish = (fields: Partial<typeof publications.$inferInsert>) =>
    db
      .update(publications)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(publications.pieceId, pieceId));
  try {
    const language = idea.language as Language;
    const profile = await requireProfile(db);
    const { externalId, url } = await publisher.publish({
      language,
      content,
      key: `${pieceId}-v${version}`,
      images: () => slideImages(content, language, slideBrand(profile)),
      profile,
    });
    await finish({ status: "posted", externalId, url, postedAt: new Date(), error: null });
    // Posted by hand before its time, so there's nothing left to schedule.
    await db.delete(scheduledPosts).where(eq(scheduledPosts.pieceId, pieceId));
  } catch (error) {
    if (error instanceof PublishRejected) {
      await finish({ status: "failed", error: error.message });
    } else {
      console.error(`Posting to ${piece.platform} ended with an unknown result:`, error);
      await finish({
        status: "unknown",
        error: `The connection to ${PLATFORM_NAMES[piece.platform]} was lost before it confirmed the post.`,
      });
    }
  }
}

/** Whether the studio can delete this live post from its network itself, rather than you doing it there. */
export function canDeleteLive(
  publisher: Publisher,
  publication: { status: string; externalId: string | null } | null | undefined,
): boolean {
  return Boolean(publication?.externalId && publisher.unpublish && publisher.canUnpublish?.());
}

/**
 * You changed your mind about posting this on its network: the post leaves this idea, with its
 * versions, schedule and results. A live post is deleted from the network first when the studio
 * can do that itself. Otherwise you delete it there and confirm with byHand.
 */
export async function removePiece(
  { db, publishers }: Pick<PublishDeps, "db" | "publishers">,
  pieceId: string,
  { byHand = false }: { byHand?: boolean } = {},
) {
  const piece = await requirePiece(db, pieceId);
  const [publication] = await db.select().from(publications).where(eq(publications.pieceId, pieceId));
  const [schedule] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.pieceId, pieceId));
  const state = publication ? publishState(publication) : "draft";
  if (state === "sending" || schedule?.status === "sending") {
    throw new StudioError("This post is being sent right now. Wait a minute, then remove it.");
  }

  // Posted, or possibly posted: it has to come off the network before it leaves the studio.
  if ((state === "posted" || state === "unknown") && !byHand) {
    const publisher = publishers[piece.platform];
    if (!canDeleteLive(publisher, publication)) {
      throw new StudioError(
        `The studio can't delete posts from ${PLATFORM_NAMES[piece.platform]}. Delete it there yourself, then choose "I deleted it there".`,
      );
    }
    try {
      await publisher.unpublish!(publication!.externalId!);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StudioError(`${reason} Then choose "I deleted it there".`);
    }
  }

  // Versions, publication, schedule and results go with it.
  await db.delete(pieces).where(eq(pieces.id, pieceId));
}

/** You checked the platform and found the post is live. */
export async function markPosted(db: Db, pieceId: string) {
  const [publication] = await db.select().from(publications).where(eq(publications.pieceId, pieceId));
  if (!publication || publishState(publication) !== "unknown") {
    throw new StudioError("This post isn't waiting for a check.");
  }
  await db
    .update(publications)
    .set({ status: "posted", postedAt: new Date(), error: null, updatedAt: new Date() })
    .where(eq(publications.pieceId, pieceId));
}

/**
 * You copied this exact version, posted it yourself, and records it here.
 * The same checks as one-click posting apply, and a post can only be recorded once.
 */
export async function markPostedByHand(db: Db, pieceId: string, version: number, link = "") {
  const piece = await requirePiece(db, pieceId);
  const manual = MANUAL_POSTING[piece.platform];
  if (!manual) {
    throw new StudioError(`Posts to ${PLATFORM_NAMES[piece.platform]} can't be recorded by hand.`);
  }
  if (piece.currentVersion !== version) throw new StudioError(STALE_PIECE);
  const { content } = await pieceVersion(db, pieceId, version);
  if (hasPlaceholder(postedText(piece.platform, content))) throw new StudioError("Replace the text in square brackets, save, then post.");
  const problem = contentProblem(piece.platform, content);
  if (problem) throw new StudioError(problem);

  if (isVideoPlatform(piece.platform)) {
    const idea = await requireIdea(db, piece.ideaId);
    const clip = content.footage ? await readyClip(db, content.footage) : null;
    const problem = renderProblem(piece.platform, content, clip);
    if (problem) throw new StudioError(problem);
    const key = renderKey(piece.platform, idea.language, clip!.id, content, await brandForVideo(db, idea.language));
    const [render] = await db.select().from(videoRenders).where(eq(videoRenders.key, key));
    if (render?.status !== "ready" || !(await renderedFile(key))) {
      throw new StudioError("Make the video from this version first, then post it.");
    }
  }

  const url = link.trim() || null;
  if (url) {
    let host = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") host = parsed.hostname;
    } catch {}
    if (!manual.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new StudioError(
        `The link should be the ${PLATFORM_NAMES[piece.platform]} address of your post, starting with https://www.${manual.hosts[0]}/`,
      );
    }
  }

  const recorded = await db
    .insert(publications)
    .values({ pieceId, version, status: "posted", url, postedAt: new Date() })
    .onConflictDoUpdate({
      target: publications.pieceId,
      set: { version, status: "posted", url, error: null, postedAt: new Date(), updatedAt: new Date() },
      where: sql`${publications.status} = 'failed'`,
    })
    .returning({ pieceId: publications.pieceId });
  if (recorded.length === 0) throw new StudioError("This post is already recorded as sent.");
}

// ---- Video ----

async function readyClip(db: Db, id: string): Promise<Clip | null> {
  const [clip] = await db.select().from(footage).where(eq(footage.id, id));
  if (!clip || clip.status !== "ready" || !clip.phrases || !clip.duration || !clip.width || !clip.height) return null;
  return { id: clip.id, file: clip.file, duration: clip.duration, width: clip.width, height: clip.height, phrases: clip.phrases };
}

async function requireVideoPiece(db: Db, pieceId: string) {
  const piece = await requirePiece(db, pieceId);
  if (!isVideoPlatform(piece.platform)) throw new StudioError("Only videos have a clip.");
  const idea = await requireIdea(db, piece.ideaId);
  return { ...piece, platform: piece.platform as VideoPlatform, idea, language: idea.language as Language };
}

/** Records an uploaded clip, uses it for this video as a new version, and starts reading it. */
export async function addFootage(
  db: Db,
  pieceId: string,
  basedOn: number,
  upload: { file: string; originalName: string; size: number },
  transcribe?: Transcriber,
) {
  const piece = await requireVideoPiece(db, pieceId);
  if (piece.currentVersion !== basedOn) throw new StudioError(STALE_PIECE);
  const [clip] = await db
    .insert(footage)
    .values({
      pairId: piece.idea.pairId,
      language: piece.language,
      file: upload.file,
      originalName: upload.originalName.slice(0, 200),
      size: upload.size,
      status: "processing",
      stage: "reading",
    })
    .returning({ id: footage.id });
  await useFootage(db, pieceId, basedOn, clip.id);
  startProcessing(db, clip.id, transcribe);
  return clip.id;
}

/** Uses a clip for this video. The old edit plan pointed at the old clip, so it's dropped. */
export async function useFootage(db: Db, pieceId: string, basedOn: number, footageId: string) {
  const piece = await requireVideoPiece(db, pieceId);
  const [clip] = await db.select().from(footage).where(eq(footage.id, footageId));
  if (!clip || clip.pairId !== piece.idea.pairId || clip.language !== piece.language) {
    throw new StudioError("That clip isn't one of this idea's clips in this language.");
  }
  const old = await pieceVersion(db, pieceId, basedOn);
  const { edit: _edit, thumbnailAt: _at, ...rest } = old.content;
  await addVersion(db, pieceId, basedOn, { ...rest, footage: footageId }, "edit", old.scenarioVersion);
}

/** Reads a clip again after it failed or was interrupted. */
export async function retryFootage(db: Db, footageId: string, transcribe?: Transcriber) {
  const [clip] = await db.select().from(footage).where(eq(footage.id, footageId));
  if (!clip) throw new StudioError("That clip no longer exists.");
  if (clip.status === "ready") return;
  if (clip.status === "processing" && isRunning(`footage:${footageId}`)) return;
  await db.update(footage).set({ status: "processing", stage: "reading", error: null, updatedAt: new Date() }).where(eq(footage.id, footageId));
  startProcessing(db, footageId, transcribe);
}

/**
 * Plans the edit for this clip as a new version: by the AI, which reads the transcript and decides
 * how much editing the clip needs, or as a simple plan that keeps everything.
 */
export async function planVideoEdit(
  { db, writer }: StudioDeps,
  pieceId: string,
  basedOn: number,
  mode: "ai" | "simple",
  request = "",
) {
  const piece = await requireVideoPiece(db, pieceId);
  if (piece.currentVersion !== basedOn) throw new StudioError(STALE_PIECE);
  const old = await pieceVersion(db, pieceId, basedOn);
  const clip = old.content.footage ? await readyClip(db, old.content.footage) : null;
  if (!clip) throw new StudioError("Wait until your clip is ready, then plan the edit.");
  const base: EditPlan = { ...simplePlan(old.content.title ?? ""), framing: defaultFraming(piece.platform, clip.width, clip.height) };
  let plan = base;
  if (mode === "ai") {
    const proposal = await writer.planEdit(await writingContext(db, piece.language), {
      platform: piece.platform,
      title: old.content.title ?? "",
      script: old.content.script ?? [],
      phrases: clip.phrases.map((phrase, number) => ({ number, start: phrase.start, end: phrase.end, text: phrase.text })),
      duration: clip.duration,
      samples: await samplesForEdit(db, piece.platform),
      request: request.trim().slice(0, 2000),
    });
    plan = { ...base, ...proposal, chapters: piece.platform === "youtube" ? proposal.chapters : [] };
  }
  await addVersion(db, pieceId, basedOn, { ...old.content, edit: cleanPlan(plan, clip.phrases.length) }, mode === "ai" ? "ai" : "edit", old.scenarioVersion);
}

/** Starts making the video for exactly the version on screen. */
export async function makeVideo(db: Db, pieceId: string, version: number, draw?: DrawCards) {
  const piece = await requireVideoPiece(db, pieceId);
  if (piece.currentVersion !== version) throw new StudioError(STALE_PIECE);
  const { content } = await pieceVersion(db, pieceId, version);
  const clip = content.footage ? await readyClip(db, content.footage) : null;
  const problem = renderProblem(piece.platform, content, clip);
  if (problem) throw new StudioError(problem);
  return startRender(db, { pieceId, platform: piece.platform, language: piece.language, content, clip: clip! }, draw);
}

export type VideoState = {
  clip: (typeof footage.$inferSelect & { stopped: boolean }) | null;
  /** This idea's other clips in the same language, to reuse one take for several videos. */
  otherClips: { id: string; originalName: string; duration: number | null; createdAt: Date }[];
  render: (typeof videoRenders.$inferSelect & { stopped: boolean }) | null;
  renderKey: string | null;
  problem: string | null;
};

/** Where this video is: its clip, and whether the finished video for this exact version exists. */
export async function videoState(db: Db, pieceId: string, platform: VideoPlatform, language: Language, content: PieceContent): Promise<VideoState> {
  const piece = await requirePiece(db, pieceId);
  const idea = await requireIdea(db, piece.ideaId);
  const clips = await db
    .select()
    .from(footage)
    .where(and(eq(footage.pairId, idea.pairId), eq(footage.language, language)))
    .orderBy(desc(footage.createdAt));
  const row = clips.find((clip) => clip.id === content.footage) ?? null;
  const clip = row ? { ...row, stopped: row.status === "processing" && !isRunning(`footage:${row.id}`) } : null;
  const ready = row ? await readyClip(db, row.id) : null;
  const problem = renderProblem(platform, content, ready);
  const key = ready && !problem ? renderKey(platform, language, ready.id, content, await brandForVideo(db, language)) : null;
  let render: VideoState["render"] = null;
  if (key) {
    const [found] = await db.select().from(videoRenders).where(eq(videoRenders.key, key));
    if (found) {
      const missing = found.status === "ready" && !(await renderedFile(key));
      render = missing ? null : { ...found, stopped: found.status === "working" && !isRunning(`render:${key}`) };
    }
  }
  return {
    clip,
    otherClips: clips
      .filter((other) => other.id !== content.footage && other.status === "ready")
      .map(({ id, originalName, duration, createdAt }) => ({ id, originalName, duration, createdAt })),
    render,
    renderKey: key,
    problem,
  };
}

export async function ideaForContentPage(db: Db, ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  return idea ?? null;
}
