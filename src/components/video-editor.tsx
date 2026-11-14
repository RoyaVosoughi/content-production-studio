"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  makeVideoAction,
  markPostedByHandAction,
  planEditAction,
  retryFootageAction,
  savePieceAction,
  useFootageAction,
} from "@/app/actions";
import type { EditPlan, PieceContent, Phrase, ScriptPart } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type UiLanguage as Language } from "@/lib/language";
import { BODY_LIMITS, contentProblem, MANUAL_POSTING, platformLabel, postedText, VIDEO_FORMATS, VIDEO_TITLE_LIMIT, type VideoPlatform } from "@/lib/platforms";
import { hasPlaceholder } from "@/lib/scenario";
import { chapterLines, formatTime, keepRanges, outputDuration } from "@/lib/video/edit";
import { THUMBNAIL_PLATFORMS } from "@/lib/video/overlays";
import { ActionForm, SubmitButton } from "./action-form";
import { Notice, PieceTools, PublishStatus, type EditorPiece } from "./piece-editor";

export type EditorVideo = {
  clip: {
    id: string;
    status: "processing" | "ready" | "failed";
    stage: string | null;
    progress: number | null;
    error: string | null;
    stopped: boolean;
    duration: number | null;
    originalName: string;
    phrases: Phrase[] | null;
  } | null;
  otherClips: { id: string; originalName: string; duration: number | null }[];
  render: { status: "working" | "ready" | "failed"; progress: number | null; error: string | null; stopped: boolean } | null;
  problem: string | null;
};

const percent = (value: number | null, language: Language) => {
  const amount = Math.round((value ?? 0) * 100);
  return language === "fa" ? `${amount.toLocaleString("fa-IR")}٪` : `${amount}%`;
};

/** Reloads the page's data every two seconds while a clip is read or a video is made. */
function useRefreshWhile(busy: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [busy, router]);
}

