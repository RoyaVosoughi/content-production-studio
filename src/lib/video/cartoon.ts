// Cartoon scenes for animations: two flat characters, a place and a prop, drawn by the studio
// itself in the brand's colours and moved by the same seek(t) that plays the rest of the animation.
// No image AI is involved, so it costs nothing and looks the same every time.
// Kept free of server code, so the scene editor and the tests can use it.

export const CARTOON_PLACES = ["office", "home", "street", "park", "classroom", "shop", "stage", "night"] as const;
export const CARTOON_ACTIONS = [
  "walk_in",
  "talk",
  "wave",
  "point",
  "think",
  "surprised",
  "celebrate",
  "open_box",
  "type_laptop",
  "shrug",
  "sad",
  "present",
  "run",
] as const;
export const CARTOON_PROPS = ["none", "box", "laptop", "phone", "lightbulb", "chart", "coffee", "book", "rocket", "money", "clock", "key"] as const;

export type CartoonPlace = (typeof CARTOON_PLACES)[number];
export type CartoonAction = (typeof CARTOON_ACTIONS)[number];
export type CartoonProp = (typeof CARTOON_PROPS)[number];

/** What happens in a cartoon scene: where, what the host does, the object beside them, and whether a friend is there. */
export type Cartoon = { place: CartoonPlace; action: CartoonAction; prop: CartoonProp; friend: boolean };

export const DEFAULT_CARTOON: Cartoon = { place: "office", action: "talk", prop: "none", friend: false };

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === "string" && (list as readonly string[]).includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as T)
    : fallback;

/** Any value from the AI or a form, made into directions the studio can draw. */
export function cleanCartoon(value: unknown): Cartoon {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    place: pick(CARTOON_PLACES, raw.place, DEFAULT_CARTOON.place),
    action: pick(CARTOON_ACTIONS, raw.action, DEFAULT_CARTOON.action),
    prop: pick(CARTOON_PROPS, raw.prop, DEFAULT_CARTOON.prop),
    friend: raw.friend === true || raw.friend === "true",
  };
}

/** Actions that need a moment to play out, so their scene never ends before they do. */
export const ACTION_SECONDS: Record<CartoonAction, number> = {
  walk_in: 3,
  talk: 2.6,
  wave: 2.6,
  point: 2.8,
  think: 3,
  surprised: 2.8,
  celebrate: 3,
  open_box: 3.4,
  type_laptop: 2.8,
  shrug: 2.6,
  sad: 2.8,
  present: 3.2,
  run: 2.8,
};

/** For scenes made without the AI: a varied cast of moments that suits most scripts. */
const SIMPLE_ROTATION: Cartoon[] = [
  { place: "office", action: "walk_in", prop: "none", friend: false },
  { place: "office", action: "point", prop: "lightbulb", friend: false },
  { place: "office", action: "think", prop: "none", friend: true },
  { place: "office", action: "type_laptop", prop: "laptop", friend: false },
  { place: "street", action: "talk", prop: "none", friend: true },
  { place: "office", action: "present", prop: "chart", friend: false },
  { place: "park", action: "surprised", prop: "phone", friend: false },
  { place: "home", action: "open_box", prop: "box", friend: false },
];

export function simpleCartoon(index: number, last: boolean): Cartoon {
  if (last) return { place: "stage", action: "celebrate", prop: "none", friend: true };
  return SIMPLE_ROTATION[index % SIMPLE_ROTATION.length];
}

export type CartoonPalette = { cobalt: string; deep: string; canvas: string; amber: string; ink: string; periwinkle: string };

type Layout = { W: number; H: number; G: number; s: number; rtl: boolean };

/** Where the floor is and how big people are, for each video shape. Portrait keeps the lower part for captions and app buttons. */
export function cartoonLayout(width: number, height: number, rtl: boolean): Layout {
  const u = Math.min(width, height) / 1080;
  const wide = width > height;
  const tall = height / width > 1.5;
  const G = Math.round(wide ? height - 190 * u : tall ? height - 560 * u : height - 330 * u);
  return { W: width, H: height, G, s: u * (wide ? 0.92 : 1), rtl };
}

/** Where the host, the prop and the friend stand, in frame pixels before any right-to-left mirroring. */
export function cartoonSpots(c: Cartoon, W: number) {
  const prop = c.prop !== "none";
  if (c.friend && prop) return { main: W * 0.24, prop: W * 0.54, friend: W * 0.82 };
  if (c.friend) return { main: W * 0.3, prop: W * 0.6, friend: W * 0.7 };
  if (prop) return { main: W * 0.32, prop: W * 0.7, friend: W * 0.9 };
  return { main: W * 0.42, prop: W * 0.7, friend: W * 0.8 };
}

const f = (n: number) => Math.round(n * 10) / 10;

