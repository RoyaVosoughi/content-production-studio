import type { IdeaSource, PieceContent } from "./db/schema";
import type { UiLanguage } from "./language";

export const TEXT_PLATFORMS = ["telegram", "linkedin", "instagram", "website"] as const;
/** Videos you film yourself. Each is a different video with its own script, not one file posted everywhere. */
export const VIDEO_PLATFORMS = ["reel", "short", "youtube", "linkedin_video"] as const;
export const PLATFORMS = [...TEXT_PLATFORMS, ...VIDEO_PLATFORMS] as const;
export type Platform = (typeof PLATFORMS)[number];
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  telegram: "Telegram",
  linkedin: "LinkedIn",
  instagram: "Instagram carousel",
  website: "Website",
  reel: "Instagram Reel",
  short: "YouTube Short",
  youtube: "YouTube",
  linkedin_video: "LinkedIn video",
};

export function isVideoPlatform(platform: string): platform is VideoPlatform {
  return (VIDEO_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * The finished video's frame size and longest allowed length for each network.
 * Reels and Shorts can be up to 3 minutes; LinkedIn allows longer, but 10 minutes keeps it watchable.
 */
export const VIDEO_FORMATS: Record<VideoPlatform, { width: number; height: number; maxSeconds: number }> = {
  reel: { width: 1080, height: 1920, maxSeconds: 180 },
  short: { width: 1080, height: 1920, maxSeconds: 180 },
  youtube: { width: 1920, height: 1080, maxSeconds: 4 * 3600 },
  linkedin_video: { width: 1080, height: 1350, maxSeconds: 600 },
};

/** YouTube titles can be up to 100 characters. */
export const VIDEO_TITLE_LIMIT = 100;

/** Instagram allows up to 20 carousel slides. Ten keeps a carousel worth finishing. */
export const SLIDE_LIMITS = { min: 1, max: 10, title: 90, text: 300 } as const;
export const INSTAGRAM_HASHTAG_LIMIT = 30;

/** The name to show on screen. Telegram and LinkedIn are brand names, so only Website is translated. */
export function platformLabel(platform: Platform, language: UiLanguage): string {
  if (language === "fa") {
    const farsi: Partial<Record<Platform, string>> = {
      instagram: "کاروسل اینستاگرام",
      website: "وب‌سایت",
      reel: "ریلز اینستاگرام",
      short: "شورتز یوتیوب",
      youtube: "یوتیوب",
      linkedin_video: "ویدیوی لینکدین",
    };
    if (farsi[platform]) return farsi[platform];
  }
  return PLATFORM_NAMES[platform];
}

/**
 * Platforms you can post to yourself and then record in the studio, while it can't post to them:
 * where to start a post, and the site a link to the finished post must be on.
 */
export const MANUAL_POSTING: Partial<Record<Platform, { composeUrl: string; hosts: string[] }>> = {
  linkedin: { composeUrl: "https://www.linkedin.com/feed/?shareActive=true", hosts: ["linkedin.com"] },
  instagram: { composeUrl: "https://www.instagram.com/", hosts: ["instagram.com"] },
  reel: { composeUrl: "https://www.instagram.com/", hosts: ["instagram.com"] },
  short: { composeUrl: "https://studio.youtube.com/", hosts: ["youtube.com", "youtu.be"] },
  youtube: { composeUrl: "https://studio.youtube.com/", hosts: ["youtube.com", "youtu.be"] },
  linkedin_video: { composeUrl: "https://www.linkedin.com/feed/?shareActive=true", hosts: ["linkedin.com"] },
};
export const MANUAL_PLATFORMS = Object.keys(MANUAL_POSTING) as Platform[];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Telegram's limit is in its API docs. LinkedIn's docs give no number, so this is its commonly reported limit. */
export const BODY_LIMITS: Record<Platform, number> = {
  telegram: 4096,
  linkedin: 3000,
  instagram: 2200,
  website: 100_000,
  reel: 2200,
  short: 5000,
  youtube: 5000,
  linkedin_video: 3000,
};

/** Web addresses: lowercase letters, numbers and single hyphens, which every blog accepts. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

/** Why this content can't be posted yet. The same rules drive the editor and the server. */
export function contentProblem(platform: Platform, content: PieceContent): string | null {
  if (!content.body.trim()) return "The post is empty.";
  if (content.body.length > BODY_LIMITS[platform]) {
    return `This is too long for ${PLATFORM_NAMES[platform]}. The limit is ${BODY_LIMITS[platform]} characters.`;
  }
  if (platform === "instagram") return instagramProblem(content);
  if (isVideoPlatform(platform)) return videoTextProblem(platform, content);
  if (platform !== "website") return null;
  if (!content.title?.trim() || content.title.length > 200) return "An article needs a title of up to 200 characters.";
  if ((content.excerpt?.length ?? 0) > 400) return "The summary can be up to 400 characters.";
  if (!content.slug || content.slug.length > 120 || !SLUG_PATTERN.test(content.slug)) {
    return "The web address can only use lowercase English letters, numbers and single hyphens.";
  }
  const tags = content.tags ?? [];
  if (tags.length > 12 || tags.some((tag) => !tag || tag.length > 40)) {
    return "Use up to 12 tags of up to 40 characters each.";
  }
  return null;
}

function videoTextProblem(platform: VideoPlatform, content: PieceContent): string | null {
  const title = content.title?.trim() ?? "";
  if ((platform === "youtube" || platform === "short") && !title) return "A YouTube video needs a title.";
  if (title.length > VIDEO_TITLE_LIMIT) return `The title can be up to ${VIDEO_TITLE_LIMIT} characters.`;
  if ((content.tags ?? []).join(",").length > 500) return "YouTube allows up to 500 characters of tags.";
  return null;
}

/**
 * The words that go out with a post, which is what a square-bracket placeholder must not be left in.
 * A video's script is only for filming, so a note left in it doesn't block posting.
 */
export function postedText(platform: Platform, content: PieceContent): object {
  if (!isVideoPlatform(platform)) return content;
  return { body: content.body, title: content.title ?? "", tags: content.tags ?? [], titleCard: content.edit?.titleCard ?? "" };
}

function instagramProblem(content: PieceContent): string | null {
  const slides = content.slides ?? [];
  if (slides.length < SLIDE_LIMITS.min || slides.length > SLIDE_LIMITS.max) {
    return `An Instagram post needs ${SLIDE_LIMITS.min} to ${SLIDE_LIMITS.max} slides.`;
  }
  const number = slides.findIndex((slide) => !slide.title.trim() || slide.title.length > SLIDE_LIMITS.title);
  if (number >= 0) return `Slide ${number + 1} needs a title of up to ${SLIDE_LIMITS.title} characters.`;
  const long = slides.findIndex((slide) => slide.text.length > SLIDE_LIMITS.text);
  if (long >= 0) return `The text on slide ${long + 1} can be up to ${SLIDE_LIMITS.text} characters.`;
  const hashtags = content.body.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > INSTAGRAM_HASHTAG_LIMIT) return `Instagram allows up to ${INSTAGRAM_HASHTAG_LIMIT} hashtags.`;
  return null;
}

/** Links the search didn't return and that aren't on your own website, so you can check them before posting. */
export function uncheckedLinks(body: string, sources: Pick<IdeaSource, "url">[], ownSite = ""): string[] {
  const known = new Set(sources.map((source) => source.url));
  const found = (body.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).map((url) => url.replace(/[.,;:!?؟،]+$/, ""));
  return [...new Set(found)].filter((url) => !known.has(url) && !(ownSite && url.startsWith(ownSite)));
}

export type Metric = "views" | "likes" | "comments" | "shares" | "saves" | "follows";

/**
 * The numbers each network shows on a live post, in the order you read them. Views is first
 * everywhere: on LinkedIn it's impressions, and on the website it's page views.
 */
export const RESULT_METRICS: Record<Platform, Metric[]> = {
  telegram: ["views", "likes", "shares"],
  linkedin: ["views", "likes", "comments", "shares"],
  instagram: ["views", "likes", "comments", "shares", "saves", "follows"],
  website: ["views"],
  reel: ["views", "likes", "comments", "shares", "saves", "follows"],
  short: ["views", "likes", "comments", "shares", "follows"],
  youtube: ["views", "likes", "comments", "follows"],
  linkedin_video: ["views", "likes", "comments", "shares"],
};