/** Remount with key={version} so the fields always match the current version. */
export function VideoEditor({ piece, video, language, t }: { piece: EditorPiece; video: EditorVideo; language: Language; t: Strings }) {
  const platform = piece.platform as VideoPlatform;
  const formId = useId();
  const [content, setContent] = useState(piece.content);
  const [dirty, setDirty] = useState(false);
  const update = (fields: Partial<PieceContent>) => {
    setContent((current) => ({ ...current, ...fields }));
    setDirty(true);
  };
  const sourceRef = useRef<HTMLVideoElement>(null);

  const { clip, render } = video;
  const phrases = clip?.status === "ready" ? (clip.phrases ?? []) : [];
  useRefreshWhile((clip?.status === "processing" && !clip.stopped) || (render?.status === "working" && !render.stopped));

  const canEdit = piece.state === "draft" || piece.state === "failed";
  const hidden = (
    <>
      <input type="hidden" name="pieceId" value={piece.id} />
      <input type="hidden" name="version" value={piece.version} />
    </>
  );
  const videoReady = render?.status === "ready" && !dirty;
  const src = `/api/videos/${piece.id}?v=${piece.version}`;
  const problem = contentProblem(platform, content);
  const placeholder = hasPlaceholder(postedText(platform, content));
  const wide = VIDEO_FORMATS[platform].width > VIDEO_FORMATS[platform].height;
  const hasTitle = platform === "youtube" || platform === "short";
  const chapters =
    platform === "youtube" && content.edit && clip?.duration ? chapterLines(phrases, content.edit, clip.duration) : [];

  return (
    <article className="rounded-xl bg-paper p-5 md:p-6" data-platform={platform}>
      <h2 className="font-display text-2xl font-semibold">
        {platformLabel(platform, language)}{" "}
        <span className="label">
          · {t.version} {piece.version}
        </span>
      </h2>
      <PublishStatus piece={piece} language={language} t={t} />

      {/* The script comes first: it's what you film from, so it reads in full before anything else. */}
      {content.script && content.script.length > 0 && (
        <section data-script-preview aria-label={t.scriptTitle} className="mt-4 rounded-lg border-s-4 border-cobalt bg-canvas p-4">
          <p className="label">{t.scriptTitle}</p>
          <ol className="mt-3 space-y-3">
            {content.script.map((part, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden className="font-display text-lg font-semibold text-cobalt">
                  {(index + 1).toLocaleString(uiLocale(language))}
                </span>
                <div className="min-w-0">
                  <p dir="auto" className="leading-relaxed">
                    {part.say}
                  </p>
                  {part.show && (
                    <p className="mt-1 text-sm text-ink-soft">
                      <span className="font-semibold">{t.scriptShow}:</span> <bdi>{part.show}</bdi>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="label mb-2">{t.finishedVideo}</p>
          {videoReady ? (
            <div className="space-y-3">
              <video
                key={src}
                src={src}
                controls
                playsInline
                className={`w-full rounded-lg bg-black ${wide ? "aspect-video" : "mx-auto max-h-[560px] w-auto"}`}
                data-finished-video
              />
              {THUMBNAIL_PLATFORMS.includes(platform) && (
                // The studio's own thumbnail for this version.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${src}&thumbnail=1`} alt={t.downloadThumbnail} className={`rounded-lg ${wide ? "w-full" : "h-48"}`} />
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-canvas p-4 text-sm text-ink-soft">{dirty ? t.videoNeedsSave : t.noVideoYet}</p>
          )}
          <div className="mt-3 rounded-lg border border-[#d9d4cc] bg-white p-3 text-sm text-[#1e1e1e]">
            {content.title && <p className="font-semibold">{content.title}</p>}
            <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{content.body}</p>
          </div>
        </div>

        {canEdit && (
          <div className="min-w-0 space-y-3">
            <p className="label">{t.editLabel}</p>
            <label className="block">
              <span className="label mb-1 flex justify-between gap-2">
                <span>{hasTitle ? t.videoTitle : t.videoCoverText}</span>
                <span dir="ltr" className={(content.title?.length ?? 0) > VIDEO_TITLE_LIMIT ? "font-bold text-danger" : ""}>
                  {content.title?.length ?? 0} / {VIDEO_TITLE_LIMIT}
                </span>
              </span>
              <input form={formId} name="videoTitle" value={content.title ?? ""} onChange={(event) => update({ title: event.target.value })} dir="auto" className="field" />
            </label>
            <label className="block">
              <span className="label mb-1 flex justify-between gap-2">
                <span>{hasTitle ? t.videoDescription : platform === "reel" ? t.caption : t.postBody}</span>
                <span dir="ltr" className={content.body.length > BODY_LIMITS[platform] ? "font-bold text-danger" : ""}>
                  {content.body.length} / {BODY_LIMITS[platform]}
                </span>
              </span>
              <textarea form={formId} name="body" rows={hasTitle ? 10 : 7} value={content.body} onChange={(event) => update({ body: event.target.value })} dir="auto" className="field" />
            </label>
            {hasTitle ? (
              <label className="block">
                <span className="label mb-1 block">{t.videoTags}</span>
                <input
                  form={formId}
                  name="videoTags"
                  value={(content.tags ?? []).join(", ")}
                  onChange={(event) => update({ tags: event.target.value.split(/[,،]/).map((tag) => tag.trimStart()) })}
                  dir="auto" className="field"
                />
              </label>
            ) : (
              <input type="hidden" form={formId} name="videoTags" value="" />
            )}
            <ScriptEditor formId={formId} script={content.script ?? []} onChange={(script) => update({ script })} t={t} />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-5 space-y-4">
          <ClipSection piece={piece} video={video} dirty={dirty} hidden={hidden} language={language} t={t} />

          {clip?.status === "ready" && (
            <PlanSection
              piece={piece}
              platform={platform}
              plan={content.edit}
              phrases={phrases}
              duration={clip.duration ?? 0}
              clipId={clip.id}
              sourceRef={sourceRef}
              formId={formId}
              thumbnailAt={content.thumbnailAt}
              chapters={chapters}
              onPlan={(edit) => update({ edit })}
              onThumbnail={(thumbnailAt) => update({ thumbnailAt })}
              dirty={dirty}
              hidden={hidden}
              language={language}
              t={t}
            />
          )}

          <ActionForm action={savePieceAction} id={formId} className="flex flex-wrap items-center gap-3">
            {hidden}
            {content.edit && <input type="hidden" name="edit" value={JSON.stringify(content.edit)} />}
            {content.thumbnailAt !== undefined && <input type="hidden" name="thumbnailAt" value={content.thumbnailAt} />}
            <SubmitButton pendingLabel={t.saving} disabled={!dirty}>
              {t.saveEdits}
            </SubmitButton>
            {dirty && (
              <span role="status" className="text-sm font-medium text-amber-deep">
                {t.unsaved}
              </span>
            )}
          </ActionForm>

          {placeholder && !dirty && <Notice>{t.placeholderWarning}</Notice>}
          {problem && <Notice>{problem}</Notice>}

          {content.edit && clip?.status === "ready" && (
            <MakeVideo video={video} dirty={dirty} hidden={hidden} language={language} t={t} />
          )}

          <VideoManualPost
            platform={platform}
            src={src}
            content={content}
            chapters={chapters}
            hidden={hidden}
            blocked={dirty || placeholder || problem !== null || !videoReady}
            videoReady={videoReady}
            language={language}
            t={t}
          />

          <PieceTools piece={piece} hidden={hidden} dirty={dirty} t={t} />
        </div>
      )}
    </article>
  );
}

function ScriptEditor({ formId, script, onChange, t }: { formId: string; script: ScriptPart[]; onChange: (script: ScriptPart[]) => void; t: Strings }) {
  const change = (index: number, fields: Partial<ScriptPart>) =>
    onChange(script.map((part, at) => (at === index ? { ...part, ...fields } : part)));
  return (
    <fieldset className="space-y-3">
      <legend className="label">{t.scriptTitle}</legend>
      <p className="text-sm text-ink-soft">{t.scriptIntro}</p>
      {script.map((part, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-mist p-3" data-script-part={index + 1}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{index + 1}</span>
            <button type="button" className="btn btn-quiet !min-h-8 !px-2 text-xs" onClick={() => onChange(script.filter((_, at) => at !== index))}>
              {t.removeSlide}
            </button>
          </div>
          <label className="block">
            <span className="label mb-1 block">{t.scriptSay}</span>
            <textarea form={formId} name="scriptSay" rows={3} value={part.say} onChange={(event) => change(index, { say: event.target.value })} dir="auto" className="field" />
          </label>
          <label className="block">
            <span className="label mb-1 block">{t.scriptShow}</span>
            <input form={formId} name="scriptShow" value={part.show} onChange={(event) => change(index, { show: event.target.value })} dir="auto" className="field" />
          </label>
        </div>
      ))}
      <button type="button" className="btn btn-quiet" onClick={() => onChange([...script, { say: "", show: "" }])}>
        {t.addScriptPart}
      </button>
    </fieldset>
  );
}

/** Uploading a clip, or reusing one, and how reading it is going. */
function ClipSection({
  piece,
  video,
  dirty,
  hidden,
  language,
  t,
}: {
  piece: EditorPiece;
  video: EditorVideo;
  dirty: boolean;
  hidden: React.ReactNode;
  language: Language;
  t: Strings;
}) {
  const router = useRouter();
  const [upload, setUpload] = useState<{ progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { clip } = video;

  function send(file: File) {
    setError(null);
    setUpload({ progress: 0 });
    const request = new XMLHttpRequest();
    request.open("POST", `/api/footage?pieceId=${piece.id}&version=${piece.version}`);
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => event.lengthComputable && setUpload({ progress: event.loaded / event.total });
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
    clip?.status === "processing" && !clip.stopped
      ? {
          reading: t.clipReading,
          audio: t.clipAudio,
          model: t.clipModel.replace("{percent}", percent(clip.progress, language)),
          transcribing: t.clipTranscribing.replace("{percent}", percent(clip.progress, language)),
        }[clip.stage ?? "reading"] ?? t.clipReading
      : null;

  return (
    <section className="space-y-3 rounded-lg border border-mist p-4" aria-label={t.clipTitle} data-clip>
      <h3 className="font-display text-lg font-semibold">{t.clipTitle}</h3>
      {!clip && <p className="text-sm text-ink-soft">{t.clipIntro}</p>}
      {clip && (
        <p className="text-sm">
          <bdi className="font-medium">{clip.originalName}</bdi>
          {clip.duration ? <span className="text-ink-soft" dir="ltr"> · {formatTime(clip.duration)}</span> : null}
        </p>
      )}
      {stage && (
        <p role="status" className="pending-pulse text-sm font-medium text-cobalt">
          {stage}
        </p>
      )}
      {clip && (clip.status === "failed" || clip.stopped) && (
        <div role="alert" className="space-y-2 rounded-lg border-s-4 border-danger bg-canvas p-3 text-sm">
          <p className="font-semibold text-danger">{clip.stopped ? t.clipStopped : t.clipFailed}</p>
          {clip.error && !clip.stopped && <p>{clip.error}</p>}
          <ActionForm action={retryFootageAction}>
            <input type="hidden" name="footageId" value={clip.id} />
            <SubmitButton pendingLabel={t.tryingAgain}>{t.tryAgain}</SubmitButton>
          </ActionForm>
        </div>
      )}

      {upload ? (
        <div role="status" className="space-y-1 text-sm font-medium">
          <p>{t.uploadingClip.replace("{percent}", percent(upload.progress, language))}</p>
          <div className="h-2 overflow-hidden rounded bg-mist">
            <div className="h-full bg-navy" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <label className={`btn btn-quiet w-fit ${dirty ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {clip ? t.replaceClip : t.chooseClip}
          <input
            type="file"
            accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
            className="sr-only"
            disabled={dirty}
            name="clip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) send(file);
            }}
          />
        </label>
      )}
      {dirty && <p className="text-sm text-ink-soft">{t.clipNeedsSave}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {video.otherClips.length > 0 && !upload && (
        <div className="space-y-2 text-sm">
          <p className="text-ink-soft">{t.useOtherClip}</p>
          {video.otherClips.map((other) => (
            <ActionForm key={other.id} action={useFootageAction} className="flex flex-wrap items-center gap-2">
              {hidden}
              <input type="hidden" name="footageId" value={other.id} />
              <bdi>{other.originalName}</bdi>
              {other.duration ? <span dir="ltr" className="text-ink-soft">{formatTime(other.duration)}</span> : null}
              <SubmitButton pendingLabel={t.usingClip} disabled={dirty}>
                {t.useClip}
              </SubmitButton>
            </ActionForm>
          ))}
        </div>
      )}
    </section>
  );
}

/** The edit plan: what's cut, zoomed and labelled, phrase by phrase, with the original clip to check against. */
function PlanSection({
  piece,
  platform,
  plan,
  phrases,
  duration,
  clipId,
  sourceRef,
  formId,
  thumbnailAt,
  chapters,
  onPlan,
  onThumbnail,
  dirty,
  hidden,
  language,
  t,
}: {
  piece: EditorPiece;
  platform: VideoPlatform;
  plan: EditPlan | undefined;
  phrases: Phrase[];
  duration: number;
  clipId: string;
  sourceRef: React.RefObject<HTMLVideoElement | null>;
  formId: string;
  thumbnailAt: number | undefined;
  chapters: string[];
  onPlan: (plan: EditPlan) => void;
  onThumbnail: (seconds: number) => void;
  dirty: boolean;
  hidden: React.ReactNode;
  language: Language;
  t: Strings;
}) {
  const aiFormId = `plan-ai-${clipId}`;
  const planButtons = (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.planRequest}</span>
        <textarea form={aiFormId} name="request" rows={2} maxLength={2000} placeholder={t.planRequestHint} dir="auto" className="field" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={planEditAction} id={aiFormId}>
          {hidden}
          <input type="hidden" name="mode" value="ai" />
          <SubmitButton pendingLabel={t.planningAi} className={plan ? "btn-quiet" : "btn-primary"} disabled={dirty}>
            {plan ? t.planAgain : t.planWithAi}
          </SubmitButton>
        </ActionForm>
        {!plan && (
          <ActionForm action={planEditAction}>
            {hidden}
            <input type="hidden" name="mode" value="simple" />
            <SubmitButton pendingLabel={t.planningSimple} disabled={dirty}>
              {t.planSimple}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );

  if (!plan) {
    return (
      <section className="space-y-3 rounded-lg border border-mist p-4" aria-label={t.planTitle}>
        <h3 className="font-display text-lg font-semibold">{t.planTitle}</h3>
        <p className="text-sm text-ink-soft">{t.planIntro}</p>
        {planButtons}
        <p className="text-sm text-ink-soft">{t.planCost}</p>
      </section>
    );
  }

  const set = (fields: Partial<EditPlan>) => onPlan({ ...plan, ...fields });
  const cut = new Set(plan.cut);
  const zooms = new Set(plan.zooms);
  const ranges = keepRanges(phrases, plan, duration);
  const total = outputDuration(ranges);
  const limit = VIDEO_FORMATS[platform].maxSeconds;
  const toggle = (list: number[], index: number, on: boolean) => (on ? [...list, index] : list.filter((item) => item !== index));
  const upsert = <T extends { phrase: number }>(list: T[], index: number, item: T | null) =>
    [...list.filter((entry) => entry.phrase !== index), ...(item ? [item] : [])].sort((a, b) => a.phrase - b.phrase);
  const seek = (time: number) => {
    const player = sourceRef.current;
    if (!player) return;
    player.currentTime = time;
    void player.play().catch(() => {});
  };

  return (
    <section className="space-y-4 rounded-lg border border-mist p-4" aria-label={t.planTitle} data-plan>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{t.planTitle}</h3>
        <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${plan.level === "full" ? "bg-amber text-canvas" : "bg-mist"}`} data-level={plan.level}>
          {plan.level === "full" ? t.levelFull : t.levelLight}
        </span>
      </div>
      {plan.reason && <p className="text-sm">{plan.reason}</p>}
      {planButtons}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={plan.captions} onChange={(event) => set({ captions: event.target.checked })} className="size-4 accent-cobalt" />
          {t.planCaptions}
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={plan.tightenPauses} onChange={(event) => set({ tightenPauses: event.target.checked })} className="size-4 accent-cobalt" />
          {t.planTighten}
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={plan.endCard} onChange={(event) => set({ endCard: event.target.checked })} className="size-4 accent-cobalt" />
          {t.planEndCard}
        </label>
        <select
          value={plan.framing}
          onChange={(event) => set({ framing: event.target.value === "fit" ? "fit" : "fill" })}
          dir="auto" className="field !py-1.5 text-sm"
          aria-label={t.framingFill}
        >
          <option value="fill">{t.framingFill}</option>
          <option value="fit">{t.framingFit}</option>
        </select>
      </div>
      <label className="block">
        <span className="label mb-1 block">{t.planTitleCard}</span>
        <input value={plan.titleCard} maxLength={80} onChange={(event) => set({ titleCard: event.target.value })} dir="auto" className="field" />
      </label>
      <label className="block">
        <span className="label mb-1 block">{t.planHighlights}</span>
        <input
          value={plan.highlights.join(", ")}
          onChange={(event) => set({ highlights: event.target.value.split(/[,،]/).map((word) => word.trimStart()) })}
          dir="auto" className="field"
        />
      </label>
      {THUMBNAIL_PLATFORMS.includes(platform) && (
        <label className="block max-w-56">
          <span className="label mb-1 block">{t.thumbnailAt}</span>
          <input
            type="number"
            min={0}
            max={Math.floor(total)}
            step={0.5}
            dir="ltr"
            value={thumbnailAt ?? ""}
            placeholder={String(Math.min(2, Math.round(total / 3)))}
            onChange={(event) => event.target.value !== "" && onThumbnail(Number(event.target.value))}
            className="field"
          />
        </label>
      )}

      <p role="status" className={`text-sm font-semibold ${total > limit ? "text-danger" : ""}`} data-length>
        {t.finishedLength.replace("{time}", formatTime(total)).replace("{limit}", formatTime(limit))}
        {total > limit && <span className="block">{t.tooLong}</span>}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <p className="label mb-1">{t.originalClip}</p>
          <video ref={sourceRef} src={`/api/footage/${clipId}`} controls playsInline preload="metadata" className="max-h-96 w-full rounded-lg bg-black" />
        </div>
        <div>
          <p className="label">{t.phrasesTitle}</p>
          <p className="mb-2 text-sm text-ink-soft">{t.phrasesHint}</p>
          <ol className="max-h-[640px] space-y-2 overflow-y-auto pe-1">
            {phrases.map((phrase, index) => {
              const kept = !cut.has(index);
              const fix = plan.fixes.find((item) => item.phrase === index);
              const callout = plan.callouts.find((item) => item.phrase === index);
              const chapter = plan.chapters.find((item) => item.phrase === index);
              return (
                <li key={index} className={`space-y-2 rounded-lg border p-2 ${kept ? "border-mist" : "border-dashed border-mist bg-canvas opacity-60"}`} data-phrase={index}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={kept}
                        onChange={(event) => set({ cut: toggle(plan.cut, index, !event.target.checked) })}
                        className="size-4 accent-cobalt"
                      />
                      {t.keepPhrase}
                    </label>
                    <button type="button" onClick={() => seek(phrase.start)} className="rounded bg-mist px-1.5 font-[family-name:var(--font-jetbrains)] text-xs" dir="ltr">
                      {formatTime(phrase.start)}
                    </button>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={zooms.has(index)}
                        disabled={!kept}
                        onChange={(event) => set({ zooms: toggle(plan.zooms, index, event.target.checked) })}
                        className="size-4 accent-cobalt"
                      />
                      {t.zoomPhrase}
                    </label>
                  </div>
                  <input
                    aria-label={`${t.phrasesTitle} ${index + 1}`}
                    value={fix?.text ?? phrase.text}
                    disabled={!kept}
                    onChange={(event) =>
                      set({
                        fixes: upsert(plan.fixes, index, event.target.value === phrase.text ? null : { phrase: index, text: event.target.value }),
                      })
                    }
                    dir="auto" className="field !py-1.5 text-sm"
                    data-caption
                  />
                  {kept && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        placeholder={t.calloutPhrase}
                        aria-label={t.calloutPhrase}
                        value={callout?.text ?? ""}
                        maxLength={40}
                        onChange={(event) =>
                          set({ callouts: upsert(plan.callouts, index, event.target.value ? { phrase: index, text: event.target.value } : null) })
                        }
                        dir="auto" className="field !py-1.5 text-sm"
                      />
                      {platform === "youtube" && (
                        <input
                          placeholder={t.chapterPhrase}
                          aria-label={t.chapterPhrase}
                          value={chapter?.title ?? ""}
                          maxLength={80}
                          onChange={(event) =>
                            set({ chapters: upsert(plan.chapters, index, event.target.value ? { phrase: index, title: event.target.value } : null) })
                          }
                          dir="auto" className="field !py-1.5 text-sm"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {platform === "youtube" && (
        <div className="text-sm">
          <p className="label">{t.chaptersPreview}</p>
          {chapters.length > 0 ? (
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-canvas p-3 font-[family-name:var(--font-jetbrains)] text-xs">{chapters.join("\n")}</pre>
          ) : (
            <p className="text-ink-soft">{t.chaptersNone}</p>
          )}
        </div>
      )}
    </section>
  );
}

function MakeVideo({ video, dirty, hidden, language, t }: { video: EditorVideo; dirty: boolean; hidden: React.ReactNode; language: Language; t: Strings }) {
  const { render, problem } = video;
  if (dirty) return <p className="text-sm font-medium text-amber-deep">{t.videoNeedsSave}</p>;
  if (problem) return <Notice>{problem}</Notice>;
  if (render?.status === "working" && !render.stopped) {
    return (
      <div role="status" className="space-y-1 text-sm font-medium" data-rendering>
        <p className="pending-pulse">{t.makingVideo.replace("{percent}", percent(render.progress, language))}</p>
        <div className="h-2 overflow-hidden rounded bg-mist">
          <div className="h-full bg-navy transition-[width]" style={{ width: `${Math.round((render.progress ?? 0) * 100)}%` }} />
        </div>
      </div>
    );
  }
  if (render?.status === "ready") return null;
  return (
    <div className="space-y-2">
      {render && (
        <div role="alert" className="rounded-lg border-s-4 border-danger bg-canvas p-3 text-sm">
          <p className="font-semibold text-danger">{render.stopped ? t.renderStopped : t.renderFailed}</p>
          {render.error && !render.stopped && <p className="mt-1">{render.error}</p>}
        </div>
      )}
      <ActionForm action={makeVideoAction}>
        {hidden}
        <SubmitButton pendingLabel={t.startingVideo} className="btn-primary">
          {render ? t.makeVideoAgain : t.makeVideo}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

const NETWORKS: Record<VideoPlatform, string> = { reel: "Instagram", short: "YouTube", youtube: "YouTube", linkedin_video: "LinkedIn" };

function CopyButton({ text, label, t }: { text: string; label: string; t: Strings }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? t.manualCopiedShort : state === "failed" ? t.manualCopyFailed : label}
    </button>
  );
}

/** Posting a video by hand: download it, upload it on the network, then record it so it can't be posted twice. */
function VideoManualPost({
  platform,
  src,
  content,
  chapters,
  hidden,
  blocked,
  videoReady,
  language,
  t,
}: {
  platform: VideoPlatform;
  src: string;
  content: PieceContent;
  chapters: string[];
  hidden: React.ReactNode;
  blocked: boolean;
  videoReady: boolean;
  language: Language;
  t: Strings;
}) {
  const manual = MANUAL_POSTING[platform]!;
  // The network, not the format: you post a Reel on Instagram.
  const network = NETWORKS[platform];
  const say = (template: string) => template.replace("{platform}", network);
  return (
    <section className="space-y-3 rounded-lg border-s-4 border-cobalt bg-canvas p-4 text-sm" aria-label={say(t.manualTitle)}>
      <p className="font-semibold">{say(t.manualTitle)}</p>
      <p className="text-ink-soft">{say(t.manualIntroVideo)}</p>
      {!videoReady && <p className="font-medium">{t.makeVideoFirst}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {videoReady && (
          <a href={`${src}&download=1`} download className="btn btn-primary">
            {t.downloadVideo}
          </a>
        )}
        {videoReady && THUMBNAIL_PLATFORMS.includes(platform) && (
          <a href={`${src}&thumbnail=1&download=1`} download className="btn btn-quiet">
            {t.downloadThumbnail}
          </a>
        )}
        {content.title && (platform === "youtube" || platform === "short") && <CopyButton text={content.title} label={t.copyTitle} t={t} />}
        <CopyButton text={content.body} label={t.manualCopy} t={t} />
        {chapters.length > 0 && <CopyButton text={chapters.join("\n")} label={t.copyChapters} t={t} />}
        {(content.tags ?? []).filter(Boolean).length > 0 && (
          <CopyButton text={(content.tags ?? []).filter(Boolean).join(", ")} label={t.copyTags} t={t} />
        )}
        <a href={manual.composeUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet">
          {say(t.manualOpen)}
        </a>
      </div>
      <ActionForm action={markPostedByHandAction} className="space-y-2">
        {hidden}
        <label className="block">
          <span className="label mb-1 block">{t.manualLink}</span>
          <input name="postUrl" type="url" dir="ltr" className="field" placeholder={`https://www.${manual.hosts[0]}/…`} />
        </label>
        <p className="text-ink-soft">{t.manualLinkHintVideo}</p>
        <SubmitButton pendingLabel={t.marking} className="btn-primary" disabled={blocked}>
          {t.manualDone}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}
