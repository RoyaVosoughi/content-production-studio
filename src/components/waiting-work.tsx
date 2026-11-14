import Link from "next/link";
import type { Db } from "@/lib/db/client";
import type { Strings } from "@/lib/i18n";
import { textDirection, uiLocale, type Language, type UiLanguage } from "@/lib/language";
import { loadMap } from "@/lib/map";
import { platformLabel } from "@/lib/platforms";

/**
 * Everything you started and haven't finished, on the first page: ideas to decide on, scenarios to
 * approve, and posts written but not live yet, each a link straight to where you pick it up.
 */
export async function WaitingWork({
  db,
  languages,
  view,
  ui,
  t,
}: {
  db: Db;
  languages: readonly Language[];
  view: Language;
  ui: UiLanguage;
  t: Strings;
}) {
  const map = await loadMap(db, languages, view);
  const scenarios = [...map.main, ...map.second].filter((row) => row.idea.language === view && row.state === "review");
  const posts = map.pieces.filter((piece) => piece.idea.language === view && piece.state !== "posted");
  const byIdea = new Map<string, { idea: (typeof posts)[number]["idea"]; posts: typeof posts }>();
  for (const piece of posts) {
    const entry = byIdea.get(piece.idea.id) ?? { idea: piece.idea, posts: [] };
    entry.posts.push(piece);
    byIdea.set(piece.idea.id, entry);
  }
  const ideasWaiting = map.proposed.length;
  if (ideasWaiting === 0 && scenarios.length === 0 && byIdea.size === 0) return null;
  const number = (value: number) => value.toLocaleString(uiLocale(ui));

  return (
    <section className="mt-10" aria-labelledby="waiting-title" data-waiting-work>
      <h2 id="waiting-title" className="font-display text-2xl font-semibold">
        {t.waitingWork.title}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{t.waitingWork.hint}</p>
      <div className="mt-4 space-y-3">
        {byIdea.size > 0 && (
          <div className="rounded-xl bg-paper p-4 md:p-5">
            <h3 className="label">{t.waitingWork.posts.replace("{count}", number(posts.length))}</h3>
            <ul className="mt-2 divide-y divide-mist">
              {[...byIdea.values()].map(({ idea, posts: own }) => (
                <li key={idea.id} className="py-3">
                  <Link href={`/${ui}/ideas/${idea.id}/content`} className="font-medium hover:text-cobalt">
                    <bdi dir={textDirection(idea.language)}>{idea.title}</bdi>
                  </Link>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {own.map((piece) => (
                      <Link
                        key={piece.id}
                        href={`/${ui}/ideas/${idea.id}/content#post-${piece.platform}`}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${piece.state === "scheduled" ? "bg-amber/20 text-amber-deep" : "bg-cobalt/20 text-periwinkle"} hover:underline`}
                      >
                        {platformLabel(piece.platform, ui)}
                        {piece.state === "scheduled" && ` · ${t.mapScheduled}`}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {scenarios.length > 0 && (
          <div className="rounded-xl bg-paper p-4 md:p-5">
            <h3 className="label">{t.waitingWork.scenarios.replace("{count}", number(scenarios.length))}</h3>
            <ul className="mt-2 divide-y divide-mist">
              {scenarios.map(({ idea }) => (
                <li key={idea.id} className="py-2">
                  <Link href={`/${ui}/ideas/${idea.id}`} className="font-medium hover:text-cobalt">
                    <bdi dir={textDirection(idea.language)}>{idea.title}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {ideasWaiting > 0 && (
          <Link href={`/${ui}/map?agent=scout#agent-card`} className="block rounded-xl bg-paper p-4 font-medium hover:text-cobalt md:p-5">
            {t.waitingWork.ideas.replace("{count}", number(ideasWaiting))}
          </Link>
        )}
      </div>
    </section>
  );
}
