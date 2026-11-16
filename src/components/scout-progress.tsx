"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ScoutJobStatus } from "@/lib/scout-job";

type Job = { id: string; status: ScoutJobStatus; count: number; error: string | null; startedAt: number; endedAt: number | null };

export type ScoutProgressText = {
  working: string;
  stop: string;
  stopping: string;
  stopped: string;
  done: string;
  failed: string;
  dismiss: string;
};

const POLL_MS = 2500;
/** A finished search is reported only if it ended recently, so an old result doesn't greet you days later. */
const RECENT_MS = 10 * 60 * 1000;

/**
 * Shows the idea scout's background search: still working (with a Stop button), or how it ended.
 * When it ends, the page reloads its data so the new ideas appear.
 */
export function ScoutProgress({ initial, text }: { initial: Job | null; text: ScoutProgressText }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(initial);
  const [stopping, setStopping] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // The clock starts in the browser, so the server's page and the browser's first render match.
  const [now, setNow] = useState<number | null>(null);
  const wasRunning = useRef(initial?.status === "running");

  useEffect(() => setNow(Date.now()), []);

  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(async () => {
      setNow(Date.now());
      try {
        const response = await fetch("/api/scout", { cache: "no-store" });
        const { job: latest } = (await response.json()) as { job: Job | null };
        setJob(latest);
        if (wasRunning.current && latest?.status !== "running") {
          wasRunning.current = false;
          setStopping(false);
          router.refresh();
        }
      } catch {
        // A missed check is fine; the next one tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job?.status, router]);

  async function stop() {
    setStopping(true);
    try {
      await fetch("/api/scout", { method: "DELETE" });
    } catch {
      setStopping(false);
    }
  }

  if (!job || dismissed === job.id) return null;
  if (job.status !== "running" && (now === null || !job.endedAt || now - job.endedAt > RECENT_MS)) return null;

  if (job.status === "running") {
    const seconds = now === null ? null : Math.max(0, Math.round((now - job.startedAt) / 1000));
    const elapsed = seconds === null ? "" : ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`;
    return (
      <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-s-4 border-cobalt bg-paper p-4 text-sm">
        <span className="pending-pulse">
          {text.working} <span className="label">{elapsed}</span>
        </span>
        <button type="button" onClick={stop} disabled={stopping} className="btn btn-quiet">
          {stopping ? text.stopping : text.stop}
        </button>
      </div>
    );
  }

  const message =
    job.status === "done" ? text.done.replace("{count}", String(job.count)) : job.status === "stopped" ? text.stopped : `${text.failed} ${job.error ?? ""}`;
  return (
    <div
      role={job.status === "failed" ? "alert" : "status"}
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-s-4 bg-paper p-4 text-sm ${
        job.status === "failed" ? "border-danger" : job.status === "stopped" ? "border-amber" : "border-cobalt"
      }`}
    >
      <span>{message}</span>
      <button type="button" onClick={() => setDismissed(job.id)} className="btn btn-quiet">
        {text.dismiss}
      </button>
    </div>
  );
}
