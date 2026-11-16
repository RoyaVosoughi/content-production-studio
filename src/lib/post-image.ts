import { brandFonts, brandPalette } from "./brand-style";
import type { PieceContent } from "./db/schema";
import { languageInfo, type Language } from "./language";
import type { SlideBrand } from "./slides";

// One picture that goes out with a LinkedIn post or a website article, drawn in the brand's colours and
// fonts. The same page is the live preview in the editor and the JPEG that is posted, so what you
// approve is what goes out. Kept free of server code so the editor can use it.

export const IMAGE_KINDS = ["cover", "quote", "points"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const IMAGE_SIZES = {
  square: { width: 1200, height: 1200 },
  portrait: { width: 1080, height: 1350 },
  wide: { width: 1200, height: 630 },
} as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

/**
 * cover: a heading with an optional line under it, and an optional photo behind.
 * quote: heading is the quote, text says who said it (optional; your name is always in the corner).
 * points: a heading and up to five short points.
 */
export type PostImage = {
  kind: ImageKind;
  size: ImageSize;
  heading: string;
  text: string;
  items: string[];
  /** A photo behind the cover, by its file name in the media folder. */
  photo?: string;
};

export const IMAGE_LIMITS = { heading: 160, text: 240, item: 120, items: 5 } as const;

/** Change this when the design changes, so images made with the old design aren't reused. */
export const IMAGE_VERSION = 1;

export const isImageKind = (value: unknown): value is ImageKind => IMAGE_KINDS.includes(value as ImageKind);
export const isImageSize = (value: unknown): value is ImageSize =>
  typeof value === "string" && Object.hasOwn(IMAGE_SIZES, value);

const clip = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");

/** Keeps only what the template can draw. Returns null when there is nothing to show. */
export function cleanImage(value: unknown): PostImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = isImageKind(raw.kind) ? raw.kind : "cover";
  const size = isImageSize(raw.size) ? raw.size : "square";
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => clip(item, IMAGE_LIMITS.item))
    .filter(Boolean)
    .slice(0, IMAGE_LIMITS.items);
  const image: PostImage = {
    kind,
    size,
    heading: clip(raw.heading, IMAGE_LIMITS.heading),
    text: clip(raw.text, IMAGE_LIMITS.text),
    items: kind === "points" ? items : [],
  };
  if (kind === "cover" && typeof raw.photo === "string" && /^[\w.-]+$/.test(raw.photo)) image.photo = raw.photo;
  return image;
}

/** Why this image can't go out yet, or null. */
export function imageProblem(image: PostImage): string | null {
  if (!image.heading) return image.kind === "quote" ? "The image needs the quote." : "The image needs a heading.";
  if (image.kind === "points" && image.items.length < 2) return "A points image needs at least two points.";
  return null;
}

/** Words for people who can't see the image, sent with it. */
export function imageAlt(image: PostImage): string {
  return [image.heading, image.text, ...image.items].filter(Boolean).join(". ").slice(0, 400);
}

const LIST_LINE = /^\s*(?:[-•*–]|\d+[.)]|[۰-۹]+[.)])\s+(.+)$/;
const plain = (line: string) => line.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();

