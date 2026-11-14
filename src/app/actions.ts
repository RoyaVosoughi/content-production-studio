"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isAgentId } from "@/lib/agents/roster";
import * as samples from "@/lib/agents/editor/samples";
import * as team from "@/lib/agents/team";
import * as content from "@/lib/content";
import { getDb } from "@/lib/db/client";
import type { EditPlan } from "@/lib/db/schema";
import { savePhoto } from "@/lib/media";
import { StudioError } from "@/lib/errors";
import { isContentLanguage, isUiLanguage, type Language, type UiLanguage } from "@/lib/language";
import { requireProfile, saveProfile, type Profile } from "@/lib/profile";
import { brandFileText, proposeBrandKits, type BrandProposal } from "@/lib/brand-file";
import { proposeInstructions, type InstructionsProposal } from "@/lib/instructions-file";
import { VIEW_COOKIE } from "@/lib/view";
import { cookies } from "next/headers";
import { isPlatform } from "@/lib/platforms";
import * as results from "@/lib/results";
import { startScoutJob } from "@/lib/scout-job";
import * as studio from "@/lib/studio";

export type ActionState = { error?: string } | null;

const MAX_REQUEST_LENGTH = 2000;

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const lines = (form: FormData, name: string) =>
  text(form, name)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** A content language, such as the language of the ideas to write. */
function languageFrom(form: FormData): Language {
  const value = text(form, "language");
  if (!isContentLanguage(value)) throw new StudioError("Unknown language.");
  return value;
}

/** The interface language, for the address to return to. */
function uiFrom(form: FormData): UiLanguage {
  const value = text(form, "ui");
  return isUiLanguage(value) ? value : "en";
}

async function showLanguage(language: Language) {
  (await cookies()).set(VIEW_COOKIE, language, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
}

function versionFrom(form: FormData, name = "version"): number {
  const value = Number(text(form, name));
  if (!Number.isInteger(value) || value < 1) throw new StudioError("Unknown version. Reload and try again.");
  return value;
}

function requestFrom(form: FormData): string {
  const request = text(form, "request");
  if (!request) throw new StudioError("Describe what should change.");
  if (request.length > MAX_REQUEST_LENGTH) throw new StudioError("Please shorten your request.");
  return request;
}

function messageFor(error: unknown): string {
  if (error instanceof StudioError) return error.message;
  console.error(error);
  return "That didn't work, and nothing was changed. Please try again.";
}

async function perform(work: () => Promise<void>): Promise<ActionState> {
  try {
    await work();
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath("/", "layout");
  // Once enough feedback has built up, the coach turns it into lessons after your wait is over.
  after(studio.learnInBackground);
  return null;
}

/** The numbers you read off one live post. */
export async function saveResultsAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const raw = Object.fromEntries(results.METRICS.map((metric) => [metric, text(form, metric)]));
    await results.saveResults(await getDb(), text(form, "pieceId"), raw, text(form, "note"));
  });
}

/**
 * Starts the idea scout in the background and goes straight to its card, where you can watch it,
 * stop it, or leave for any other page. "mode=topic" needs a topic; "mode=auto" searches your Brand Kit's topics.
 */
export async function generateIdeasAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const focus = text(form, "mode") === "auto" ? "" : text(form, "focus");
    if (text(form, "mode") === "topic" && !focus) throw new StudioError("Write a topic or paste a link first.");
    if (focus.length > MAX_REQUEST_LENGTH) throw new StudioError("Please shorten your request.");
    const language = languageFrom(form);
    const job = startScoutJob(
      language,
      async (stopIfAsked) => (await studio.generateIdeas(await studio.defaultDeps(), language, focus, stopIfAsked)).length,
      messageFor,
      () => void studio.learnInBackground(),
    );
    if (!job) throw new StudioError("The Idea Scout is still finishing its last search. Try again in a minute.");
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(`/${uiFrom(form)}/map?agent=scout#agent-card`);
}

export async function refineIdeaAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.reviseIdea(await studio.defaultDeps(), text(form, "ideaId"), requestFrom(form));
  });
}

export async function rejectIdeaAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.decideIdea(await getDb(), text(form, "ideaId"), "rejected");
  });
}

/** Approves the idea, then writes its scenario. If writing fails, the idea page offers a retry. */
export async function approveIdeaAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ideaId = text(form, "ideaId");
  let path: string;
  try {
    const deps = await studio.defaultDeps();
    await studio.decideIdea(deps.db, ideaId, "approved");
    path = `/${uiFrom(form)}/ideas/${ideaId}`;
    try {
      await studio.writeScenario(deps, ideaId);
    } catch (error) {
      path += `?writeError=${encodeURIComponent(messageFor(error))}`;
    }
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath("/", "layout");
  after(studio.learnInBackground);
  redirect(path);
}

