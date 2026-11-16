import Link from "next/link";
import { importLinkedInAction, saveResultsAction, syncInstagramAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatNumber } from "@/components/team-parts";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, uiLocale, type UiLanguage as Language } from "@/lib/language";
import { readyPage } from "@/lib/view";
import { platformLabel, PLATFORMS, RESULT_METRICS, type Metric, type Platform } from "@/lib/platforms";
import { bestAndWorst, patternsOf, weeklySummary, type Group } from "@/lib/insights";
import { MIN_TO_COMPARE, pillarSummary, resultsOverview, type RankedRow, type Standing } from "@/lib/results";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

function metricLabel(t: Strings, platform: Platform, metric: Metric) {
  if (metric === "views" && (platform === "linkedin" || platform === "linkedin_video")) return t.metricsLinkedin.views;
  return t.metrics[metric];
}

export default async function ResultsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, db } = await readyPage(param);
  const rows = await resultsOverview(db);
  const waiting = rows.filter((row) => !row.numbers);
  const measured = rows.filter((row) => row.numbers);
  const pillars = pillarSummary(rows);
  const number = formatNumber(lang);
  const networks = PLATFORMS.filter((platform) => measured.some((row) => row.platform === platform));

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.resultsTitle}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{t.resultsIntro}</p>
      <Link href={`/${lang}/results/report`} className="btn btn-quiet mt-4" data-report-link>
        {t.report.link}
      </Link>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl bg-paper p-5">{t.resultsNoPosts}</p>
      ) : (
        <>
          <Insights rows={rows} lang={lang} t={t} />
          <Sources rows={rows} t={t} lang={lang} />

          <section className="mt-10" aria-labelledby="waiting">
            <h2 id="waiting" className="font-display text-xl font-semibold">
              {t.resultsWaiting} <span className="label">({number(waiting.length)})</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="mt-3 text-ink-soft">{t.resultsWaitingNone}</p>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {waiting.map((row) => (
                  <article key={row.pieceId} data-waiting={row.platform} className="rounded-xl bg-paper p-5">
                    <PostHeading row={row} language={lang} t={t} />
                    <ResultsForm row={row} t={t} />
                  </article>
                ))}
              </div>
            )}
          </section>

          {pillars.length > 0 && (
            <section className="mt-10" aria-labelledby="pillars">
              <h2 id="pillars" className="font-display text-xl font-semibold">
                {t.resultsByPillar}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">{t.resultsByPillarHint}</p>
              <ul className="mt-4 space-y-3">
                {pillars.map((entry) => (
                  <li key={entry.pillar} data-pillar={entry.pillar}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{entry.pillar}</span>
                      <span className="label">
                        {t.resultsScore.replace("{score}", number(entry.score, 1))} ·{" "}
                        {(entry.posts === 1 ? t.resultsOnePost : t.resultsPosts).replace("{count}", number(entry.posts))}
                      </span>
                    </div>
                    <ScoreBar score={entry.score} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {measured.length > 0 && (
            <section className="mt-10" aria-labelledby="measured">
              <h2 id="measured" className="font-display text-xl font-semibold">
                {t.resultsMeasured} <span className="label">({number(measured.length)})</span>
              </h2>
              {networks.map((platform) => {
                const own = measured
                  .filter((row) => row.platform === platform)
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
                return (
                  <div key={platform} className="mt-6" data-network={platform}>
                    <h3 className="font-display text-lg font-semibold">{platformLabel(platform, lang)}</h3>
                    {own.length < MIN_TO_COMPARE && (
                      <p className="mt-1 text-sm text-amber-deep">
                        {t.resultsEarly
                          .replace("{platform}", platformLabel(platform, lang))
                          .replace("{count}", number(MIN_TO_COMPARE))}
                      </p>
                    )}
                    <div className="mt-3 space-y-3">
                      {own.map((row) => (
                        <article key={row.pieceId} data-measured={row.pieceId} className="rounded-xl bg-paper p-5">
                          <div className="flex items-start justify-between gap-3">
                            <PostHeading row={row} language={lang} t={t} />
                            {row.standing && <StandingBadge standing={row.standing} score={row.score} language={lang} t={t} />}
                          </div>
                          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                            {RESULT_METRICS[row.platform].map((metric) => (
                              <div key={metric}>
                                <dt className="label">{metricLabel(t, row.platform, metric)}</dt>
                                <dd className="font-[family-name:var(--font-jetbrains)] text-lg">
                                  {row.numbers?.[metric] === undefined ? "–" : number(row.numbers[metric]!)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {row.checkedAt && (
                            <p className="label mt-2">
                              {checkedText(row, t, number)}
                              {row.note && <> · {row.note}</>}
                            </p>
                          )}
                          <details className="mt-3">
                            <summary className="cursor-pointer text-sm font-medium text-cobalt">{t.resultsUpdate}</summary>
                            <ResultsForm row={row} t={t} />
                          </details>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </>
  );
}

function checkedText(row: RankedRow, t: Strings, number: (value: number) => string) {
  if (!row.checkedAt || !row.postedAt) return "";
  const days = Math.floor((row.checkedAt.getTime() - row.postedAt.getTime()) / DAY);
  return days < 1 ? t.resultsCheckedToday : t.resultsChecked.replace("{days}", number(days));
}

function PostHeading({ row, language, t }: { row: RankedRow; language: Language; t: Strings }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="label">
        {platformLabel(row.platform, language)} · {languageName(row.language, language)}
      </p>
      {/* The post can be in the other language, so it keeps its own direction. */}
      <h3 className="mt-1 font-semibold" lang={row.language} dir={textDirection(row.language)}>
        {row.ideaTitle}
      </h3>
      <p className="mt-1 text-sm text-ink-soft" lang={row.language} dir={textDirection(row.language)}>
        {row.opening}
      </p>
      {row.url && /^https?:\/\//i.test(row.url) && (
        <a href={row.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-cobalt underline underline-offset-2">
          {t.resultsOpen}
        </a>
      )}
    </div>
  );
}

function ResultsForm({ row, t }: { row: RankedRow; t: Strings }) {
  return (
    <ActionForm action={saveResultsAction} className="mt-4 space-y-3">
      <input type="hidden" name="pieceId" value={row.pieceId} />
      <p className="text-sm text-ink-soft">{t.resultsHowTo}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {RESULT_METRICS[row.platform].map((metric) => (
          <label key={metric} className="block">
            <span className="label mb-1 block">{metricLabel(t, row.platform, metric)}</span>
            <input
              name={metric}
              inputMode="numeric"
              dir="ltr"
              required={metric === "views"}
              defaultValue={row.numbers?.[metric] ?? ""}
              className="field font-[family-name:var(--font-jetbrains)]"
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="label mb-1 block">{t.resultsNote}</span>
        <input name="note" maxLength={500} defaultValue={row.note} dir="auto" className="field" placeholder={t.resultsNotePlaceholder} />
      </label>
      <SubmitButton pendingLabel={t.resultsSaving} className="btn-primary">
        {row.numbers ? t.resultsUpdate : t.resultsSave}
      </SubmitButton>
    </ActionForm>
  );
}

const BADGE: Record<Standing, string> = {
  strong: "bg-navy text-ink",
  average: "bg-mist text-ink-soft",
  weak: "border border-amber text-amber-deep",
  early: "bg-mist text-ink-soft",
};

function StandingBadge({ standing, score, language, t }: { standing: Standing; score: number | null; language: Language; t: Strings }) {
  return (
    <span data-standing={standing} className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${BADGE[standing]}`}>
      {t.standing[standing]}
      {score !== null && <span className="ms-2 font-normal">{t.resultsScore.replace("{score}", formatNumber(language)(score, 1))}</span>}
    </span>
  );
}

/** A score drawn against a mark for a typical post, so above and below typical read at a glance. */
function ScoreBar({ score }: { score: number }) {
  const max = 3;
  const width = Math.min(score, max) / max;
  return (
    <div className="relative mt-1 h-2 rounded-full bg-mist" aria-hidden>
      <div className={`h-2 rounded-full ${score >= 1 ? "bg-cobalt" : "bg-amber"}`} style={{ width: `${width * 100}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ insetInlineStart: `${100 / max}%` }} />
    </div>
  );
}

const MIN_COMPARED_FOR_PATTERNS = 5;

function Insights({ rows, lang, t }: { rows: RankedRow[]; lang: Language; t: Strings }) {
  const r = t.resultsSync;
  const number = formatNumber(lang);
  const week = weeklySummary(rows);
  const compared = rows.filter((row) => row.score !== null);
  const patterns = patternsOf(compared);
  const topics = bestAndWorst(patterns.topics, 2);
  const channels = bestAndWorst(patterns.channels, 2);
  const days = bestAndWorst(patterns.weekdays, 2);
  const weekday = (day: number) =>
    new Intl.DateTimeFormat(lang === "fa" ? `${uiLocale(lang)}-u-ca-gregory` : uiLocale(lang), { weekday: "long" }).format(new Date(2024, 0, 7 + day));
  const avg = (group: Group<unknown>) => r.avg.replace("{score}", number(group.score, 1)).replace("{posts}", number(group.posts));
  const lines: { label: string; value: string; group: Group<unknown> }[] = [];
  if (topics) {
    lines.push({ label: r.bestTopic, value: topics.best.key, group: topics.best });
    if (topics.worst) lines.push({ label: r.weakTopic, value: topics.worst.key, group: topics.worst });
  }
  if (channels?.worst) {
    lines.push({ label: r.bestChannel, value: platformLabel(channels.best.key, lang), group: channels.best });
    lines.push({ label: r.weakChannel, value: platformLabel(channels.worst.key, lang), group: channels.worst });
  }
  if (days?.worst) {
    lines.push({ label: r.bestDay, value: weekday(days.best.key), group: days.best });
    lines.push({ label: r.weakDay, value: weekday(days.worst.key), group: days.worst });
  }
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl bg-paper p-5" aria-labelledby="week" data-week>
        <h2 id="week" className="font-display text-xl font-semibold">
          {r.weekTitle}
        </h2>
        {week.posted === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{r.weekNone}</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {r.weekPosted.replace("{posted}", number(week.posted)).replace("{measured}", number(week.measured)).replace("{views}", number(week.views))}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {week.best && (
                <div>
                  <dt className="label">{r.weekBest}</dt>
                  <dd dir={textDirection(week.best.language)}>{week.best.ideaTitle}</dd>
                </div>
              )}
              {week.weakest && (
                <div>
                  <dt className="label">{r.weekWeakest}</dt>
                  <dd dir={textDirection(week.weakest.language)}>{week.weakest.ideaTitle}</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </section>
      <section className="rounded-xl bg-paper p-5" aria-labelledby="patterns" data-patterns>
        <h2 id="patterns" className="font-display text-xl font-semibold">
          {r.patternsTitle}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{r.patternsHint}</p>
        {compared.length < MIN_COMPARED_FOR_PATTERNS || lines.length === 0 ? (
          <p className="mt-3 text-sm text-amber-deep">{r.patternsNeed}</p>
        ) : (
          <dl className="mt-3 space-y-2 text-sm">
            {lines.map((line) => (
              <div key={line.label}>
                <dt className="label">{line.label}</dt>
                <dd>
                  <bdi>{line.value}</bdi> <span className="text-ink-soft">· {avg(line.group)}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

/** Where numbers come from without typing: Instagram's own report, and LinkedIn's exported file. */
function Sources({ rows, lang, t }: { rows: RankedRow[]; lang: Language; t: Strings }) {
  const r = t.resultsSync;
  const hasInstagram = rows.some((row) => row.platform === "instagram");
  const hasLinkedIn = rows.some((row) => row.platform === "linkedin" || row.platform === "linkedin_video");
  if (!hasInstagram && !hasLinkedIn) return null;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {hasInstagram && (
        <section className="rounded-xl border border-mist p-5" data-sync="instagram">
          <h2 className="font-semibold">{r.instagramTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{r.instagramHint}</p>
          {process.env.INSTAGRAM_ACCESS_TOKEN ? (
            <ActionForm action={syncInstagramAction} className="mt-3">
              <input type="hidden" name="ui" value={lang} />
              <SubmitButton pendingLabel={r.instagramReading}>{r.instagramButton}</SubmitButton>
            </ActionForm>
          ) : (
            <p className="mt-3 text-sm text-amber-deep">{r.instagramNoToken}</p>
          )}
        </section>
      )}
      {hasLinkedIn && (
        <section className="rounded-xl border border-mist p-5" data-sync="linkedin">
          <h2 className="font-semibold">{r.linkedinTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{r.linkedinHint}</p>
          <ActionForm action={importLinkedInAction} resetOnSuccess className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="ui" value={lang} />
            <input type="file" name="file" required accept=".xlsx,.csv,text/csv" aria-label={r.linkedinFile} className="max-w-full text-sm" />
            <SubmitButton pendingLabel={r.linkedinImporting}>{r.linkedinButton}</SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
