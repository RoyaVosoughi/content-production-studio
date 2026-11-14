"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { makeAnimationAction, removeNarrationAction, replanAnimationAction, retryNarrationAction, saveAnimationAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";
import { platformLabel, VIDEO_PLATFORMS, type VideoPlatform } from "@/lib/platforms";
import { clock, hasItems, SCENE_KINDS, type AnimationScene, type SceneKind } from "@/lib/video/animation";

const percent = (value: number | null, ui: UiLanguage) => {
  const amount = Math.round((value ?? 0) * 100);
  return ui === "fa" ? `${amount.toLocaleString("fa-IR")}٪` : `${amount}%`;
};

/** Reloads the page's data every two seconds while the narration is read or the video is made. */
function useRefreshWhile(busy: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [busy, router]);
}

/** While the video editor plans the scenes, or when it couldn't: what's happening, and a way to try again. */
export function PlanningNote({ id, planning, error, t }: { id: string; planning: boolean; error: string | null; t: Strings }) {
  const v = t.videoStudio;
  useRefreshWhile(planning);
  if (planning) {
    return (
      <p role="status" className="pending-pulse rounded-xl border-s-4 border-cobalt bg-paper p-4 text-sm" data-planning>
        {v.planningNote}
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border-s-4 border-amber bg-paper p-4 text-sm">
      <p className="min-w-0 flex-1 font-medium">{error}</p>
      <ActionForm action={replanAnimationAction}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton pendingLabel={v.planning} name="mode" value="ai">
          {v.planRetry}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

const blank = (kind: SceneKind): AnimationScene => ({ kind, say: "", heading: "", text: "", items: [] });

/**
 * The scenes, one card each: its kind, its on-screen text and the line said meanwhile. Saving
 * replaces them all. Remount with key={updatedAt} so the cards match what was saved.
 */
export function SceneEditor({
  id,
  title,
  platform,
  captions,
  scenes: saved,
  dir,
  ui,
  t,
}: {
  id: string;
  title: string;
  platform: VideoPlatform;
  captions: boolean;
  scenes: AnimationScene[];
  dir: "ltr" | "rtl";
  ui: UiLanguage;
  t: Strings;
}) {
  const v = t.videoStudio;
  const [scenes, setScenes] = useState(saved);
  const [dirty, setDirty] = useState(false);

  function change(index: number, fields: Partial<AnimationScene>) {
    setScenes((all) => all.map((scene, at) => (at === index ? { ...scene, ...fields } : scene)));
    setDirty(true);
  }
  function move(index: number, by: number) {
    setScenes((all) => {
      const next = [...all];
      const [scene] = next.splice(index, 1);
      next.splice(index + by, 0, scene);
      return next;
    });
    setDirty(true);
  }

  return (
    <ActionForm action={saveAnimationAction} className="space-y-4" onInput={() => setDirty(true)}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="scenes" value={JSON.stringify(scenes)} />
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="label mb-1 block">{v.titleLabel}</span>
          <input name="title" defaultValue={title} maxLength={120} dir={dir} className="field" />
        </label>
        <label className="block">
          <span className="label mb-1 block">{v.platformLabel}</span>
          <select name="platform" defaultValue={platform} className="field">
            {VIDEO_PLATFORMS.map((option) => (
              <option key={option} value={option}>
                {platformLabel(option, ui)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h2 className="font-display text-2xl font-semibold">{v.scenes}</h2>
        <p className="mt-1 text-sm text-ink-soft">{v.scenesHint}</p>
      </div>

      <ol className="space-y-3">
        {scenes.map((scene, index) => {
          const headingLabel = (v.headingFor as Partial<Record<SceneKind, string>>)[scene.kind] ?? v.heading;
          const textLabel = (v.textFor as Partial<Record<SceneKind, string>>)[scene.kind];
          return (
            <li key={index} className="rounded-xl border border-mist bg-canvas p-4" data-scene={index + 1}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{v.scene.replace("{number}", (index + 1).toLocaleString(ui === "fa" ? "fa-IR" : "en-US"))}</span>
                <select
                  aria-label={v.kind}
                  value={scene.kind}
                  onChange={(event) => change(index, { kind: event.target.value as SceneKind })}
                  className="field !w-auto !py-1 text-sm"
                >
                  {SCENE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {v.kinds[kind]}
                    </option>
                  ))}
                </select>
                <span className="ms-auto flex gap-1">
                  <button type="button" className="btn btn-quiet !min-h-8 !px-2 text-xs" disabled={index === 0} onClick={() => move(index, -1)} aria-label={v.up} title={v.up}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet !min-h-8 !px-2 text-xs"
                    disabled={index === scenes.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={v.down}
                    title={v.down}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet !min-h-8 !px-2 text-xs"
                    disabled={scenes.length === 1}
                    onClick={() => {
                      setScenes((all) => all.filter((_, at) => at !== index));
                      setDirty(true);
                    }}
                  >
                    {v.remove}
                  </button>
                </span>
              </div>
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <span className="label mb-1 block">{headingLabel}</span>
                  <input value={scene.heading} onChange={(event) => change(index, { heading: event.target.value })} maxLength={120} dir="auto" className="field" />
                </label>
                {textLabel && (
                  <label className="block">
                    <span className="label mb-1 block">{textLabel}</span>
                    <input value={scene.text} onChange={(event) => change(index, { text: event.target.value })} maxLength={200} dir="auto" className="field" />
                  </label>
                )}
              </div>
              {hasItems(scene.kind) && (
                <label className="mt-3 block">
                  <span className="label mb-1 block">{scene.kind === "compare" ? v.itemsCompare : v.items}</span>
                  <textarea
                    rows={Math.max(2, scene.items.length + 1)}
                    value={scene.items.join("\n")}
                    onChange={(event) => change(index, { items: event.target.value.split("\n") })}
                    dir="auto"
                    className="field"
                  />
                </label>
              )}
              <label className="mt-3 block">
                <span className="label mb-1 block">{v.say}</span>
                <textarea rows={2} value={scene.say} onChange={(event) => change(index, { say: event.target.value })} dir="auto" className="field" />
                {!scene.say.trim() && <span className="mt-1 block text-xs text-ink-soft">{v.sayEmpty}</span>}
              </label>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-soft">{v.addScene}:</span>
        {(["statement", "points", "number", "steps", "quote", "compare"] as SceneKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn-quiet !min-h-8 !px-3 text-sm"
            onClick={() => {
              setScenes((all) => {
                const end = all.at(-1)?.kind === "end" ? all.length - 1 : all.length;
                return [...all.slice(0, end), blank(kind), ...all.slice(end)];
              });
              setDirty(true);
            }}
          >
            + {v.kinds[kind]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="captions" defaultChecked={captions} className="size-4 accent-cobalt" />
        <span>{v.captions}</span>
      </label>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl bg-paper/95 p-3 shadow-sm backdrop-blur">
        <SubmitButton pendingLabel={v.saving} className="btn-primary" disabled={!dirty}>
          {v.save}
        </SubmitButton>
        {dirty && <span className="text-sm text-amber-deep">{v.unsaved}</span>}
      </div>
    </ActionForm>
  );
}

export type NarrationView = {
  name: string | null;
  status: "processing" | "ready" | "failed" | null;
  stage: string | null;
  progress: number | null;
  error: string | null;
  duration: number | null;
  stopped: boolean;
};

/** The optional recording of the script, which the scenes and captions follow once Whisper has read it. */
export function NarrationPanel({ id, narration, ui, t }: { id: string; narration: NarrationView; ui: UiLanguage; t: Strings }) {
  const v = t.videoStudio;
  const router = useRouter();
  const [upload, setUpload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = narration.status === "processing" && !narration.stopped;
  useRefreshWhile(busy);

  function send(file: File) {
    setError(null);
    setUpload(0);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/animations/${id}/narration`);
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => event.lengthComputable && setUpload(event.loaded / event.total);
    request.onload = () => {
      let message: string | null = null;
      try {
        const body = JSON.parse(request.responseText) as { ok?: boolean; error?: string };
        if (!body.ok) message = body.error ?? t.uploadFailed;
      } catch {
        message = t.uploadFailed;
      }
      setUpload(null);
      if (message) setError(message);
      else router.refresh();
    };
    request.onerror = () => {
      setUpload(null);
      setError(t.uploadFailed);
    };
    request.send(file);
  }

  const stage =
    narration.stage === "model"
      ? v.voiceModel.replace("{percent}", percent(narration.progress, ui))
      : narration.stage === "transcribing"
        ? v.voiceTranscribing.replace("{percent}", percent(narration.progress, ui))
        : narration.stage === "audio"
          ? v.voiceAudio
          : v.voiceReading;

  return (
    <section className="rounded-xl bg-paper p-4" data-narration>
      <h2 className="font-semibold">{v.voice}</h2>
      <p className="mt-1 text-sm text-ink-soft">{v.voiceHint}</p>
      <div className="mt-3 space-y-2 text-sm" aria-live="polite">
        {upload !== null ? (
          <p className="pending-pulse">{v.voiceUploading.replace("{percent}", percent(upload, ui))}</p>
        ) : busy ? (
          <p className="pending-pulse">{stage}</p>
        ) : narration.status === "ready" ? (
          <p>
            ✓ <bdi>{v.voiceReady.replace("{name}", narration.name ?? "").replace("{length}", clock(narration.duration ?? 0, ui))}</bdi>
          </p>
        ) : narration.status === "failed" || narration.stopped ? (
          <p role="alert" className="font-medium text-danger">
            {narration.stopped ? v.voiceStopped : narration.error}
          </p>
        ) : (
          <p className="text-ink-soft">{v.voiceNone}</p>
        )}
        {error && (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className={`btn btn-quiet cursor-pointer ${upload !== null || busy ? "pointer-events-none opacity-50" : ""}`}>
          {narration.status ? v.voiceReplace : v.voiceUpload}
          <input
            type="file"
            accept="audio/*,video/mp4,video/quicktime,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac"
            className="sr-only"
            disabled={upload !== null || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) send(file);
            }}
          />
        </label>
        {(narration.status === "failed" || narration.stopped) && (
          <ActionForm action={retryNarrationAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton pendingLabel={v.voiceRetry}>{v.voiceRetry}</SubmitButton>
          </ActionForm>
        )}
        {narration.status && !busy && (
          <ActionForm action={removeNarrationAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton pendingLabel={v.voiceRemove}>{v.voiceRemove}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </section>
  );
}

export type RenderView = { ready: boolean; working: boolean; stopped: boolean; failed: string | null; progress: number | null; problem: string | null; key: string };

/** Makes the video for the scenes as saved, shows it when it's done, and offers it as a download. */
export function MakePanel({ id, render, ui, t }: { id: string; render: RenderView; ui: UiLanguage; t: Strings }) {
  const v = t.videoStudio;
  useRefreshWhile(render.working);
  return (
    <section className="rounded-xl bg-paper p-4" data-make>
      {render.ready ? (
        <div className="space-y-3">
          <video key={render.key} src={`/api/animations/${id}?k=${render.key}`} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black" />
          <a href={`/api/animations/${id}?download=1&k=${render.key}`} className="btn btn-primary">
            {v.download}
          </a>
        </div>
      ) : render.working ? (
        <p className="pending-pulse text-sm" aria-live="polite">
          {v.making.replace("{percent}", percent(render.progress, ui))}
        </p>
      ) : (
        <div className="space-y-2">
          {render.stopped && <p className="text-sm font-medium text-danger">{v.madeStopped}</p>}
          {render.failed && (
            <p role="alert" className="text-sm font-medium text-danger">
              {render.failed}
            </p>
          )}
          {render.problem && <p className="text-sm text-amber-deep">{render.problem}</p>}
          <ActionForm action={makeAnimationAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton pendingLabel={v.making.replace("{percent}", "")} className="btn-primary" disabled={Boolean(render.problem)}>
              {render.failed || render.stopped ? v.makeAgain : v.make}
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </section>
  );
}
