import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { profiles } from "./db/schema";
import { StudioError } from "./errors";
import { isContentLanguage, type Language } from "./language";

// Who the studio works for. Everything personal — the name the AI writes as, the content languages,
// the handles printed on slides, the website and the brand colours — comes from here, set on the Setup page.

export type BrandColors = {
  /** Cover slides, title cards and buttons. */
  primary: string;
  /** The darkest colour: last slides, end cards and thumbnail shading. */
  dark: string;
  /** The light background of the point slides. */
  light: string;
  /** Small accents: the bar under titles, numbers, highlighted caption words. */
  highlight: string;
};

export type Handles = { instagram: string; youtube: string; linkedin: string; telegram: string };

export type Profile = {
  /** The name the AI writes as, in Latin letters. */
  name: string;
  /** One or two content language codes. The first is the main one. */
  languages: Language[];
  /** The name as written in each content language, when it differs, such as سارا in Farsi. */
  localNames: Record<Language, string>;
  /** One line on what the person does, in each content language. Shown on end cards and in the LinkedIn preview. */
  headlines: Record<Language, string>;
  handles: Handles;
  /** The website's address, such as https://example.com. Empty for none. */
  websiteUrl: string;
  /** Where an article lives on the website; {lang} and {slug} are filled in. */
  blogPath: string;
  colors: BrandColors;
  /** Headings on slides and thumbnails: a serif (Fraunces) or the same sans-serif as the text. */
  headingStyle: "serif" | "sans";
};

export const DEFAULT_COLORS: BrandColors = { primary: "#1e3a8a", dark: "#0b1530", light: "#f4f6fb", highlight: "#f5b942" };
export const DEFAULT_BLOG_PATH = "/{lang}/blog/{slug}";
export const MAX_LANGUAGES = 2;

const PROFILE_ID = 1;

export async function getProfile(db: Db): Promise<Profile | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, PROFILE_ID));
  if (!row) return null;
  return {
    name: row.name,
    languages: row.languages.filter(isContentLanguage),
    localNames: row.localNames,
    headlines: row.headlines,
    handles: { instagram: "", youtube: "", linkedin: "", telegram: "", ...row.handles },
    websiteUrl: row.websiteUrl,
    blogPath: row.blogPath || DEFAULT_BLOG_PATH,
    colors: { ...DEFAULT_COLORS, ...row.colors },
    headingStyle: row.headingStyle === "sans" ? "sans" : "serif",
  };
}

/** For work that can't start before Setup is done. Pages send people to Setup instead. */
export async function requireProfile(db: Db): Promise<Profile> {
  const profile = await getProfile(db);
  if (!profile || profile.languages.length === 0) throw new StudioError("Finish Setup first: add your name and languages.");
  return profile;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Checks and cleans what Setup sends, so a bad value can never reach a prompt or a slide. */
export function cleanProfile(input: Profile): Profile {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new StudioError("Add your name.");
  const languages = [...new Set(input.languages.filter(isContentLanguage))].slice(0, MAX_LANGUAGES);
  if (languages.length === 0) throw new StudioError("Choose at least one content language.");
  const perLanguage = (values: Record<string, string>, limit: number) =>
    Object.fromEntries(languages.map((code) => [code, (values[code] ?? "").trim().slice(0, limit)]).filter(([, value]) => value));
  const handle = (value: string) => value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 60);
  const websiteUrl = input.websiteUrl.trim().replace(/\/+$/, "");
  if (websiteUrl && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(websiteUrl)) {
    throw new StudioError("The website address should look like https://example.com.");
  }
  const blogPath = input.blogPath.trim() || DEFAULT_BLOG_PATH;
  if (!blogPath.startsWith("/") || !blogPath.includes("{slug}")) {
    throw new StudioError("The article address must start with / and include {slug}, such as /blog/{slug}.");
  }
  const colors = Object.fromEntries(
    Object.entries(DEFAULT_COLORS).map(([key, fallback]) => {
      const value = input.colors[key as keyof BrandColors]?.trim() ?? "";
      return [key, HEX.test(value) ? value.toLowerCase() : fallback];
    }),
  ) as BrandColors;
  return {
    name,
    languages,
    localNames: perLanguage(input.localNames, 80),
    headlines: perLanguage(input.headlines, 120),
    handles: {
      instagram: handle(input.handles.instagram),
      youtube: handle(input.handles.youtube),
      linkedin: handle(input.handles.linkedin),
      telegram: handle(input.handles.telegram),
    },
    websiteUrl,
    blogPath,
    colors,
    headingStyle: input.headingStyle === "sans" ? "sans" : "serif",
  };
}

export async function saveProfile(db: Db, input: Profile): Promise<Profile> {
  const profile = cleanProfile(input);
  const values = { ...profile, updatedAt: new Date() };
  await db
    .insert(profiles)
    .values({ id: PROFILE_ID, ...values })
    .onConflictDoUpdate({ target: profiles.id, set: values });
  return profile;
}

/** The name as written in a language, falling back to the main name. */
export function displayName(profile: Pick<Profile, "name" | "localNames">, language: Language): string {
  return profile.localNames[language] || profile.name;
}

export function headline(profile: Pick<Profile, "headlines">, language: Language): string {
  return profile.headlines[language] ?? Object.values(profile.headlines)[0] ?? "";
}

/** "@handle", or the name when there is no Instagram handle. */
export function instagramLabel(profile: Pick<Profile, "handles" | "name">): string {
  return profile.handles.instagram ? `@${profile.handles.instagram}` : profile.name;
}

/** Where a published article lives, or null when no website is set. */
export function articleUrl(profile: Pick<Profile, "websiteUrl" | "blogPath">, language: Language, slug: string): string | null {
  if (!profile.websiteUrl) return null;
  return profile.websiteUrl + profile.blogPath.replaceAll("{lang}", language).replaceAll("{slug}", slug);
}
