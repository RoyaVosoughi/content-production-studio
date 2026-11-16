import type { ScoutLook } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type UiLanguage } from "@/lib/language";
import { scheduleLabel } from "@/lib/schedule-time";

/** Where the last idea search looked: the queries, your sites and feeds, and the links you shared. */
export function ScoutLookNote({ looked, at, ui, t }: { looked: ScoutLook; at: Date; ui: UiLanguage; t: Strings }) {
  const number = (value: number) => value.toLocaleString(uiLocale(ui));
  const list = (items: string[]) => (
    <ul dir="ltr" className="mt-1 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="rounded-md bg-mist px-2 py-0.5 text-xs">
          <bdi>{item}</bdi>
        </li>
      ))}
    </ul>
  );
  return (
    <details data-scout-look className="mt-4 rounded-lg bg-paper p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t.lookedTitle} · {scheduleLabel(at, ui)}
      </summary>
      <div className="mt-3 space-y-3">
        <p>
          {looked.onlyMine ? t.lookedOnlyMine : t.lookedWeb} {t.lookedResults.replace("{count}", number(looked.results))}
        </p>
        {looked.queries.length > 0 && (
          <div>
            <p className="label">{t.lookedQueries}</p>
            {list(looked.queries)}
          </div>
        )}
        {looked.domains.length > 0 && (
          <div>
            <p className="label">{t.lookedDomains}</p>
            {list(looked.domains)}
          </div>
        )}
        {looked.feeds.length > 0 && (
          <div>
            <p className="label">{t.lookedFeeds}</p>
            <ul className="mt-1 space-y-1">
              {looked.feeds.map((feed) => (
                <li key={feed.url} className="text-xs">
                  <bdi dir="ltr" className="font-[family-name:var(--font-jetbrains)]">
                    {feed.url}
                  </bdi>{" "}
                  <span className={feed.error ? "text-danger" : "text-ink-soft"}>
                    · {feed.error ? t.lookedFeedFailed.replace("{reason}", feed.error) : t.lookedFeedItems.replace("{count}", number(feed.items))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {looked.links.length > 0 && (
          <div>
            <p className="label">{t.lookedLinks}</p>
            {list(looked.links)}
          </div>
        )}
      </div>
    </details>
  );
}
