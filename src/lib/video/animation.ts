import { brandFonts, brandPalette } from "../brand-style";
import type { Word } from "../db/schema";
import { languageInfo, type Language } from "../language";
import { VIDEO_FORMATS, type VideoPlatform } from "../platforms";
import { ACTION_SECONDS, CARTOON_SCRIPT, cartoonCss, cartoonLayout, cartoonScene, cleanCartoon, simpleCartoon, type Cartoon } from "./cartoon";
import type { VideoBrand } from "./overlays";

// An explainer animation made from any script: a list of scenes drawn in the brand's colours and
// fonts, timed by reading speed or by an uploaded narration, and played by one page that can show
// any moment on demand. Chrome draws each frame of that page, and FFmpeg joins them into a video.
// Kept free of server code, so the scene editor and the tests can use it.

/** Change this when a design or the timing changes, so animations made the old way are made again. */
export const ANIMATION_VERSION = 2;

export const SCENE_KINDS = ["title", "statement", "number", "points", "steps", "quote", "compare", "cartoon", "end"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

/**
 * How an animation looks: cartoon scenes with characters, or animated text cards in one of three looks.
 * text uses the brand's colours on a dark background. tech is a light, modern tech look: a subtle grid,
 * glass cards, thin lines and glowing blue, violet and cyan accents. editorial is a Vox-style collage:
 * flat colour fields, paper grain and halftone, torn-paper cutouts, tape, and marker circles and
 * underlines that draw themselves, with snappy entrances that overshoot a little.
 */
export const ANIMATION_STYLES = ["cartoon", "text", "tech", "editorial"] as const;
export type AnimationStyle = (typeof ANIMATION_STYLES)[number];
export const isAnimationStyle = (value: string): value is AnimationStyle => (ANIMATION_STYLES as readonly string[]).includes(value);

/** The look the text cards are drawn in. Cartoon scenes keep the brand look around them. */
export type AnimationTheme = "brand" | "tech" | "editorial";
export const themeOf = (style: string): AnimationTheme => (style === "tech" ? "tech" : style === "editorial" ? "editorial" : "brand");

/** Where the picture-in-picture card of your clip sits on the frame, in pixels. */
export type PipBox = { x: number; y: number; w: number; h: number; r: number };

/**
 * The picture-in-picture card for an explainer over your clip. It stays clear of the app's top bar,
 * its buttons on the right and at the bottom, and the captions, and leaves the main area to the
 * animation: below it on vertical and 4:5 videos, beside it (at the reading end) on wide ones.
 */
export function pipBox(platform: VideoPlatform, rtl = false): PipBox {
  const { width, height } = VIDEO_FORMATS[platform];
  if (width > height) {
    const w = 640;
    const h = 360;
    return { x: rtl ? 110 : width - w - 110, y: height - h - 210, w, h, r: 28 };
  }
  if (height / width > 1.5) {
    const w = 620;
    const h = 420;
    return { x: Math.round((width - w) / 2), y: 820, w, h, r: 34 };
  }
  const w = 560;
  const h = 340;
  return { x: Math.round((width - w) / 2), y: 640, w, h, r: 30 };
}

/**
 * One scene. `say` is the part of the script read while it's on screen, which is also its caption.
 * What the other fields mean depends on the kind:
 * - title: heading, with text as a subtitle
 * - statement: heading as one big line, with text as a small label above it
 * - number: text is the big number (such as 73%), heading says what it means
 * - points, steps: heading, then up to five items
 * - quote: text is the quote, heading says who said it
 * - compare: heading, text is the two column names as "A | B", each item a row as "left | right"
 * - cartoon: the cartoon directions in `cartoon`, heading as a sign at the top, text as the host's speech bubble
 * - end: heading and text, or the brand's follow line when both are empty
 */
export type AnimationScene = { kind: SceneKind; say: string; heading: string; text: string; items: string[]; cartoon?: Cartoon };

export type SceneTime = { start: number; end: number };
export type Cue = { start: number; end: number; text: string };
export type Narration = { words: Word[]; duration: number };

export const SCENE_LIMITS = { scenes: 24, heading: 120, text: 200, item: 120, items: 5, say: 1000 } as const;

const ITEM_KINDS: SceneKind[] = ["points", "steps", "compare"];
export const hasItems = (kind: SceneKind) => ITEM_KINDS.includes(kind);

export function isSceneKind(value: string): value is SceneKind {
  return (SCENE_KINDS as readonly string[]).includes(value);
}

const clip = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

/** Trims every field to its limit and drops what a scene can't show, so a plan from the AI or a form is always drawable. */
export function cleanScenes(scenes: { [K in keyof AnimationScene]?: unknown }[]): AnimationScene[] {
  return scenes
    .slice(0, SCENE_LIMITS.scenes)
    .map((scene): AnimationScene => {
      const kind = typeof scene.kind === "string" && isSceneKind(scene.kind) ? scene.kind : "statement";
      return {
        kind,
        say: typeof scene.say === "string" ? scene.say.trim().slice(0, SCENE_LIMITS.say) : "",
        heading: clip(scene.heading, SCENE_LIMITS.heading),
        text: clip(scene.text, SCENE_LIMITS.text),
        items: hasItems(kind)
          ? (Array.isArray(scene.items) ? scene.items : [])
              .map((item) => clip(item, SCENE_LIMITS.item))
              .filter(Boolean)
              .slice(0, SCENE_LIMITS.items)
          : [],
        ...(kind === "cartoon" ? { cartoon: cleanCartoon(scene.cartoon) } : {}),
      };
    })
    // A cartoon scene shows something even with no words, so it's always kept.
    .filter((scene) => scene.kind === "end" || scene.kind === "cartoon" || scene.say || scene.heading || scene.text || scene.items.length > 0);
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Splits a script into sentences, keeping their end marks, for scenes made without the AI. */
export function sentences(script: string): string[] {
  return script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?؟…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const shorten = (text: string, words: number) => {
  const all = text.split(/\s+/).filter(Boolean);
  return all.length <= words ? text : `${all.slice(0, words).join(" ")}…`;
};

/**
 * Scenes made without the AI: the title first, then one scene for every few sentences, then the
 * end card. Plain, but it covers the whole script in order and can be changed scene by scene.
 * In the cartoon style, each of those scenes is a cartoon moment instead of a big line.
 */
export function simpleScenes(title: string, script: string, style: AnimationStyle = "text"): AnimationScene[] {
  const parts = sentences(script);
  const groups: string[][] = [];
  let group: string[] = [];
  for (const part of parts) {
    group.push(part);
    if (countWords(group.join(" ")) >= 22) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length > 0) groups.push(group);

  if (style === "cartoon") {
    const scenes: AnimationScene[] = groups.map((lines, index) => ({
      kind: "cartoon",
      say: lines.join(" "),
      heading: index === 0 ? clip(title, SCENE_LIMITS.heading) : "",
      text: "",
      items: [],
      cartoon: simpleCartoon(index, false),
    }));
    if (scenes.length === 0 && title.trim()) scenes.push({ kind: "cartoon", say: "", heading: clip(title, SCENE_LIMITS.heading), text: "", items: [], cartoon: simpleCartoon(0, false) });
    scenes.push({ kind: "cartoon", say: "", heading: "", text: "", items: [], cartoon: simpleCartoon(0, true) });
    scenes.push({ kind: "end", say: "", heading: "", text: "", items: [] });
    return cleanScenes(scenes);
  }

  const scenes: AnimationScene[] = groups.map((lines) => ({
    kind: "statement",
    say: lines.join(" "),
    heading: shorten(lines[0].replace(/[.!?؟…]+$/, ""), 14),
    text: "",
    items: [],
  }));
  const first = scenes[0];
  if (first && title.trim()) scenes[0] = { ...first, kind: "title", heading: clip(title, SCENE_LIMITS.heading) };
  else if (title.trim()) scenes.unshift({ kind: "title", say: "", heading: clip(title, SCENE_LIMITS.heading), text: "", items: [] });
  scenes.push({ kind: "end", say: "", heading: "", text: "", items: [] });
  return cleanScenes(scenes);
}

/** Words a listener hears per second, and words a viewer reads per second when nothing is said. */
const SPOKEN_PER_SECOND = 2.5;
const READ_PER_SECOND = 3;
const ENTRANCE = 0.8;
const MIN_SCENE = 2.4;
const MAX_SCENE = 16;
const END_SCENE = 3.2;

function shownWords(scene: AnimationScene): number {
  return countWords([scene.heading, scene.text, ...scene.items].join(" ").replace(/\|/g, " "));
}

/** How long a scene stays on screen without narration: long enough to hear its line, or to read it. */
export function readingSeconds(scene: AnimationScene): number {
  if (scene.kind === "end" && !scene.say) return END_SCENE;
  const said = countWords(scene.say);
  const seconds = said > 0 ? said / SPOKEN_PER_SECOND + ENTRANCE : shownWords(scene) / READ_PER_SECOND + ENTRANCE + 0.6;
  // A cartoon scene stays long enough for its action to play out, such as a box being opened.
  const least = scene.kind === "cartoon" && scene.cartoon ? Math.max(MIN_SCENE, ACTION_SECONDS[scene.cartoon.action]) : MIN_SCENE;
  return Math.min(MAX_SCENE, Math.max(least, seconds));
}

/**
 * When each scene starts and ends. Without narration, by reading speed. With narration, the words
 * Whisper heard are shared out in the order of the scenes, by how many words each scene says, so
 * each scene starts as its first word is spoken. Scenes after the last spoken one, such as the end
 * card, follow once the voice has finished.
 */
export function sceneTimeline(scenes: AnimationScene[], narration: Narration | null): SceneTime[] {
  const times: SceneTime[] = [];
  if (!narration || narration.words.length === 0) {
    let at = 0;
    for (const scene of scenes) {
      const length = readingSeconds(scene);
      times.push({ start: at, end: at + length });
      at += length;
    }
    return times;
  }

  // Silent scenes at the end come after the voice; every other scene shares the spoken words.
  let spoken = scenes.length;
  while (spoken > 0 && !scenes[spoken - 1].say.trim()) spoken--;
  if (spoken === 0) spoken = scenes.length;
  const weights = scenes.slice(0, spoken).map((scene) => Math.max(countWords(scene.say), 2));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const { words } = narration;
  const voiceEnd = Math.max(narration.duration, words[words.length - 1].end);

  const starts: number[] = [];
  let shared = 0;
  for (let index = 0; index < spoken; index++) {
    if (index === 0) starts.push(0);
    else {
      const word = words[Math.min(words.length - 1, Math.round((shared / total) * words.length))];
      // Each scene gets at least a moment on screen, even when the words come fast.
      starts.push(Math.max(word.start - 0.15, starts[index - 1] + 1));
    }
    shared += weights[index];
  }
  const spokenEnd = Math.max(voiceEnd + 0.4, starts[spoken - 1] + MIN_SCENE);
  for (let index = 0; index < spoken; index++) times.push({ start: starts[index], end: starts[index + 1] ?? spokenEnd });
  let at = spokenEnd;
  for (const scene of scenes.slice(spoken)) {
    const length = readingSeconds(scene);
    times.push({ start: at, end: at + length });
    at += length;
  }
  return times;
}

/** 75 → 1:15, in Persian digits for the Farsi interface. */
export function clock(seconds: number, ui: string) {
  const whole = Math.max(0, Math.round(seconds));
  const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return ui === "fa" ? text.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) : text;
}

export const totalDuration = (times: SceneTime[]) => (times.length ? times[times.length - 1].end : 0);

/** Arabic-script captions hold fewer words per line, as the words are longer. */
const wordsPerCue = (language: Language) => (languageInfo(language).script === "arabic" ? 4 : 5);

/**
 * The captions: with narration, the words as Whisper heard them, a few at a time, breaking at
 * pauses and at the end of sentences. Without it, each scene's line split into short pieces shared
 * across the time the scene is on screen.
 */
export function captionCues(scenes: AnimationScene[], times: SceneTime[], narration: Narration | null, language: Language): Cue[] {
  const most = wordsPerCue(language);
  const cues: Cue[] = [];
  if (narration && narration.words.length > 0) {
    let group: Word[] = [];
    const flush = () => {
      if (group.length) cues.push({ start: group[0].start, end: group[group.length - 1].end, text: group.map((word) => word.text.trim()).join(" ") });
      group = [];
    };
    narration.words.forEach((word, index) => {
      const previous = narration.words[index - 1];
      if (group.length && (group.length >= most || (previous && word.start - previous.end > 0.6) || /[.!?؟…,،:;]$/.test(previous?.text.trim() ?? ""))) flush();
      group.push(word);
    });
    flush();
  } else {
    scenes.forEach((scene, index) => {
      const words = scene.say.split(/\s+/).filter(Boolean);
      if (words.length === 0) return;
      const pieces: string[] = [];
      for (let at = 0; at < words.length; at += most) pieces.push(words.slice(at, at + most).join(" "));
      const start = times[index].start + 0.3;
      const span = Math.max(0.5, times[index].end - 0.2 - start);
      pieces.forEach((text, number) => {
        cues.push({ start: start + (span * number) / pieces.length, end: start + (span * (number + 1)) / pieces.length, text });
      });
    });
  }
  // A caption stays up through short gaps, so the words don't flicker on and off.
  for (let index = 0; index < cues.length - 1; index++) {
    if (cues[index + 1].start - cues[index].end < 0.35) cues[index].end = cues[index + 1].start;
  }
  return cues;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const splitPair = (text: string): [string, string] => {
  const [left = "", ...right] = text.split("|");
  return [left.trim(), right.join("|").trim()];
};

/** The closing line, from the brand, when the end card is left empty. */
function endLines(scene: AnimationScene, platform: VideoPlatform, language: Language, brand: VideoBrand): { line: string; small: string } {
  if (scene.heading || scene.text) return { line: scene.heading, small: scene.text };
  const { phrases } = languageInfo(language);
  if (platform === "youtube") return { line: phrases.subscribe, small: [brand.name, brand.headline].filter(Boolean).join(" · ") };
  const handle = platform === "reel" ? brand.instagram || brand.name : brand.name || brand.instagram;
  return { line: handle ? phrases.follow.replace("{name}", handle) : brand.name, small: brand.headline };
}

type Px = (value: number) => string;
type Fonts = ReturnType<typeof brandFonts>;

/** The light tech look: an off-white page with a faint grid, glass cards, thin glowing lines in blue, violet and cyan. */
function techCss(px: Px, lh: (latin: number) => number, fonts: Fonts, fa: boolean): string {
  const glass = `background:rgba(255,255,255,.72);color:#0B1220;border:1px solid rgba(99,102,241,.22);box-shadow:0 ${px(16)} ${px(40)} rgba(15,23,42,.08),inset 0 1px 0 rgba(255,255,255,.95);backdrop-filter:blur(${px(12)})`;
  return `#frame.t-tech{background:#F5F7FB;color:#0B1220}
.t-tech .blob{opacity:1;filter:blur(${px(30)})}
.t-tech #b1{background:radial-gradient(circle,rgba(124,58,237,.22) 0%,transparent 66%)}
.t-tech #b2{background:radial-gradient(circle,rgba(6,182,212,.24) 0%,transparent 64%)}
#grid{position:absolute;inset:0;background-image:linear-gradient(rgba(37,99,235,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(37,99,235,.08) 1px,transparent 1px);background-size:${px(54)} ${px(54)};-webkit-mask-image:radial-gradient(ellipse 85% 70% at 50% 40%,#000 30%,transparent 100%)}
#scan{position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,rgba(6,182,212,.6),transparent);box-shadow:0 0 ${px(12)} rgba(6,182,212,.6)}
.t-tech .bar{height:${px(10)};background:linear-gradient(90deg,#2563EB,#7C3AED,#06B6D4);box-shadow:0 0 ${px(18)} rgba(37,99,235,.5)}
.t-tech .title,.t-tech .statement,.t-tech .head,.t-tech blockquote{color:#0B1220}
.t-tech .sub,.t-tech .who{color:#475569}
.t-tech .label{color:#2563EB}
.t-tech .number{background:linear-gradient(120deg,#2563EB 10%,#7C3AED 55%,#06B6D4 95%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 ${px(26)} rgba(124,58,237,.28))}
.t-tech .meaning{color:#1E293B}
.t-tech .points li,.t-tech .steps li,.t-tech .col.a{${glass}}
.t-tech .points b{border-radius:${px(6)};background:#06B6D4;box-shadow:0 0 ${px(14)} rgba(6,182,212,.8)}
.t-tech .steps li{font-size:${px(60)};font-weight:700;padding:${px(32)} ${px(40)};line-height:${lh(1.2)}}
.t-tech .steps b{width:${px(104)};height:${px(104)};font-size:${px(54)};background:linear-gradient(135deg,#2563EB,#7C3AED);box-shadow:0 0 0 ${px(6)} rgba(124,58,237,.12),0 0 ${px(26)} rgba(124,58,237,.45)}
.t-tech .mark{color:#7C3AED}
.t-tech .col.b{background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;box-shadow:0 ${px(16)} ${px(40)} rgba(37,99,235,.3)}
.t-tech .end b{background:linear-gradient(90deg,#2563EB,#7C3AED);color:#fff;box-shadow:0 0 ${px(30)} rgba(124,58,237,.4)}
.t-tech .end p{color:#334155;opacity:1}
.t-tech #captions span{background:rgba(11,18,32,.82);color:#fff}
.t-tech #progress{background:linear-gradient(90deg,#2563EB,#7C3AED,#06B6D4)}
.t-tech #pipframe{background:#0B1220;box-shadow:0 0 0 ${px(8)} rgba(255,255,255,.92),0 0 0 ${px(9)} rgba(99,102,241,.35),0 ${px(26)} ${px(60)} rgba(15,23,42,.22),0 0 ${px(50)} rgba(99,102,241,.35)}
.t-tech .title,.t-tech .statement,.t-tech .head{font-family:${fonts.display};letter-spacing:${fa ? 0 : "-0.025em"}}`;
}

/** The Vox colour fields, used in turn: warm yellow, paper, navy, coral. Text on navy and coral is light. */
const FIELDS = ["#F2C230", "#F1EADB", "#1C2A4A", "#E8604C"];
const FIELD_COUNT = FIELDS.length;
const DARK_FIELDS = [2, 3];
const INK = "#161616";
const PAPER = "#FBF7EE";

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
)}")`;

/** A torn paper edge as a clip-path: every side wobbles a little, the same way every time. */
function tornEdge(): string {
  const points: string[] = [];
  const wobble = (index: number) => ((Math.sin(index * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const steps = 14;
  for (let i = 0; i <= steps; i++) points.push(`${((i / steps) * 100).toFixed(1)}% ${(wobble(i) * 5).toFixed(1)}%`);
  for (let i = 1; i < 6; i++) points.push(`${(100 - wobble(i + 20) * 1.6).toFixed(1)}% ${((i / 6) * 100).toFixed(1)}%`);
  for (let i = steps; i >= 0; i--) points.push(`${((i / steps) * 100).toFixed(1)}% ${(100 - wobble(i + 40) * 6).toFixed(1)}%`);
  for (let i = 5; i > 0; i--) points.push(`${(wobble(i + 60) * 1.6).toFixed(1)}% ${((i / 6) * 100).toFixed(1)}%`);
  return `polygon(${points.join(",")})`;
}

/** The Vox-style editorial collage look. */
function editorialCss(px: Px, lh: (latin: number) => number, fonts: Fonts, fa: boolean): string {
  const card = `background:${PAPER};color:${INK};border-radius:${px(4)};box-shadow:${px(9)} ${px(9)} 0 ${INK}`;
  return `#frame.t-editorial{background:${FIELDS[1]};color:${INK}}
.t-editorial .blob{display:none}
.field{position:absolute;inset:0;opacity:0}
${FIELDS.map((color, index) => `.f${index}{background:${color}}`).join("\n")}
#halftone{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(22,22,22,.2) 24%,transparent 28%);background-size:${px(18)} ${px(18)};-webkit-mask-image:radial-gradient(circle at 92% 8%,#000 0,transparent 36%),radial-gradient(circle at 6% 94%,#000 0,transparent 32%)}
#grain{position:absolute;inset:0;pointer-events:none;background-image:${GRAIN};opacity:.32;mix-blend-mode:multiply}
.t-editorial .scene{filter:drop-shadow(0 ${px(6)} ${px(10)} rgba(0,0,0,.14))}
.t-editorial .title,.t-editorial .statement,.t-editorial .head{font-family:${fonts.display};font-weight:${fa ? 900 : 800};color:${INK};letter-spacing:${fa ? 0 : "-0.03em"}}
.t-editorial .title{font-size:${px(118)};line-height:${lh(1)}}
.t-editorial .on-dark .statement,.t-editorial .on-dark .head,.t-editorial .on-dark .meaning,.t-editorial .on-dark .sub,.t-editorial .on-dark blockquote,.t-editorial .on-dark .who{color:${PAPER}}
.cut{position:relative;isolation:isolate;align-self:flex-start;max-width:100%;padding:${px(34)} ${px(46)} ${px(44)};rotate:-1.4deg}
.cut::before{content:"";position:absolute;inset:0;background:${PAPER};clip-path:${tornEdge()};z-index:-1}
.tape{position:absolute;top:${px(-22)};inset-inline-start:${px(60)};width:${px(170)};height:${px(48)};background:rgba(255,255,255,.62);border-inline:${px(3)} dashed rgba(0,0,0,.08);rotate:-5deg;box-shadow:0 ${px(2)} ${px(6)} rgba(0,0,0,.12)}
.t-editorial .sub{font-size:${px(48)};font-weight:700;color:${INK};line-height:${lh(1.3)}}
.t-editorial .label{color:${INK}}
.t-editorial .label span{display:inline-block;background:${INK};color:${FIELDS[0]};padding:${px(8)} ${px(20)};rotate:-1.5deg}
.under{position:relative}
.mark-line{display:block;height:${px(44)};margin-top:${px(4)}}
.mark-line svg{display:block;width:72%;height:100%;overflow:visible}
.mark-ring{position:absolute;inset:-20% -9%;pointer-events:none}
.mark-ring svg{width:100%;height:100%;overflow:visible}
.mark-line path,.mark-ring path{fill:none;stroke:${FIELDS[3]};stroke-width:${px(11)};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:var(--draw,1)}
.on-dark .mark-line path,.on-dark .mark-ring path{stroke:${FIELDS[0]}}
.circled{position:relative;align-self:flex-start;padding:0 ${px(24)};margin-inline-start:${px(36)}}
.t-editorial .number{color:${INK}}
.t-editorial .on-dark .number{color:${FIELDS[0]}}
.t-editorial .meaning span{background:linear-gradient(transparent 58%,rgba(232,96,76,.5) 58%);padding:0 ${px(6)}}
.t-editorial .on-dark .meaning span{background:linear-gradient(transparent 58%,rgba(242,194,48,.45) 58%)}
.bars{position:absolute;inset-inline-end:0;bottom:0;width:46%;height:62%;display:flex;align-items:flex-end;gap:${px(16)};opacity:.2;z-index:-1}
.bars i{flex:1;background:${INK};transform-origin:bottom;transform:scaleY(0)}
.on-dark .bars i{background:${PAPER}}
.t-editorial .points li,.t-editorial .steps li,.t-editorial .col.a{${card}}
.t-editorial .points li:nth-child(odd),.t-editorial .steps li:nth-child(odd){rotate:-0.8deg}
.t-editorial .points li:nth-child(even),.t-editorial .steps li:nth-child(even){rotate:0.7deg}
.t-editorial .points b{border-radius:0;background:${FIELDS[3]}}
.t-editorial .steps li{font-size:${px(58)};font-weight:700}
.t-editorial .steps b{width:${px(96)};height:${px(96)};font-size:${px(50)};background:${FIELDS[0]};color:${INK};border:${px(5)} solid ${INK}}
.t-editorial .mark{color:${FIELDS[3]}}
.t-editorial blockquote{color:${INK}}
.t-editorial .col.b{background:${FIELDS[2]};color:${PAPER};border-radius:${px(4)};box-shadow:${px(9)} ${px(9)} 0 ${INK}}
.t-editorial .end b{background:${INK};color:${FIELDS[0]};border-radius:${px(6)}}
.t-editorial .end p{color:${INK};opacity:1}
.t-editorial .on-dark .end p{color:${PAPER}}
.t-editorial #captions span{background:${INK};color:${PAPER};border-radius:${px(6)}}
.t-editorial #progress{background:${FIELDS[3]}}
.t-editorial #pipframe{background:${INK};box-shadow:0 0 0 ${px(14)} #fff,${px(14)} ${px(14)} 0 ${px(14)} ${INK}}
.t-editorial #pipframe .tape{top:${px(-34)};inset-inline-start:auto;inset-inline-end:${px(40)};rotate:6deg}`;
}

// Hand-drawn marks for the editorial look. pathLength="1" lets the page draw each one in, from 0 to 1.
const MARKER_RING = `<svg class="ring" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M214 14C120 8 26 40 18 98c-8 58 92 92 196 88 104-4 172-40 168-92C378 40 300 12 196 18c-40 2-78 10-104 22"/></svg>`;
const MARKER_LINE = `<svg class="swoosh" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M6 28C120 14 260 10 380 16c80 4 150 10 210 2"/></svg>`;

/** Five abstract bars that grow behind a big number, unlabelled, like a Vox chart. */
const growingBars = () =>
  `<div class="bars" aria-hidden="true">${[0.32, 0.5, 0.44, 0.72, 1]
    .map((h, index) => `<i data-grow="${(0.15 + index * 0.12).toFixed(2)}" style="height:${Math.round(h * 100)}%"></i>`)
    .join("")}</div>`;

/** The scene's markup. data-d is when a part comes in, in seconds after the scene starts. */
function sceneBody(scene: AnimationScene, platform: VideoPlatform, language: Language, brand: VideoBrand, theme: AnimationTheme = "brand"): string {
  const heading = escape(scene.heading);
  const text = escape(scene.text);
  const items = scene.items.map(escape);
  const paper = theme === "editorial";
  switch (scene.kind) {
    case "title":
      if (paper) {
        return `<div class="cut" data-d="0.05"><i class="tape"></i><h1 class="title">${heading}</h1></div>${text ? `<p class="sub" data-d="0.5">${text}</p>` : ""}<span class="mark-line" data-draw="0.55">${MARKER_LINE}</span>`;
      }
      return `<i class="bar" data-d="0"></i><h1 class="title" data-d="0.1">${heading}</h1>${text ? `<p class="sub" data-d="0.45">${text}</p>` : ""}`;
    case "statement":
      if (paper) {
        return `${text ? `<p class="label" data-d="0"><span>${text}</span></p>` : ""}<div class="under"><h2 class="statement" data-d="0.12">${heading}</h2><span class="mark-line" data-draw="0.55">${MARKER_LINE}</span></div>`;
      }
      return `${text ? `<p class="label" data-d="0">${text}</p>` : ""}<h2 class="statement" data-d="0.12">${heading}</h2><i class="bar" data-d="0.45"></i>`;
    case "number":
      if (paper) {
        return `${growingBars()}<div class="circled"><div class="number" data-d="0" data-count="${escape(scene.text)}">${text}</div><span class="mark-ring" data-draw="0.7">${MARKER_RING}</span></div><h2 class="meaning" data-d="0.5"><span>${heading}</span></h2>`;
      }
      return `<div class="number" data-d="0" data-count="${escape(scene.text)}">${text}</div><h2 class="meaning" data-d="0.5">${heading}</h2>`;
    case "points":
      return `${heading ? `<h2 class="head" data-d="0">${heading}</h2>` : ""}<ul class="points">${items
        .map((item, index) => `<li data-d="${(0.35 + index * 0.4).toFixed(2)}"><b></b><span>${item}</span></li>`)
        .join("")}</ul>`;
    case "steps":
      return `${heading ? `<h2 class="head" data-d="0">${heading}</h2>` : ""}<ol class="steps">${items
        .map((item, index) => `<li data-d="${(0.35 + index * 0.45).toFixed(2)}"><b>${(index + 1).toLocaleString(languageInfo(language).locale)}</b><span>${item}</span></li>`)
        .join("")}</ol>`;
    case "quote":
      return `<div class="mark" data-d="0">“</div><blockquote data-d="0.15">${text}</blockquote>${heading ? `<p class="who" data-d="0.6">— ${heading}</p>` : ""}`;
    case "compare": {
      const [left, right] = splitPair(scene.text);
      const rows = scene.items.map(splitPair);
      return `${heading ? `<h2 class="head" data-d="0">${heading}</h2>` : ""}<div class="compare"><div class="col a" data-d="0.3"><h3>${escape(left)}</h3>${rows
        .map(([a], index) => `<p data-d="${(0.55 + index * 0.35).toFixed(2)}">${escape(a)}</p>`)
        .join("")}</div><div class="col b" data-d="0.45"><h3>${escape(right)}</h3>${rows
        .map(([, b], index) => `<p data-d="${(0.7 + index * 0.35).toFixed(2)}">${escape(b)}</p>`)
        .join("")}</div></div>`;
    }
    case "cartoon": {
      const { width, height } = VIDEO_FORMATS[platform];
      const layout = cartoonLayout(width, height, languageInfo(language).dir === "rtl");
      return cartoonScene(scene.cartoon ?? cleanCartoon(null), scene.heading, scene.text, layout, brandPalette(brand.colors));
    }
    case "end": {
      const end = endLines(scene, platform, language, brand);
      return `<div class="end"><b data-d="0">${escape(end.line)}</b>${end.small ? `<p data-d="0.35">${escape(end.small)}</p>` : ""}</div>`;
    }
  }
}

export type AnimationPage = {
  scenes: AnimationScene[];
  times: SceneTime[];
  cues: Cue[];
  platform: VideoPlatform;
  language: Language;
  brand: VideoBrand;
  /** preview plays by itself in the browser, scaled to fit, with the narration when there is one. */
  preview?: { audio: string | null; playLabel: string };
  /** The look of the text cards. Brand by default. */
  theme?: AnimationTheme;
  /**
   * An explainer laid over your own clip by the video editor. The scenes keep clear of the captions
   * the editor draws on top, there is no progress bar, and with pip they leave room for the card
   * your clip plays in, which the page frames.
   */
  insert?: { pip: PipBox | null };
};

/**
 * The whole animation as one page. window.seek(t) shows the moment t seconds in, the same way
 * every time, which is what lets Chrome draw it frame by frame.
 */
export function animationHtml({ scenes, times, cues, platform, language, brand, preview, theme = "brand", insert }: AnimationPage): string {
  const { width, height } = VIDEO_FORMATS[platform];
  const info = languageInfo(language);
  const fa = info.script === "arabic";
  const rtl = info.dir === "rtl";
  const wide = width > height;
  const fonts = brandFonts(language, brand.headingStyle);
  const C = brandPalette(brand.colors);
  const u = Math.min(width, height) / 1080;
  const pip = insert?.pip ?? null;
  // Beside a picture-in-picture card the text is drawn smaller, so it fits the smaller area.
  const k = pip ? (wide ? 0.8 : 0.72) : 1;
  const px = (value: number) => `${Math.round(value * u * k)}px`;
  const room = (value: number) => `${Math.round(value * u)}px`;
  const lh = (latin: number) => (fa ? latin + 0.35 : latin);
  // Portrait videos keep the lower part clear for captions and the app's own buttons.
  // 9:16 keeps room for the app's buttons at the bottom; 4:5 and 16:9 need less.
  // Over a clip, the scenes also stay above the editor's captions, which sit higher on 9:16.
  const tall = height / width > 1.5;
  const stage = pip
    ? wide
      ? `top:${room(90)};bottom:${room(220)};${rtl ? `right:${room(140)};left:${pip.x + pip.w + 70}px` : `left:${room(140)};right:${width - pip.x + 70}px`}`
      : `top:${room(tall ? 300 : 110)};bottom:${height - pip.y + 64}px;left:${room(90)};right:${room(90)}`
    : wide
      ? `top:${room(90)};bottom:${room(220)};left:${room(140)};right:${room(140)}`
      : tall
        ? `top:${room(insert ? 290 : 200)};bottom:${room(insert ? 700 : 560)};left:${room(90)};right:${room(90)}`
        : `top:${room(110)};bottom:${room(330)};left:${room(90)};right:${room(90)}`;
  const captionsAt = wide ? room(70) : tall ? room(330) : room(110);
  const total = totalDuration(times);
  const data = JSON.stringify({ times, cues, total, locale: info.locale, theme }).replace(/</g, "\\u003c");
  const look = theme === "tech" ? techCss(px, lh, fonts, fa) : theme === "editorial" ? editorialCss(px, lh, fonts, fa) : "";
  const fields = theme === "editorial" ? scenes.map((_, index) => `<div class="field f${index % FIELD_COUNT}" data-f="${index}"></div>`).join("") : "";
  const frameDecor =
    theme === "tech"
      ? `<div id="grid"></div><div id="scan"></div>`
      : theme === "editorial"
        ? `${fields}<div id="halftone"></div><div id="grain"></div>`
        : "";
  const pipFrame = pip
    ? `<div id="pipframe" style="left:${pip.x}px;top:${pip.y}px;width:${pip.w}px;height:${pip.h}px;border-radius:${pip.r}px">${theme === "editorial" ? `<i class="tape"></i>` : ""}</div>`
    : "";

  return `<!doctype html><html lang="${language}" dir="${info.dir}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
/* The page lays out left to right so the scaled frame (origin top left) stays in view; the frame keeps the language's direction. */
body{background:${preview ? "#000" : C.deep};overflow:hidden;direction:ltr}
#frame{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${C.deep};color:#fff;font-family:${fonts.body};transform-origin:0 0;direction:${info.dir}}
.blob{position:absolute;border-radius:50%;filter:blur(${px(10)});opacity:.55}
#b1{width:${px(900)};height:${px(900)};background:radial-gradient(circle,${C.cobalt} 0%,transparent 68%)}
#b2{width:${px(700)};height:${px(700)};background:radial-gradient(circle,${C.amber}55 0%,transparent 66%)}
#progress{position:absolute;top:0;inset-inline-start:0;height:${px(10)};background:${C.amber};width:0}
.scene{position:absolute;${stage};display:flex;flex-direction:column;justify-content:center;gap:${px(34)};opacity:0}
[data-d]{opacity:0}
h1,h2,h3,p,ul,ol,blockquote{margin:0}
.bar{display:block;width:${px(150)};height:${px(16)};border-radius:${px(8)};background:${C.amber}}
.title{font-family:${fonts.display};font-weight:${fa ? 800 : 700};font-size:${px(wide ? 112 : 124)};line-height:${lh(1.04)};letter-spacing:${fa ? 0 : "-0.02em"}}
.sub{font-size:${px(50)};line-height:${lh(1.3)};color:${C.periwinkle};font-weight:500}
.label{font-size:${px(38)};font-weight:700;text-transform:${fa ? "none" : "uppercase"};letter-spacing:${fa ? 0 : "0.08em"};color:${C.amber}}
.statement{font-family:${fonts.display};font-weight:${fa ? 800 : 700};font-size:${px(wide ? 92 : 100)};line-height:${lh(1.12)}}
.number{font-family:${fonts.display};font-weight:800;font-size:${px(wide ? 260 : 300)};line-height:1;color:${C.amber};letter-spacing:${fa ? 0 : "-0.04em"}}
.meaning{font-size:${px(64)};font-weight:600;line-height:${lh(1.25)}}
.head{font-family:${fonts.display};font-weight:${fa ? 800 : 700};font-size:${px(wide ? 78 : 84)};line-height:${lh(1.1)}}
.points,.steps{list-style:none;padding:0;display:flex;flex-direction:column;gap:${px(26)}}
.points li,.steps li{display:flex;align-items:center;gap:${px(30)};background:rgba(255,255,255,.08);border-radius:${px(28)};padding:${px(28)} ${px(36)};font-size:${px(52)};font-weight:600;line-height:${lh(1.25)}}
.points b{flex:none;width:${px(26)};height:${px(26)};border-radius:50%;background:${C.amber}}
.steps b{flex:none;display:grid;place-items:center;width:${px(84)};height:${px(84)};border-radius:50%;background:${C.cobalt};color:#fff;font-size:${px(44)};font-weight:800}
.mark{font-family:${fonts.display};font-size:${px(260)};line-height:.6;height:${px(120)};color:${C.amber}}
blockquote{font-family:${fonts.display};font-size:${px(wide ? 74 : 80)};font-weight:${fa ? 700 : 600};font-style:${fa ? "normal" : "italic"};line-height:${lh(1.2)}}
.who{font-size:${px(44)};color:${C.periwinkle};font-weight:600}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:${px(28)}}
.col{border-radius:${px(30)};padding:${px(34)};display:flex;flex-direction:column;gap:${px(22)}}
.col.a{background:${C.canvas};color:${C.ink}}
.col.b{background:${C.cobalt};color:#fff}
.col h3{font-size:${px(46)};font-weight:800;line-height:${lh(1.2)}}
.col p{font-size:${px(42)};font-weight:500;line-height:${lh(1.3)}}
.end{display:flex;flex-direction:column;align-items:center;text-align:center;gap:${px(36)}}
.end b{display:inline-block;background:${C.amber};color:${C.ink};border-radius:${px(999)};padding:${px(26)} ${px(56)};font-size:${px(66)};font-weight:800;line-height:${lh(1.2)}}
.end p{font-size:${px(44)};font-weight:600;opacity:.9;line-height:${lh(1.4)}}
#pipframe{position:absolute;background:#000;box-shadow:0 0 0 ${px(8)} ${C.amber},0 ${px(20)} ${px(50)} rgba(0,0,0,.45)}
#captions{position:absolute;left:${px(70)};right:${px(70)};bottom:${captionsAt};display:flex;justify-content:center;pointer-events:none}
#captions span{display:inline-block;max-width:100%;text-align:center;background:rgba(0,0,0,.62);color:#fff;border-radius:${px(22)};padding:${px(14)} ${px(30)};font-size:${px(wide ? 52 : 60)};font-weight:700;line-height:${lh(1.3)};opacity:0}
${scenes.some((scene) => scene.kind === "cartoon") ? cartoonCss(px, C, fonts, lh) : ""}
${look}
${insert ? `#progress{display:none}` : ""}
${preview ? `#play{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35);border:0;color:#fff;font:600 18px system-ui;cursor:pointer}` : ""}
</style></head><body><div id="frame" class="t-${theme}">
<div class="blob" id="b1"></div><div class="blob" id="b2"></div>${frameDecor}
${scenes
  .map((scene, index) => {
    const cartoon = scene.kind === "cartoon" ? cartoonLayout(width, height, info.dir === "rtl") : null;
    const extra = cartoon
      ? ` data-action="${(scene.cartoon ?? cleanCartoon(null)).action}" data-talk="${scene.say.trim() ? 1 : 0}" data-g="${cartoon.G}" data-w="${width}" data-h="${height}"`
      : "";
    const dark = theme === "editorial" && DARK_FIELDS.includes(index % FIELD_COUNT) ? " on-dark" : "";
    return `<section class="scene k-${scene.kind}${dark}" data-i="${index}"${extra}>${sceneBody(scene, platform, language, brand, theme)}</section>`;
  })
  .join("\n")}
${pipFrame}<div id="captions"><span></span></div><div id="progress"></div>
</div>
${preview ? `${preview.audio ? `<audio id="voice" src="${escape(preview.audio)}" preload="auto"></audio>` : ""}<button id="play" type="button">▶ ${escape(preview.playLabel)}</button>` : ""}
<script>
(function(){
var D=${data},W=${width},H=${height};
var scenes=[].slice.call(document.querySelectorAll('.scene'));
var parts=scenes.map(function(s){return [].slice.call(s.querySelectorAll('[data-d]'))});
var cap=document.querySelector('#captions span'),bar=document.getElementById('progress');
var b1=document.getElementById('b1'),b2=document.getElementById('b2');
var draws=scenes.map(function(s){return [].slice.call(s.querySelectorAll('[data-draw]'))});
var grows=scenes.map(function(s){return [].slice.call(s.querySelectorAll('[data-grow]'))});
var fields=[].slice.call(document.querySelectorAll('.field')),scan=document.getElementById('scan');
var SNAP=D.theme==='editorial';
var FA='۰۱۲۳۴۵۶۷۸۹';
function clamp(v){return v<0?0:v>1?1:v}
function ease(v){v=clamp(v);return 1-Math.pow(1-v,3)}
function back(v){v=clamp(v);var c=1.9;return 1+(c+1)*Math.pow(v-1,3)+c*Math.pow(v-1,2)}
function count(el,p){
  var raw=el.getAttribute('data-count')||'';var fa=/[۰-۹]/.test(raw);
  var latin=raw.replace(/[۰-۹]/g,function(c){return FA.indexOf(c)});
  var m=latin.match(/^(\\D*)(\\d[\\d,]*(?:\\.\\d+)?)(.*)$/);
  if(!m){el.textContent=raw;return}
  var target=parseFloat(m[2].replace(/,/g,''));var dec=(m[2].split('.')[1]||'').length;
  var n=(target*ease(p)).toFixed(dec);if(m[2].indexOf(',')>=0)n=Number(n).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  var out=m[1]+n+m[3];if(fa)out=out.replace(/\\d/g,function(d){return FA[d]});el.textContent=out;
}
${CARTOON_SCRIPT}
function seek(t){
  for(var i=0;i<scenes.length;i++){
    var s=D.times[i],local=t-s.start,len=s.end-s.start,el=scenes[i];
    if(local<0||local>=len){el.style.opacity=0;if(fields[i])fields[i].style.opacity=0;continue}
    var out=i===scenes.length-1?1:clamp((len-local)/0.35);
    // The editorial look pushes in slowly through each scene, like a camera on a paper collage.
    var push=SNAP?1+0.035*clamp(local/Math.max(len,1)):1;
    el.style.opacity=out;el.style.transform='scale('+((0.97+0.03*out)*push)+')';
    if(fields[i]){var w=ease(local/0.32);fields[i].style.opacity=1;fields[i].style.clipPath='inset(0 '+((1-w)*100)+'% 0 0)'}
    if(el.hasAttribute('data-action'))cartoon(el,local,len,el.getAttribute('data-talk')==='1');
    for(var j=0;j<parts[i].length;j++){
      var p=parts[i][j],d=parseFloat(p.getAttribute('data-d'))||0,v=ease((local-d)/0.55);
      if(SNAP){var m=back((local-d)/0.42);p.style.opacity=ease((local-d)/0.2);p.style.transform='translateY('+((1-m)*${Math.round(60 * u)})+'px) rotate('+((1-m)*-2.5)+'deg)'}
      else{p.style.opacity=v;p.style.transform='translateY('+((1-v)*${Math.round(46 * u)})+'px)'}
      if(p.hasAttribute('data-count'))count(p,(local-d)/1.1);
    }
    for(var q=0;q<draws[i].length;q++){var r=draws[i][q],rd=parseFloat(r.getAttribute('data-draw'))||0;r.style.setProperty('--draw',String(1-ease((local-rd)/0.6)))}
    for(var g=0;g<grows[i].length;g++){var b=grows[i][g],bd=parseFloat(b.getAttribute('data-grow'))||0;b.style.transform='scaleY('+(SNAP?back((local-bd)/0.5):ease((local-bd)/0.5))+')'}
  }
  if(scan)scan.style.transform='translateY('+(((t*0.12)%1)*H)+'px)';
  var text='',ct=0;
  for(var k=0;k<D.cues.length;k++){var c=D.cues[k];if(t>=c.start&&t<c.end){text=c.text;ct=t-c.start;break}}
  if(cap.textContent!==text)cap.textContent=text;
  var cv=text?ease(ct/0.18):0;cap.style.opacity=cv;cap.style.transform='scale('+(0.92+0.08*cv)+')';
  bar.style.width=(D.total?Math.min(100,t/D.total*100):0)+'%';
  b1.style.transform='translate('+(W*0.45+Math.sin(t*0.35)*W*0.18-${Math.round(450 * u)})+'px,'+(H*0.22+Math.cos(t*0.27)*H*0.08-${Math.round(450 * u)})+'px)';
  b2.style.transform='translate('+(W*0.2+Math.cos(t*0.3)*W*0.15-${Math.round(350 * u)})+'px,'+(H*0.78+Math.sin(t*0.41)*H*0.06-${Math.round(350 * u)})+'px)';
}
window.seek=seek;window.ANIMATION_LENGTH=D.total;seek(0);
${
  preview
    ? `var frame=document.getElementById('frame'),voice=document.getElementById('voice'),play=document.getElementById('play');
function fit(){var k=Math.min(innerWidth/W,innerHeight/H);frame.style.transform='scale('+k+')';frame.style.marginLeft=frame.style.marginRight='0';document.body.style.paddingLeft=((innerWidth-W*k)/2)+'px';document.body.style.paddingTop=((innerHeight-H*k)/2)+'px'}
addEventListener('resize',fit);fit();seek(Math.min(1.6,D.total/2));
var started=0,running=false;
function now(){return voice&&!voice.paused?voice.currentTime:(performance.now()-started)/1000}
function tick(){if(!running)return;var t=now();if(t>=D.total+0.6){running=false;play.style.display='';if(voice)voice.pause();seek(D.total-0.01);return}seek(t);requestAnimationFrame(tick)}
play.addEventListener('click',function(){play.style.display='none';started=performance.now();running=true;if(voice){voice.currentTime=0;voice.play().catch(function(){})}requestAnimationFrame(tick)});`
    : ""
}
})();
</script></body></html>`;
}
