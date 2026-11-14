import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import type { CSSProperties } from "react";
import { IdeaRow, ProposedIdeaCard } from "@/components/idea-card";
import { ScoutProgress } from "@/components/scout-progress";
import { StudioMap } from "@/components/studio-map";
import { scoutProgressText } from "@/lib/i18n";
import { currentScoutJob } from "@/lib/scout-job";
import { AGENTS } from "@/lib/agents/roster";
import { latestVerdicts } from "@/lib/agents/team";
import type { Db } from "@/lib/db/client";
import { ideas } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, type Language, type UiLanguage } from "@/lib/language";
import { loadMap, WRITERS, type MapData, type MapNodeId, type MapPiece, type MapScenario } from "@/lib/map";
import { platformLabel } from "@/lib/platforms";
import { closestPublished, ideaTopic, publishedIdeas } from "@/lib/duplicate";
import { upcomingPosts } from "@/lib/schedule";
import { scheduleLabel } from "@/lib/schedule-time";
import { readyPage } from "@/lib/view";
import { Stepper } from "@/components/stepper";
import { studioProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

/** The order steps are offered in when nothing is chosen: the first one waiting for you. */
const LINE: MapNodeId[] = ["scout", "storyteller", ...WRITERS, "editor", "live"];
const ALL: MapNodeId[] = [...LINE, "manager", "coach"];

const HUES: Partial<Record<MapNodeId, string>> = {
  scout: "#4fd1a5",
  storyteller: "#e59cff",
  telegram: "#6cb6ff",
  linkedin: "#9cb2ff",
  carousel: "#ba9cff",
  blogger: "#c9b8ff",
  scriptwriter: "#9382ff",
  editor: "#7d62ff",
  manager: "#9382ff",
  coach: "#5046e4",
  live: "#f4f0ff",
};

export default async function StudioMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const { lang: param } = await params;
  const { agent } = await searchParams;
  const { ui: lang, t, db, view, languages } = await readyPage(param);
  const [map, steps] = await Promise.all([loadMap(db, languages, view), studioProgress(db, lang, view)]);
  const available = ALL;
  const chosen: MapNodeId =
    agent && (available as string[]).includes(agent)
      ? (agent as MapNodeId)
      : (LINE.find((id) => available.includes(id) && map.state[id].status === "waiting") ?? "scout");
  const hrefs = Object.fromEntries(available.map((id) => [id, `/${lang}/map?agent=${id}`]));

  const missingKeys = [
    ...(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY ? [] : ["GEMINI_API_KEY"]),
    ...(process.env.TAVILY_API_KEY ? [] : ["TAVILY_API_KEY"]),
  ];

  return (
    <>
      <Stepper steps={steps} t={t} />
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.mapTitle}</h1>
      <p className="mt-3 text-ink-soft">
        <Link href={`/${lang}`} className="text-cobalt underline underline-offset-2">
          {t.mapAskAgain}
        </Link>
        {" · "}
        <Link href={`/${lang}/guide`} className="text-cobalt underline underline-offset-2">
          {t.guideLink}
        </Link>
      </p>

      {missingKeys.length > 0 && (
        <div role="status" className="mt-6 rounded-lg border-s-4 border-amber bg-paper p-4 text-sm">
          <p className="font-semibold">{t.setupTitle}</p>
          <p dir="ltr" className="mt-1 text-start font-[family-name:var(--font-jetbrains)]">
            {missingKeys.join(", ")}
          </p>
        </div>
      )}

      <div className="map-wide mt-8">
        <StudioMap state={map.state} ui={lang} t={t} hrefs={hrefs} selected={[chosen]} label={t.mapLabel} />
      </div>

      <section id="agent-card" aria-labelledby="agent-card-title" className="scroll-mt-24">
        <AgentCardHead id={chosen} ui={lang} t={t} />
        <div className="mt-6">
          <AgentWork id={chosen} map={map} db={db} ui={lang} view={view} t={t} />
        </div>
      </section>
    </>
  );
}

function AgentCardHead({ id, ui, t }: { id: MapNodeId; ui: UiLanguage; t: Strings }) {
  const name = id === "live" ? t.mapLive : AGENTS[id].name[ui];
  const job = id === "live" ? t.mapLiveJob : AGENTS[id].job[ui];
  return (
    <div className="agent-card-head rounded-xl bg-paper p-5 md:p-6">
      <span className="map-orb" style={{ "--hue": HUES[id] } as CSSProperties} aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="agent-card-title" className="font-display text-2xl font-semibold">
          {name}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{job}</p>
      </div>
    </div>
  );
}

async function AgentWork({
  id,
  map,
  db,
  ui,
  view,
  t,
}: {
  id: MapNodeId;
  map: MapData;
  db: Db;
  ui: UiLanguage;
  view: Language;
  t: Strings;
}) {
  if (id === "scout") {
    return (
      <>
        <ScoutProgress initial={currentScoutJob()} text={scoutProgressText(t)} />
        <ScoutWork db={db} ui={ui} view={view} t={t} />
      </>
    );
  }
  if (id === "storyteller") return <ScenarioList rows={[...map.main, ...map.second]} ui={ui} t={t} />;
  if (id === "manager" || id === "coach") {
    return (
      <p className="text-ink-soft">
        {t.mapSupportJob}{" "}
        <Link href={`/${ui}/team`} className="text-cobalt underline underline-offset-2">
          {t.navTeam}
        </Link>
      </p>
    );
  }
  if (id === "live") return <LiveWork map={map} db={db} ui={ui} t={t} />;
  const own = map.pieces.filter((piece) => (id === "editor" ? piece.video !== null && piece.video !== "none" : piece.agent === id));
  return <PieceList rows={own} ui={ui} t={t} withVideo={id === "editor" || id === "scriptwriter"} />;
}