/** The first sentence or line, cut at a word so it fits. */
function firstSentence(text: string, limit: number): string {
  const line = text.split(/\n/).map(plain).find(Boolean) ?? "";
  // A clause cut off at a semicolon or comma reads better without it.
  const sentence = (line.match(/^.+?[.!?؟](?=\s|$)/u)?.[0] ?? line).replace(/[\s;:,،؛]+$/u, "");
  if (sentence.length <= limit) return sentence;
  const cut = sentence.slice(0, limit);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), limit / 2)).trim()}…`;
}

/** Points for a points image: the post's list when it has one, otherwise its first sentences. */
export function draftPoints(body: string): string[] {
  const listed = body
    .split(/\n/)
    .map((line) => line.match(LIST_LINE)?.[1])
    .filter((line): line is string => Boolean(line));
  if (listed.length >= 2) return listed.slice(0, 4).map((point) => firstSentence(point, 90));
  const sentences = plain(body.replace(/\n+/g, " ")).match(/[^.!?؟]+[.!?؟]?/gu) ?? [];
  return sentences
    .map((sentence) => firstSentence(sentence, 90))
    .filter((sentence) => sentence.length > 3)
    .slice(1, 4);
}

/**
 * A first draft of the image from the post itself, made by code so it costs nothing:
 * an article gets a wide cover with its title, a post with a list gets the points, and any
 * other post gets its opening line as a quote.
 */
export function suggestImage(platform: "linkedin" | "website", content: PieceContent): PostImage {
  if (platform === "website") {
    return {
      kind: "cover",
      size: "wide",
      heading: clip(content.title, IMAGE_LIMITS.heading) || firstSentence(content.body, 90),
      text: firstSentence(content.excerpt ?? "", 140),
      items: [],
    };
  }
  const listed = content.body.split(/\n/).filter((line) => LIST_LINE.test(line)).length;
  if (listed >= 2) {
    return { kind: "points", size: "square", heading: firstSentence(content.body, 90), text: "", items: draftPoints(content.body) };
  }
  return { kind: "quote", size: "square", heading: firstSentence(content.body, 150), text: "", items: [] };
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const digits = (value: number, language: Language) => value.toLocaleString(languageInfo(language).locale);

function fit(length: number, sizes: [number, number][]): number {
  for (const [upTo, size] of sizes) if (length <= upTo) return size;
  return sizes[sizes.length - 1][1];
}

/** The full HTML page for one image. photoSrc is a URL in the preview and a data URL when rendering. */
export function imageHtml(
  image: PostImage,
  { language, brand, photoSrc }: { language: Language; brand: SlideBrand; photoSrc?: string | null },
): string {
  const info = languageInfo(language);
  const arabic = info.script === "arabic";
  const { width, height } = IMAGE_SIZES[image.size];
  const wide = image.size === "wide";
  // Type is set for the square image and scaled down for the short wide one.
  const u = wide ? 0.62 : image.size === "portrait" ? 0.95 : 1;
  const px = (size: number) => `${Math.round(size * u)}px`;
  const pad = wide ? 72 : 96;
  const fonts = brandFonts(language, brand.headingStyle);
  const C = brandPalette(brand.colors);
  const heading = escape(image.heading);
  const text = escape(image.text);
  const photo = image.kind === "cover" && photoSrc ? photoSrc : null;

  let body: string;
  if (image.kind === "quote") {
    const size = fit(image.heading.length, [[60, 100], [110, 80], [160, 66]]);
    // A drawn mark, so it looks the same in every font and never overlaps the first line.
    body = `
      <div class="quote-inner">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
        <h1 style="font-size:${px(size)}">${heading}</h1>
        ${text ? `<p class="who">— ${text}</p>` : ""}
      </div>`;
  } else if (image.kind === "points") {
    const many = image.items.length > 3 || image.items.some((item) => item.length > 70);
    const headingSize = fit(image.heading.length, [[40, 84], [80, 68], [160, 56]]);
    body = `
      <div class="points-inner">
        <h1 style="font-size:${px(headingSize)}">${heading}</h1>
        <ol style="font-size:${px(many ? 42 : 52)}">${image.items
          .map((item, index) => `<li><span class="n">${digits(index + 1, language)}</span><span>${escape(item)}</span></li>`)
          .join("")}</ol>
      </div>`;
  } else {
    const size = fit(image.heading.length, [[30, 104], [60, 88], [100, 72], [160, 60]]);
    body = `
      ${photo ? `<img class="photo" src="${escape(photo)}" alt="">` : ""}
      <div class="cover-inner">
        <div class="bar"></div>
        <h1 style="font-size:${px(size)}">${heading}</h1>
        ${text ? `<p class="sub">${text}</p>` : ""}
      </div>`;
  }

  return `<!doctype html>
<html lang="${language}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body { font-family: ${fonts.body}; position: relative; -webkit-font-smoothing: antialiased; }
  h1 { font-family: ${fonts.display}; font-weight: ${arabic ? 800 : 700}; line-height: ${arabic ? 1.4 : 1.1};
    letter-spacing: ${arabic ? "0" : "-0.01em"}; }
  footer { position: absolute; inset-inline: ${pad}px; bottom: ${wide ? 44 : 64}px; display: flex; align-items: center; gap: 16px;
    font: 600 ${px(30)}/1 ${fonts.body}; }
  footer::before { content: ""; width: ${px(36)}; height: ${px(8)}; border-radius: 4px; background: ${C.amber}; }

  body.cover { background: ${C.cobalt}; color: #fff; }
  body.cover footer { color: ${C.periwinkle}; z-index: 1; }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  body.has-photo::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(180deg, ${C.deepClear} 15%, ${C.deepShade} 55%, ${C.deep} 85%); }
  .cover-inner { position: absolute; inset-inline: ${pad}px; top: 50%; transform: translateY(-55%); z-index: 1; }
  body.has-photo .cover-inner { top: auto; bottom: ${wide ? 110 : 160}px; transform: none; }
  .bar { width: ${px(120)}; height: ${px(14)}; background: ${C.amber}; border-radius: 7px; margin-bottom: ${px(44)}; }
  .sub { margin-top: ${px(32)}; font-size: ${px(40)}; line-height: 1.45; color: ${C.periwinkle}; font-weight: 500; }

  body.quote { background: ${C.canvas}; color: ${C.ink}; }
  body.quote footer { color: ${C.inkSoft}; }
  .quote-inner { position: absolute; inset-inline: ${pad}px; top: 50%; transform: translateY(-56%); }
  .mark { display: block; width: ${px(130)}; height: ${px(130)}; margin-bottom: ${px(24)}; fill: ${C.amber};
    transform: ${info.dir === "rtl" ? "none" : "rotate(180deg)"}; }
  body.quote h1 { color: ${C.cobalt}; }
  .who { margin-top: ${px(40)}; font-size: ${px(36)}; font-weight: 600; color: ${C.inkSoft}; }

  body.points { background: ${C.deep}; color: #fff; }
  body.points footer { color: ${C.periwinkle}; }
  .points-inner { position: absolute; inset-inline: ${pad}px; top: 50%; transform: translateY(-54%); }
  ol { list-style: none; margin-top: ${px(wide ? 36 : 56)}; display: grid; gap: ${px(wide ? 20 : 30)}; line-height: ${arabic ? 1.65 : 1.35}; }
  li { display: flex; gap: ${px(28)}; align-items: baseline; }
  .n { flex: none; display: inline-grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 999px;
    background: ${C.amber}; color: ${C.deep}; font-weight: 800; font-size: 0.8em; line-height: 1; transform: translateY(0.12em); }
</style>
</head>
<body class="${image.kind}${photo ? " has-photo" : ""}">${body}
<footer><span>${escape(brand.label)}</span></footer>
</body>
</html>`;
}