function place(name: CartoonPlace, L: Layout, C: CartoonPalette): string {
  const { W, H, G } = L;
  const floor = (fill: string) => `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="${fill}"/><rect x="0" y="${G}" width="${W}" height="${f(6 * L.s)}" fill="#000" opacity=".12"/>`;
  const wall = (fill: string) => `<rect width="${W}" height="${H}" fill="${fill}"/>`;
  const win = (x: number, y: number, w: number, h: number) =>
    `<g><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(12 * L.s)}" fill="${C.periwinkle}"/>` +
    [0.12, 0.3, 0.52, 0.74]
      .map((p, i) => `<rect x="${f(x + w * p)}" y="${f(y + h * (0.35 + (i % 2) * 0.12))}" width="${f(w * 0.14)}" height="${f(h * (0.65 - (i % 2) * 0.12))}" fill="${C.cobalt}" opacity=".45"/>`)
      .join("") +
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(12 * L.s)}" fill="none" stroke="#fff" stroke-width="${f(14 * L.s)}"/><line x1="${f(x + w / 2)}" y1="${f(y)}" x2="${f(x + w / 2)}" y2="${f(y + h)}" stroke="#fff" stroke-width="${f(10 * L.s)}"/></g>`;
  const plant = (x: number) =>
    `<g transform="translate(${f(x)} ${G}) scale(${f(L.s)})"><path d="M-40 0 L-52 -110 L52 -110 L40 0Z" fill="${C.amber}"/><path d="M0 -110 C-90 -170 -70 -260 -10 -300 C0 -230 10 -180 0 -110Z M0 -110 C80 -160 100 -240 40 -290 C20 -220 10 -170 0 -110Z" fill="#5f9e62"/></g>`;
  const tree = (x: number, k: number) =>
    `<g transform="translate(${f(x)} ${G}) scale(${f(L.s * k)})"><rect x="-18" y="-220" width="36" height="220" fill="#7a5537"/><circle cx="0" cy="-300" r="130" fill="#5f9e62"/><circle cx="-80" cy="-240" r="90" fill="#6fae6a"/><circle cx="80" cy="-250" r="95" fill="#6fae6a"/></g>`;
  const building = (x: number, w: number, h: number, shade: number) =>
    `<rect x="${f(x)}" y="${f(G - h)}" width="${f(w)}" height="${f(h)}" fill="${C.cobalt}" opacity="${shade}"/>` +
    Array.from({ length: Math.max(1, Math.floor(h / (90 * L.s))) }, (_, row) =>
      [0.2, 0.6].map((p) => `<rect x="${f(x + w * p)}" y="${f(G - h + 40 * L.s + row * 90 * L.s)}" width="${f(w * 0.2)}" height="${f(40 * L.s)}" fill="#fff" opacity=".55"/>`).join(""),
    ).join("");
  switch (name) {
    case "office":
      return wall(C.canvas) + win(W * 0.08, G - 820 * L.s, W * 0.3, 420 * L.s) + win(W * 0.62, G - 820 * L.s, W * 0.3, 420 * L.s) + floor("#d8d0c4") + plant(W * 0.93);
    case "home":
      return (
        wall("#f3e4d3") +
        `<rect x="${f(W * 0.12)}" y="${f(G - 760 * L.s)}" width="${f(220 * L.s)}" height="${f(170 * L.s)}" fill="${C.cobalt}" stroke="#fff" stroke-width="${f(14 * L.s)}"/><circle cx="${f(W * 0.12 + 150 * L.s)}" cy="${f(G - 720 * L.s)}" r="${f(26 * L.s)}" fill="${C.amber}"/>` +
        `<g transform="translate(${f(W * 0.86)} ${G}) scale(${f(L.s)})"><rect x="-6" y="-420" width="12" height="420" fill="${C.ink}"/><path d="M-70 -420 L70 -420 L45 -520 L-45 -520Z" fill="${C.amber}"/></g>` +
        floor("#b98f6a")
      );
    case "street":
      return (
        `<rect width="${W}" height="${H}" fill="${C.periwinkle}"/>` +
        building(W * 0.02, W * 0.2, 760 * L.s, 0.35) +
        building(W * 0.26, W * 0.16, 560 * L.s, 0.55) +
        building(W * 0.62, W * 0.18, 860 * L.s, 0.4) +
        building(W * 0.84, W * 0.16, 620 * L.s, 0.6) +
        `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#4a4f5c"/>` +
        Array.from({ length: 6 }, (_, i) => `<rect x="${f(W * (0.04 + i * 0.17))}" y="${f(G + 70 * L.s)}" width="${f(W * 0.08)}" height="${f(12 * L.s)}" fill="#fff" opacity=".7"/>`).join("")
      );
    case "park":
      return (
        `<rect width="${W}" height="${H}" fill="#cfe7f5"/><circle cx="${f(W * 0.82)}" cy="${f(G - 900 * L.s)}" r="${f(110 * L.s)}" fill="${C.amber}"/>` +
        `<ellipse cx="${f(W * 0.2)}" cy="${f(G + 40 * L.s)}" rx="${f(W * 0.5)}" ry="${f(220 * L.s)}" fill="#8cc084"/><ellipse cx="${f(W * 0.85)}" cy="${f(G + 60 * L.s)}" rx="${f(W * 0.5)}" ry="${f(200 * L.s)}" fill="#7bb574"/>` +
        tree(W * 0.08, 1) +
        tree(W * 0.95, 0.85) +
        `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#6fae6a"/>`
      );
    case "classroom":
      return (
        wall(C.canvas) +
        `<rect x="${f(W * 0.12)}" y="${f(G - 860 * L.s)}" width="${f(W * 0.76)}" height="${f(420 * L.s)}" rx="${f(10 * L.s)}" fill="#2f4f3e" stroke="#a9805a" stroke-width="${f(18 * L.s)}"/>` +
        `<path d="M${f(W * 0.2)} ${f(G - 760 * L.s)} q${f(60 * L.s)} -${f(40 * L.s)} ${f(120 * L.s)} 0 t${f(120 * L.s)} 0 M${f(W * 0.2)} ${f(G - 680 * L.s)} h${f(W * 0.3)} M${f(W * 0.2)} ${f(G - 610 * L.s)} h${f(W * 0.2)}" stroke="#fff" stroke-width="${f(8 * L.s)}" fill="none" opacity=".75" stroke-linecap="round"/>` +
        floor("#d8d0c4")
      );
    case "shop":
      return (
        wall("#f6efe6") +
        `<g>${Array.from({ length: 8 }, (_, i) => `<rect x="${f((W / 8) * i)}" y="${f(G - 960 * L.s)}" width="${f(W / 8)}" height="${f(130 * L.s)}" fill="${i % 2 ? "#fff" : C.amber}"/>`).join("")}</g>` +
        [0, 1].map((row) => `<rect x="${f(W * 0.06)}" y="${f(G - (620 - row * 220) * L.s)}" width="${f(W * 0.88)}" height="${f(16 * L.s)}" fill="#a9805a"/>` + Array.from({ length: 7 }, (_, i) => `<rect x="${f(W * (0.09 + i * 0.12))}" y="${f(G - (720 - row * 220) * L.s)}" width="${f(W * 0.07)}" height="${f(100 * L.s)}" rx="${f(8 * L.s)}" fill="${[C.cobalt, C.amber, C.periwinkle][(i + row) % 3]}"/>`).join("")).join("") +
        floor("#d8d0c4")
      );
    case "stage":
      return (
        `<rect width="${W}" height="${H}" fill="${C.deep}"/>` +
        `<path d="M${f(W * 0.5 - 120 * L.s)} 0 L${f(W * 0.5 + 120 * L.s)} 0 L${f(W * 0.82)} ${G} L${f(W * 0.18)} ${G}Z" fill="#fff" opacity=".1"/>` +
        `<path d="M0 0 H${f(W * 0.14)} C${f(W * 0.1)} ${f(H * 0.3)} ${f(W * 0.16)} ${f(H * 0.55)} ${f(W * 0.08)} ${G} H0Z" fill="#8c2131"/><path d="M${W} 0 H${f(W * 0.86)} C${f(W * 0.9)} ${f(H * 0.3)} ${f(W * 0.84)} ${f(H * 0.55)} ${f(W * 0.92)} ${G} H${W}Z" fill="#8c2131"/>` +
        `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#7a5537"/>`
      );
    case "night":
      return (
        `<rect width="${W}" height="${H}" fill="${C.deep}"/><circle cx="${f(W * 0.8)}" cy="${f(G - 900 * L.s)}" r="${f(90 * L.s)}" fill="#fff6d5"/>` +
        Array.from({ length: 22 }, (_, i) => `<circle cx="${f(((i * 397) % 1000) / 1000 * W)}" cy="${f(((i * 211) % 1000) / 1000 * (G - 500 * L.s))}" r="${f((2 + (i % 3)) * L.s)}" fill="#fff" opacity=".8"/>`).join("") +
        building(W * 0.0, W * 0.22, 520 * L.s, 0.5) +
        building(W * 0.7, W * 0.3, 640 * L.s, 0.5) +
        `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#1c1f2b"/>`
      );
  }
}

