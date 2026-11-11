import { languageInfo, type Language } from "./language";
import type { BrandColors, Profile } from "./profile";

// Shared by the slides, the video cards and the thumbnails, so they all look like one brand.
// Kept free of server code so the editor's live preview can use it.

const STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&family=Vazirmatn:wght@400;500;600;700;800&display=block";

/**
 * Arabic script uses Vazirmatn throughout. Latin text uses Inter, with Fraunces for headings when the
 * serif style is chosen. Fraunces has no Cyrillic, so Cyrillic headings stay in Inter.
 */
export function brandFonts(language: Language, headingStyle: Profile["headingStyle"]) {
  const { script } = languageInfo(language);
  if (script === "arabic") return { stylesheet: STYLESHEET, display: "'Vazirmatn', sans-serif", body: "'Vazirmatn', sans-serif" };
  const serif = headingStyle === "serif" && script === "latin";
  return { stylesheet: STYLESHEET, display: serif ? "'Fraunces', serif" : "'Inter', sans-serif", body: "'Inter', sans-serif" };
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A colour part of the way towards white, as a hex value. */
function lighten(hex: string, amount: number): string {
  return `#${rgb(hex)
    .map((part) => Math.round(part + (255 - part) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

function alpha(hex: string, opacity: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${opacity})`;
}

/** The full palette the templates draw with, worked out from the four brand colours in Setup. */
export function brandPalette(colors: BrandColors) {
  return {
    cobalt: colors.primary,
    deep: colors.dark,
    canvas: colors.light,
    amber: colors.highlight,
    ink: "#1e1e1e",
    inkSoft: "#55504a",
    /** Soft text on the primary and dark colours. */
    periwinkle: lighten(colors.primary, 0.62),
    deepClear: alpha(colors.dark, 0),
    deepShade: alpha(colors.dark, 0.82),
    deepStrong: alpha(colors.dark, 0.94),
    deepMid: alpha(colors.dark, 0.72),
    shadow: alpha(colors.dark, 0.38),
  };
}

/** ASS subtitle colours are written blue, green, red. */
export function assColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `&H00${[b, g, r].map((part) => part.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}
