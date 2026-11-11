import { brandFonts, brandPalette } from "../brand-style";
import { languageInfo, type Language } from "../language";
import { displayName, headline, instagramLabel, type Profile } from "../profile";
import { VIDEO_FORMATS, type VideoPlatform } from "../platforms";

// The motion graphics and thumbnails, drawn by Chrome in the brand's fonts and colours, then placed
// on the video by FFmpeg. Each card is drawn on a transparent page and cut out by its element.

/** Change this when a design changes, so videos made with the old design are made again. */
export const OVERLAY_VERSION = 2;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export type OverlayKind = "title" | "callout" | "end";

/** What the cards need from the profile, for one language. Part of the render key, so a change makes videos again. */
export type VideoBrand = {
  name: string;
  instagram: string;
  headline: string;
  colors: Profile["colors"];
  headingStyle: Profile["headingStyle"];
};

export function videoBrand(profile: Profile, language: Language): VideoBrand {
  return {
    name: displayName(profile, language),
    instagram: instagramLabel(profile),
    headline: headline(profile, language),
    colors: profile.colors,
    headingStyle: profile.headingStyle,
  };
}

/** The closing card: follow on Instagram and LinkedIn, subscribe on YouTube. */
function endText(platform: VideoPlatform, language: Language, brand: VideoBrand): { line: string; small: string } {
  const { phrases } = languageInfo(language);
  if (platform === "reel") return { line: phrases.follow.replace("{name}", brand.instagram), small: brand.headline };
  if (platform === "linkedin_video") return { line: phrases.follow.replace("{name}", brand.name), small: brand.headline };
  return { line: phrases.subscribe, small: [brand.name, brand.headline].filter(Boolean).join(" · ") };
}

function page(language: Language, brand: VideoBrand, width: number, height: number, css: string, body: string) {
  const fonts = brandFonts(language, brand.headingStyle);
  return `<!doctype html><html lang="${language}" dir="${languageInfo(language).dir}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
html,body{margin:0;background:transparent;width:${width}px;height:${height}px}
body{display:flex;align-items:flex-start;justify-content:center;font-family:${fonts.body}}
#card{box-sizing:border-box}
${css}
</style></head><body>${body}</body></html>`;
}

/** One motion-graphic card for a video, as a transparent page. */
export function overlayHtml(kind: OverlayKind, text: string, platform: VideoPlatform, language: Language, brand: VideoBrand): string {
  const { width, height } = VIDEO_FORMATS[platform];
  const fa = languageInfo(language).script === "arabic";
  const wide = width > height;
  const display = brandFonts(language, brand.headingStyle).display;
  const COLORS = brandPalette(brand.colors);
  const unit = wide ? height / 1080 : width / 1080;
  const px = (value: number) => `${Math.round(value * unit)}px`;

  if (kind === "title") {
    return page(
      language,
      brand,
      width,
      height,
      `#card{max-width:${px(wide ? 1300 : 940)};background:${COLORS.cobalt};color:#fff;padding:${px(34)} ${px(46)} ${px(40)};border-radius:${px(30)};box-shadow:0 ${px(18)} ${px(50)} ${COLORS.shadow}}
#card h1{margin:0;font-family:${display};font-weight:${fa ? 800 : 700};font-size:${px(text.length > 40 ? 64 : 80)};line-height:${fa ? 1.45 : 1.08};letter-spacing:${fa ? 0 : "-0.01em"}}
#card i{display:block;width:${px(120)};height:${px(12)};margin-top:${px(22)};border-radius:${px(6)};background:${COLORS.amber}}`,
      `<div id="card"><h1>${escape(text)}</h1><i></i></div>`,
    );
  }
  if (kind === "callout") {
    return page(
      language,
      brand,
      width,
      height,
      `#card{background:${COLORS.amber};color:${COLORS.ink};padding:${px(18)} ${px(36)};border-radius:${px(999)};font-weight:800;font-size:${px(wide ? 54 : 60)};line-height:${fa ? 1.6 : 1.2};white-space:nowrap;box-shadow:0 ${px(12)} ${px(30)} rgba(30,30,30,.28)}`,
      `<div id="card">${escape(text)}</div>`,
    );
  }
  const end = endText(platform, language, brand);
  return page(
    language,
    brand,
    width,
    height,
    `#card{width:${px(wide ? 1100 : 920)};background:${COLORS.deep};color:#fff;padding:${px(40)} ${px(48)};border-radius:${px(34)};text-align:center;box-shadow:0 ${px(18)} ${px(50)} ${COLORS.shadow}}
#card b{display:inline-block;background:${COLORS.amber};color:${COLORS.ink};border-radius:${px(999)};padding:${px(14)} ${px(34)};font-size:${px(56)};font-weight:800;line-height:${fa ? 1.6 : 1.2}}
#card p{margin:${px(20)} 0 0;font-size:${px(34)};font-weight:600;opacity:.9;line-height:1.5}`,
    `<div id="card"><b>${escape(end.line)}</b>${end.small ? `<p>${escape(end.small)}</p>` : ""}</div>`,
  );
}

