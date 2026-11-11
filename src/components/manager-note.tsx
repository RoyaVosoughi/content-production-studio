import { PASS_SCORE } from "@/lib/agents/roster";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type UiLanguage } from "@/lib/language";

/** The manager's check of the AI's draft, shown next to the work it was about. */
export function ManagerNote({
  verdict,
  language,
  t,
}: {
  verdict: { score: number | null; revised: boolean; note: { en: string; fa: string } } | undefined;
  language: UiLanguage;
  t: Strings;
}) {
  if (!verdict || verdict.score == null) return null;
  const note = verdict.note[language];
  const passed = verdict.score >= PASS_SCORE;
  return (
    <p className={`rounded-lg border-s-4 bg-paper px-3 py-2 text-sm ${passed && !verdict.revised ? "border-cobalt" : "border-amber"}`}>
      <span className="label me-2">
        {t.managerCheck} · {verdict.score.toLocaleString(uiLocale(language))}/{(10).toLocaleString(uiLocale(language))}
      </span>
      {note}
      {verdict.revised && <span className="ms-1 text-ink-soft">{t.managerRevised}</span>}
    </p>
  );
}
