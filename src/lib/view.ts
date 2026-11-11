import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "./db/client";
import { localize } from "./i18n";
import { isUiLanguage, type Language, type UiLanguage } from "./language";
import { getProfile } from "./profile";

/** Remembers which content language is on screen. Set by /api/switch. */
export const VIEW_COOKIE = "content_language";

/**
 * The content language to show: the one last chosen, else the interface language when it is one of
 * the content languages, else the main content language.
 */
export async function viewLanguage(languages: readonly Language[], ui: UiLanguage): Promise<Language> {
  const chosen = (await cookies()).get(VIEW_COOKIE)?.value;
  if (chosen && languages.includes(chosen)) return chosen;
  if (languages.includes(ui)) return ui;
  return languages[0] ?? "en";
}

/**
 * What every studio page starts with. Until Setup is saved, every page except Setup sends the
 * person there, because nothing can be written without a name and a language.
 */
export async function studioPage(lang: string, { setup = false }: { setup?: boolean } = {}) {
  if (!isUiLanguage(lang)) notFound();
  const db = await getDb();
  const profile = await getProfile(db);
  if ((!profile || profile.languages.length === 0) && !setup) redirect(`/${lang}/setup`);
  const languages = profile?.languages ?? [];
  const view = await viewLanguage(languages, lang);
  return { ui: lang, db, profile, languages, view, t: localize(lang, languages, view) };
}

export type StudioPage = Awaited<ReturnType<typeof studioPage>> & { profile: NonNullable<Awaited<ReturnType<typeof studioPage>>["profile"]> };

/** For pages that only render once Setup is done, where the profile is always there. */
export async function readyPage(lang: string): Promise<StudioPage> {
  return (await studioPage(lang)) as StudioPage;
}
