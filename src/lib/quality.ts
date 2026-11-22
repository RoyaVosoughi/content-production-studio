import type { IdeaSource, PieceContent } from "./db/schema";
import { languageInfo, type Language } from "./language";
import { contentProblem, isVideoPlatform, postedText, uncheckedLinks, type Platform } from "./platforms";
import { hasPlaceholder } from "./scenario";
import { overlap, topicWords } from "./text-overlap";

/**
 * The ready check: a quick look at a post before it goes out, done in code so it's instant, free and
 * the same every time. fail means it can't go out yet; warn is advice you may ignore.
 */
export type CheckLevel = "pass" | "warn" | "fail";
export type CheckId =
  | "rules"
  | "hook"
  | "opener"
  | "paragraphs"
  | "sentences"
  | "hashtags"
  | "numbers"
  | "freshness"
  | "repeat"
  | "links";
export type CheckItem = { id: CheckId; level: CheckLevel; values?: Record<string, string | number> };
export type ReadyCheck = { level: CheckLevel; items: CheckItem[] };

/** A post already live on the same network, to notice when a new one says the same thing again. */
export type RecentPost = { title: string; body: string };

/** How much of a post shows before "see more": the hook has to land inside it. */
export const HOOK_FOLD: Partial<Record<Platform, number>> = {
  linkedin: 210,
  instagram: 125,
  telegram: 200,
  reel: 125,
  linkedin_video: 210,
};
/** Titles longer than this are cut short in search results and under a video. */
export const TITLE_FOLD: Partial<Record<Platform, number>> = { website: 70, youtube: 60, short: 60 };
/** More hashtags than this reads as spam on that network. */
export const HASHTAG_ADVICE: Partial<Record<Platform, number>> = {
  linkedin: 5,
  instagram: 10,
  telegram: 5,
  reel: 10,
  short: 5,
  youtube: 8,
  linkedin_video: 5,
};
const PARAGRAPH_LIMIT = 400;
const SENTENCE_WORDS = 25;
/** At or above this, a post reads as a repeat of one already live. */
export const REPEAT_THRESHOLD = 0.5;
/** News older than this is no longer "why now". */
const STALE_DAYS = 90;

