import type { EditPlan, Explainer, ExplainerStyle, Moment, Phrase, Word } from "../db/schema";
import { cleanScenes, type AnimationScene, type SceneKind } from "./animation";
import { assColor } from "../brand-style";
import { languageInfo, type Language } from "../language";
import { VIDEO_FORMATS, type VideoPlatform } from "../platforms";

// Pure editing logic, shared by the editor in the browser and the renderer on the server,
// so the length and chapters you see are the ones the finished video has.

/** A pause at least this long, or a sentence ending, starts a new phrase. */
const PHRASE_GAP = 0.5;
const PHRASE_MAX_WORDS = 14;
/** Pauses longer than this are shortened when tightenPauses is on. */
const LONG_PAUSE = 0.6;
/** Speech is kept with a little room around it, so words aren't clipped. */
const LEAD = 0.12;
const TAIL = 0.25;

export type Range = { start: number; end: number };

/** Groups a transcript's words into phrases, the units an edit plan works with. */
export function buildPhrases(words: Word[]): Phrase[] {
  const phrases: Phrase[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length === 0) return;
    phrases.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.text).join(" "),
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    const previous = current[current.length - 1];
    if (previous && (word.start - previous.end >= PHRASE_GAP || current.length >= PHRASE_MAX_WORDS)) flush();
    current.push({ text, start: word.start, end: Math.max(word.end, word.start) });
    if (/[.!?؟]["»)]*$/.test(text)) flush();
  }
  flush();
  return phrases;
}

/** A pause the audio really has. */
export type Silence = { start: number; end: number };

/** The audio is measured in steps this long. */
export const LEVEL_STEP = 0.05;
/** Quiet this long counts as a pause. */
const MIN_PAUSE = 0.3;
/** Where quiet ends and speech starts, from the room's silence up towards the voice. */
const SPEECH_SHARE = 0.35;
/** A clip with less than this between its quiet and its voice is too noisy to tell them apart. */
const MIN_RANGE_DB = 15;

/**
 * The pauses in a clip, from its loudness in steps of LEVEL_STEP seconds. The line between quiet and
 * speech comes from the clip itself: a set level would hear the soft end of a sentence as silence
 * in a quiet room, and hear nothing as silence in a noisy one.
 */
export function pausesFromLevels(levels: number[]): Silence[] {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.floor(share * (sorted.length - 1))];
  const quiet = at(0.1);
  const voice = at(0.95);
  if (voice - quiet < MIN_RANGE_DB) return [];
  const line = quiet + SPEECH_SHARE * (voice - quiet);
  const pauses: Silence[] = [];
  let from: number | null = null;
  const close = (to: number) => {
    if (from !== null && (to - from) * LEVEL_STEP >= MIN_PAUSE) pauses.push({ start: from * LEVEL_STEP, end: to * LEVEL_STEP });
    from = null;
  };
  levels.forEach((level, index) => {
    if (level < line) from ??= index;
    else close(index);
  });
  close(levels.length);
  return pauses;
}

/** The loudness of mono samples in decibels, one value per LEVEL_STEP. */
export function levelsOf(samples: Float32Array, rate: number): number[] {
  const size = Math.round(rate * LEVEL_STEP);
  const levels: number[] = [];
  for (let at = 0; at + size <= samples.length; at += size) {
    let sum = 0;
    for (let index = at; index < at + size; index++) sum += samples[index] * samples[index];
    levels.push(10 * Math.log10(sum / size + 1e-12));
  }
  return levels;
}

/** Words this close together count as piled on one moment. */
const PILE = 0.02;

/** Words Whisper failed to time: two or more stacked on one moment, or set after the words that follow. */
function piledFlags(words: Word[]): boolean[] {
  const flags = words.map(() => false);
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && Math.abs(next.start - word.start) < PILE && word.end - word.start < PILE) flags[index] = flags[index + 1] = true;
    if (next && word.start > next.start + PILE) flags[index] = true;
  });
  return flags;
}