export async function writeScenarioAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.writeScenario(await studio.defaultDeps(), text(form, "ideaId"));
  });
}

export async function saveScenarioAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const mainPoints = lines(form, "mainPoints");
    const title = text(form, "title");
    if (!title || mainPoints.length === 0) {
      throw new StudioError("A scenario needs a title and at least one main point.");
    }
    await studio.saveScenarioEdit(await getDb(), text(form, "ideaId"), versionFrom(form), {
      title,
      hook: text(form, "hook"),
      mainPoints,
      angle: text(form, "angle"),
      example: text(form, "example"),
      callToAction: text(form, "callToAction"),
    });
  });
}

export async function changeScenarioAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.changeScenarioWithAi(
      await studio.defaultDeps(),
      text(form, "ideaId"),
      versionFrom(form),
      requestFrom(form),
    );
  });
}

export async function syncOtherLanguageAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.syncOtherLanguage(await studio.defaultDeps(), text(form, "ideaId"), versionFrom(form));
  });
}

export async function approveScenarioAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.approveScenario(await getDb(), text(form, "ideaId"), versionFrom(form));
  });
}

export async function restoreScenarioAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await studio.restoreScenarioVersion(
      await getDb(),
      text(form, "ideaId"),
      versionFrom(form),
      versionFrom(form, "restoreVersion"),
    );
  });
}

export async function createPiecesAction(_: ActionState, form: FormData) {
  let elsewhere: string | null = null;
  const state = await perform(async () => {
    const platforms = form.getAll("platforms").map(String).filter(isPlatform);
    const languages = form.getAll("languages").map(String).filter(isContentLanguage);
    const deps = await studio.defaultDeps();
    const ideaId = text(form, "ideaId");
    await content.createPieces(deps, ideaId, platforms, languages);
    // Content written only in the other language appears on that language's page, so go there.
    const idea = await studio.requireIdea(deps.db, ideaId);
    if (!languages.includes(idea.language as Language)) {
      const sibling = await studio.getSibling(deps.db, idea);
      if (sibling) {
        await showLanguage(sibling.language);
        elsewhere = `/${uiFrom(form)}/ideas/${sibling.id}/content`;
      }
    }
  });
  // redirect() works by throwing, so it must run outside perform, which turns errors into messages.
  if (!state && elsewhere) redirect(elsewhere);
  return state;
}

export async function savePieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const body = String(form.get("body") ?? "").trim();
    if (!body) throw new StudioError("A post can't be empty.");
    await content.savePieceEdit(await getDb(), text(form, "pieceId"), versionFrom(form), {
      body,
      ...(form.has("slideTitle") && { slides: slidesFrom(form) }),
      ...(form.has("videoTitle") && videoFieldsFrom(form)),
      ...(form.has("title") && {
        title: text(form, "title"),
        excerpt: text(form, "excerpt"),
        slug: text(form, "slug"),
        tags: text(form, "tags")
          .split(/[,،]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
  });
}

/** A video's own fields. The edit plan arrives as JSON and is checked against the clip when saved. */
function videoFieldsFrom(form: FormData) {
  const says = form.getAll("scriptSay").map((value) => String(value).trim());
  const shows = form.getAll("scriptShow").map((value) => String(value).trim());
  let edit: EditPlan | undefined;
  if (form.has("edit")) {
    try {
      edit = JSON.parse(text(form, "edit")) as EditPlan;
    } catch {
      throw new StudioError("The edit plan couldn't be read. Reload and try again.");
    }
  }
  const at = text(form, "thumbnailAt");
  return {
    title: text(form, "videoTitle"),
    tags: text(form, "videoTags")
      .split(/[,،]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    script: says.map((say, index) => ({ say, show: shows[index] ?? "" })).filter((part) => part.say || part.show),
    ...(edit && { edit }),
    ...(at !== "" && { thumbnailAt: Number(at) }),
  };
}

/** Slides arrive as repeated fields, in order. A slide left completely empty is dropped. */
function slidesFrom(form: FormData) {
  const titles = form.getAll("slideTitle").map((value) => String(value).trim());
  const texts = form.getAll("slideText").map((value) => String(value).trim());
  return titles
    .map((title, index) => ({ title, text: texts[index] ?? "" }))
    .filter((slide) => slide.title || slide.text);
}

export async function uploadPhotoAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new StudioError("Choose a photo first.");
    const name = await savePhoto(file);
    await content.setPiecePhoto(await getDb(), text(form, "pieceId"), versionFrom(form), name);
  });
}