/** Openings that make people scroll past, because every other post starts the same way. */
const WEAK_OPENERS =
  /^(in today'?s (fast[- ]paced |digital )?world|i'?m (so |very )?(excited|thrilled|happy) to|have you ever wondered|did you know|hey (guys|everyone|folks)|hello (everyone|all)|as we all know|in this (post|video|article)|let'?s talk about)/i;

/** Numbers that need a source: percentages, money and big counts. Years and list numbers don't. */
const STATISTIC = /\d[\d.,٬]*\s?(%|٪|percent|per cent|درصد|million|billion|trillion|میلیون|میلیارد)|[$€£]\s?\d/i;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The line people see first: the first line of the post, or the cover slide's title. */
export function hookLine(platform: Platform, content: PieceContent): string {
  if (platform === "instagram" && content.slides?.[0]) return content.slides[0].title.trim();
  return (content.body.split("\n").find((line) => line.trim()) ?? "").trim();
}

function sentences(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .split(/(?<=[.!?؟。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 3);
}

/** True when the post names one of the idea's sources, by its address or its site. */
export function citesSource(body: string, sources: Pick<IdeaSource, "url">[]): boolean {
  const lower = body.toLowerCase();
  return sources.some((source) => {
    const host = hostOf(source.url);
    return lower.includes(source.url.toLowerCase()) || (host !== "" && lower.includes(host.toLowerCase()));
  });
}

export function readyCheck(
  platform: Platform,
  content: PieceContent,
  {
    sources = [],
    recent = [],
    ownSite = "",
    today = new Date(),
  }: { sources?: IdeaSource[]; recent?: RecentPost[]; ownSite?: string; today?: Date } = {},
): ReadyCheck {
  const items: CheckItem[] = [];
  const video = isVideoPlatform(platform);
  const body = content.body;

  // The rules a post must meet to go out at all.
  const problem = hasPlaceholder(postedText(platform, content)) ? "placeholder" : contentProblem(platform, content);
  items.push(problem ? { id: "rules", level: "fail", values: { problem } } : { id: "rules", level: "pass" });

  // The hook: short enough to show before "see more", and not a tired opening.
  const hook = hookLine(platform, content);
  const fold = HOOK_FOLD[platform];
  const titleFold = TITLE_FOLD[platform];
  const title = (content.title ?? "").trim();
  if (titleFold && title) {
    items.push({ id: "hook", level: title.length > titleFold ? "warn" : "pass", values: { kind: "title", length: title.length, limit: titleFold } });
  } else if (fold && hook) {
    items.push({ id: "hook", level: hook.length > fold ? "warn" : "pass", values: { kind: "line", length: hook.length, limit: fold } });
  }
  const opening = titleFold && title ? title : hook;
  if (opening) items.push({ id: "opener", level: WEAK_OPENERS.test(opening) ? "warn" : "pass" });

  // Easy to read on a phone: no walls of text, no endless sentences. Articles have their own headings.
  if (!video && platform !== "website" && body.trim()) {
    const longest = Math.max(0, ...body.split(/\n\s*\n/).map((paragraph) => paragraph.trim().length));
    items.push({ id: "paragraphs", level: longest > PARAGRAPH_LIMIT ? "warn" : "pass", values: { length: longest, limit: PARAGRAPH_LIMIT } });
  }
  const all = sentences(platform === "website" ? body.replace(/^#+ .*$/gm, "") : body);
  if (all.length > 0) {
    const average = Math.round(all.reduce((sum, sentence) => sum + sentence.split(/\s+/).length, 0) / all.length);
    items.push({ id: "sentences", level: average > SENTENCE_WORDS ? "warn" : "pass", values: { words: average, limit: SENTENCE_WORDS } });
  }

  const advice = HASHTAG_ADVICE[platform];
  if (advice !== undefined) {
    const count = (body.match(HASHTAG) ?? []).length;
    items.push({ id: "hashtags", level: count > advice ? "warn" : "pass", values: { count, limit: advice } });
  }

  // Facts: a number that matters should point at where it came from.
  const checked = `${title}\n${body}\n${(content.slides ?? []).map((slide) => `${slide.title}\n${slide.text}`).join("\n")}`;
  if (STATISTIC.test(checked)) {
    const cited = citesSource(body, sources);
    items.push({ id: "numbers", level: cited ? "pass" : "warn", values: { sources: sources.length } });
  }
  const dates = sources.map((source) => (source.publishedDate ? Date.parse(source.publishedDate) : NaN)).filter((time) => !Number.isNaN(time));
  if (dates.length > 0) {
    const days = Math.floor((today.getTime() - Math.max(...dates)) / 86_400_000);
    items.push({ id: "freshness", level: days > STALE_DAYS ? "warn" : "pass", values: { days } });
  }

  const links = uncheckedLinks(body, sources, ownSite);
  if (links.length > 0) items.push({ id: "links", level: "warn", values: { count: links.length } });

  // Saying the same thing again on the same network.
  if (body.trim() && recent.length > 0) {
    const words = topicWords(`${title} ${body}`);
    let closest: { title: string; score: number } | null = null;
    for (const post of recent) {
      const score = overlap(words, topicWords(`${post.title} ${post.body}`));
      if (!closest || score > closest.score) closest = { title: post.title, score };
    }
    if (closest && closest.score >= REPEAT_THRESHOLD) {
      items.push({ id: "repeat", level: "warn", values: { title: closest.title, percent: Math.round(closest.score * 100) } });
    } else {
      items.push({ id: "repeat", level: "pass" });
    }
  }

  const level: CheckLevel = items.some((item) => item.level === "fail") ? "fail" : items.some((item) => item.level === "warn") ? "warn" : "pass";
  return { level, items };
}

/**
 * The idea's sources written at the end of a post, in the post's language: as Markdown links on
 * the website, as addresses where links work, and as site names on Instagram, where they don't.
 * Sources already in the post are left out, so pressing the button twice adds nothing.
 */
export function withSources(platform: Platform, body: string, sources: IdeaSource[], language: Language): string {
  const missing = sources.filter((source) => !citesSource(body, [source]));
  if (missing.length === 0) return body;
  const heading = languageInfo(language).phrases.sources;
  const trimmed = body.trimEnd();
  if (platform === "website") {
    const list = missing.map((source) => `- [${source.title.replace(/[[\]]/g, "") || hostOf(source.url)}](${source.url})`).join("\n");
    return `${trimmed}\n\n## ${heading}\n\n${list}`;
  }
  if (platform === "instagram" || platform === "reel") {
    const sites = [...new Set(missing.map((source) => hostOf(source.url)).filter(Boolean))];
    return `${trimmed}\n\n${heading}: ${sites.join(", ")}`;
  }
  const list = missing.map((source) => `- ${source.title ? `${source.title}: ` : ""}${source.url}`).join("\n");
  return `${trimmed}\n\n${heading}:\n${list}`;
}
