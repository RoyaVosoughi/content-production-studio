import { formatNumber } from "@/components/team-parts";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage as Language } from "@/lib/language";
import type { Standing } from "@/lib/results";

// Small pieces the Results page and the weekly report share.

const BADGE: Record<Standing, string> = {
  strong: "bg-navy text-ink",
  average: "bg-mist text-ink-soft",
  weak: "border border-amber text-amber-deep",
  early: "bg-mist text-ink-soft",
};

export function StandingBadge({ standing, score, language, t }: { standing: Standing; score: number | null; language: Language; t: Strings }) {
  return (
    <span data-standing={standing} className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${BADGE[standing]}`}>
      {t.standing[standing]}
      {score !== null && <span className="ms-2 font-normal">{t.resultsScore.replace("{score}", formatNumber(language)(score, 1))}</span>}
    </span>
  );
}

/** A score drawn against a mark for a typical post, so above and below typical read at a glance. */
export function ScoreBar({ score }: { score: number }) {
  const max = 3;
  const width = Math.min(score, max) / max;
  return (
    <div className="relative mt-1 h-2 rounded-full bg-mist" aria-hidden>
      <div className={`h-2 rounded-full ${score >= 1 ? "bg-cobalt" : "bg-amber"}`} style={{ width: `${width * 100}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ insetInlineStart: `${100 / max}%` }} />
    </div>
  );
}
