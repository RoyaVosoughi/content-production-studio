import Link from "next/link";
import { languageName, textDirection, uiLocale } from "@/lib/language";
import { platformLabel, PLATFORMS } from "@/lib/platforms";
import { filterFrom, filterQuery, reportPillars, reportRows } from "@/lib/report";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

/** Everything that was published, filtered by date, channel, topic and language, with a CSV download. */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang: param } = await params;
  const { ui: lang, t, db, languages } = await readyPage(param);
  const r = t.report;
  const filter = filterFrom(await searchParams);
  const [rows, everything, pillars] = await Promise.all([reportRows(db, filter), reportRows(db), reportPillars(db)]);
  const query = filterQuery(filter);
  const filtered = query !== "";
  // Farsi uses the Gregorian calendar here, so dates match the date boxes above.
  const date = new Intl.DateTimeFormat(lang === "fa" ? `${uiLocale(lang)}-u-ca-gregory` : uiLocale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const count = (rows.length === 1 ? r.one : r.count).replace("{count}", rows.length.toLocaleString(uiLocale(lang)));

  return (
    <>
      <Link href={`/${lang}/results`} className="text-sm font-medium text-cobalt hover:underline">
        {lang === "fa" ? "→" : "←"} {r.back}
      </Link>
      <h1 className="mt-2 font-display text-4xl font-semibold leading-tight md:text-5xl">{r.title}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{r.intro}</p>

      <form method="get" className="mt-8 grid gap-4 rounded-xl bg-paper p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]" data-report-filter>
        <label className="block">
          <span className="label mb-1 block">{r.from}</span>
          <input type="date" name="from" defaultValue={filter.from} className="field" dir="ltr" />
        </label>
        <label className="block">
          <span className="label mb-1 block">{r.to}</span>
          <input type="date" name="to" defaultValue={filter.to} className="field" dir="ltr" />
        </label>
        <label className="block">
          <span className="label mb-1 block">{r.channel}</span>
          <select name="platform" defaultValue={filter.platform ?? ""} className="field">
            <option value="">{r.all}</option>
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {platformLabel(platform, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">{r.topic}</span>
          <select name="pillar" defaultValue={filter.pillar ?? ""} className="field">
            <option value="">{r.all}</option>
            {pillars.map((pillar) => (
              <option key={pillar} value={pillar}>
                {pillar}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">{r.language}</span>
          <select name="language" defaultValue={filter.language ?? ""} className="field">
            <option value="">{r.all}</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {languageName(language, lang)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            {r.apply}
          </button>
          {filtered && (
            <Link href={`/${lang}/results/report`} className="btn btn-quiet">
              {r.clear}
            </Link>
          )}
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="label" data-report-count>
          {count}
        </p>
        {rows.length > 0 && (
          <a href={`/api/report?${new URLSearchParams([...new URLSearchParams(query), ["ui", lang]])}`} download className="btn btn-quiet">
            {r.download}
          </a>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl bg-paper p-5">{everything.length === 0 ? r.noneAtAll : r.none}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-mist">
          <table className="w-full min-w-[860px] text-start text-sm" data-report>
            <thead className="bg-paper">
              <tr>
                {[r.date, r.channel, r.topic, r.summary, r.post, r.sources].map((heading) => (
                  <th key={heading} scope="col" className="label px-4 py-3 text-start">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {rows.map((row) => (
                <tr key={row.pieceId} data-platform={row.platform} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3">{date.format(row.postedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {platformLabel(row.platform, lang)}
                    {languages.length > 1 && <span className="label block">{languageName(row.language, lang)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <bdi dir={textDirection(row.language)}>{row.pillar}</bdi>
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <p dir={textDirection(row.language)}>{row.summary}</p>
                    <Link
                      href={`/${lang}/ideas/${row.ideaId}/content#post-${row.platform}`}
                      className="label mt-1 block hover:text-cobalt hover:underline"
                    >
                      <bdi dir={textDirection(row.language)}>{row.ideaTitle}</bdi>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cobalt underline-offset-2 hover:underline">
                        {r.open} ↗
                      </a>
                    ) : (
                      <span className="text-ink-soft">{r.noLink}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.sources.length === 0 ? (
                      <span className="text-ink-soft">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {row.sources.map((source, index) => (
                          <li key={source.url}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={source.url}
                              className="text-cobalt underline-offset-2 hover:underline"
                            >
                              {source.title || r.source.replace("{n}", (index + 1).toLocaleString(uiLocale(lang)))}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
