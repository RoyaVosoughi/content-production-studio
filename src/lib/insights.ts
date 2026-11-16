import type { Language } from "./language";
import { PLATFORM_NAMES, type Platform } from "./platforms";
import { pillarSummary, type RankedRow } from "./results";

// What the numbers say about your own posts: which topic, channel and day did better, and how the
// last week went. Worked out by code from the posts' scores, so it costs nothing.

export type Group<K> = { key: K; score: number; posts: number };

const DAY = 24 * 3600 * 1000;
/** A weekday or channel needs this many compared posts before it is called better or worse. */
const MIN_GROUP = 2;
/** The gap between best and worst must be at least this much, or it is only noise. */
const MIN_GAP = 0.25;

function average<K>(rows: RankedRow[], keyOf: (row: RankedRow) => K | null): Group<K>[] {
  const groups = new Map<K, number[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || row.score === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), row.score]);
  }
  return [...groups]
    .map(([key, scores]) => ({ key, score: scores.reduce((a, b) => a + b, 0) / scores.length, posts: scores.length }))
    .sort((a, b) => b.score - a.score);
}

export type Patterns = {
  /** Topics, best first. */
  topics: Group<string>[];
  /** Channels, best first. Each post is scored against its own channel, so this shows where you beat your usual. */
  channels: Group<Platform>[];
  /** 0 is Sunday. */
  weekdays: Group<number>[];
};

/** Averages of the compared posts by topic, channel and weekday, best first. */
export function patternsOf(rows: RankedRow[]): Patterns {
  return {
    topics: pillarSummary(rows).map((entry) => ({ key: entry.pillar, score: entry.score, posts: entry.posts })),
    channels: average(rows, (row) => row.platform),
    weekdays: average(rows, (row) => row.postedAt?.getDay() ?? null),
  };
}

/** A clear winner and loser, or null when there is nothing to tell apart. */
export function bestAndWorst<K>(groups: Group<K>[], minPosts = MIN_GROUP): { best: Group<K>; worst: Group<K> | null } | null {
  const usable = groups.filter((group) => group.posts >= minPosts);
  if (usable.length === 0) return null;
  const best = usable[0];
  const worst = usable.length > 1 ? usable[usable.length - 1] : null;
  if (worst && best.score - worst.score < MIN_GAP) return { best, worst: null };
  return { best, worst };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Plain sentences the idea scout reads, each backed by the numbers. A pattern needs several compared
 * posts behind it, so one lucky post never becomes a rule.
 */
export function patternLines(rows: RankedRow[]): string[] {
  const compared = rows.filter((row) => row.score !== null);
  if (compared.length < 5) return [];
  const patterns = patternsOf(compared);
  const lines: string[] = [];
  const topics = bestAndWorst(patterns.topics, 2);
  if (topics) {
    lines.push(`Best topic so far: "${topics.best.key}" (average score ${topics.best.score.toFixed(1)} over ${topics.best.posts} posts).`);
    if (topics.worst) lines.push(`Weakest topic so far: "${topics.worst.key}" (average score ${topics.worst.score.toFixed(1)} over ${topics.worst.posts} posts).`);
  }
  const channels = bestAndWorst(patterns.channels, 2);
  if (channels?.worst) {
    lines.push(`Posts beat their usual most on ${PLATFORM_NAMES[channels.best.key]} (${channels.best.score.toFixed(1)}) and least on ${PLATFORM_NAMES[channels.worst.key]} (${channels.worst.score.toFixed(1)}).`);
  }
  const days = bestAndWorst(patterns.weekdays, 2);
  if (days?.worst) {
    lines.push(`Posts did best on ${WEEKDAYS[days.best.key]}s (${days.best.score.toFixed(1)}) and worst on ${WEEKDAYS[days.worst.key]}s (${days.worst.score.toFixed(1)}).`);
  }
  return lines;
}

export type WeeklySummary = {
  /** Posts that went out in the last seven days. */
  posted: number;
  /** Those with numbers. */
  measured: number;
  views: number;
  best: RankedRow | null;
  weakest: RankedRow | null;
};

/** How the last seven days went. The best and weakest need a score, so a network with few posts has neither. */
export function weeklySummary(rows: RankedRow[], now = new Date()): WeeklySummary {
  const recent = rows.filter((row) => row.postedAt && now.getTime() - row.postedAt.getTime() <= 7 * DAY);
  const measured = recent.filter((row) => row.numbers);
  const scored = measured.filter((row) => row.score !== null).sort((a, b) => b.score! - a.score!);
  return {
    posted: recent.length,
    measured: measured.length,
    views: measured.reduce((sum, row) => sum + (row.numbers?.views ?? 0), 0),
    best: scored[0] ?? null,
    weakest: scored.length > 1 ? scored[scored.length - 1] : null,
  };
}

/** The language the scout is writing in doesn't change the sentences, which are for the AI. */
export type PatternsFor = (language: Language) => Promise<string[]>;
