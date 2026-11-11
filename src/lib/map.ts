import { desc } from "drizzle-orm";
import { agentForPlatform, type AgentId } from "./agents/roster";
import type { Db } from "./db/client";
import { ideas, pieces, publications, scenarios, scheduledPosts, videoRenders } from "./db/schema";
import type { Language } from "./language";
import { isPlatform, isVideoPlatform, type Platform } from "./platforms";

/**
 * The studio map: every agent as one step of the production line, from the idea scout to
 * the post going live. Each step says whether it has work waiting for the owner, is done,
 * or has nothing yet.
 */
export type MapNodeId = AgentId | "live";
export type MapStatus = "idle" | "waiting" | "done";
export type MapNode = { status: MapStatus; count: number };
export type MapState = Record<MapNodeId, MapNode>;

export const WRITERS = ["telegram", "linkedin", "carousel", "blogger", "scriptwriter"] as const satisfies AgentId[];

export type MapIdea = { id: string; pairId: string; language: Language; title: string; status: string };
export type MapScenario = { idea: MapIdea; state: "none" | "review" | "approved" };
export type MapPiece = {
  id: string;
  idea: MapIdea;
  platform: Platform;
  agent: AgentId;
  state: "draft" | "scheduled" | "posted";
  video: "none" | "working" | "ready" | "failed" | null;
};

export type MapData = {
  state: MapState;
  /** True when the studio writes in two languages, so the language writer has a part. */
  twoLanguages: boolean;
  proposed: MapIdea[];
  main: MapScenario[];
  second: MapScenario[];
  pieces: MapPiece[];
};

/** Loads the whole line. Pass a pair id to see one idea's journey instead of everything. */
export async function loadMap(db: Db, languages: readonly Language[], view: Language, pairId?: string): Promise<MapData> {
  const [mainLanguage, secondLanguage] = languages;
  const allIdeas = (await db.select().from(ideas).orderBy(desc(ideas.createdAt))).filter(
    (idea) => !pairId || idea.pairId === pairId,
  ) as MapIdea[];
  const byId = new Map(allIdeas.map((idea) => [idea.id, idea]));
  const scenarioRows = await db.select().from(scenarios);
  const scenarioOf = (idea: MapIdea): MapScenario => {
    const row = scenarioRows.find((candidate) => candidate.ideaId === idea.id);
    const state = !row ? "none" : row.approvedVersion === row.currentVersion ? "approved" : "review";
    return { idea, state };
  };

  const approved = allIdeas.filter((idea) => idea.status === "approved");
  const main = approved.filter((idea) => idea.language === mainLanguage).map(scenarioOf);
  const second = secondLanguage ? approved.filter((idea) => idea.language === secondLanguage).map(scenarioOf) : [];
  // Ideas come in pairs; one card per pair is enough, in the language on screen.
  const proposed = allIdeas.filter((idea) => idea.status === "proposed" && idea.language === view);

  const posted = new Set(
    (await db.select().from(publications)).filter((row) => row.status === "posted").map((row) => row.pieceId),
  );
  const scheduled = new Set(
    (await db.select().from(scheduledPosts)).filter((row) => row.status === "waiting" || row.status === "sending").map((row) => row.pieceId),
  );
  const renders = await db.select().from(videoRenders);
  const pieceRows = (await db.select().from(pieces).orderBy(desc(pieces.createdAt))).filter(
    (piece) => byId.has(piece.ideaId) && isPlatform(piece.platform),
  );
  const mapPieces: MapPiece[] = pieceRows.map((piece) => {
    const platform = piece.platform as Platform;
    const render = renders.filter((row) => row.pieceId === piece.id);
    const video = !isVideoPlatform(platform)
      ? null
      : render.length === 0
        ? "none"
        : render.some((row) => row.status === "ready")
          ? "ready"
          : render.some((row) => row.status === "working")
            ? "working"
            : "failed";
    return {
      id: piece.id,
      idea: byId.get(piece.ideaId)!,
      platform,
      agent: agentForPlatform(platform),
      state: posted.has(piece.id) ? "posted" : scheduled.has(piece.id) ? "scheduled" : "draft",
      video,
    };
  });

  const step = (waiting: number, done: number): MapNode => ({
    status: waiting > 0 ? "waiting" : done > 0 ? "done" : "idle",
    count: waiting,
  });
  const scenarioStep = (list: MapScenario[]) =>
    step(
      list.filter((row) => row.state !== "approved").length,
      list.filter((row) => row.state === "approved").length,
    );
  const writerStep = (agent: AgentId) => {
    const own = mapPieces.filter((piece) => piece.agent === agent);
    return step(own.filter((piece) => piece.state === "draft").length, own.filter((piece) => piece.state !== "draft").length);
  };
  const videos = mapPieces.filter((piece) => piece.video !== null && piece.video !== "none");
  const live = mapPieces.filter((piece) => piece.state === "posted").length;

  const state: MapState = {
    scout: step(proposed.length, approved.length),
    storyteller: scenarioStep([...main, ...second]),
    telegram: writerStep("telegram"),
    linkedin: writerStep("linkedin"),
    carousel: writerStep("carousel"),
    blogger: writerStep("blogger"),
    scriptwriter: writerStep("scriptwriter"),
    editor: step(
      videos.filter((piece) => piece.state === "draft").length,
      videos.filter((piece) => piece.state !== "draft").length,
    ),
    // The manager and the coach work alongside every step rather than in the line.
    manager: { status: allIdeas.length > 0 ? "done" : "idle", count: 0 },
    coach: { status: allIdeas.length > 0 ? "done" : "idle", count: 0 },
    live: { status: live > 0 ? "done" : mapPieces.some((piece) => piece.state === "scheduled") ? "waiting" : "idle", count: live },
  };
  return { state, twoLanguages: Boolean(secondLanguage), proposed, main, second, pieces: mapPieces };
}