/** Where each card sits on the frame, as FFmpeg overlay positions. */
export function overlayPosition(kind: OverlayKind, platform: VideoPlatform): { x: string; y: string } {
  const { width, height } = VIDEO_FORMATS[platform];
  const wide = width > height;
  if (kind === "title") return wide ? { x: "90", y: "main_h-overlay_h-170" } : { x: "(main_w-overlay_w)/2", y: String(Math.round(height * 0.12)) };
  if (kind === "callout") return wide ? { x: "main_w-overlay_w-90", y: "90" } : { x: "(main_w-overlay_w)/2", y: String(Math.round(height * 0.24)) };
  return { x: "(main_w-overlay_w)/2", y: wide ? "(main_h-overlay_h)/2" : String(Math.round(height * 0.36)) };
}

/** Thumbnail sizes: YouTube's recommended 1280 × 720, and a full-screen Reel cover. */
export const THUMBNAIL_PLATFORMS: VideoPlatform[] = ["youtube", "reel"];
export function thumbnailSize(platform: VideoPlatform) {
  return platform === "youtube" ? { width: 1280, height: 720 } : { width: 1080, height: 1920 };
}

/** A thumbnail: a frame of the video with the title over it. frameSrc is a data URL. */
export function thumbnailHtml(title: string, frameSrc: string, platform: VideoPlatform, language: Language, brand: VideoBrand): string {
  const { width, height } = thumbnailSize(platform);
  const info = languageInfo(language);
  const fa = info.script === "arabic";
  const rtl = info.dir === "rtl";
  const wide = width > height;
  const fonts = brandFonts(language, brand.headingStyle);
  const display = fonts.display;
  const COLORS = brandPalette(brand.colors);
  const size = wide ? (title.length > 40 ? 72 : 92) : title.length > 40 ? 96 : 120;
  return `<!doctype html><html lang="${language}" dir="${info.dir}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fonts.stylesheet}">
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${COLORS.deep}}
.frame{position:absolute;inset:0;background:url("${frameSrc}") center/cover}
.shade{position:absolute;inset:0;background:${wide ? `linear-gradient(${rtl ? "270deg" : "90deg"},${COLORS.deepStrong} 0%,${COLORS.deepMid} 45%,${COLORS.deepClear} 75%)` : `linear-gradient(0deg,${COLORS.deepStrong} 0%,${COLORS.deepMid} 40%,${COLORS.deepClear} 70%)`}}
.text{position:absolute;${wide ? `top:0;bottom:0;${rtl ? "right" : "left"}:70px;width:640px;display:flex;flex-direction:column;justify-content:center` : "left:80px;right:80px;bottom:260px"}}
h1{margin:0;color:#fff;font-family:${display};font-weight:${fa ? 800 : 700};font-size:${size}px;line-height:${fa ? 1.4 : 1.04};letter-spacing:${fa ? 0 : "-0.015em"}}
i{display:block;width:140px;height:14px;border-radius:7px;background:${COLORS.amber};margin-top:28px}
</style></head><body><div class="frame"></div><div class="shade"></div><div class="text"><h1>${escape(title)}</h1><i></i></div></body></html>`;
}
