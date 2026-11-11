import type { EditPlan, Phrase, Word } from "../db/schema";
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

/** The parts of the clip the finished video keeps, in order and without overlaps. */
export function keepRanges(phrases: Phrase[], plan: Pick<EditPlan, "cut" | "tightenPauses">, duration: number): Range[] {
  const cut = new Set(plan.cut);
  const ranges: Range[] = [];
  for (const [index, phrase] of phrases.entries()) {
    if (cut.has(index)) continue;
    const pieces: Range[] = [];
    if (plan.tightenPauses) {
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
    const joinGap = plan.tightenPauses ? 0 : 1.5;
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
export function chapterLines(phrases: Phrase[], plan: EditPlan, duration: number): string[] {
  const ranges = keepRanges(phrases, plan, duration);
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
  };
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
export function captionChunks(phrases: Phrase[], plan: EditPlan, duration: number, platform: VideoPlatform): CaptionChunk[] {
  const ranges = keepRanges(phrases, plan, duration);
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