export async function removePhotoAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.setPiecePhoto(await getDb(), text(form, "pieceId"), versionFrom(form), null);
  });
}

export async function changePieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.changePieceWithAi(await studio.defaultDeps(), text(form, "pieceId"), versionFrom(form), requestFrom(form));
  });
}

export async function rewritePieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.rewritePieceFromScenario(await studio.defaultDeps(), text(form, "pieceId"), versionFrom(form));
  });
}

export async function restorePieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.restorePieceVersion(
      await getDb(),
      text(form, "pieceId"),
      versionFrom(form),
      versionFrom(form, "restoreVersion"),
    );
  });
}

export async function publishPieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.approveAndPublish(await content.defaultPublishDeps(), text(form, "pieceId"), versionFrom(form), {
      checkedNotPosted: text(form, "checkedNotPosted") === "yes",
    });
  });
}

export async function schedulePostAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const { parseLocalTime, schedulePost } = await import("@/lib/schedule");
    await schedulePost(await content.defaultPublishDeps(), text(form, "pieceId"), versionFrom(form), parseLocalTime(text(form, "at")));
  });
}

export async function cancelScheduleAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const { cancelSchedule } = await import("@/lib/schedule");
    await cancelSchedule(await getDb(), text(form, "pieceId"));
  });
}

export async function removePieceAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.removePiece(await content.defaultPublishDeps(), text(form, "pieceId"), {
      byHand: text(form, "byHand") === "yes",
    });
  });
}

export async function markPostedAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.markPosted(await getDb(), text(form, "pieceId"));
  });
}

export async function markPostedByHandAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.markPostedByHand(await getDb(), text(form, "pieceId"), versionFrom(form), text(form, "postUrl"));
  });
}

export async function useFootageAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.useFootage(await getDb(), text(form, "pieceId"), versionFrom(form), text(form, "footageId"));
  });
}

export async function retryFootageAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.retryFootage(await getDb(), text(form, "footageId"));
  });
}

export async function planEditAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const mode = text(form, "mode") === "simple" ? "simple" : "ai";
    const request = mode === "ai" ? String(form.get("request") ?? "") : "";
    await content.planVideoEdit(await studio.defaultDeps(), text(form, "pieceId"), versionFrom(form), mode, request);
  });
}

export async function makeVideoAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await content.makeVideo(await getDb(), text(form, "pieceId"), versionFrom(form));
  });
}

export async function saveBrandKitAction(_: ActionState, form: FormData) {
  const state = await perform(async () => {
    await studio.saveBrandKit(await getDb(), languageFrom(form), {
      positioning: text(form, "positioning"),
      audience: text(form, "audience"),
      pillars: lines(form, "pillars"),
      voiceGuide: text(form, "voiceGuide"),
      avoid: text(form, "avoid"),
      samples: text(form, "samples"),
      searchTopics: lines(form, "searchTopics"),
    });
  });
  // The form is rebuilt from the saved kit, so the "saved" note and the next step travel in the address.
  if (!state && form.has("ui")) redirect(`/${uiFrom(form)}/brand?saved=1`);
  return state;
}

export type BrandFileState = { error?: string; proposal?: BrandProposal; fileName?: string } | null;

/** Reads an uploaded brand file and proposes a Brand Kit for each content language. Nothing is saved. */
export async function readBrandFileAction(_: BrandFileState, form: FormData): Promise<BrandFileState> {
  try {
    const file = form.get("brandFile");
    if (!(file instanceof File)) throw new StudioError("Choose a file first.");
    const db = await getDb();
    const profile = await requireProfile(db);
    const text = await brandFileText(file);
    const { claudeJson } = await import("@/lib/ai/claude");
    const { openRouterJson } = await import("@/lib/ai/openrouter");
    const proposal = await proposeBrandKits(process.env.ANTHROPIC_API_KEY ? claudeJson : openRouterJson, {
      text,
      languages: profile.languages,
      ownerName: profile.name,
    });
    return { proposal, fileName: file.name };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Saves the Brand Kit for each content language in the form, and the "About you" text when one was sent. */
export async function saveBrandSetupAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const db = await getDb();
    const profile = await requireProfile(db);
    for (const code of profile.languages) {
      if (!form.has(`${code}:positioning`)) continue;
      const field = (name: string) => text(form, `${code}:${name}`);
      const list = (name: string) => lines(form, `${code}:${name}`);
      await studio.saveBrandKit(db, code, {
        positioning: field("positioning"),
        audience: field("audience"),
        pillars: list("pillars"),
        voiceGuide: field("voiceGuide"),
        avoid: field("avoid"),
        samples: field("samples"),
        searchTopics: list("searchTopics"),
      });
    }
    const about = text(form, "about");
    if (about) {
      const general = await team.getInstructions(db, team.GENERAL);
      // Never overwrites what you wrote yourself: the box is filled only while it's empty.
      if (!general.both.trim()) await team.saveInstructions(db, team.GENERAL, { both: about, byLanguage: general.byLanguage });
    }
  });
}

