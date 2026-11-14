import { getDb } from "@/lib/db/client";
import { STRINGS } from "@/lib/i18n";
import { isUiLanguage } from "@/lib/language";
import { filterFrom, reportCsv, reportRows } from "@/lib/report";

/** The published report as a CSV file, with the same filters as the page. */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const ui = isUiLanguage(params.ui ?? "") ? (params.ui as "en" | "fa") : "en";
  const filter = filterFrom(params);
  const rows = await reportRows(await getDb(), filter);
  const r = STRINGS[ui].report;
  const csv = reportCsv(
    rows,
    { date: r.date, channel: r.channel, language: r.language, topic: r.topic, idea: r.idea, summary: r.summary, link: r.post, sources: r.sources },
    ui,
  );
  const name = ["published", filter.from, filter.to].filter(Boolean).join("-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