/** One person, feet at 0,0, facing right. Parts carry classes the page script moves. */
function person(who: "main" | "friend", x: number, L: Layout, C: CartoonPalette, face: 1 | -1): string {
  const main = who === "main";
  const skin = main ? "#f2c5a0" : "#c98e66";
  const shirt = main ? C.cobalt : C.amber;
  const pants = main ? "#2e3a59" : "#3d3550";
  const hair = main
    ? `<path d="M-100 -20 C-110 -120 -20 -150 40 -120 C90 -100 110 -60 100 -20 C60 -70 -40 -80 -100 -20Z" fill="#2b2118"/>`
    : `<path d="M-108 30 C-130 -110 -30 -150 40 -128 C110 -105 125 -40 104 40 L86 40 C88 -20 60 -70 -10 -72 C-60 -70 -86 -30 -86 40Z" fill="#5a3b26"/>`;
  const arm = (side: "l" | "r", sx: number) =>
    `<g class="ar ${side}" transform="translate(${sx} -470)"><rect x="-16" y="-6" width="32" height="140" rx="16" fill="${shirt}"/><g class="fa" transform="translate(0 122)"><rect x="-14" y="0" width="28" height="118" rx="14" fill="${skin}"/><circle cx="0" cy="124" r="23" fill="${skin}"/></g></g>`;
  const leg = (side: "l" | "r", sx: number) =>
    `<g class="lg ${side}" transform="translate(${sx} -250)"><rect x="-17" y="0" width="34" height="236" rx="17" fill="${pants}"/><ellipse cx="14" cy="238" rx="38" ry="18" fill="${C.ink}"/></g>`;
  return `<g class="cx ${who}" data-x="${f(x)}" data-s="${f(L.s)}" data-face="${face}" transform="translate(${f(x)} ${L.G}) scale(${f(L.s * face)} ${f(L.s)})">
<ellipse cx="0" cy="4" rx="120" ry="20" fill="#000" opacity=".16"/>
<g class="bob">${leg("l", -40)}${leg("r", 40)}
<rect x="-98" y="-505" width="196" height="285" rx="84" fill="${shirt}"/>
<rect x="-22" y="-540" width="44" height="48" fill="${skin}"/>
${arm("l", -84)}${arm("r", 84)}
<g class="hd" transform="translate(0 -625)"><circle cx="0" cy="0" r="104" fill="${skin}"/>${hair}
<g class="ey"><ellipse cx="-24" cy="-4" rx="12" ry="16" fill="${C.ink}"/><ellipse cx="42" cy="-4" rx="12" ry="16" fill="${C.ink}"/><circle cx="-20" cy="-10" r="4" fill="#fff"/><circle cx="46" cy="-10" r="4" fill="#fff"/></g>
<path class="br" d="M-44 -40 L-6 -44 M24 -44 L62 -40" stroke="${C.ink}" stroke-width="8" stroke-linecap="round"/>
<circle cx="-50" cy="34" r="16" fill="#e8907a" opacity=".45"/><circle cx="74" cy="34" r="16" fill="#e8907a" opacity=".45"/>
<path class="mc" d="M-6 46 Q14 64 40 46" stroke="${C.ink}" stroke-width="8" fill="none" stroke-linecap="round"/>
<path class="mf" d="M-6 60 Q14 44 40 60" stroke="${C.ink}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0"/>
<ellipse class="mo" cx="17" cy="54" rx="22" ry="16" fill="#7a2230" opacity="0"/></g>
${main ? `<g class="th" opacity="0" transform="translate(110 -820)"><circle cx="0" cy="40" r="14" fill="#fff" stroke="${C.ink}" stroke-width="5"/><circle cx="40" cy="0" r="22" fill="#fff" stroke="${C.ink}" stroke-width="5"/><circle cx="96" cy="-50" r="36" fill="#fff" stroke="${C.ink}" stroke-width="5"/></g>
<g class="ex" opacity="0" transform="translate(150 -840)"><rect x="-14" y="-90" width="28" height="80" rx="12" fill="#e2362f"/><circle cx="0" cy="18" r="16" fill="#e2362f"/></g>
<g class="rn" opacity="0" transform="translate(0 -900)"><ellipse cx="-50" cy="0" rx="80" ry="50" fill="#8b93a6"/><ellipse cx="40" cy="-14" rx="90" ry="60" fill="#8b93a6"/><path d="M-60 60 l-10 40 M0 60 l-10 40 M60 60 l-10 40" stroke="#5b8bd6" stroke-width="10" stroke-linecap="round"/></g>` : ""}
</g></g>`;
}

