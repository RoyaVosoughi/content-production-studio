import type { PieceContent } from "./db/schema";
import { PLATFORM_NAMES, SLIDE_LIMITS, VIDEO_TITLE_LIMIT, type Platform } from "./platforms";
import { HOOK_FOLD } from "./quality";

// Every post comes with three openings of different kinds. You pick one, and the studio keeps
// count of which kind you pick and which kind does well once live, so the writers lean toward it.

export const HOOK_KINDS = ["question", "number", "story", "bold", "problem"] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export type HookOption = { kind: HookKind; text: string };

export const HOOK_COUNT = 3;

/** What each kind is, for the writers. */
export const HOOK_KIND_RULES: Record<HookKind, string> = {
  question: "a question the audience is already asking themselves",
  number: "a specific figure or fact from the sources, never an invented one",
  story: "a moment from a real situation, told in one line; a square-bracket placeholder when it needs {OWNER}'s own story",
  bold: "a bold or contrarian claim {OWNER} would stand behind",
  problem: "the problem or frustration the audience feels, named plainly",
};

export function isHookKind(value: unknown): value is HookKind {
  return typeof value === "string" && (HOOK_KINDS as readonly string[]).includes(value);
}

/** Where people see the hook first: the title, the cover slide, or the first line of the text. */
export type HookPlace = "title" | "cover" | "line";

export function hookPlace(platform: Platform): HookPlace {
  if (platform === "website" || platform === "youtube" || platform === "short") return "title";
  if (platform === "instagram") return "cover";
  return "line";
}

/** The longest a hook can be in its place. */
export function hookLimit(platform: Platform): number {
  const place = hookPlace(platform);
  if (place === "title") return platform === "website" ? 100 : VIDEO_TITLE_LIMIT;
  if (place === "cover") return SLIDE_LIMITS.title;
  return HOOK_FOLD[platform] ?? 210;
}

/** What the writers are told about where the hook goes. */
export function hookPlaceRule(platform: Platform): string {
  const place = hookPlace(platform);
  const where =
    place === "title" ? "the title" : place === "cover" ? "the cover slide's title (at most 8 words)" : "the first line of the text, on a line of its own";
  return `On ${PLATFORM_NAMES[platform]} the hook is ${where}, at most ${hookLimit(platform)} characters.`;
}

const firstLine = (body: string) => body.split("\n").findIndex((line) => line.trim());

/** The opening the post uses now, in its place. */
export function currentHook(platform: Platform, content: PieceContent): string {
  const place = hookPlace(platform);
  if (place === "title") return (content.title ?? "").trim();
  if (place === "cover") return (content.slides?.[0]?.title ?? "").trim();
  const index = firstLine(content.body);
  return index < 0 ? "" : content.body.split("\n")[index].trim();
}

/** The post with this opening in the hook's place. Nothing else changes. */
export function applyHook(platform: Platform, content: PieceContent, text: string): PieceContent {
  const hook = text.trim();
  const place = hookPlace(platform);
  if (place === "title") return { ...content, title: hook };
  if (place === "cover") {
    const slides = content.slides?.length ? content.slides : [{ title: "", text: "" }];
    return { ...content, slides: [{ ...slides[0], title: hook }, ...slides.slice(1)] };
  }
  const lines = content.body.split("\n");
  const index = firstLine(content.body);
  if (index < 0) return { ...content, body: hook };
  lines[index] = hook;
  return { ...content, body: lines.join("\n") };
}

const normal = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The kind of the option the post opens with now, or null when you wrote your own opening. */
export function hookKindOf(platform: Platform, content: PieceContent): HookKind | null {
  const now = normal(currentHook(platform, content));
  if (!now) return null;
  return content.hooks?.find((option) => normal(option.text) === now)?.kind ?? null;
}

/**
 * The writer's options, made safe: known kinds only, one of each, one line, short enough for their
 * place. Kinds the AI wrote in other words, such as "Question" or "statistic", are understood.
 */
export function cleanHooks(platform: Platform, raw: unknown): HookOption[] {
  if (!Array.isArray(raw)) return [];
  const aliases: Record<string, HookKind> = { statistic: "number", stat: "number", fact: "number", contrarian: "bold", claim: "bold", pain: "problem", anecdote: "story" };
  const options: HookOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { kind: rawKind, text: rawText } = item as Record<string, unknown>;
    const word = String(rawKind ?? "").trim().toLowerCase();
    const kind = isHookKind(word) ? word : aliases[word];
    const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
    if (!kind || !text || text.length > hookLimit(platform)) continue;
    if (options.some((option) => option.kind === kind || normal(option.text) === normal(text))) continue;
    options.push({ kind, text });
    if (options.length === HOOK_COUNT) break;
  }
  return options;
}

/**
 * A freshly written post with its hooks. The post opens with the first option; when the writer
 * opened it some other way, the first option is put in its place so the two always agree.
 */
export function finishHooks(platform: Platform, draft: Omit<PieceContent, "hooks"> & { hooks?: unknown }): PieceContent {
  const hooks = cleanHooks(platform, draft.hooks);
  const { hooks: _raw, ...rest } = draft;
  if (hooks.length < 2) return rest;
  const content: PieceContent = { ...rest, hooks };
  return hookKindOf(platform, content) ? content : applyHook(platform, content, hooks[0].text);
}

// ---- What works ----

export type HookRecordRow = { platform: Platform; kind: HookKind | null; score: number | null; standing?: string | null };

export type HookTally = { kind: HookKind; picked: number; live: number; compared: number; score: number | null };

/** A kind needs this many compared live posts before its average means anything. */
export const MIN_HOOK_POSTS = 2;

/**
 * For each kind: how often you kept it, how many live posts opened with it, and how those did
 * against your usual post on the same network (1 is typical). Best first.
 */
export function hookTally(picked: { kind: HookKind | null }[], live: HookRecordRow[]): HookTally[] {
  const tallies = HOOK_KINDS.map((kind) => {
    const scores = live.filter((row) => row.kind === kind && row.score !== null).map((row) => row.score!);
    return {
      kind,
      picked: picked.filter((row) => row.kind === kind).length,
      live: live.filter((row) => row.kind === kind).length,
      compared: scores.length,
      score: scores.length >= MIN_HOOK_POSTS ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  });
  return tallies
    .filter((tally) => tally.picked > 0 || tally.live > 0)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.picked - a.picked);
}

/** Sentences for a writer about one network's hooks, each backed by counts. Empty until there is something to say. */
export function hookRecordLines(platform: Platform, tallies: HookTally[]): string[] {
  const network = PLATFORM_NAMES[platform];
  const lines: string[] = [];
  const picks = tallies.filter((tally) => tally.picked > 0).sort((a, b) => b.picked - a.picked);
  if (picks.reduce((sum, tally) => sum + tally.picked, 0) >= 2) {
    lines.push(`On ${network}, {OWNER} kept these kinds of hook: ${picks.map((tally) => `${tally.kind} ${tally.picked} times`).join(", ")}.`);
  }
  const scored = tallies.filter((tally) => tally.score !== null);
  if (scored.length > 0) {
    lines.push(
      `Live ${network} posts by the kind of hook they opened with (1 is a typical post for {OWNER}): ${scored
        .map((tally) => `${tally.kind} ${tally.score!.toFixed(1)} over ${tally.compared} posts`)
        .join(", ")}.`,
    );
  }
  return lines;
}