export function hasPiledWords(phrases: Phrase[]): boolean {
  return piledFlags(phrases.flatMap((phrase) => phrase.words)).some(Boolean);
}

/**
 * Whisper sometimes gives a stretch of words one and the same time, or a time past the end of its
 * part of the clip, and the speech between them then belongs to no phrase and is lost from the
 * video. Those words are spread over the speech between the words around them, in proportion to
 * their length, skipping the audio's pauses: close to where they were said.
 */
export function spreadPiledWords(words: Word[], pauses: Silence[], duration: number): Word[] {
  const flags = piledFlags(words);
  const result = words.map((word) => ({ ...word }));
  for (let index = 0; index < words.length; index++) {
    if (!flags[index]) continue;
    let last = index;
    while (last + 1 < words.length && flags[last + 1]) last++;
    const from = index > 0 ? result[index - 1].end : 0;
    const to = last + 1 < words.length ? words[last + 1].start : duration;
    if (to > from) {
      // The speech in between: the span without its pauses, or all of it if that leaves nothing.
      let voiced: Range[] = [{ start: from, end: to }];
      for (const pause of pauses) {
        voiced = voiced.flatMap((part) =>
          pause.end <= part.start || pause.start >= part.end
            ? [part]
            : [{ start: part.start, end: pause.start }, { start: pause.end, end: part.end }].filter((piece) => piece.end - piece.start > 0.05),
        );
      }
      if (outputDuration(voiced) < 0.2) voiced = [{ start: from, end: to }];
      const total = outputDuration(voiced);
      // Time along the speech, back to a time in the clip.
      const place = (along: number) => {
        let left = along;
        for (const part of voiced) {
          if (left <= part.end - part.start) return part.start + left;
          left -= part.end - part.start;
        }
        return voiced[voiced.length - 1].end;
      };
      const run = words.slice(index, last + 1);
      const weight = run.reduce((sum, word) => sum + word.text.length + 1, 0);
      let along = 0;
      run.forEach((word, offset) => {
        const length = ((word.text.length + 1) / weight) * total;
        result[index + offset] = { ...word, start: place(along), end: place(along + length) };
        along += length;
      });
    }
    index = last;
  }
  return result;
}

/** The same, for a clip's phrases: each keeps its words, so edit plans made on them still work. */
export function spreadPiledPhrases(phrases: Phrase[], pauses: Silence[], duration: number): Phrase[] {
  const spread = spreadPiledWords(phrases.flatMap((phrase) => phrase.words), pauses, duration);
  let at = 0;
  return phrases.map((phrase) => {
    const words = spread.slice(at, (at += phrase.words.length));
    if (words.length === 0) return phrase;
    return { ...phrase, start: words[0].start, end: Math.max(...words.map((word) => word.end)), words };
  });
}

/**
 * For clips whose words an earlier version trimmed to pauses it heard wrongly: a word edge that
 * sits exactly on one of those pauses is put back to the far side of it. The real pauses are taken
 * out when the video is made, so a word that reaches too far costs nothing, and one cut short loses speech.
 */
export function untrimPhrases(phrases: Phrase[], trimmedAt: Silence[]): Phrase[] {
  const starts = new Map(trimmedAt.map((pause) => [pause.start, pause.end]));
  const ends = new Map(trimmedAt.map((pause) => [pause.end, pause.start]));
  return phrases.map((phrase) => {
    const words = phrase.words.map((word) => ({ ...word, start: ends.get(word.start) ?? word.start, end: starts.get(word.end) ?? word.end }));
    if (words.length === 0) return phrase;
    return { ...phrase, start: Math.min(phrase.start, ...words.map((word) => word.start)), end: Math.max(phrase.end, ...words.map((word) => word.end)), words };
  });
}

/** The parts of the clip the finished video keeps, in order and without overlaps. */
export function keepRanges(
  phrases: Phrase[],
  plan: Pick<EditPlan, "cut" | "tightenPauses">,
  duration: number,
  silences: Silence[] = [],
): Range[] {
  // With the audio's own pauses, only they decide what is quiet: word times can be off.
  if (plan.tightenPauses && silences.length > 0) {
    return withoutPauses(toSpeechEnd(speechRanges(phrases, plan, duration, false), phrases, plan.cut, silences, duration), silences);
  }
  return speechRanges(phrases, plan, duration, plan.tightenPauses);
}

