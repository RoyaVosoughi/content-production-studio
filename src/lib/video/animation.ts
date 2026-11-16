import { brandFonts, brandPalette } from "../brand-style";
import type { Word } from "../db/schema";
import { languageInfo, type Language } from "../language";
import { VIDEO_FORMATS, type VideoPlatform } from "../platforms";
import type { VideoBrand } from "./overlays";

// An explainer animation made from any script: a list of scenes drawn in the brand's colours and
// fonts, timed by reading speed or by an uploaded narration, and played by one page that can show
// any moment on demand. Chrome draws each frame of that page, and FFmpeg joins them into a video.
// Kept free of server code, so the scene editor and the tests can use it.

/** Change this when a design or the timing changes, so animations made the old way are made again. */
export const ANIMATION_VERSION = 1;

export const SCENE_KINDS = ["title", "statement", "number", "points", "steps", "quote", "compare", "end"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

/**
 * One scene. `say` is the part of the script read while it's on screen, which is also its caption.
 * What the other fields mean depends on the kind:
 * - title: heading, with text as a subtitle
 * - statement: heading as one big line, with text as a small label above it
 * - number: text is the big number (such as 73%), heading says what it means
 * - points, steps: heading, then up to five items
 * - quote: text is the quote, heading says who said it
 * - compare: heading, text is the two column names as "A | B", each item a row as "left | right"
 * - end: heading and text, or the brand's follow line when both are empty
 */
export type AnimationScene = { kind: SceneKind; say: string; heading: string; text: string; items: string[] };

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
export function cleanScenes(scenes: Partial<AnimationScene>[]): AnimationScene[] {
  return scenes
    .slice(0, SCENE_LIMITS.scenes)
    .map((scene) => {
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
      };
    })
    .filter((scene) => scene.kind === "end" || scene.say || scene.heading || scene.text || scene.items.length > 0);
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
 * Scenes made without the AI: the title first, then one big line for every few sentences, then the
 * end card. Plain, but it covers the whole script in order and can be changed scene by scene.
 */
export function simpleScenes(title: string, script: string): AnimationScene[] {
  const scenes: AnimationScene[] = [];
  const parts = sentences(script);
  let group: string[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const say = group.join(" ");
    scenes.push({ kind: "statement", say, heading: shorten(group[0].replace(/[.!?؟…]+$/, ""), 14), text: "", items: [] });
    group = [];
  };
  for (const part of parts) {
    group.push(part);
    if (countWords(group.join(" ")) >= 22) flush();
  }
  flush();
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
  return Math.min(MAX_SCENE, Math.max(MIN_SCENE, seconds));
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

/** The scene's markup. data-d is when a part comes in, in seconds after the scene starts. */
function sceneBody(scene: AnimationScene, platform: VideoPlatform, language: Language, brand: VideoBrand): string {
  const heading = escape(scene.heading);
  const text = escape(scene.text);
  const items = scene.items.map(escape);
  switch (scene.kind) {
    case "title":
      return `<i class="bar" data-d="0"></i><h1 class="title" data-d="0.1">${heading}</h1>${text ? `<p class="sub" data-d="0.45">${text}</p>` : ""}`;
    case "statement":
      return `${text ? `<p class="label" data-d="0">${text}</p>` : ""}<h2 class="statement" data-d="0.12">${heading}</h2><i class="bar" data-d="0.45"></i>`;
    case "number":
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
};

/**
 * The whole animation as one page. window.seek(t) shows the moment t seconds in, the same way
 * every time, which is what lets Chrome draw it frame by frame.
 */
export function animationHtml({ scenes, times, cues, platform, language, brand, preview }: AnimationPage): string {
  const { width, height } = VIDEO_FORMATS[platform];
  const info = languageInfo(language);
  const fa = info.script === "arabic";
  const wide = width > height;
  const fonts = brandFonts(language, brand.headingStyle);
  const C = brandPalette(brand.colors);
  const u = Math.min(width, height) / 1080;
  const px = (value: number) => `${Math.round(value * u)}px`;
  const lh = (latin: number) => (fa ? latin + 0.35 : latin);
  // Portrait videos keep the lower part clear for captions and the app's own buttons.
  // 9:16 keeps room for the app's buttons at the bottom; 4:5 and 16:9 need less.
  const tall = height / width > 1.5;
  const stage = wide
    ? `top:${px(90)};bottom:${px(220)};left:${px(140)};right:${px(140)}`
    : tall
      ? `top:${px(200)};bottom:${px(560)};left:${px(90)};right:${px(90)}`
      : `top:${px(110)};bottom:${px(330)};left:${px(90)};right:${px(90)}`;
  const captionsAt = wide ? px(70) : tall ? px(330) : px(110);
  const total = totalDuration(times);
  const data = JSON.stringify({ times, cues, total, locale: info.locale }).replace(/</g, "\\u003c");

  return `<!doctype html><html lang="${language}" dir="${info.dir}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${preview ? "#000" : C.deep};overflow:hidden}
#frame{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${C.deep};color:#fff;font-family:${fonts.body};transform-origin:0 0}
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
#captions{position:absolute;left:${px(70)};right:${px(70)};bottom:${captionsAt};display:flex;justify-content:center;pointer-events:none}
#captions span{display:inline-block;max-width:100%;text-align:center;background:rgba(0,0,0,.62);color:#fff;border-radius:${px(22)};padding:${px(14)} ${px(30)};font-size:${px(wide ? 52 : 60)};font-weight:700;line-height:${lh(1.3)};opacity:0}
${preview ? `#play{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35);border:0;color:#fff;font:600 18px system-ui;cursor:pointer}` : ""}
</style></head><body><div id="frame">
<div class="blob" id="b1"></div><div class="blob" id="b2"></div>
${scenes.map((scene, index) => `<section class="scene k-${scene.kind}" data-i="${index}">${sceneBody(scene, platform, language, brand)}</section>`).join("\n")}
<div id="captions"><span></span></div><div id="progress"></div>
</div>
${preview ? `${preview.audio ? `<audio id="voice" src="${escape(preview.audio)}" preload="auto"></audio>` : ""}<button id="play" type="button">▶ ${escape(preview.playLabel)}</button>` : ""}
<script>
(function(){
var D=${data},W=${width},H=${height};
var scenes=[].slice.call(document.querySelectorAll('.scene'));
var parts=scenes.map(function(s){return [].slice.call(s.querySelectorAll('[data-d]'))});
var cap=document.querySelector('#captions span'),bar=document.getElementById('progress');
var b1=document.getElementById('b1'),b2=document.getElementById('b2');
var FA='۰۱۲۳۴۵۶۷۸۹';
function clamp(v){return v<0?0:v>1?1:v}
function ease(v){v=clamp(v);return 1-Math.pow(1-v,3)}
function count(el,p){
  var raw=el.getAttribute('data-count')||'';var fa=/[۰-۹]/.test(raw);
  var latin=raw.replace(/[۰-۹]/g,function(c){return FA.indexOf(c)});
  var m=latin.match(/^(\\D*)(\\d[\\d,]*(?:\\.\\d+)?)(.*)$/);
  if(!m){el.textContent=raw;return}
  var target=parseFloat(m[2].replace(/,/g,''));var dec=(m[2].split('.')[1]||'').length;
  var n=(target*ease(p)).toFixed(dec);if(m[2].indexOf(',')>=0)n=Number(n).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  var out=m[1]+n+m[3];if(fa)out=out.replace(/\\d/g,function(d){return FA[d]});el.textContent=out;
}
function seek(t){
  for(var i=0;i<scenes.length;i++){
    var s=D.times[i],local=t-s.start,len=s.end-s.start,el=scenes[i];
    if(local<0||local>=len){el.style.opacity=0;continue}
    var out=i===scenes.length-1?1:clamp((len-local)/0.35);
    el.style.opacity=out;el.style.transform='scale('+(0.97+0.03*out)+')';
    for(var j=0;j<parts[i].length;j++){
      var p=parts[i][j],d=parseFloat(p.getAttribute('data-d'))||0,v=ease((local-d)/0.55);
      p.style.opacity=v;p.style.transform='translateY('+((1-v)*${Math.round(46 * u)})+'px)';
      if(p.hasAttribute('data-count'))count(p,(local-d)/1.1);
    }
  }
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
