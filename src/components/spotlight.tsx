"use client";

import { useEffect } from "react";

/** Lets the lavender glow on cards follow the pointer (read by .bg-paper and .bg-deep in globals.css). */
export function Spotlight() {
  useEffect(() => {
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const card = (event.target as Element | null)?.closest?.<HTMLElement>(".bg-paper, .bg-deep");
        if (!card) return;
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${event.clientX - box.left}px`);
        card.style.setProperty("--my", `${event.clientY - box.top}px`);
      });
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
    };
  }, []);
  return null;
}