/** Audio pauses at least this long are shortened when tightenPauses is on... */
const CUT_PAUSE = 0.6;
/** ...to this much quiet after speech, so a sentence's soft ending is never clipped... */
const ROOM_AFTER = 0.3;
/** ...and this much before the next, so the cut sounds like a breath, not a jump. */
const ROOM_BEFORE = 0.15;
/** A sliver left between two cuts is too short to hear as speech. */
const SLIVER = 0.12;

/** How far past Whisper's end of a phrase the speech may still run. */
const SPEECH_REACH = 1;

/**
 * Whisper sometimes ends a phrase before its last word is finished. Each kept part runs on to the
 * pause that really ends it, a second at most, and never into a phrase that was cut.
 */
function toSpeechEnd(ranges: Range[], phrases: Phrase[], cut: number[], silences: Silence[], duration: number): Range[] {
  const cutStarts = cut.map((index) => phrases[index]?.start).filter((start): start is number => start !== undefined);
  const reached = ranges.map((range) => {
    if (silences.some((pause) => pause.start <= range.end && pause.end > range.end)) return range;
    const pause = silences.filter((item) => item.start > range.end).reduce<number>((first, item) => Math.min(first, item.start + ROOM_AFTER), duration);
    const nextCut = cutStarts.filter((start) => start >= range.end).reduce<number>((first, start) => Math.min(first, start), duration);
    return { start: range.start, end: Math.max(range.end, Math.min(pause, nextCut, range.end + SPEECH_REACH, duration)) };
  });
  // A part that now reaches the next one joins it, so nothing plays twice.
  const merged: Range[] = [];
  for (const range of reached) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Takes the pauses the audio really has out of the kept parts. Word times can't be trusted for
 * this: Whisper runs words over pauses, and sometimes ends them before the speech does.
 */
function withoutPauses(ranges: Range[], silences: Silence[]): Range[] {
  const gaps = silences
    .filter((pause) => pause.end - pause.start >= CUT_PAUSE)
    .filter((pause) => pause.end - pause.start > ROOM_AFTER + ROOM_BEFORE)
    .map((pause) => ({ start: pause.start + ROOM_AFTER, end: pause.end - ROOM_BEFORE }))
    .sort((a, b) => a.start - b.start);
  const result: Range[] = [];
  for (const range of ranges) {
    let start = range.start;
    for (const gap of gaps) {
      if (gap.end <= start || gap.start >= range.end) continue;
      if (gap.start > start) result.push({ start, end: gap.start });
      start = Math.max(start, gap.end);
    }
    if (range.end > start) result.push({ start, end: range.end });
  }
  return result.filter((range) => range.end - range.start >= SLIVER);
}

function speechRanges(phrases: Phrase[], plan: Pick<EditPlan, "cut">, duration: number, tighten: boolean): Range[] {
  const cut = new Set(plan.cut);
  const ranges: Range[] = [];
  for (const [index, phrase] of phrases.entries()) {
    if (cut.has(index)) continue;
    const pieces: Range[] = [];
    if (tighten) {
      // Split the phrase at long pauses between its words.
      let start = phrase.words[0]?.start ?? phrase.start;
      for (let at = 1; at < phrase.words.length; at++) {
        if (phrase.words[at].start - phrase.words[at - 1].end > LONG_PAUSE) {
          pieces.push({ start, end: phrase.words[at - 1].end });
          start = phrase.words[at].start;
        }
      }
      pieces.push({ start, end: phrase.words[phrase.words.length - 1]?.end ?? phrase.end });
    } else {
      pieces.push({ start: phrase.start, end: phrase.end });
    }
    for (const piece of pieces) ranges.push({ start: piece.start - LEAD, end: piece.end + TAIL });
  }

  // Without tightening, natural pauses between neighbouring kept phrases stay in.
  const merged: Range[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start);
    const end = Math.min(duration, range.end);
    if (end <= start) continue;
    const last = merged[merged.length - 1];
    const joinGap = tighten ? 0 : 1.5;
    if (last && start - last.end <= joinGap) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

export function outputDuration(ranges: Range[]): number {
  return ranges.reduce((total, range) => total + (range.end - range.start), 0);
}

/** Where a moment of the clip lands in the finished video, or null if it was cut. */
export function toOutputTime(ranges: Range[], time: number): number | null {
  let before = 0;
  for (const range of ranges) {
    if (time < range.start) return null;
    if (time <= range.end) return before + (time - range.start);
    before += range.end - range.start;
  }
  return null;
}

/** The first moment of a phrase that survived the edit, in finished-video time. */
export function phraseOutputStart(ranges: Range[], phrase: Phrase): number | null {
  const times = [phrase.start, ...phrase.words.map((word) => word.start)];
  for (const time of times) {
    const at = toOutputTime(ranges, time);
    if (at !== null) return at;
  }
  // The phrase may begin inside the lead-in room of a range.
  const inside = ranges.find((range) => range.start >= phrase.start && range.start < phrase.end);
  return inside ? toOutputTime(ranges, inside.start) : null;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * YouTube chapters as they go in the description. YouTube needs the first at 0:00, at least three,
 * and each at least 10 seconds long, so chapters that break those rules are left out.
 */
export function chapterLines(phrases: Phrase[], plan: EditPlan, duration: number, silences: Silence[] = []): string[] {
  const ranges = keepRanges(phrases, plan, duration, silences);
  const total = outputDuration(ranges);
  const points = plan.chapters
    .map((chapter) => {
      const phrase = phrases[chapter.phrase];
      const at = phrase ? phraseOutputStart(ranges, phrase) : null;
      return at === null || !chapter.title.trim() ? null : { at, title: chapter.title.trim() };
    })
    .filter((point): point is { at: number; title: string } => point !== null)
    .sort((a, b) => a.at - b.at);
  if (points.length === 0) return [];
  points[0].at = 0;
  const kept: { at: number; title: string }[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && point.at - last.at < 10) continue;
    kept.push(point);
  }
  if (kept.length > 0 && total - kept[kept.length - 1].at < 10) kept.pop();
  if (kept.length < 3) return [];
  return kept.map((point) => `${formatTime(point.at)} ${point.title}`);
}

/** A plan that keeps everything and only adds captions and a title card, for you to build on. */
export function simplePlan(title: string): EditPlan {
  return {
    level: "light",
    reason: "",
    cut: [],
    tightenPauses: false,
    captions: true,
    fixes: [],
    highlights: [],
    titleCard: title.slice(0, 60),
    callouts: [],
    zooms: [],
    chapters: [],
    endCard: true,
    framing: "fill",
  };
}

/** fit is the better default only when a vertical clip goes into a wide frame. */
export function defaultFraming(platform: VideoPlatform, width: number, height: number): EditPlan["framing"] {
  const format = VIDEO_FORMATS[platform];
  return height > width && format.width > format.height ? "fit" : "fill";
}

/** Keeps a plan within what the clip and the editor can show, whoever wrote it. */
export function cleanPlan(plan: EditPlan, phraseCount: number): EditPlan {
  const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < phraseCount;
  const unique = <T,>(items: T[], key: (item: T) => unknown) => {
    const seen = new Set();
    return items.filter((item) => {
      const id = key(item);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  let cut = unique(plan.cut.filter(valid), (index) => index);
  // Never cut everything: the video would be empty.
  if (cut.length >= phraseCount) cut = [];
  const explainers = cleanExplainers(Array.isArray(plan.explainers) ? plan.explainers : [], phraseCount, cut);
  return {
    level: plan.level === "full" ? "full" : "light",
    reason: plan.reason.trim().slice(0, 600),
    cut,
    tightenPauses: Boolean(plan.tightenPauses),
    captions: plan.captions !== false,
    fixes: unique(
      plan.fixes.filter((fix) => valid(fix.phrase) && fix.text.trim()).map((fix) => ({ phrase: fix.phrase, text: fix.text.trim().slice(0, 300) })),
      (fix) => fix.phrase,
    ),
    highlights: unique(plan.highlights.map((word) => word.trim()).filter(Boolean), (word) => word.toLowerCase()).slice(0, 20),
    titleCard: plan.titleCard.trim().slice(0, 80),
    callouts: unique(
      plan.callouts.filter((callout) => valid(callout.phrase) && callout.text.trim()).map((callout) => ({
        phrase: callout.phrase,
        text: callout.text.trim().slice(0, 40),
      })),
      (callout) => callout.phrase,
    ).slice(0, 12),
    zooms: unique(plan.zooms.filter(valid), (index) => index).slice(0, 20),
    chapters: unique(
      plan.chapters.filter((chapter) => valid(chapter.phrase) && chapter.title.trim()).map((chapter) => ({
        phrase: chapter.phrase,
        title: chapter.title.trim().slice(0, 80),
      })),
      (chapter) => chapter.phrase,
    ),
    endCard: plan.endCard !== false,
    framing: plan.framing === "fit" ? "fit" : "fill",
    // Plans without explainers stay exactly as they were, so their finished videos are reused.
    ...(explainers.length > 0
      ? { explainers, explainerStyle: isExplainerStyle(plan.explainerStyle) ? plan.explainerStyle : "tech" }
      : {}),
  };
}

// ---- Explainers ----

export const EXPLAINER_STYLES: ExplainerStyle[] = ["tech", "editorial", "text"];
const isExplainerStyle = (value: unknown): value is ExplainerStyle => EXPLAINER_STYLES.includes(value as ExplainerStyle);

/**
 * The look for explainers: the Vox-style collage when asked for in words, otherwise the look the
 * edit already had, otherwise the light tech look of the Reels editor prompt.
 */
export function explainerStyleFor(request: string, previous?: ExplainerStyle): ExplainerStyle {
  if (/\b(vox|editorial|collage|newspaper|paper cut)/i.test(request) || /(ووکس|کلاژ|روزنامه|کاغذی)/.test(request)) return "editorial";
  if (/\b(tech|glass|grid|light background|white background)/i.test(request) || /(تکنولوژی|شیشه|پس‌زمینه سفید|پس زمینه سفید)/.test(request)) return "tech";
  return previous ?? "tech";
}

/** Scene kinds an explainer can show over a clip. Cartoons and end cards belong to animations of their own. */
export const EXPLAINER_KINDS: SceneKind[] = ["title", "statement", "number", "points", "steps", "quote", "compare"];
export const EXPLAINER_LIMIT = 12;
/** Beside the picture-in-picture card there is room for three items; full screen fits five. */
const PIP_ITEMS = 3;
/** How long the switch between your clip and an explainer takes, each way. */
export const EXPLAINER_FADE = 0.35;
const EXPLAINER_MIN = 1.6;

/** Keeps only explainers that start on a kept phrase, in order and without overlaps, with drawable scenes. */
export function cleanExplainers(explainers: Explainer[], phraseCount: number, cut: number[]): Explainer[] {
  const valid = (index: unknown): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < phraseCount;
  const removed = new Set(cut);
  const kept: Explainer[] = [];
  const sorted = explainers.filter((item) => item && valid(item.phrase) && !removed.has(item.phrase)).sort((a, b) => a.phrase - b.phrase);
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (last && item.phrase <= last.until) continue;
    const mode = item.mode === "full" ? "full" : "pip";
    const [scene] = cleanScenes([{ ...item.scene, kind: EXPLAINER_KINDS.includes(item.scene?.kind) ? item.scene.kind : "statement" }]);
    if (!scene) continue;
    if (mode === "pip") scene.items = scene.items.slice(0, PIP_ITEMS);
    kept.push({ phrase: item.phrase, until: valid(item.until) && item.until >= item.phrase ? item.until : item.phrase, mode, scene });
    if (kept.length >= EXPLAINER_LIMIT) break;
  }
  return kept;
}

export type ExplainerWindow = { start: number; end: number; mode: Explainer["mode"]; scene: AnimationScene };

/** Where each explainer plays in the finished video: from its first phrase to the end of its last kept word. */
export function explainerWindows(phrases: Phrase[], plan: EditPlan, ranges: Range[], total: number): ExplainerWindow[] {
  const windows: ExplainerWindow[] = [];
  let freeFrom = 0;
  for (const item of plan.explainers ?? []) {
    const first = phrases[item.phrase];
    const start = first ? phraseOutputStart(ranges, first) : null;
    if (start === null || start < freeFrom || start > total - EXPLAINER_MIN) continue;
    let end: number | null = null;
    for (let index = Math.max(item.until, item.phrase); index >= item.phrase && end === null; index--) {
      const words = phrases[index]?.words ?? [];
      for (let at = words.length - 1; at >= 0 && end === null; at--) end = toOutputTime(ranges, words[at].end);
    }
    const until = Math.min(total, Math.max((end ?? start) + 0.3, start + EXPLAINER_MIN));
    windows.push({ start, end: until, mode: item.mode, scene: item.scene });
    freeFrom = until + 0.2;
  }
  return windows;
}

// ---- Captions ----

export type CaptionChunk = { start: number; end: number; text: string };

const CHUNK = {
  vertical: { words: 3, chars: 22 },
  portrait: { words: 4, chars: 28 },
  wide: { words: 7, chars: 44 },
};

function shape(platform: VideoPlatform) {
  const { width, height } = VIDEO_FORMATS[platform];
  return height / width > 1.5 ? "vertical" : height > width ? "portrait" : "wide";
}

/** Splits the kept speech into short caption lines, timed to the finished video. */
export function captionChunks(
  phrases: Phrase[],
  plan: EditPlan,
  duration: number,
  platform: VideoPlatform,
  silences: Silence[] = [],
): CaptionChunk[] {
  const ranges = keepRanges(phrases, plan, duration, silences);
  const limit = CHUNK[shape(platform)];
  const fixes = new Map(plan.fixes.map((fix) => [fix.phrase, fix.text]));
  const cut = new Set(plan.cut);
  const chunks: CaptionChunk[] = [];

  for (const [index, phrase] of phrases.entries()) {
    if (cut.has(index)) continue;
    const fixed = fixes.get(index);
    // A corrected phrase spreads its words evenly over the time the phrase was spoken.
    const words: Word[] = fixed
      ? spread(fixed, phrase.start, phrase.end)
      : phrase.words;
    let group: Word[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const start = toOutputTime(ranges, group[0].start) ?? nextKept(ranges, group[0].start);
      const end = toOutputTime(ranges, group[group.length - 1].end) ?? start;
      if (start !== null && end !== null) {
        chunks.push({ start, end: Math.max(end, start + 0.3), text: group.map((word) => word.text).join(" ") });
      }
      group = [];
    };
    for (const word of words) {
      const length = [...group, word].map((item) => item.text).join(" ").length;
      if (group.length >= limit.words || (group.length > 0 && length > limit.chars)) flush();
      group.push(word);
    }
    flush();
  }
  // Each line stays up until the next starts, unless there's a real pause.
  for (let index = 0; index < chunks.length - 1; index++) {
    const next = chunks[index + 1];
    if (next.start - chunks[index].end < 0.6) chunks[index].end = next.start;
    else chunks[index].end = Math.min(chunks[index].end + 0.3, next.start);
  }
  return chunks.filter((chunk) => chunk.end > chunk.start);
}

function spread(text: string, start: number, end: number): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((sum, part) => sum + part.length + 1, 0) || 1;
  let at = start;
  return parts.map((part) => {
    const length = ((part.length + 1) / total) * (end - start);
    const word = { text: part, start: at, end: at + length };
    at += length;
    return word;
  });
}

function nextKept(ranges: Range[], time: number): number | null {
  let before = 0;
  for (const range of ranges) {
    if (range.start >= time) return before;
    before += range.end - range.start;
  }
  return null;
}

const assTime = (seconds: number) => {
  const centis = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centis / 360000);
  const m = Math.floor((centis % 360000) / 6000);
  const s = Math.floor((centis % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
};

const assEscape = (text: string) => text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\n/g, " ");
const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** ASS colours are blue, green, red. */
const WHITE = "&H00FFFFFF";
const INK = "&H001E1E1E";

/**
 * The caption file FFmpeg draws onto the video. Arabic script uses Vazirmatn and everything else Inter.
 * Encoding -1 lets the caption engine find the text direction itself, which puts right-to-left
 * words in the right order around English terms. Highlighted words use the brand's highlight colour.
 */
export function captionFile(
  chunks: CaptionChunk[],
  plan: EditPlan,
  platform: VideoPlatform,
  language: Language,
  highlight = "#e3a72f",
): string {
  const AMBER = assColor(highlight);
  const { width, height } = VIDEO_FORMATS[platform];
  const kind = shape(platform);
  const size = kind === "wide" ? 62 : kind === "portrait" ? 66 : 80;
  // Vertical captions sit above the area the app's own buttons and caption cover.
  const marginV = kind === "wide" ? 70 : kind === "portrait" ? 230 : Math.round(height * 0.29);
  const font = languageInfo(language).script === "arabic" ? "Vazirmatn ExtraBold" : "Inter ExtraBold";
  const highlights = new Set(plan.highlights.flatMap((phrase) => phrase.split(/\s+/)).map(bare).filter(Boolean));
  const pop = kind === "wide" ? "" : "\\fscx86\\fscy86\\t(0,110,\\fscx100\\fscy100)";

  const lines = chunks.map((chunk) => {
    const text = chunk.text
      .split(/\s+/)
      .map((word) => (highlights.has(bare(word)) ? `{\\c${AMBER}}${assEscape(word)}{\\c${WHITE}}` : assEscape(word)))
      .join(" ");
    return `Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Caption,,0,0,0,,{\\fad(60,0)${pop}}${text}`;
  });

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${font},${size},${WHITE},${WHITE},${INK},&H64000000,0,0,0,0,100,100,0,0,1,${kind === "wide" ? 4 : 6},1,2,90,90,${marginV},-1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

// ---- Short videos from a long clip ----

/** Clips at least this long get "Best moments for Shorts". */
export const MOMENTS_MIN_CLIP = 60;
type MomentLimits = { min: number; max: number; count: number };
/** A moment that is a short video by itself. */
const SHORT_MOMENT: MomentLimits = { min: 8, max: 90, count: 5 };
/** A part of a video of the main moments: shorter, and more of them. */
const HIGHLIGHT_PART: MomentLimits = { min: 4, max: 60, count: 12 };
/** Where a short video can go: the vertical and 4:5 networks. */
export const SHORT_PLATFORMS: VideoPlatform[] = ["reel", "short", "linkedin_video"];

/**
 * Reads the editor's answer as times in seconds, which it sometimes gives where phrase numbers
 * belong: each moment runs from the phrase being said at its start to the last one begun before its end.
 */
function fromSeconds(moments: Moment[], phrases: Phrase[]): Moment[] {
  const last = phrases.length - 1;
  if (last < 0) return [];
  const at = (time: number) => Math.max(0, phrases.findIndex((phrase) => phrase.end > time));
  const until = (time: number) => {
    const index = phrases.findLastIndex((phrase) => phrase.start < time);
    return index < 0 ? 0 : index;
  };
  return moments.map((moment) => {
    const start = Math.min(moment.from, moment.to);
    const end = Math.max(moment.from, moment.to);
    const from = phrases[last].end <= start ? last : at(start);
    return { ...moment, from, to: Math.max(from, until(end)) };
  });
}

/**
 * The editor's moments, made safe: on real phrases, a usable length, without overlaps, strongest
 * first. When two overlap, the stronger one stays.
 */
export function cleanMoments(moments: Moment[], phrases: Phrase[], limits: MomentLimits = SHORT_MOMENT): Moment[] {
  const asNumbers = cleanOnPhrases(moments, phrases, limits);
  // When the answer only makes sense as seconds, it is read that way instead.
  const asSeconds = moments.some((moment) => Math.max(moment.from, moment.to) > phrases.length - 1) ? cleanOnPhrases(fromSeconds(moments, phrases), phrases, limits) : [];
  return asSeconds.length > asNumbers.length ? asSeconds : asNumbers;
}

function cleanOnPhrases(moments: Moment[], phrases: Phrase[], limits: MomentLimits): Moment[] {
  const last = phrases.length - 1;
  const usable = moments
    .map((moment) => {
      const from = Math.round(Math.min(moment.from, moment.to));
      const to = Math.round(Math.max(moment.from, moment.to));
      return {
        from,
        to,
        title: String(moment.title ?? "").trim().slice(0, 100),
        hook: String(moment.hook ?? "").trim().slice(0, 200),
        why: String(moment.why ?? "").trim().slice(0, 300),
        score: Math.max(1, Math.min(10, Math.round(Number(moment.score) || 5))),
      };
    })
    .filter((moment) => moment.from >= 0 && moment.to <= last && moment.title)
    .filter((moment) => {
      const seconds = phrases[moment.to].end - phrases[moment.from].start;
      return seconds >= limits.min && seconds <= limits.max;
    })
    .sort((a, b) => b.score - a.score || a.from - b.from);
  const kept: Moment[] = [];
  for (const moment of usable) {
    if (kept.length >= limits.count) break;
    if (kept.some((other) => moment.from <= other.to && other.from <= moment.to)) continue;
    kept.push(moment);
  }
  return kept;
}

type ClipPart = { from: number; to: number };

/** The parts of the clip a video keeps: one moment, the main moments, or null for the whole clip. */
export function keptParts(content: { window?: ClipPart; parts?: ClipPart[] }): ClipPart[] | null {
  if (content.window) return [content.window];
  return content.parts?.length ? content.parts : null;
}

/** The phrases a video of some parts leaves out: everything outside them. */
export function outsideParts(parts: ClipPart[], phraseCount: number): number[] {
  return Array.from({ length: phraseCount }, (_, number) => number).filter((number) => !parts.some((part) => number >= part.from && number <= part.to));
}

/** How long some parts of the clip are together, in seconds. */
export function partsSeconds(parts: ClipPart[], phrases: Phrase[]): number {
  return parts.reduce((sum, part) => sum + windowSeconds(part, phrases), 0);
}

/** The shortest and longest seconds the main moments of a long clip can come to. */
export const HIGHLIGHT_SECONDS = { min: 30, default: 120 };

/**
 * The main moments of a long clip for one video of about `seconds`: the strongest parts that fit,
 * then put back in the clip's order, so the video follows the talk.
 */
export function pickHighlights(moments: Moment[], phrases: Phrase[], seconds: number): Moment[] {
  const picked: Moment[] = [];
  let total = 0;
  for (const moment of cleanMoments(moments, phrases, HIGHLIGHT_PART)) {
    const length = windowSeconds(moment, phrases);
    if (total + length > seconds) continue;
    picked.push(moment);
    total += length;
  }
  return picked.sort((a, b) => a.from - b.from);
}

/** The phrases a short video leaves out: everything before and after its part of the clip. */
export function outsideWindow(window: { from: number; to: number }, phraseCount: number): number[] {
  return Array.from({ length: phraseCount }, (_, number) => number).filter((number) => number < window.from || number > window.to);
}

/** How long a part of the clip is, in seconds. */
export function windowSeconds(window: { from: number; to: number }, phrases: Phrase[]): number {
  const first = phrases[window.from];
  const last = phrases[window.to];
  return first && last ? Math.max(0, last.end - first.start) : 0;
}
