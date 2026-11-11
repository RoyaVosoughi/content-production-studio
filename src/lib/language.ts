/**
 * Two kinds of language live in the studio:
 * - the interface language (menus and buttons), English or Farsi, which is the first part of every address;
 * - content languages, one or two that each person chooses in Setup, in which ideas and posts are written.
 * With two content languages every idea exists in both as a pair: the first is written, the second is adapted from it.
 */

export const UI_LANGUAGES = ["en", "fa"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function isUiLanguage(value: string): value is UiLanguage {
  return (UI_LANGUAGES as readonly string[]).includes(value);
}

export function uiDirection(language: UiLanguage): "ltr" | "rtl" {
  return language === "fa" ? "rtl" : "ltr";
}

/** For dates and numbers shown in the interface. */
export function uiLocale(language: UiLanguage): string {
  return language === "fa" ? "fa-IR" : "en-GB";
}

/** A content language's code, such as "en" or "es". Only codes in CONTENT_LANGUAGES are ever stored. */
export type Language = string;

type Script = "latin" | "cyrillic" | "arabic";

export type ContentLanguageInfo = {
  code: string;
  /** The English name, which is also what the AI is told. */
  name: string;
  /** The name in Persian, for the Farsi interface. */
  faName: string;
  /** The name in the language itself, shown when choosing languages. */
  native: string;
  dir: "ltr" | "rtl";
  /** For numbers on slides and in captions. */
  locale: string;
  /** Decides which bundled typeface draws it on slides and in video captions. */
  script: Script;
  /** The few words the studio itself puts on slides and end cards. */
  phrases: { swipe: string; follow: string; subscribe: string };
};

/**
 * The languages the studio can write, caption and draw. The list is limited to scripts the bundled
 * fonts cover (Inter for Latin and Cyrillic, Vazirmatn for Arabic script) and that Whisper transcribes well.
 * {name} in a phrase is replaced with the person's name or handle.
 */
export const CONTENT_LANGUAGES: ContentLanguageInfo[] = [
  { code: "en", name: "English", faName: "انگلیسی", native: "English", dir: "ltr", locale: "en-US", script: "latin", phrases: { swipe: "Swipe", follow: "Follow {name}", subscribe: "Subscribe for more" } },
  { code: "fa", name: "Farsi (Persian)", faName: "فارسی", native: "فارسی", dir: "rtl", locale: "fa-IR", script: "arabic", phrases: { swipe: "ورق بزنید", follow: "{name} را دنبال کنید", subscribe: "برای ویدیوهای بیشتر سابسکرایب کنید" } },
  { code: "ar", name: "Arabic", faName: "عربی", native: "العربية", dir: "rtl", locale: "ar", script: "arabic", phrases: { swipe: "اسحب", follow: "تابع {name}", subscribe: "اشترك للمزيد" } },
  { code: "es", name: "Spanish", faName: "اسپانیایی", native: "Español", dir: "ltr", locale: "es-ES", script: "latin", phrases: { swipe: "Desliza", follow: "Sigue a {name}", subscribe: "Suscríbete para ver más" } },
  { code: "fr", name: "French", faName: "فرانسوی", native: "Français", dir: "ltr", locale: "fr-FR", script: "latin", phrases: { swipe: "Faites défiler", follow: "Suivez {name}", subscribe: "Abonnez-vous pour en voir plus" } },
  { code: "de", name: "German", faName: "آلمانی", native: "Deutsch", dir: "ltr", locale: "de-DE", script: "latin", phrases: { swipe: "Wischen", follow: "Folge {name}", subscribe: "Abonnieren für mehr" } },
  { code: "it", name: "Italian", faName: "ایتالیایی", native: "Italiano", dir: "ltr", locale: "it-IT", script: "latin", phrases: { swipe: "Scorri", follow: "Segui {name}", subscribe: "Iscriviti per altri video" } },
  { code: "pt", name: "Portuguese", faName: "پرتغالی", native: "Português", dir: "ltr", locale: "pt-PT", script: "latin", phrases: { swipe: "Deslize", follow: "Siga {name}", subscribe: "Inscreva-se para ver mais" } },
  { code: "nl", name: "Dutch", faName: "هلندی", native: "Nederlands", dir: "ltr", locale: "nl-NL", script: "latin", phrases: { swipe: "Swipe", follow: "Volg {name}", subscribe: "Abonneer voor meer" } },
  { code: "sv", name: "Swedish", faName: "سوئدی", native: "Svenska", dir: "ltr", locale: "sv-SE", script: "latin", phrases: { swipe: "Svep", follow: "Följ {name}", subscribe: "Prenumerera för mer" } },
  { code: "pl", name: "Polish", faName: "لهستانی", native: "Polski", dir: "ltr", locale: "pl-PL", script: "latin", phrases: { swipe: "Przesuń", follow: "Obserwuj {name}", subscribe: "Subskrybuj, aby zobaczyć więcej" } },
  { code: "tr", name: "Turkish", faName: "ترکی", native: "Türkçe", dir: "ltr", locale: "tr-TR", script: "latin", phrases: { swipe: "Kaydır", follow: "{name} hesabını takip et", subscribe: "Daha fazlası için abone ol" } },
  { code: "id", name: "Indonesian", faName: "اندونزیایی", native: "Bahasa Indonesia", dir: "ltr", locale: "id-ID", script: "latin", phrases: { swipe: "Geser", follow: "Ikuti {name}", subscribe: "Langganan untuk lebih banyak" } },
  { code: "ru", name: "Russian", faName: "روسی", native: "Русский", dir: "ltr", locale: "ru-RU", script: "cyrillic", phrases: { swipe: "Листайте", follow: "Подписывайтесь на {name}", subscribe: "Подпишитесь, чтобы не пропустить" } },
  { code: "uk", name: "Ukrainian", faName: "اوکراینی", native: "Українська", dir: "ltr", locale: "uk-UA", script: "cyrillic", phrases: { swipe: "Гортайте", follow: "Стежте за {name}", subscribe: "Підпишіться, щоб не пропустити" } },
];

const BY_CODE = new Map(CONTENT_LANGUAGES.map((info) => [info.code, info]));

export function isContentLanguage(value: string): boolean {
  return BY_CODE.has(value);
}

/** Unknown codes fall back to English, so a removed language never breaks a page. */
export function languageInfo(code: string): ContentLanguageInfo {
  return BY_CODE.get(code) ?? BY_CODE.get("en")!;
}

export function textDirection(code: string): "ltr" | "rtl" {
  return languageInfo(code).dir;
}

export function languageName(code: string, ui: UiLanguage = "en"): string {
  const info = languageInfo(code);
  // The interface drops the AI's extra wording, such as "(Persian)".
  return ui === "fa" ? info.faName : info.name.replace(/ \(.*\)$/, "");
}

export function numberLocale(code: string): string {
  return languageInfo(code).locale;
}

/** The other of a person's two content languages, or null when they write in only one. */
export function otherLanguage(code: string, languages: readonly string[]): string | null {
  return languages.find((language) => language !== code) ?? null;
}
