"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type PostTab = { key: string; label: string; badge?: string; tone?: "draft" | "scheduled" | "posted" | "add" };

const TONES = {
  draft: "bg-cobalt",
  scheduled: "bg-amber",
  posted: "bg-ink-soft",
  add: "",
};

/**
 * One post at a time: a row of tabs, one per channel, and only the chosen post below. Every post
 * stays on the page, only hidden, so an edit you haven't saved is still there when you come back.
 * The address keeps the tab (#post-reel), so links from the map and the calendar open the right one.
 */
export function PostTabs({ tabs, panels, label }: { tabs: PostTab[]; panels: ReactNode[]; label: string }) {
  const [selected, setSelected] = useState(tabs[0]?.key);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const keys = tabs.map((tab) => tab.key).join(" ");
  useEffect(() => {
    const fromHash = () => {
      const key = decodeURIComponent(window.location.hash.replace(/^#post-/, ""));
      if (keys.split(" ").includes(key)) {
        setSelected(key);
        document.getElementById("post-tabs")?.scrollIntoView({ block: "start" });
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [keys]);

  function choose(key: string) {
    setSelected(key);
    window.history.replaceState(null, "", `#post-${key}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.key === selected);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key as "ArrowRight" | "ArrowLeft"];
    let next = index;
    if (step) next = (index + step + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    choose(tabs[next].key);
    buttons.current[next]?.focus();
  }

  return (
    <div id="post-tabs" className="mt-6 scroll-mt-28">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="nav-scroll flex gap-1 overflow-x-auto border-b border-mist">
        {tabs.map((tab, index) => {
          const active = tab.key === selected;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={active}
              aria-controls={`panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(tab.key)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                active ? "border-cobalt text-ink" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {tab.tone && tab.tone !== "add" && <span aria-hidden className={`size-2 rounded-full ${TONES[tab.tone]}`} />}
              {tab.label}
              {tab.badge && <span className="sr-only">({tab.badge})</span>}
            </button>
          );
        })}
      </div>
      {panels.map((panel, index) => (
        <div
          key={tabs[index].key}
          role="tabpanel"
          id={`panel-${tabs[index].key}`}
          aria-labelledby={`tab-${tabs[index].key}`}
          hidden={tabs[index].key !== selected}
          className="pt-5"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
