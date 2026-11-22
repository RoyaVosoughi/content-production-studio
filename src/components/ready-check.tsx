"use client";

import type { IdeaSource, PieceContent } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type Language as ContentLanguage, type UiLanguage as Language } from "@/lib/language";
import type { Platform } from "@/lib/platforms";
import { citesSource, readyCheck, withSources, type CheckItem, type CheckLevel, type RecentPost } from "@/lib/quality";

const BADGE: Record<CheckLevel, string> = {
  pass: "bg-emerald-400 text-canvas",
  warn: "bg-amber text-canvas",
  fail: "bg-danger text-canvas",
};
const DOT: Record<CheckLevel, string> = { pass: "bg-emerald-400", warn: "bg-amber", fail: "bg-danger" };

function fill(template: string, values: Record<string, string | number> = {}, language: Language) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return typeof value === "number" ? value.toLocaleString(uiLocale(language)) : String(value ?? "");
  });
}

function itemText(item: CheckItem, t: Strings, language: Language): string {
  const r = t.readyCheck;
  const values = item.values ?? {};
  if (item.id === "rules") {
    if (item.level === "pass") return r.pass.rules;
    return values.problem === "placeholder" ? r.warn.placeholder : String(values.problem);
  }
  const key = item.id === "hook" ? (`hook${values.kind}` as "hookline" | "hooktitle") : item.id;
  if (item.level === "pass") return fill((r.pass as Record<string, string>)[key] ?? "", values, language);
  if (item.id === "numbers" && values.sources === 0) return r.warn.numbersNoSource;
  return fill((r.warn as Record<string, string>)[key] ?? "", values, language);
}

/** A green, amber or red summary of the post, with what to fix first. */
export function ReadyCheckPanel({
  platform,
  content,
  sources,
  recent,
  ownSite,
  language,
  t,
}: {
  platform: Platform;
  content: PieceContent;
  sources: IdeaSource[];
  recent: RecentPost[];
  ownSite?: string;
  language: Language;
  t: Strings;
}) {
  const check = readyCheck(platform, content, { sources, recent, ownSite });
  // Problems first, then advice, then what's already fine.
  const order: CheckLevel[] = ["fail", "warn", "pass"];
  const items = [...check.items].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return (
    <section aria-label={t.readyCheck.title} className="rounded-lg border border-mist bg-canvas p-4" data-ready-check={check.level}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold">{t.readyCheck.title}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE[check.level]}`}>{t.readyCheck.levels[check.level]}</span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{t.readyCheck.hint}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item.id} className={`flex items-start gap-2 ${item.level === "pass" ? "text-ink-soft" : ""}`} data-check={item.id} data-level={item.level}>
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[item.level]}`} />
            <bdi>{itemText(item, t, language)}</bdi>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The idea's news sources, and a button that writes them into the post. */
export function SourcesBox({
  platform,
  body,
  sources,
  contentLanguage,
  onChange,
  t,
}: {
  platform: Platform;
  body: string;
  sources: IdeaSource[];
  contentLanguage: ContentLanguage;
  onChange: (body: string) => void;
  t: Strings;
}) {
  const missing = sources.filter((source) => !citesSource(body, [source]));
  return (
    <section aria-label={t.postSourcesTitle} className="rounded-lg border border-mist bg-canvas p-4" data-sources>
      <h3 className="font-display text-lg font-semibold">{t.postSourcesTitle}</h3>
      {sources.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">{t.postSourcesNone}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-soft">{t.postSourcesHint}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {sources.map((source) => (
              <li key={source.url} className="flex items-start gap-2">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${citesSource(body, [source]) ? "bg-emerald-400" : "bg-steel"}`} />
                <a href={source.url} target="_blank" rel="noreferrer" dir="auto" className="min-w-0 break-words text-cobalt underline-offset-2 hover:underline">
                  {source.title || source.url}
                </a>
                {source.publishedDate && (
                  <span className="shrink-0 text-xs text-ink-soft" dir="ltr">
                    {source.publishedDate.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <button
              type="button"
              className="btn btn-quiet mt-3 text-sm"
              onClick={() => onChange(withSources(platform, body, sources, contentLanguage))}
            >
              {t.postSourcesAdd}
            </button>
          ) : (
            <p className="mt-2 text-xs font-semibold text-emerald-300">{t.postSourcesAllIn}</p>
          )}
        </>
      )}
    </section>
  );
}
