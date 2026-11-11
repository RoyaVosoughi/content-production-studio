"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { AGENTS, type AgentId } from "@/lib/agents/roster";
import type { UiLanguage } from "@/lib/language";
import { sectionOf, type SectionId } from "./rail-nav";

/**
 * The large animated picture above each section's headline. Purely decorative:
 * hidden from screen readers, and still when the computer asks for less motion.
 */
export function HeroArt({ language }: { language: UiLanguage }) {
  const pathname = usePathname();
  const here = sectionOf(pathname, language);
  if (!here.top) return null;
  const Art = ARTS[here.id];
  if (!Art) return null;
  return (
    <div className={`art art-${here.id}`} aria-hidden>
      <Art language={language} />
    </div>
  );
}

// The Studio page has the live map of the team instead of a picture.
const ARTS: Partial<Record<SectionId, (props: { language: UiLanguage }) => React.ReactNode>> = {
  team: NodeGraph,
  results: Radar,
  brand: Spotlight,
  connections: Vault,
  setup: Orbit,
};

/** A few slow sparks drifting upward. Positions are fixed so the page renders the same on server and browser. */
function Motes({ count = 14 }: { count?: number }) {
  return (
    <div className="motes">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={
            {
              "--x": `${(i * 37 + 11) % 100}%`,
              "--d": `${(i * 0.73) % 6}s`,
              "--t": `${6 + ((i * 1.7) % 5)}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** The constellation mark used at the center of several pictures. */
function Mark({ size = 56 }: { size?: number }) {
  return (
    <span className="art-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#fff" strokeWidth="1.2">
        <circle cx="12" cy="12" r="8.5" strokeOpacity="0.55" />
        <path d="M5 10.5 11 6l6.5 4-2 6.5-6.5 1.5L5 10.5Z M11 6l4.5 10.5M5 10.5l12.5-.5M9 18l2-12" strokeLinejoin="round" strokeOpacity="0.85" />
        {[
          [11, 6],
          [17.5, 10],
          [15.5, 16.5],
          [9, 18],
          [5, 10.5],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" fill="#fff" stroke="none" />
        ))}
      </svg>
    </span>
  );
}

/** Team: the agents as glowing nodes, with work travelling along the lines to the manager. */
const GRAPH: { id: AgentId; x: number; y: number; hue: string }[] = [
  { id: "scout", x: 70, y: 150, hue: "#4fd1a5" },
  { id: "storyteller", x: 170, y: 60, hue: "#e59cff" },
  { id: "manager", x: 300, y: 125, hue: "#9382ff" },
  { id: "carousel", x: 430, y: 55, hue: "#9cb2ff" },
  { id: "linkedin", x: 470, y: 175, hue: "#ba9cff" },
  { id: "coach", x: 200, y: 200, hue: "#7d62ff" },
];

function NodeGraph({ language }: { language: UiLanguage }) {
  const center = GRAPH.find((node) => node.id === "manager")!;
  const others = GRAPH.filter((node) => node !== center);
  const curve = (node: (typeof GRAPH)[number]) => {
    const mx = (node.x + center.x) / 2;
    return `M${node.x} ${node.y} C${mx} ${node.y} ${mx} ${center.y} ${center.x} ${center.y}`;
  };
  return (
    <svg viewBox="0 0 540 240" className="graph">
      <defs>
        {GRAPH.map((node) => (
          <radialGradient key={node.id} id={`node-${node.id}`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="0.35" stopColor={node.hue} />
            <stop offset="1" stopColor={node.hue} stopOpacity="0.15" />
          </radialGradient>
        ))}
        <filter id="node-glow" x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {others.map((node, i) => (
        <g key={node.id}>
          <path id={`edge-${node.id}`} d={curve(node)} fill="none" stroke="rgb(183 164 251 / 0.28)" strokeWidth="1.2" />
          <circle r="2.5" fill="#fff" className="graph-pulse">
            <animateMotion dur={`${3 + i * 0.6}s`} begin={`${i * 0.7}s`} repeatCount="indefinite">
              <mpath href={`#edge-${node.id}`} />
            </animateMotion>
          </circle>
        </g>
      ))}
      {GRAPH.map((node) => {
        const r = node === center ? 16 : 10;
        return (
          <g key={node.id} className="graph-node" style={{ "--hue": node.hue } as CSSProperties}>
            <circle cx={node.x} cy={node.y} r={r + 6} fill={node.hue} opacity="0.45" filter="url(#node-glow)" />
            <circle cx={node.x} cy={node.y} r={r} fill={`url(#node-${node.id})`} stroke="rgb(255 255 255 / 0.35)" />
            <text x={node.x} y={node.y + r + 18} textAnchor="middle" fill="#cdccd0" fontSize="12">
              {AGENTS[node.id].name[language]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Results: a radar of concentric half circles with a beam sweeping across. */
function Radar() {
  return (
    <div className="radar">
      {[1, 2, 3, 4, 5].map((ring) => (
        <span key={ring} className="radar-ring" style={{ "--r": ring } as CSSProperties} />
      ))}
      <span className="radar-sweep" />
      <span className="radar-axis" />
      <span className="radar-base" />
      <div className="radar-center">
        <Mark size={52} />
      </div>
    </div>
  );
}

/** Brand Kit: a beam of light falling from above onto the headline. */
function Spotlight() {
  return (
    <>
      <div className="beam beam-wide" />
      <div className="beam beam-core" />
      <div className="beam-floor" />
      <Motes count={18} />
    </>
  );
}

/** Connections: a lock glowing in front of scrolling encrypted text, with a planet rising below. */
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function token(seed: number) {
  // A small integer hash, so each line looks random but renders the same everywhere.
  let s = seed * 2654435761;
  let out = "";
  const length = 5 + (seed % 7);
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out += CHARS[(s >>> 0) % CHARS.length];
  }
  return out;
}
const CIPHER = Array.from({ length: 14 }, (_, row) =>
  Array.from({ length: 9 }, (_, col) => token(row * 31 + col * 7 + 3)).join("   "),
);

function Vault() {
  return (
    <>
      <div className="cipher" dir="ltr">
        <div className="cipher-scroll">
          {[...CIPHER, ...CIPHER].map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      <div className="lock">
        <svg viewBox="0 0 64 80" width="72" height="90">
          <defs>
            <linearGradient id="shackle" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#c9bcff" />
              <stop offset="1" stopColor="#7d62ff" />
            </linearGradient>
          </defs>
          <path d="M16 34V24a16 16 0 0 1 32 0v10" fill="none" stroke="url(#shackle)" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <div className="lock-body">
          <Mark size={46} />
        </div>
      </div>
      <div className="planet" />
    </>
  );
}

/** Setup: rings turning slowly around the studio's mark, with small planets riding them. */
function Orbit() {
  return (
    <div className="orbit">
      <span className="orbit-ring" style={{ "--s": 1, "--dur": "18s", "--delay": "-4s" } as CSSProperties}>
        <i />
      </span>
      <span className="orbit-ring" style={{ "--s": 1.55, "--dur": "28s", "--delay": "-17s" } as CSSProperties}>
        <i />
      </span>
      <span className="orbit-ring" style={{ "--s": 2.1, "--dur": "40s", "--delay": "-9s" } as CSSProperties}>
        <i />
      </span>
      <div className="orbit-center">
        <Mark size={58} />
      </div>
      <Motes count={10} />
    </div>
  );
}