// ---- Team ----

export async function setManagerAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await team.setManagerEnabled(await getDb(), text(form, "enabled") === "yes");
  });
}

export async function addLessonAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const agent = text(form, "agent");
    const appliesTo = text(form, "appliesTo");
    if (!isAgentId(agent)) throw new StudioError("Unknown team member.");
    if (appliesTo !== "both" && !isContentLanguage(appliesTo)) throw new StudioError("Choose a language.");
    await team.addLesson(await getDb(), agent, text(form, "lesson"), appliesTo);
  });
}

export async function deleteLessonAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await team.deleteLesson(await getDb(), text(form, "lessonId"));
  });
}

export async function learnNowAction(_: ActionState, form: FormData) {
  void form;
  try {
    await studio.learnNow(await studio.defaultDeps());
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath("/", "layout");
  return null;
}

export async function saveInstructionsAction(_: ActionState, form: FormData) {
  return perform(async () => {
    const agent = text(form, "agent");
    if (!isAgentId(agent) && agent !== team.GENERAL) throw new StudioError("Unknown team member.");
    // Each content language has its own box, named lang:<code>.
    const byLanguage = Object.fromEntries(
      [...form.keys()]
        .filter((key) => key.startsWith("lang:") && isContentLanguage(key.slice(5)))
        .map((key) => [key.slice(5), text(form, key)]),
    );
    await team.saveInstructions(await getDb(), agent, { both: text(form, "both"), byLanguage });
  });
}

export type InstructionsFileState = { error?: string; proposal?: InstructionsProposal; fileName?: string } | null;

/** Reads an uploaded file and proposes one agent's instructions from it. Nothing is saved. */
export async function readInstructionsFileAction(_: InstructionsFileState, form: FormData): Promise<InstructionsFileState> {
  try {
    const agent = text(form, "agent");
    if (!isAgentId(agent)) throw new StudioError("Unknown team member.");
    const file = form.get("instructionsFile");
    if (!(file instanceof File)) throw new StudioError("Choose a file first.");
    const db = await getDb();
    const profile = await requireProfile(db);
    const [fileText, current] = await Promise.all([brandFileText(file), team.getInstructions(db, agent)]);
    const { claudeJson } = await import("@/lib/ai/claude");
    const { openRouterJson } = await import("@/lib/ai/openrouter");
    const proposal = await proposeInstructions(process.env.ANTHROPIC_API_KEY ? claudeJson : openRouterJson, {
      agent,
      text: fileText,
      ownerName: profile.name,
      current: { both: current.both, byLanguage: current.byLanguage },
    });
    return { proposal, fileName: file.name };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function saveSampleNoteAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await samples.saveSampleNote(await getDb(), text(form, "sampleId"), text(form, "note"));
  });
}

export async function deleteSampleAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await samples.deleteSample(await getDb(), text(form, "sampleId"));
  });
}

export async function retrySampleAction(_: ActionState, form: FormData) {
  return perform(async () => {
    await samples.retrySample(await getDb(), text(form, "sampleId"));
  });
}

/** Setup: who the studio works for. A new studio goes on to the Brand Kit once it's saved. */
export async function saveProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ui = uiFrom(form);
  const first = text(form, "first") === "yes";
  const state = await perform(async () => {
    const languages = [text(form, "main"), text(form, "second")].filter(Boolean);
    const perLanguage = (name: string) => Object.fromEntries(languages.map((code) => [code, text(form, `${name}:${code}`)]));
    const input: Profile = {
      name: text(form, "name"),
      languages,
      localNames: perLanguage("localName"),
      headlines: perLanguage("headline"),
      handles: {
        instagram: text(form, "instagram"),
        youtube: text(form, "youtube"),
        linkedin: text(form, "linkedin"),
        telegram: text(form, "telegram"),
      },
      websiteUrl: text(form, "websiteUrl"),
      blogPath: text(form, "blogPath"),
      colors: {
        primary: text(form, "primary"),
        dark: text(form, "dark"),
        light: text(form, "light"),
        highlight: text(form, "highlight"),
      },
      headingStyle: text(form, "headingStyle") === "sans" ? "sans" : "serif",
    };
    const saved = await saveProfile(await getDb(), input);
    await showLanguage(saved.languages[0]);
  });
  if (state) return state;
  revalidatePath("/", "layout");
  if (first) redirect(`/${ui}/brand`);
  return null;
}
