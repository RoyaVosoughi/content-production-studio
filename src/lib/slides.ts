import type { Slide } from "./db/schema";
import { languageInfo, type Language } from "./language";
import { instagramLabel, type BrandColors, type Profile } from "./profile";
import { brandFonts, brandPalette } from "./brand-style";

// One template drives both the live preview in the editor and the JPEG images that are posted,
// so what you approve is what Instagram receives. Kept free of server code so the editor can use it.

/** What a slide needs from the profile: the name or handle in the footer, the colours and heading style. */
export type SlideBrand = { label: string; colors: BrandColors; headingStyle: Profile["headingStyle"] };

export function slideBrand(profile: Profile): SlideBrand {
  return { label: instagramLabel(profile), colors: profile.colors, headingStyle: profile.headingStyle };
}

export const SLIDE_SIZE = { width: 1080, height: 1350 } as const;

/** Change this when the design changes, so images made with the old design aren't reused. */
export const TEMPLATE_VERSION = 4;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const digits = (value: number, language: Language) => value.toLocaleString(languageInfo(language).locale);

/** Long titles get smaller type, so every slide fits without cutting words. */
function fit(length: number, sizes: [number, number][]): number {
  for (const [upTo, size] of sizes) if (length <= upTo) return size;
  return sizes[sizes.length - 1][1];
}

/**
 * The full HTML page for one 1080 × 1350 slide.
 * photoSrc fills the cover when a photo was added; it is a URL in the preview and a data URL when rendering.
 */
export function slideHtml(
  slide: Slide,
  {
    index,
    total,
    language,
    photoSrc,
    brand,
  }: { index: number; total: number; language: Language; photoSrc?: string | null; brand: SlideBrand },
): string {
  const info = languageInfo(language);
  // Arabic script needs more line height and no letter spacing; everything else follows the Latin settings.
  const arabic = info.script === "arabic";
  const rtl = info.dir === "rtl";
  const kind = index === 0 ? "cover" : index === total - 1 && total > 1 ? "last" : "point";
  const fonts = brandFonts(language, brand.headingStyle);
  const display = fonts.display;
  const body = fonts.body;
  const COLORS = brandPalette(brand.colors);
  const words = {
    swipe: info.phrases.swipe,
    follow: info.phrases.follow.replace("{name}", brand.label),
    arrow: rtl ? "←" : "→",
  };
  const title = escape(slide.title);
  const text = escape(slide.text).replace(/\n/g, "<br>");
  const counter = `${digits(index + 1, language)} / ${digits(total, language)}`;

  const titleSize =
    kind === "cover"
      ? fit(slide.title.length, [[24, arabic ? 104 : 112], [45, arabic ? 88 : 96], [70, 76], [999, 64]])
      : fit(slide.title.length, [[30, 76], [55, 64], [999, 54]]);
  const textSize = fit(slide.text.length, [[120, 50], [200, 44], [999, 40]]);

  const footer = `<footer><span>${escape(brand.label)}</span><span dir="${info.dir}">${counter}</span></footer>`;
  let content: string;
  if (kind === "cover") {
    content = `
      ${photoSrc ? `<img class="photo" src="${escape(photoSrc)}" alt="">` : ""}
      <div class="cover-inner">
        <div class="bar"></div>
        <h1 style="font-size:${titleSize}px">${title}</h1>
        ${text ? `<p class="sub">${text}</p>` : ""}
        <p class="swipe">${words.swipe} ${words.arrow}</p>
      </div>
      ${footer}`;
  } else if (kind === "last") {
    content = `
      <div class="last-inner">
        <h2 style="font-size:${titleSize}px">${title}</h2>
        ${text ? `<p class="text" style="font-size:${textSize}px">${text}</p>` : ""}
        <p class="pill">${escape(words.follow)}</p>
      </div>
      ${footer}`;
  } else {
    content = `
      <div class="point-inner">
        <p class="number">${digits(index, language)}</p>
        <h2 style="font-size:${titleSize}px">${title}</h2>
        ${text ? `<p class="text" style="font-size:${textSize}px">${text}</p>` : ""}
      </div>
      ${footer}`;
  }

  return `<!doctype html>
<html lang="${language}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${SLIDE_SIZE.width}px; height: ${SLIDE_SIZE.height}px; overflow: hidden; }
  body { font-family: ${body}; position: relative; -webkit-font-smoothing: antialiased; }
  h1, h2 { font-family: ${display}; font-weight: ${arabic ? 800 : 700}; line-height: ${arabic ? 1.35 : 1.08}; letter-spacing: ${arabic ? "0" : "-0.01em"}; }
  footer { position: absolute; inset-inline: 96px; bottom: 72px; display: flex; justify-content: space-between;
    font: 500 30px/1 'Inter', sans-serif; direction: ltr; }
  .bar { width: 120px; height: 14px; background: ${COLORS.amber}; border-radius: 7px; margin-bottom: 48px; }

  body.cover { background: ${COLORS.cobalt}; color: #fff; }
  body.cover footer { color: ${COLORS.periwinkle}; }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  body.cover.has-photo::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(180deg, ${COLORS.deepClear} 25%, ${COLORS.deepShade} 58%, ${COLORS.deep} 82%); }
  .cover-inner { position: absolute; inset-inline: 96px; bottom: 190px; z-index: 1; }
  body.cover:not(.has-photo) .cover-inner { bottom: auto; top: 50%; transform: translateY(-45%); }
  body.cover footer { z-index: 1; }
  .sub { margin-top: 36px; font-size: 42px; line-height: 1.45; color: ${COLORS.periwinkle}; font-weight: 500; }
  .swipe { margin-top: 56px; font-size: 34px; font-weight: 600; color: ${COLORS.amber}; }

  body.point { background: ${COLORS.canvas}; color: ${COLORS.ink}; }
  body.point footer { color: ${COLORS.inkSoft}; }
  .point-inner { position: absolute; inset-inline: 96px; top: 47%; transform: translateY(-50%); }
  .number { font-family: ${display}; font-weight: 700; font-size: 150px; line-height: 1;
    color: ${COLORS.amber}; margin-bottom: 56px; }
  body.point h2 { color: ${COLORS.cobalt}; }
  .text { margin-top: 44px; line-height: ${arabic ? 1.8 : 1.5}; }

  body.last { background: ${COLORS.deep}; color: #fff; }
  body.last footer { color: ${COLORS.periwinkle}; }
  .last-inner { position: absolute; inset-inline: 96px; top: 50%; transform: translateY(-58%); }
  body.last .text { color: ${COLORS.periwinkle}; }
  .pill { display: inline-block; margin-top: 64px; padding: 22px 40px; border-radius: 999px; background: ${COLORS.amber};
    color: ${COLORS.deep}; font-size: 34px; font-weight: 700; }
</style>
</head>
<body class="${kind}${kind === "cover" && photoSrc ? " has-photo" : ""}">${content}</body>
</html>`;
}