function prop(name: CartoonProp, x: number, L: Layout, C: CartoonPalette): string {
  if (name === "none") return "";
  const at = (inner: string) => `<g class="pp ${name}" transform="translate(${f(x)} ${L.G}) scale(${f(L.s)})">${inner}</g>`;
  const table = (h: number) => `<rect x="-150" y="${-h}" width="300" height="24" rx="8" fill="#a9805a"/><rect x="-130" y="${-h + 24}" width="20" height="${h - 24}" fill="#8a6646"/><rect x="110" y="${-h + 24}" width="20" height="${h - 24}" fill="#8a6646"/>`;
  switch (name) {
    case "box":
      return at(
        `<g class="ry" opacity="0">${[-60, -30, 0, 30, 60].map((a) => `<path d="M0 -200 L${f(Math.sin((a * Math.PI) / 180) * 420 - 26)} ${f(-200 - Math.cos((a * Math.PI) / 180) * 420)} L${f(Math.sin((a * Math.PI) / 180) * 420 + 26)} ${f(-200 - Math.cos((a * Math.PI) / 180) * 420)}Z" fill="${C.amber}" opacity=".55"/>`).join("")}</g>` +
          `<rect x="-120" y="-200" width="240" height="200" rx="10" fill="#c8873a"/><rect x="-18" y="-200" width="36" height="200" fill="${C.cobalt}"/>` +
          `<g class="lid" transform="translate(-130 -200)"><rect x="0" y="-44" width="260" height="46" rx="10" fill="#d9974a"/><rect x="112" y="-44" width="36" height="46" fill="${C.cobalt}"/></g>`,
      );
    case "laptop":
      return at(
        table(300) +
          `<g transform="translate(0 -300)"><rect x="-110" y="-12" width="220" height="14" rx="6" fill="#9aa3b5"/><rect x="-96" y="-160" width="192" height="146" rx="10" fill="#3a4152"/><rect class="sc" x="-84" y="-148" width="168" height="122" rx="6" fill="${C.periwinkle}"/><path d="M-66 -120 h90 M-66 -96 h120 M-66 -72 h70" stroke="${C.cobalt}" stroke-width="10" stroke-linecap="round"/></g>`,
      );
    case "phone":
      return at(
        `<g transform="translate(0 -560)"><rect x="-90" y="-170" width="180" height="340" rx="30" fill="${C.ink}"/><rect x="-74" y="-140" width="148" height="276" rx="14" fill="${C.periwinkle}"/><path d="M-50 -90 h100 M-50 -50 h70 M-50 -10 h90" stroke="${C.cobalt}" stroke-width="12" stroke-linecap="round"/><circle class="nt" cx="80" cy="-160" r="34" fill="#e2362f"/></g>`,
      );
    case "lightbulb":
      return at(
        `<g transform="translate(0 -700)"><g class="ry">${Array.from({ length: 8 }, (_, i) => `<line x1="${f(Math.cos((i * Math.PI) / 4) * 120)}" y1="${f(Math.sin((i * Math.PI) / 4) * 120)}" x2="${f(Math.cos((i * Math.PI) / 4) * 170)}" y2="${f(Math.sin((i * Math.PI) / 4) * 170)}" stroke="${C.amber}" stroke-width="14" stroke-linecap="round"/>`).join("")}</g><circle class="gl" cx="0" cy="0" r="92" fill="#ffe27a"/><rect x="-40" y="84" width="80" height="60" rx="12" fill="#9aa3b5"/><path d="M-26 0 l16 30 l16 -30 l16 30" stroke="#c8873a" stroke-width="8" fill="none"/></g>`,
      );
    case "chart":
      return at(
        `<rect x="-10" y="-300" width="20" height="300" fill="#8a6646"/><rect x="-200" y="-620" width="400" height="330" rx="16" fill="#fff" stroke="${C.ink}" stroke-width="8"/>` +
          [0.4, 0.65, 0.95].map((h, i) => `<rect class="bar" data-h="${h}" x="${-150 + i * 110}" y="-320" width="80" height="0" rx="8" fill="${[C.periwinkle, C.cobalt, C.amber][i]}"/>`).join("") +
          `<path class="up" d="M-150 -420 L-40 -480 L60 -520 L150 -600 M120 -600 h30 v30" stroke="#e2362f" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>`,
      );
    case "coffee":
      return at(
        table(260) +
          `<g transform="translate(0 -260)"><path d="M-55 -120 L55 -120 L45 0 L-45 0Z" fill="#fff" stroke="${C.ink}" stroke-width="6"/><path d="M55 -95 C100 -95 100 -35 50 -35" stroke="${C.ink}" stroke-width="10" fill="none"/><rect x="-55" y="-120" width="110" height="20" fill="#7a5537"/><g class="st">${[-25, 5, 35].map((sx) => `<path d="M${sx} -150 c-20 -30 20 -50 0 -80" stroke="#b9b2a8" stroke-width="8" fill="none" stroke-linecap="round"/>`).join("")}</g></g>`,
      );
    case "book":
      return at(
        table(260) +
          `<g transform="translate(0 -264)"><path d="M0 -8 C-60 -40 -130 -40 -170 -24 L-170 0 C-130 -16 -60 -16 0 12 C60 -16 130 -16 170 0 L170 -24 C130 -40 60 -40 0 -8Z" fill="${C.cobalt}"/><path d="M0 -10 C-50 -60 -120 -60 -160 -40 L-160 -20 C-120 -36 -50 -36 0 -4Z" fill="#fff"/><path class="pg" d="M0 -10 C50 -60 120 -60 160 -40 L160 -20 C120 -36 50 -36 0 -4Z" fill="#fff"/></g>`,
      );
    case "rocket":
      return at(
        `<g class="rk"><g class="fl"><path d="M-40 -60 Q0 80 40 -60Z" fill="${C.amber}"/><path d="M-20 -60 Q0 30 20 -60Z" fill="#e2362f"/></g><path d="M-60 -60 L-60 -300 Q0 -440 60 -300 L60 -60Z" fill="#fff" stroke="${C.ink}" stroke-width="6"/><circle cx="0" cy="-260" r="34" fill="${C.cobalt}"/><path d="M-60 -140 L-120 -40 L-60 -60Z M60 -140 L120 -40 L60 -60Z" fill="#e2362f"/></g>`,
      );
    case "money":
      return at(Array.from({ length: 5 }, (_, i) => `<g class="cn" data-k="${i}"><ellipse cx="0" cy="${-30 - i * 44}" rx="110" ry="32" fill="#d9a520" stroke="#a87c10" stroke-width="6"/><rect x="-110" y="${-30 - i * 44}" width="220" height="30" fill="#d9a520"/><ellipse cx="0" cy="${-30 - i * 44}" rx="110" ry="32" fill="#f2c94c"/></g>`).join(""));
    case "clock":
      return at(
        `<g transform="translate(0 -700)"><circle cx="0" cy="0" r="150" fill="#fff" stroke="${C.ink}" stroke-width="14"/>${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-120" x2="0" y2="-104" stroke="${C.ink}" stroke-width="8" transform="rotate(${i * 30})"/>`).join("")}<line class="hh" x1="0" y1="0" x2="0" y2="-70" stroke="${C.ink}" stroke-width="14" stroke-linecap="round"/><line class="mh" x1="0" y1="0" x2="0" y2="-110" stroke="${C.cobalt}" stroke-width="10" stroke-linecap="round"/><circle cx="0" cy="0" r="12" fill="${C.ink}"/></g>`,
      );
    case "key":
      return at(
        `<g class="ky" transform="translate(0 -620)"><circle cx="-90" cy="0" r="70" fill="none" stroke="#d9a520" stroke-width="34"/><rect x="-24" y="-18" width="220" height="36" rx="10" fill="#d9a520"/><rect x="140" y="18" width="24" height="50" fill="#d9a520"/><rect x="96" y="18" width="24" height="36" fill="#d9a520"/><circle class="gl" cx="-130" cy="-50" r="16" fill="#fff"/></g>`,
      );
  }
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The markup of one cartoon scene: the drawing (mirrored for right-to-left languages, so the story
 * reads in the language's direction), a sign at the top for the heading, and a speech bubble.
 */
export function cartoonScene(c: Cartoon, sign: string, bubble: string, L: Layout, C: CartoonPalette): string {
  const spots = cartoonSpots(c, L.W);
  const people = person("main", spots.main, L, C, 1) + (c.friend ? person("friend", spots.friend, L, C, c.prop === "none" || spots.friend > spots.prop ? -1 : 1) : "");
  const confetti = Array.from({ length: 26 }, (_, i) => {
    const x = ((i * 389) % 1000) / 1000 * L.W;
    return `<rect class="cf" opacity="0" data-x="${f(x)}" data-k="${i}" x="${f(x)}" y="-40" width="${f(22 * L.s)}" height="${f(34 * L.s)}" rx="${f(4 * L.s)}" fill="${["#e2362f", "#f2c94c", "#2e78dc", "#5f9e62"][i % 4]}"/>`;
  }).join("");
  // The bubble sits beside the host's head, on the mirrored side when the drawing is mirrored.
  const headX = L.rtl ? L.W - spots.main : spots.main;
  const bubbleWidth = Math.round(600 * L.s);
  const left = Math.min(Math.max(Math.round(headX - bubbleWidth / 2 + (L.rtl ? -1 : 1) * 150 * L.s), Math.round(36 * L.s)), L.W - bubbleWidth - Math.round(36 * L.s));
  const bottom = Math.round(L.H - (L.G - 790 * L.s));
  return `<svg class="cartoon" viewBox="0 0 ${L.W} ${L.H}" width="${L.W}" height="${L.H}"${L.rtl ? ` style="transform:scaleX(-1)"` : ""}>${place(c.place, L, C)}${prop(c.prop, spots.prop, L, C)}${people}<g class="cfs">${confetti}</g></svg>${
    sign ? `<div class="csign"><b data-d="0.2">${escape(sign)}</b></div>` : ""
  }${bubble ? `<div class="cbub" style="left:${left}px;bottom:${bottom}px;width:${bubbleWidth}px"><p data-d="0.55" class="${L.rtl ? "tail-r" : "tail-l"}">${escape(bubble)}</p></div>` : ""}`;
}