/** The idea scout's card: ask for new ideas, then approve the one worth making. */
async function ScoutWork({ db, ui, view, t }: { db: Db; ui: UiLanguage; view: Language; t: Strings }) {
  const rows = await db.select().from(ideas).where(eq(ideas.language, view)).orderBy(desc(ideas.createdAt));
  // A new idea can build on a past one that did well once live; show which, in this language.
  const titleByPair = new Map(rows.map((idea) => [idea.pairId, idea.title]));
  const proposed = rows.filter((idea) => idea.status === "proposed");
  const approved = rows.filter((idea) => idea.status === "approved");
  const rejected = rows.filter((idea) => idea.status === "rejected");
  const verdicts = await latestVerdicts(db, proposed.map((idea) => idea.pairId));
  const published = proposed.length ? await publishedIdeas(db, view) : [];
  return (
    <>
      <h3 className="font-display text-xl font-semibold">
        {t.waiting} <span className="label">({proposed.length})</span>
      </h3>
      {proposed.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t.noIdeas}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {proposed.map((idea) => (
            <ProposedIdeaCard
              key={idea.id}
              idea={{ ...idea, buildsOnTitle: idea.buildsOn ? titleByPair.get(idea.buildsOn) : null }}
              ui={ui}
              language={view}
              verdict={verdicts.get(idea.pairId)}
              repeats={closestPublished(ideaTopic(idea), published)}
              t={t}
            />
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <section className="mt-10">
          <h3 className="font-display text-xl font-semibold">
            {t.approvedIdeas} <span className="label">({approved.length})</span>
          </h3>
          <p className="mt-1 text-sm text-ink-soft">{t.approvedIdeasHint}</p>
          <div className="mt-2">
            {approved.map((idea) => (
              <IdeaRow key={idea.id} href={`/${ui}/ideas/${idea.id}`} title={idea.title} status={t.inProgress} />
            ))}
          </div>
        </section>
      )}

      {rejected.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer font-display text-lg font-semibold">
            {t.rejected} <span className="label">({rejected.length})</span>
          </summary>
          <div className="mt-2">
            {rejected.map((idea) => (
              <IdeaRow key={idea.id} title={idea.title} status={t.rejected} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ScenarioList({ rows, ui, t }: { rows: MapScenario[]; ui: UiLanguage; t: Strings }) {
  if (rows.length === 0) return <p className="text-ink-soft">{t.mapEmpty}</p>;
  const label = { none: t.noScenarioYet, review: t.scenarioInReview, approved: t.scenarioApproved };
  return (
    <div>
      {rows.map(({ idea, state }) => (
        <IdeaRow
          key={idea.id}
          href={`/${ui}/ideas/${idea.id}`}
          title={idea.title}
          status={`${languageName(idea.language, ui)} · ${label[state]}`}
        />
      ))}
    </div>
  );
}

function PieceList({ rows, ui, t, withVideo }: { rows: MapPiece[]; ui: UiLanguage; t: Strings; withVideo: boolean }) {
  if (rows.length === 0) return <p className="text-ink-soft">{t.mapEmpty}</p>;
  const state = { draft: t.mapDraft, scheduled: t.mapScheduled, posted: t.mapPosted };
  const video = { none: t.mapVideoNone, working: t.mapVideoWorking, ready: t.mapVideoReady, failed: t.mapVideoFailed };
  return (
    <ul className="divide-y divide-mist">
      {rows.map((piece) => (
        <li key={piece.id}>
          <Link
            href={`/${ui}/ideas/${piece.idea.id}/content`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 hover:text-cobalt"
          >
            <span className="min-w-0">
              <span className="label block">
                {platformLabel(piece.platform, ui)} · {languageName(piece.idea.language, ui)}
              </span>
              <bdi className="font-medium" dir={textDirection(piece.idea.language)}>
                {piece.idea.title}
              </bdi>
            </span>
            <span className={`text-sm ${piece.state === "draft" ? "text-periwinkle" : "text-ink-soft"}`}>
              {state[piece.state]}
              {withVideo && piece.video && <> · {video[piece.video]}</>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function LiveWork({ map, db, ui, t }: { map: MapData; db: Db; ui: UiLanguage; t: Strings }) {
  const upcoming = await upcomingPosts(db);
  const posted = map.pieces.filter((piece) => piece.state === "posted");
  return (
    <>
      {upcoming.length > 0 && (
        <>
          <h3 className="font-display text-xl font-semibold">
            {t.comingUp} <span className="label">({upcoming.length})</span>
          </h3>
          <ul className="mt-3 mb-8 divide-y divide-mist">
            {upcoming.map((post) => {
              const trouble = post.changed || (post.status !== "waiting" && post.status !== "sending");
              return (
                <li key={post.pieceId} data-upcoming={post.status}>
                  <Link
                    href={`/${ui}/ideas/${post.ideaId}/content`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 hover:text-cobalt"
                  >
                    <span className="min-w-0">
                      <span className="label block">
                        {platformLabel(post.platform, ui)} · {languageName(post.language, ui)}
                      </span>
                      <bdi className="font-medium" dir={textDirection(post.language)}>
                        {post.title}
                      </bdi>
                    </span>
                    <span className={`text-sm ${trouble ? "font-semibold text-amber-deep" : "text-ink-soft"}`}>
                      {scheduleLabel(post.at, ui)}
                      {trouble && <> · {post.changed ? t.comingUpChanged : t.comingUpProblem}</>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h3 className="font-display text-xl font-semibold">
        {t.mapLiveNow} <span className="label">({posted.length})</span>
      </h3>
      <div className="mt-3">
        <PieceList rows={posted} ui={ui} t={t} withVideo={false} />
      </div>
    </>
  );
}

