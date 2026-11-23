import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { ScoreBar, StandingBadge } from "@/components/results-parts";
import { formatNumber } from "@/components/team-parts";
import { loadWeek } from "@/lib/calendar";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, uiLocale, type UiLanguage } from "@/lib/language";
import { platformLabel } from "@/lib/platforms";
import type { RankedRow } from "@/lib/results";
import { readyPage } from "@/lib/view";
import { loadWeeklyReport, type Advice } from "@/lib/weekly";

export const dynamic = "force-dynamic";

/** How far back the report goes. */
const MAX_WEEKS_BACK = 52;

function dates(ui: UiLanguage) {
  // Farsi uses the Gregorian calendar here, as the calendar and the published report do.
  const locale = ui === "fa" ? `${uiLocale(ui)}-u-ca-gregory` : uiLocale(ui);
  return {
    short: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
    long: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    day: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short" }),
    weekday: (day: number) => new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(2024, 0, 7 + day)),
  };
}

/**
 * The weekly report: one week's posts, what worked against your usual, and what to make next week.
 * Plain code over your numbers and calendar; nothing here calls the AI.
 */
export default async function WeeklyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { lang: param } = await params;
  const { week: weekParam } = await searchParams;
  const { ui: lang, t, db, view, languages } = await readyPage(param);
  const w = t.weekly;
  const offset = Math.max(-MAX_WEEKS_BACK, Math.min(0, Math.round(Number(weekParam)) || 0));
  const firstDay = lang === "fa" ? 6 : 1;
  const { week, plan, advice, hasEarlier } = await loadWeeklyReport(db, {
    language: view,
    firstDay,
    offset,
    planFor: (weeks) => loadWeek(db, view, firstDay, weeks),
  });
  const number = formatNumber(lang);
  const date = dates(lang);
  const lastDay = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() - 1);
  const range = `${date.short.format(week.start)} – ${date.long.format(lastDay)}`;
  const weekHref = (to: number) => (to === 0 ? `/${lang}/results/week` : `/${lang}/results/week?week=${to}`);
  const byDay = new Map<string, RankedRow[]>();
  for (const row of week.posts) {
    const key = date.day.format(row.postedAt!);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  return (
    <>
      <Link href={`/${lang}/results`} className="text-sm font-medium text-cobalt hover:underline print:hidden">
        {lang === "fa" ? "→" : "←"} {w.back}
      </Link>
      <h1 className="mt-2 font-display text-4xl font-semibold leading-tight md:text-5xl">{w.title}</h1>
      <p className="mt-2 font-display text-xl" data-week-range>
        {range}
      </p>
      <p className="mt-3 max-w-2xl text-ink-soft print:hidden">{w.intro}</p>

      <nav className="mt-5 flex flex-wrap items-center gap-2 print:hidden" aria-label={w.title}>
        {hasEarlier && (
          <Link href={weekHref(offset - 1)} className="btn btn-quiet" data-week-earlier>
            {lang === "fa" ? "→" : "←"} {w.earlier}
          </Link>
        )}
        {offset < 0 && (
          <>
            <Link href={weekHref(offset + 1)} className="btn btn-quiet" data-week-later>
              {w.later} {lang === "fa" ? "←" : "→"}
            </Link>
            <Link href={weekHref(0)} className="btn btn-quiet">
              {w.thisWeek}
            </Link>
          </>
        )}
        <PrintButton label={w.print} />
      </nav>

      <section className="mt-8 rounded-xl bg-paper p-5" aria-label={w.title} data-week-totals>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          {[
            [w.posted, week.totals.posted],
            [w.channels, week.totals.channels],
            [w.measured, week.totals.measured],
            [w.views, week.totals.views],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="label">{label}</dt>
              <dd className="font-[family-name:var(--font-jetbrains)] text-2xl">{number(value as number)}</dd>
            </div>
          ))}
        </dl>
        {week.previous.posted > 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            {(week.previous.measured > 0 ? w.lastWeek : w.lastWeekNoNumbers)
              .replace("{posts}", (week.previous.posted === 1 ? t.resultsOnePost : t.resultsPosts).replace("{count}", number(week.previous.posted)))
              .replace("{views}", number(week.previous.views))}
          </p>
        )}
      </section>

      <section className="mt-10" aria-labelledby="went-out" data-went-out>
        <h2 id="went-out" className="font-display text-2xl font-semibold">
          {w.wentOut}
        </h2>
        {week.posts.length === 0 ? (
          <p className="mt-3 text-ink-soft">{w.wentOutNone}</p>
        ) : (
          <div className="mt-4 space-y-5">
            {[...byDay].map(([day, rows]) => (
              <div key={day}>
                <h3 className="label">{day}</h3>
                <ul className="mt-2 space-y-2">
                  {rows.map((row) => (
                    <li key={row.pieceId}>
                      <PostLine row={row} lang={lang} t={t} showLanguage={languages.length > 1} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {week.posts.length > 0 && (
        <section className="mt-10" aria-labelledby="worked" data-worked>
          <h2 id="worked" className="font-display text-2xl font-semibold">
            {w.worked}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{w.workedHint}</p>
          {week.worked.length === 0 && week.weak.length === 0 ? (
            <p className="mt-3 text-amber-deep">{w.workedNone}</p>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ul className="space-y-2">
                {week.worked.map((row) => (
                  <li key={row.pieceId} data-worked-post={row.pieceId}>
                    <PostLine row={row} lang={lang} t={t} showLanguage={languages.length > 1} />
                  </li>
                ))}
              </ul>
              {week.weak.length > 0 && (
                <div>
                  <h3 className="font-semibold">{w.weak}</h3>
                  <ul className="mt-2 space-y-2">
                    {week.weak.map((row) => (
                      <li key={row.pieceId} data-weak-post={row.pieceId}>
                        <PostLine row={row} lang={lang} t={t} showLanguage={languages.length > 1} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {(week.topics.length > 0 || week.hooks.some((tally) => tally.score !== null)) && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {week.topics.length > 0 && (
                <div data-week-topics>
                  <h3 className="font-semibold">{w.topics}</h3>
                  <ul className="mt-2 space-y-3">
                    {week.topics.map((topic) => (
                      <li key={topic.key}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <bdi className="font-medium">{topic.key}</bdi>
                          <span className="label">
                            {t.resultsScore.replace("{score}", number(topic.score, 1))} ·{" "}
                            {(topic.posts === 1 ? t.resultsOnePost : t.resultsPosts).replace("{count}", number(topic.posts))}
                          </span>
                        </div>
                        <ScoreBar score={topic.score} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {week.hooks.some((tally) => tally.score !== null) && (
                <div data-week-hooks>
                  <h3 className="font-semibold">{w.hooks}</h3>
                  <ul className="mt-2 space-y-3">
                    {week.hooks
                      .filter((tally) => tally.score !== null)
                      .map((tally) => (
                        <li key={tally.kind}>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">{t.hooks.kinds[tally.kind]}</span>
                            <span className="label">
                              {t.resultsScore.replace("{score}", number(tally.score!, 1))} · {t.hooks.live.replace("{n}", number(tally.live))}
                            </span>
                          </div>
                          <ScoreBar score={tally.score!} />
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mt-10 rounded-xl border border-cobalt p-5" aria-labelledby="next" data-next-week>
        <h2 id="next" className="font-display text-2xl font-semibold">
          {w.next}
        </h2>
        {plan ? (
          <p className="label mt-1">{w.nextOf.replace("{date}", date.long.format(plan.start))}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
            {w.nextPast}{" "}
            <Link href={weekHref(0)} className="text-cobalt underline underline-offset-2 print:hidden">
              {w.openThis}
            </Link>
          </p>
        )}
        {advice.length === 0 ? (
          <p className="mt-4">{w.nothing}</p>
        ) : (
          <ol className={`mt-4 space-y-3 ps-5 ${lang === "fa" ? "[list-style-type:persian]" : "list-decimal"}`}>
            {advice.map((item, index) => (
              <li key={`${item.kind}-${index}`} data-advice={item.kind}>
                <AdviceLine item={item} lang={lang} t={t} weekday={date.weekday} planWeeks={offset + 1} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function PostLine({ row, lang, t, showLanguage }: { row: RankedRow; lang: UiLanguage; t: Strings; showLanguage: boolean }) {
  const w = t.weekly;
  const number = formatNumber(lang);
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-paper p-4">
      <div className="min-w-0 flex-1">
        <p className="label">
          {platformLabel(row.platform, lang)}
          {showLanguage && <> · {languageName(row.language, lang)}</>}
          {row.hookKind && <> · {w.hook.replace("{kind}", t.hooks.kinds[row.hookKind])}</>}
        </p>
        <Link
          href={`/${lang}/ideas/${row.ideaId}/content#post-${row.platform}`}
          className="mt-1 block font-semibold hover:text-cobalt"
          lang={row.language}
          dir={textDirection(row.language)}
        >
          {row.ideaTitle}
        </Link>
        <p className="mt-1 text-sm text-ink-soft" lang={row.language} dir={textDirection(row.language)}>
          {row.opening}
        </p>
      </div>
      <div className="shrink-0 text-end">
        {row.numbers ? (
          <>
            {row.standing && <StandingBadge standing={row.standing} score={row.score} language={lang} t={t} />}
            <p className="label mt-1">{w.viewsShort.replace("{n}", number(row.numbers.views ?? 0))}</p>
          </>
        ) : (
          <Link href={`/${lang}/results#waiting`} className="text-sm text-amber-deep underline underline-offset-2">
            {w.noNumbers}
          </Link>
        )}
      </div>
    </div>
  );
}

function AdviceLine({
  item,
  lang,
  t,
  weekday,
  planWeeks,
}: {
  item: Advice;
  lang: UiLanguage;
  t: Strings;
  weekday: (day: number) => string;
  planWeeks: number;
}) {
  const w = t.weekly;
  const number = formatNumber(lang);
  const score = (value: number) => number(value, 1);
  const link = (href: string, label: string) => (
    <>
      {" "}
      <Link href={href} className="font-medium text-cobalt underline underline-offset-2 print:hidden">
        {label}
      </Link>
    </>
  );
  switch (item.kind) {
    case "followUp":
      return (
        <p>
          {w.followUp
            .replace("{title}", item.post.ideaTitle)
            .replace("{score}", score(item.post.score ?? 0))
            .replace("{channel}", platformLabel(item.post.platform, lang))}
          {link(`/${lang}/ideas/${item.post.ideaId}`, w.openIdea)}
        </p>
      );
    case "topic":
      return <p>{w.topic.replace("{topic}", item.topic).replace("{score}", score(item.score)).replace("{posts}", number(item.posts))}</p>;
    case "easeTopic":
      return <p>{w.easeTopic.replace("{topic}", item.topic).replace("{score}", score(item.score)).replace("{posts}", number(item.posts))}</p>;
    case "hook":
      return (
        <p>
          {w.hookAdvice.replace("{hook}", t.hooks.kinds[item.hook]).replace("{score}", score(item.score)).replace("{posts}", number(item.posts))}
        </p>
      );
    case "day":
      return <p>{w.day.replace("{day}", weekday(item.day)).replace("{score}", score(item.score))}</p>;
    case "channel":
      return <p>{w.channel.replace("{channel}", platformLabel(item.platform, lang)).replace("{score}", score(item.score))}</p>;
    case "schedule":
      return (
        <p>
          {item.count === 1 ? w.scheduleOne : w.schedule.replace("{count}", number(item.count))}
          {link(`/${lang}/calendar${planWeeks > 0 ? `?week=${planWeeks}` : ""}`, w.openCalendar)}
        </p>
      );
    case "fill":
      return (
        <div>
          <p>
            {w.fill.replace(
              "{slots}",
              item.empty.map((entry) => `${platformLabel(entry.platform, lang)} × ${number(entry.count)}`).join(lang === "fa" ? "، " : ", "),
            )}
          </p>
          {item.ideas.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-ink-soft">{w.fillIdeas}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {item.ideas.map((idea) => (
                  <li key={idea.id}>
                    <Link href={`/${lang}/ideas/${idea.id}`} className="text-cobalt underline-offset-2 hover:underline" dir={textDirection(idea.language)}>
                      {idea.title}
                    </Link>{" "}
                    <span className="label">
                      · <bdi>{idea.pillar}</bdi>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">
              {w.fillNoIdeas}
              {link(`/${lang}`, w.findIdeas)}
            </p>
          )}
        </div>
      );
    case "numbers":
      return (
        <p>
          {item.count === 1 ? w.numbersOne : w.numbers.replace("{count}", number(item.count))}
          {link(`/${lang}/results#waiting`, w.addNumbers)}
        </p>
      );
    case "needData":
      return <p className="text-ink-soft">{w.needData}</p>;
  }
}