/** Styles for cartoon scenes. px() turns 1080-based sizes into this video's pixels. */
export function cartoonCss(px: (value: number) => string, C: CartoonPalette, fonts: { display: string }, lh: (latin: number) => number): string {
  return `.scene.k-cartoon{inset:0;display:block;transform-origin:50% 50%}
.cartoon{position:absolute;inset:0;transform-origin:50% 50%}
.csign{position:absolute;top:${px(150)};left:0;right:0;display:flex;justify-content:center;padding:0 ${px(70)}}
.csign b{display:inline-block;background:${C.deep};color:#fff;border-radius:${px(24)};padding:${px(18)} ${px(40)};font-family:${fonts.display};font-size:${px(54)};font-weight:800;line-height:${lh(1.2)};text-align:center;box-shadow:0 ${px(10)} 0 ${C.amber}}
.cbub{position:absolute;display:flex;justify-content:center}
.cbub p{position:relative;background:#fff;color:${C.ink};border:${px(6)} solid ${C.ink};border-radius:${px(40)};padding:${px(22)} ${px(32)};font-size:${px(46)};font-weight:700;line-height:${lh(1.25)};text-align:center}
.cbub p::after{content:"";position:absolute;bottom:${px(-34)};width:${px(40)};height:${px(40)};background:#fff;border-right:${px(6)} solid ${C.ink};border-bottom:${px(6)} solid ${C.ink}}
.cbub p.tail-l::after{left:${px(60)};transform:rotate(45deg) skew(12deg,12deg)}
.cbub p.tail-r::after{right:${px(60)};transform:rotate(45deg) skew(12deg,12deg)}
`;
}

