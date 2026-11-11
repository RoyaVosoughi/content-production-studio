import { and, eq } from "drizzle-orm";
import { agentForPlatform } from "./agents/roster";
import { recordSignal } from "./agents/team";
import type { Db } from "./db/client";
import { ideas, pieces, pieceVersions, postResults, publications, type ResultNumbers } from "./db/schema";
import { StudioError } from "./errors";
import { isContentLanguage, languageInfo, type Language } from "./language";
import { isPlatform, PLATFORM_NAMES, RESULT_METRICS, type Metric, type Platform } from "./platforms";

// You read each live post's numbers off the network and types them in. Every post is compared
// only with your other posts on the same network, because a Telegram view and a YouTube view
// aren't worth the same. The idea scout and the writers then learn from what did well.

/** A network needs this many posts with numbers before any of them can be called strong or weak. */
export const MIN_TO_COMPARE = 3;
const STRONG = 1.3;
const WEAK = 0.7;
const MAX_NUMBER = 1_000_000_000;
const NOTE_LENGTH = 500;

/** What each kind of response is worth: sharing or following says more than a like. */
const WEIGHTS: Record<Metric, number> = { views: 0, likes: 1, comments: 2, shares: 3, saves: 3, follows: 5 };
export const METRICS = Object.keys(WEIGHTS) as Metric[];

export type Standing = "strong" | "average" | "weak" | "early";

/** Responses per view, weighted. Null when there are no views, or the network shows only views. */
export function responseRate(platform: Platform, numbers: ResultNumbers): number | null {
  const views = numbers.views ?? 0;
  const kinds = RESULT_METRICS[platform].filter((metric) => metric !== "views");
  if (views <= 0 || kinds.length === 0) return null;
  return kinds.reduce((sum, metric) => sum + (numbers[metric] ?? 0) * WEIGHTS[metric], 0) / views;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Scores each post against the middle of your posts on the same network: how many people saw it,
 * and how many of them responded. 1 is a typical post for you; 2 did twice as well.
 */
export function rankResults<T extends { platform: Platform; numbers: ResultNumbers }>(
  rows: T[],
): (T & { score: number | null; standing: Standing })[] {
  const groups = new Map<Platform, T[]>();
  for (const row of rows) groups.set(row.platform, [...(groups.get(row.platform) ?? []), row]);
  const scores = new Map<T, number | null>();
  for (const [platform, group] of groups) {
    if (group.length < MIN_TO_COMPARE) {
      for (const row of group) scores.set(row, null);
      continue;
    }
    const typicalViews = median(group.map((row) => row.numbers.views ?? 0));
    const rates = group.map((row) => responseRate(platform, row.numbers));
    const typicalRate = median(rates.filter((rate): rate is number => rate !== null));
    group.forEach((row, index) => {
      if (!typicalViews) return scores.set(row, null);
      const reach = (row.numbers.views ?? 0) / typicalViews;
      const rate = rates[index];
      // Seen by many but ignored, or loved by the few who saw it, both land near typical.
      scores.set(row, typicalRate && rate !== null ? Math.sqrt(reach * (rate / typicalRate)) : reach);
    });
  }
  return rows.map((row) => {
    const score = scores.get(row) ?? null;
    const standing: Standing = score === null ? "early" : score >= STRONG ? "strong" : score <= WEAK ? "weak" : "average";
    return { ...row, score, standing };
  });
}

export type PostedRow = {
  pieceId: string;
  platform: Platform;
  language: Language;
  ideaId: string;
  pairId: string;
  ideaTitle: string;
  pillar: string;
  /** The post's own title, or the start of its text. */
  opening: string;
  url: string | null;
  postedAt: Date | null;
  numbers: ResultNumbers | null;
  note: string;
  checkedAt: Date | null;
};

function openingOf(content: { title?: string; body: string }): string {
  const text = (content.title || content.body).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/** Every post that is live, in both languages, newest first, with its numbers if you added them. */
export async function postedPieces(db: Db): Promise<PostedRow[]> {
  const rows = await db
    .select({ piece: pieces, publication: publications, idea: ideas, version: pieceVersions, result: postResults })
    .from(publications)
    .innerJoin(pieces, eq(pieces.id, publications.pieceId))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, publications.version)))
    .leftJoin(postResults, eq(postResults.pieceId, pieces.id))
    .where(eq(publications.status, "posted"));
  return rows
    .flatMap(({ piece, publication, idea, version, result }): PostedRow[] => {
      if (!isPlatform(piece.platform) || !isContentLanguage(idea.language)) return [];
      return [
        {
          pieceId: piece.id,
          platform: piece.platform,
          language: idea.language,
          ideaId: idea.id,
          pairId: idea.pairId,
          ideaTitle: idea.title,
          pillar: idea.pillar,
          opening: openingOf(version.content),
          url: publication.url,
          postedAt: publication.postedAt,
          numbers: result?.numbers ?? null,
          note: result?.note ?? "",
          checkedAt: result?.checkedAt ?? null,
        },
      ];
    })
    .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
}

export type RankedRow = PostedRow & { score: number | null; standing: Standing | null };

