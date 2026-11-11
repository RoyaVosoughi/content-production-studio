import { uiLocale, type UiLanguage } from "./language";

/**
 * A scheduled time as the interface shows it. Farsi uses the Gregorian calendar here, so the time
 * reads the same as the date-and-time box it was chosen in.
 */
export function scheduleLabel(date: Date, ui: UiLanguage): string {
  const locale = ui === "fa" ? `${uiLocale(ui)}-u-ca-gregory` : uiLocale(ui);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