/**
 * The page script that moves cartoon scenes. cartoon(el, t, len, talk) poses everything in one
 * scene for the moment t seconds into it, the same way every time, so Chrome can draw it frame by frame.
 */
export const CARTOON_SCRIPT = `
var CT={};
function cx(g){if(!g)return null;return{g:g,x:parseFloat(g.getAttribute('data-x')),s:parseFloat(g.getAttribute('data-s')),face:parseFloat(g.getAttribute('data-face')),bob:g.querySelector('.bob'),ll:g.querySelector('.lg.l'),lr:g.querySelector('.lg.r'),al:g.querySelector('.ar.l'),ar:g.querySelector('.ar.r'),fl:g.querySelector('.ar.l .fa'),fr:g.querySelector('.ar.r .fa'),hd:g.querySelector('.hd'),ey:g.querySelector('.ey'),mo:g.querySelector('.mo'),mc:g.querySelector('.mc'),mf:g.querySelector('.mf'),th:g.querySelector('.th'),ex:g.querySelector('.ex'),rn:g.querySelector('.rn')}}
function rot(el,tx,ty,a){if(el)el.setAttribute('transform','translate('+tx+' '+ty+') rotate('+a.toFixed(2)+')')}
function pose(c,x,y,p,G){
  c.g.setAttribute('transform','translate('+x.toFixed(1)+' '+(G+y*c.s).toFixed(1)+') scale('+(c.s*c.face)+' '+c.s+')');
  rot(c.ll,-40,-250,p.ll||0);rot(c.lr,40,-250,p.lr||0);
  rot(c.al,-84,-470,p.al==null?8:p.al);rot(c.ar,84,-470,p.ar==null?-8:p.ar);
  rot(c.fl,0,122,p.fl||0);rot(c.fr,0,122,p.fr||0);
  rot(c.hd,0,-625+(p.hy||0),p.tilt||0);
  if(c.ey)c.ey.setAttribute('transform','translate('+(p.lx||0)+' '+(p.ly||0)+') scale(1 '+(p.eye||1)+')');
  var open=p.open?1:0;if(c.mo)c.mo.setAttribute('opacity',open);if(c.mc)c.mc.setAttribute('opacity',p.frown||open?0:1);if(c.mf)c.mf.setAttribute('opacity',p.frown&&!open?1:0);
}
function walk(t,k){return{ll:Math.sin(t*k)*28,lr:-Math.sin(t*k)*28,al:8-Math.sin(t*k)*22,ar:-8+Math.sin(t*k)*22}}
function cartoon(el,t,len,talk){
  var C=CT[el.getAttribute('data-i')];
  if(!C){var svg=el.querySelector('svg.cartoon');C=CT[el.getAttribute('data-i')]={a:el.getAttribute('data-action'),G:parseFloat(el.getAttribute('data-g')),W:parseFloat(el.getAttribute('data-w')),H:parseFloat(el.getAttribute('data-h')),m:cx(svg.querySelector('.cx.main')),fr:cx(svg.querySelector('.cx.friend')),pp:svg.querySelector('.pp'),cf:[].slice.call(svg.querySelectorAll('.cf'))}}
  var a=C.a,m=C.m,G=C.G,W=C.W,H=C.H,s=m.s;
  var mouth=talk&&t>0.35&&t<len-0.25&&Math.sin(t*15)>-0.1;
  var breathe=Math.sin(t*2.2)*4;
  var p={hy:breathe,open:mouth},x=m.x,y=0;
  if(a==='walk_in'){var k=ease(t/1.6);x=m.x-(1-k)*W*0.5;if(t<1.6){var w=walk(t,9);p.ll=w.ll;p.lr=w.lr;p.al=w.al;p.ar=w.ar;y=-Math.abs(Math.sin(t*9))*10}else{p.ar=-25+Math.sin(t*3)*10;p.fr=-50}}
  else if(a==='run'){x=-W*0.15+(W*1.3)*clamp(t/Math.max(len,1));var r=walk(t,15);p.ll=r.ll*1.5;p.lr=r.lr*1.5;p.al=r.al*1.8;p.ar=r.ar*1.8;p.fl=60;p.fr=-60;y=-Math.abs(Math.sin(t*15))*18;p.tilt=6}
  else if(a==='wave'){p.ar=-150+Math.sin(t*9)*18;p.fr=-20;p.tilt=Math.sin(t*2)*3}
  else if(a==='talk'){p.ar=-28+Math.sin(t*3.2)*12;p.fr=-55+Math.sin(t*2.4)*10;p.al=14+Math.sin(t*2.6)*6;p.tilt=Math.sin(t*1.6)*3}
  else if(a==='point'||a==='present'){var q=ease((t-0.3)/0.5);p.ar=-8-82*q;p.fr=-6*q;p.tilt=4*q;p.lx=8*q}
  else if(a==='think'){var q2=ease((t-0.2)/0.6);p.ar=-12*q2;p.fr=-150*q2;p.tilt=-6*q2;p.ly=-6*q2;p.lx=6*q2;if(m.th){[].slice.call(m.th.children).forEach(function(d,i){d.setAttribute('opacity',ease((t-0.6-i*0.35)/0.3))});m.th.setAttribute('opacity',1)}}
  else if(a==='surprised'){var j=t>0.5?Math.max(0,Math.sin(Math.min((t-0.5)*5.5,Math.PI))):0;y=-j*70;var q3=ease((t-0.45)/0.25);p.ar=-8-150*q3;p.al=8+150*q3;p.eye=1+0.55*q3;p.open=q3>0.5;if(m.ex){m.ex.setAttribute('opacity',q3);m.ex.setAttribute('transform','translate(150 -840) scale('+(0.6+0.4*q3)+')')}}
  else if(a==='celebrate'){y=-Math.abs(Math.sin(t*6))*55;p.ar=-155+Math.sin(t*11)*15;p.al=155-Math.sin(t*11)*15;p.fr=-15;p.fl=15;p.open=true;p.ll=Math.sin(t*12)*10;p.lr=-Math.sin(t*12)*10}
  else if(a==='open_box'){var q4=ease((t-0.2)/0.5);p.ar=-8-62*q4;p.fr=-30*q4;var after=ease((t-1.6)/0.4);if(after>0){p.ar=-70-80*after;p.al=8+120*after;p.eye=1+0.4*after;p.open=true}}
  else if(a==='type_laptop'){p.ar=-62+Math.sin(t*22)*5;p.fr=-38;p.al=-48+Math.cos(t*22)*5;p.fl=-38;p.tilt=5;p.ly=4}
  else if(a==='shrug'){var q5=ease((t-0.3)/0.4);p.ar=-8-38*q5;p.fr=-95*q5;p.al=8+38*q5;p.fl=95*q5;p.tilt=8*q5*Math.sin(t*1.5+1);p.hy=breathe-10*q5}
  else if(a==='sad'){p.tilt=12;p.hy=breathe+12;p.ar=-2;p.al=2;p.frown=true;p.open=false;y=4;if(m.rn){m.rn.setAttribute('opacity',ease((t-0.4)/0.5));m.rn.setAttribute('transform','translate('+(Math.sin(t*1.2)*14)+' -900)')}}
  pose(m,x,y,p,G);
  if(C.fr){var f=C.fr,fp={hy:Math.sin(t*2+1)*4,tilt:Math.sin(t*3)*4*ease((t-0.5)/0.4),ar:-8,al:8};
    if(a==='celebrate'){fp={hy:0,ar:-150+Math.sin(t*10+1)*15,al:150-Math.sin(t*10+1)*15,open:true};pose(f,f.x,-Math.abs(Math.sin(t*6+0.8))*50,fp,G)}
    else if(a==='surprised'){var q6=ease((t-0.55)/0.25);fp.ar=-8-120*q6;fp.al=8+120*q6;fp.eye=1+0.5*q6;fp.open=q6>0.5;pose(f,f.x,0,fp,G)}
    else if(a==='sad'){fp.tilt=-10;fp.al=40;fp.fl=60;pose(f,f.x,0,fp,G)}
    else pose(f,f.x,0,fp,G)}
  var P=C.pp;if(P){var kind=P.getAttribute('class').split(' ')[1];
    if(kind==='box'){var o=ease((t-1.0)/0.6);var lid=P.querySelector('.lid');if(a==='open_box'){lid.setAttribute('transform','translate(-130 -200) rotate('+(-115*o)+')');P.querySelector('.ry').setAttribute('opacity',ease((t-1.3)/0.5)*(0.75+0.25*Math.sin(t*6)))}}
    else if(kind==='laptop'){P.querySelector('.sc').setAttribute('opacity',0.75+0.25*Math.sin(t*7))}
    else if(kind==='phone'){var nt=P.querySelector('.nt');nt.setAttribute('transform','translate(80 -160) scale('+(1+0.18*Math.sin(t*7))+') translate(-80 160)')}
    else if(kind==='lightbulb'){var on=ease((t-0.7)/0.35);P.querySelector('.gl').setAttribute('fill',on>0.5?'#ffe27a':'#e9e4d4');P.querySelector('.ry').setAttribute('opacity',on*(0.7+0.3*Math.sin(t*6)))}
    else if(kind==='chart'){[].slice.call(P.querySelectorAll('.bar')).forEach(function(b,i){var h=parseFloat(b.getAttribute('data-h'))*260*ease((t-0.5-i*0.3)/0.7);b.setAttribute('height',h.toFixed(1));b.setAttribute('y',(-320-h).toFixed(1))});P.querySelector('.up').setAttribute('opacity',ease((t-1.6)/0.4))}
    else if(kind==='coffee'){var st=P.querySelector('.st');st.setAttribute('transform','translate(0 '+(-((t*30)%40)).toFixed(1)+')');st.setAttribute('opacity',0.5+0.5*Math.sin(t*3))}
    else if(kind==='book'){P.querySelector('.pg').setAttribute('transform','scale(1 '+(0.6+0.4*Math.abs(Math.cos(t*2.2)))+')')}
    else if(kind==='rocket'){var lift=Math.max(0,t-1.1);P.querySelector('.rk').setAttribute('transform','translate(0 '+(-lift*lift*420).toFixed(1)+')');P.querySelector('.fl').setAttribute('opacity',t>0.8?0.7+0.3*Math.sin(t*30):0)}
    else if(kind==='money'){[].slice.call(P.querySelectorAll('.cn')).forEach(function(c,i){var d=ease((t-0.3-i*0.3)/0.35);c.setAttribute('opacity',d>0?1:0);c.setAttribute('transform','translate(0 '+(-(1-d)*220).toFixed(1)+')')})}
    else if(kind==='clock'){P.querySelector('.mh').setAttribute('transform','rotate('+(t*140).toFixed(1)+')');P.querySelector('.hh').setAttribute('transform','rotate('+(60+t*12).toFixed(1)+')')}
    else if(kind==='key'){P.querySelector('.ky').setAttribute('transform','translate(0 -620) rotate('+(Math.sin(t*2)*8).toFixed(1)+')');P.querySelector('.gl').setAttribute('opacity',0.4+0.6*Math.abs(Math.sin(t*3)))}
    if(a==='point'||a==='present'){var pulse=1+0.04*Math.sin(t*6)*ease((t-0.6)/0.3);var tr=P.getAttribute('data-base')||P.getAttribute('transform');P.setAttribute('data-base',tr);P.setAttribute('transform',tr+' scale('+pulse.toFixed(3)+')')}}
  if(a==='celebrate'){C.cf.forEach(function(r,i){var sp=0.55+(i%5)*0.12,yy=((t*sp*H*0.45)+(i*97)%H)%(H*1.05)-40;r.setAttribute('opacity',ease(t/0.4));r.setAttribute('transform','translate(0 '+yy.toFixed(1)+') rotate('+((t*200+i*40)%360).toFixed(0)+' '+r.getAttribute('data-x')+' 0)')})}
}
`;