/** Live posts with their standing. A post without numbers has no standing yet. */
export async function resultsOverview(db: Db): Promise<RankedRow[]> {
  const posted = await postedPieces(db);
  const measured = rankResults(
    posted.flatMap((row) => (row.numbers ? [{ ...row, numbers: row.numbers }] : [])),
  );
  const byPiece = new Map(measured.map((row) => [row.pieceId, row]));
  return posted.map((row) => byPiece.get(row.pieceId) ?? { ...row, score: null, standing: null });
}

/** Average score per content pillar, across networks, for pillars with compared posts. */
export function pillarSummary(rows: RankedRow[]): { pillar: string; score: number; posts: number }[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (row.score === null) continue;
    groups.set(row.pillar, [...(groups.get(row.pillar) ?? []), row.score]);
  }
  return [...groups]
    .map(([pillar, scores]) => ({ pillar, score: scores.reduce((a, b) => a + b, 0) / scores.length, posts: scores.length }))
    .sort((a, b) => b.score - a.score);
}

export function parseNumbers(platform: Platform, raw: Partial<Record<Metric, string>>): ResultNumbers {
  const numbers: ResultNumbers = {};
  for (const metric of RESULT_METRICS[platform]) {
    const text = (raw[metric] ?? "").replace(/[,\s٬]/g, "").replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
    if (!text) continue;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > MAX_NUMBER) {
      throw new StudioError("Use whole numbers, such as 1250.");
    }
    numbers[metric] = value;
  }
  if (numbers.views === undefined) throw new StudioError("Add the views first. The other numbers are compared against them.");
  return numbers;
}

/**
 * Saves the numbers you read off a live post. When the post now clearly stands out against your
 * others on that network, its writer and the idea scout hear about it, so the coach can learn.
 */
export async function saveResults(db: Db, pieceId: string, raw: Partial<Record<Metric, string>>, note: string) {
  if (note.length > NOTE_LENGTH) throw new StudioError("Please shorten your note.");
  const posted = await postedPieces(db);
  const row = posted.find((entry) => entry.pieceId === pieceId);
  if (!row) throw new StudioError("Only a live post can have results. Post it first.");
  const numbers = parseNumbers(row.platform, raw);
  const values = { numbers, note: note.trim(), checkedAt: new Date() };
  await db
    .insert(postResults)
    .values({ pieceId, ...values })
    .onConflictDoUpdate({ target: postResults.pieceId, set: values });

  const ranked = await resultsOverview(db);
  const mine = ranked.find((entry) => entry.pieceId === pieceId);
  if (!mine || (mine.standing !== "strong" && mine.standing !== "weak")) return mine?.standing ?? null;
  const network = PLATFORM_NAMES[row.platform];
  const shown = RESULT_METRICS[row.platform].map((metric) => `${numbers[metric] ?? 0} ${metric}`).join(", ");
  const how = mine.standing === "strong" ? "did much better than" : "did much worse than";
  const detail = `Results: this ${network} post ${how} your typical ${network} post (score ${mine.score!.toFixed(1)}, where 1 is typical; ${shown}). Idea: "${row.ideaTitle}" (pillar: ${row.pillar}). It began: "${row.opening}".${values.note ? ` your note: ${values.note}` : ""}`;
  await recordSignal(db, { agent: agentForPlatform(row.platform), language: row.language, kind: "results", detail });
  await recordSignal(db, { agent: "scout", language: row.language, kind: "results", detail });
  return mine.standing;
}

export type PerformanceItem = {
  number: number;
  pairId: string;
  title: string;
  pillar: string;
  results: string;
};

/**
 * What the idea scout is told about past ideas that went live: how each one did on each network,
 * in the language it is writing in. Only posts that could be compared are included.
 */
export async function performanceBrief(db: Db, language: Language): Promise<PerformanceItem[]> {
  const ranked = (await resultsOverview(db)).filter((row) => row.score !== null);
  if (ranked.length === 0) return [];
  const titles = new Map(
    (await db.select({ pairId: ideas.pairId, title: ideas.title, pillar: ideas.pillar }).from(ideas).where(eq(ideas.language, language))).map(
      (idea) => [idea.pairId, idea],
    ),
  );
  const pairs = new Map<string, RankedRow[]>();
  for (const row of ranked) pairs.set(row.pairId, [...(pairs.get(row.pairId) ?? []), row]);
  return [...pairs]
    .map(([pairId, rows]) => ({ pairId, rows, best: Math.max(...rows.map((row) => row.score!)) }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 20)
    .map(({ pairId, rows }, index) => {
      const idea = titles.get(pairId) ?? { title: rows[0].ideaTitle, pillar: rows[0].pillar };
      return {
        number: index + 1,
        pairId,
        title: idea.title,
        pillar: idea.pillar,
        results: rows
          .map((row) => `${PLATFORM_NAMES[row.platform]} (${languageInfo(row.language).name}): ${row.standing}, score ${row.score!.toFixed(1)}${row.note ? `; {OWNER}'s note: ${row.note}` : ""}`)
          .join(" | "),
      };
    });
}
