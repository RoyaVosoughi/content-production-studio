import type { Db } from "@/lib/db/client";
import type { Strings } from "@/lib/i18n";
import type { Language, UiLanguage } from "@/lib/language";
import { loadMap, WRITERS, type MapNodeId } from "@/lib/map";
import { StudioMap } from "./studio-map";

/** One idea's journey through the team, shown at the top of its scenario and content pages. */
export async function IdeaMap({
  db,
  ui,
  t,
  languages,
  view,
  idea,
  here,
}: {
  db: Db;
  ui: UiLanguage;
  t: Strings;
  languages: readonly Language[];
  view: Language;
  idea: { id: string; pairId: string; language: Language };
  /** The same idea in the other language. Not used by the map any more; kept so callers need no change. */
  sibling?: { id: string; language: Language } | null;
  here: "scenario" | "content";
}) {
  const map = await loadMap(db, languages, view, idea.pairId);
  const content = `/${ui}/ideas/${idea.id}/content`;
  const hrefs: Partial<Record<MapNodeId, string>> = {
    scout: `/${ui}/map?agent=scout`,
    storyteller: `/${ui}/ideas/${idea.id}`,
    // Each writer jumps to its own post on the page, so it isn't lost below the others.
    ...Object.fromEntries(
      [...WRITERS, "editor", "live"].map((id) => {
        const own = map.pieces.find((piece) =>
          id === "editor" ? piece.video !== null && piece.idea.id === idea.id : piece.agent === id && piece.idea.id === idea.id,
        );
        return [id, own ? `${content}#post-${own.platform}` : content];
      }),
    ),
    manager: `/${ui}/team/manager`,
    coach: `/${ui}/team/coach`,
  };
  const selected: MapNodeId[] =
    here === "scenario"
      ? ["storyteller"]
      : [...WRITERS, "editor"];
  return (
    <div className="map-wide mt-4">
      <p className="label text-center">{t.mapIdeaHint}</p>
      <StudioMap state={map.state} ui={ui} t={t} hrefs={hrefs} selected={selected} label={t.mapLabel} />
    </div>
  );
}
