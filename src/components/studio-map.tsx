import Link from "next/link";
import type { CSSProperties } from "react";
import { AGENTS } from "@/lib/agents/roster";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";
import { WRITERS, type MapNodeId, type MapState } from "@/lib/map";

/** Where each step sits on a 1000 × 560 board, left to right in the order work travels. */
const SPOTS: Record<MapNodeId, { x: number; y: number; hue: string }> = {
  scout: { x: 90, y: 280, hue: "#4fd1a5" },
  storyteller: { x: 330, y: 280, hue: "#e59cff" },
  manager: { x: 305, y: 75, hue: "#9382ff" },
  coach: { x: 305, y: 490, hue: "#5046e4" },
  telegram: { x: 585, y: 70, hue: "#6cb6ff" },
  linkedin: { x: 585, y: 175, hue: "#9cb2ff" },
  carousel: { x: 585, y: 280, hue: "#ba9cff" },
  blogger: { x: 585, y: 385, hue: "#c9b8ff" },
  scriptwriter: { x: 585, y: 490, hue: "#9382ff" },
  editor: { x: 765, y: 490, hue: "#7d62ff" },
  live: { x: 925, y: 280, hue: "#f4f0ff" },
};

const BIG: MapNodeId[] = ["manager", "live"];

type Edge = { from: MapNodeId; to: MapNodeId; support?: boolean };

function edges(): Edge[] {
  const line: Edge[] = [
    { from: "scout", to: "storyteller" },
    ...WRITERS.map((writer) => ({ from: "storyteller" as MapNodeId, to: writer })),
    { from: "scriptwriter", to: "editor" },
    ...(["telegram", "linkedin", "carousel", "blogger", "editor"] as MapNodeId[]).map((from) => ({ from, to: "live" as MapNodeId })),
  ];
  // The manager checks every writer's first draft; the coach turns feedback from each of them into lessons.
  const checked: MapNodeId[] = ["scout", "storyteller", ...WRITERS, "editor"];
  const support: Edge[] = [
    ...checked.map((to) => ({ from: "manager" as MapNodeId, to, support: true })),
    ...checked.map((to) => ({ from: "coach" as MapNodeId, to, support: true })),
    { from: "coach", to: "manager", support: true },
  ];
  return [...support, ...line];
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, vertical: boolean) {
  if (vertical) {
    const my = (a.y + b.y) / 2;
    return `M${a.x} ${a.y} C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
  }
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

export function StudioMap({
  state,
  ui,
  t,
  hrefs,
  selected = [],
  label,
}: {
  state: MapState;
  ui: UiLanguage;
  t: Strings;
  /** Where clicking each step goes. */
  hrefs: Partial<Record<MapNodeId, string>>;
  /** The steps to show as "you are here". */
  selected?: MapNodeId[];
  label: string;
}) {
  const rtl = ui === "fa";
  // In Farsi the line runs right to left, like the text.
  const at = (id: MapNodeId) => ({ x: rtl ? 1000 - SPOTS[id].x : SPOTS[id].x, y: SPOTS[id].y });
  const nodes = Object.keys(SPOTS) as MapNodeId[];
  const statusText = (id: MapNodeId) => {
    const node = state[id];
    if (id === "manager" || id === "coach") return null;
    if (id === "live") return node.count > 0 ? t.mapLiveCount.replace("{count}", node.count.toLocaleString(ui)) : t.mapIdle;
    if (node.status === "waiting") return t.mapWaiting.replace("{count}", node.count.toLocaleString(ui));
    return node.status === "done" ? t.mapDone : t.mapIdle;
  };

  return (
    <div className="map-scroll">
      <div className="map" role="group" aria-label={label}>
        <svg viewBox="0 0 1000 560" className="map-lines" aria-hidden>
          {edges().map((edge, index) => {
            const a = at(edge.from);
            const b = at(edge.to);
            const on = state[edge.to].status !== "idle";
            const id = `map-edge-${index}`;
            return (
              <g key={id} className={edge.support ? "map-edge-support" : on ? "map-edge map-edge-on" : "map-edge"}>
                <path id={id} d={curve(a, b, Math.abs(a.x - b.x) < 120)} />
                {on && !edge.support && (
                  <circle r="3" className="map-spark">
                    <animateMotion dur={`${2.6 + (index % 5) * 0.4}s`} begin={`${(index % 4) * 0.6}s`} repeatCount="indefinite">
                      <mpath href={`#${id}`} />
                    </animateMotion>
                  </circle>
                )}
              </g>
            );
          })}
        </svg>
        {nodes.map((id) => {
          const spot = at(id);
          const node = state[id];
          const href = hrefs[id];
          const name = id === "live" ? t.mapLive : AGENTS[id].name[ui];
          const status = statusText(id);
          const style = {
            left: `${spot.x / 10}%`,
            top: `${(spot.y / 560) * 100}%`,
            "--hue": SPOTS[id].hue,
          } as CSSProperties;
          const body = (
            <>
              <span className="map-orb">
                {node.status === "waiting" && node.count > 0 && <span className="map-count">{node.count.toLocaleString(ui)}</span>}
              </span>
              <span className="map-name">{name}</span>
              {status && <span className="map-status">{status}</span>}
            </>
          );
          const className = `map-node${BIG.includes(id) ? " map-node-big" : ""}`;
          return href ? (
            <Link
              key={id}
              href={href}
              scroll={false}
              className={className}
              style={style}
              data-status={node.status}
              aria-current={selected.includes(id) ? "step" : undefined}
            >
              {body}
            </Link>
          ) : (
            <span key={id} className={className} style={style} data-status={node.status}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}
