"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  findMomentsAction,
  makeHighlightsAction,
  makeShortAction,
  makeVideoAction,
  markPostedByHandAction,
  planEditAction,
  retryFootageAction,
  savePieceAction,
  useFootageAction,
  useWholeClipAction,
} from "@/app/actions";
import type { EditPlan, Explainer, ExplainerStyle, IdeaSource, Moment, PieceContent, Phrase, ScriptPart } from "@/lib/db/schema";
import type { RecentPost } from "@/lib/quality";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type Language as ContentLanguage, type UiLanguage as Language } from "@/lib/language";
import { BODY_LIMITS, contentProblem, MANUAL_POSTING, platformLabel, postedText, VIDEO_FORMATS, VIDEO_TITLE_LIMIT, type VideoPlatform } from "@/lib/platforms";
import { hasPlaceholder } from "@/lib/scenario";
import {
  chapterLines,
  EXPLAINER_KINDS,
  EXPLAINER_STYLES,
  formatTime,
  HIGHLIGHT_SECONDS,
  keepRanges,
  MOMENTS_MIN_CLIP,
  outputDuration,
  partsSeconds,
  SHORT_PLATFORMS,
  windowSeconds,
  type Silence,
} from "@/lib/video/edit";
import { hasItems } from "@/lib/video/animation";
import { THUMBNAIL_PLATFORMS } from "@/lib/video/overlays";
import { ActionForm, SubmitButton } from "./action-form";
import { Notice, PieceTools, PublishStatus, type EditorPiece } from "./piece-editor";
import { ReadyCheckPanel, SourcesBox } from "./ready-check";

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
    /** The pauses heard in the audio, so the length shown matches the finished video. */
    silences: Silence[];
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

type StepState = "done" | "active" | "open" | "locked";

/** One numbered step of making a video. A locked step only says what has to happen first. */
function Step({
  number,
  title,
  hint,
  state,
  language,
  t,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  state: StepState;
  language: Language;
  t: Strings;
  children?: React.ReactNode;
}) {
  const frame = {
    done: "border-mist",
    active: "border-cobalt/70 bg-deep/40",
    open: "border-mist",
    locked: "border-mist opacity-60",
  }[state];
  const badge = {
    done: "bg-cobalt text-canvas",
    active: "border-2 border-cobalt text-cobalt",
    open: "border border-steel text-fog",
    locked: "border border-steel text-fog",
  }[state];
  return (
    <section aria-label={title} data-step={number} data-state={state} className={`rounded-xl border p-4 md:p-5 ${frame}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${badge}`}>
          {state === "done" ? "✓" : number.toLocaleString(uiLocale(language))}
        </span>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <h3 className="font-display text-lg font-semibold">
              {title}
              {state === "done" && <span className="sr-only"> · {t.videoSteps.done}</span>}
            </h3>
            {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
          </div>
          {state !== "locked" && children}
        </div>
      </div>
    </section>
  );
}

/** An on/off option that reads as a switch. */
function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        checked ? "border-cobalt bg-cobalt/15 text-ink" : "border-mist text-ink-soft"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-cobalt" />
      {children}
    </label>
  );
}

/** Remount with key={version} so the fields always match the current version. */
export function VideoEditor({
  piece,
  video,
  sources = [],
  recent = [],
  taken = {},
  language,
  contentLanguage,
  t,
}: {
  piece: EditorPiece;
  video: EditorVideo;
  sources?: IdeaSource[];
  recent?: RecentPost[];
  /** This idea's videos, by network: true when that one is already posted, so a moment can't replace it. */
  taken?: Partial<Record<VideoPlatform, boolean>>;
  language: Language;
  contentLanguage: ContentLanguage;
  t: Strings;
}) {
  const platform = piece.platform as VideoPlatform;
  const s = t.videoSteps;
  const formId = useId();
  const [content, setContent] = useState(piece.content);
  const [dirty, setDirty] = useState(false);
  const update = (fields: Partial<PieceContent>) => {
    setContent((current) => ({ ...current, ...fields }));
    setDirty(true);
  };
  const sourceRef = useRef<HTMLVideoElement>(null);

  const { clip, render } = video;
  const clipReady = clip?.status === "ready";
  const phrases = clipReady ? (clip.phrases ?? []) : [];
  const silences = clipReady ? clip.silences : [];
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
    platform === "youtube" && content.edit && clip?.duration ? chapterLines(phrases, content.edit, clip.duration, silences) : [];
  const limit = VIDEO_FORMATS[platform].maxSeconds;
  const partOfClip = Boolean(content.window || content.parts?.length);
  const longClip = clipReady && (clip.duration ?? 0) >= MOMENTS_MIN_CLIP && !partOfClip;

  const finished = videoReady ? (
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
  ) : null;

  const header = (
    <>
      <h2 className="font-display text-2xl font-semibold">
        {platformLabel(platform, language)}{" "}
        <span className="label">
          · {t.version} {piece.version}
        </span>
      </h2>
      <PublishStatus piece={piece} language={language} t={t} />
    </>
  );

  // Posted, scheduled or on its way: the finished video and its text, nothing to change.
  if (!canEdit) {
    return (
      <article className="rounded-xl bg-paper p-5 md:p-6" data-platform={platform}>
        {header}
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="min-w-0">{finished ?? <p className="rounded-lg bg-canvas p-4 text-sm text-ink-soft">{t.noVideoYet}</p>}</div>
          <PostPreview content={content} />
        </div>
      </article>
    );
  }

  const done = { film: clipReady, edit: clipReady && Boolean(piece.content.edit), make: Boolean(videoReady) };
  const active = !done.film ? 1 : !done.edit ? 2 : !done.make ? 3 : 4;
  const stateOf = (number: number, isDone: boolean): StepState =>
    isDone ? "done" : number === active ? "active" : number > active && number < 4 ? "locked" : "open";

  return (
    <article className="space-y-4 rounded-xl bg-paper p-5 md:p-6" data-platform={platform}>
      <div>{header}</div>

      {/* 1. Film from the script, then upload. */}
      <Step number={1} title={s.filmTitle} hint={clip ? undefined : s.filmHint} state={stateOf(1, done.film)} language={language} t={t}>
        {content.script && content.script.length > 0 && (
          <details open={!clip} className="rounded-lg bg-canvas p-3" data-script-preview>
            <summary className="cursor-pointer text-sm font-semibold">{s.script}</summary>
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
          </details>
        )}
        <ClipSection piece={piece} video={video} dirty={dirty} hidden={hidden} language={language} t={t} />
        <details>
          <summary className="cursor-pointer text-sm font-medium text-cobalt">{s.changeScript}</summary>
          <div className="mt-3">
            <ScriptEditor formId={formId} script={content.script ?? []} onChange={(script) => update({ script })} t={t} />
          </div>
        </details>
      </Step>

      {/* 2. The edit: one button, a few switches, and the fine detail out of the way. */}
      <Step
        number={2}
        title={s.editTitle}
        hint={clipReady ? s.editHint.replace("{limit}", formatTime(limit)) : s.editLocked}
        state={stateOf(2, done.edit)}
        language={language}
        t={t}
      >
        {partOfClip && ((content.window && phrases[content.window.to]) || content.parts?.every((part) => phrases[part.to])) && (
          <div className="space-y-2 rounded-lg border-s-4 border-cobalt bg-canvas p-3 text-sm" data-window>
            <p>
              {content.window
                ? t.moments.window
                    .replace("{from}", formatTime(phrases[content.window.from].start))
                    .replace("{to}", formatTime(phrases[content.window.to].end))
                    .replace("{duration}", formatTime(windowSeconds(content.window, phrases)))
                : t.moments.parts
                    .replace("{count}", (content.parts ?? []).length.toLocaleString(uiLocale(language)))
                    .replace("{duration}", formatTime(partsSeconds(content.parts ?? [], phrases)))}
            </p>
            <ActionForm action={useWholeClipAction}>
              {hidden}
              <SubmitButton pendingLabel={t.moments.usingWholeClip} disabled={dirty}>
                {t.moments.wholeClip}
              </SubmitButton>
            </ActionForm>
          </div>
        )}

        {longClip && SHORT_PLATFORMS.includes(platform) && (
          <KeepBest platform={platform} duration={clip.duration ?? 0} dirty={dirty} hidden={hidden} language={language} t={t} />
        )}

        {clipReady && (
          <EditSection
            platform={platform}
            plan={content.edit}
            phrases={phrases}
            silences={silences}
            duration={clip.duration ?? 0}
            clipId={clip.id}
            onPlan={(edit) => update({ edit })}
            dirty={dirty}
            hidden={hidden}
            language={language}
            t={t}
          />
        )}

        {clipReady && content.edit && (
          <details className="rounded-lg border border-mist p-3" data-plan>
            <summary className="cursor-pointer text-sm font-semibold">{s.fineTune}</summary>
            <div className="mt-4">
              <FineTune
                platform={platform}
                plan={content.edit}
                phrases={phrases}
                silences={silences}
                duration={clip.duration ?? 0}
                clipId={clip.id}
                sourceRef={sourceRef}
                thumbnailAt={content.thumbnailAt}
                chapters={chapters}
                onPlan={(edit) => update({ edit })}
                onThumbnail={(thumbnailAt) => update({ thumbnailAt })}
                t={t}
              />
            </div>
          </details>
        )}

        {longClip && (
          <details className="rounded-lg border border-mist p-3">
            <summary className="cursor-pointer text-sm font-semibold">{s.otherNetworks}</summary>
            <div className="mt-4">
              <MomentsSection
                platform={platform}
                moments={content.moments ?? []}
                phrases={phrases}
                taken={taken}
                dirty={dirty}
                hidden={hidden}
                language={language}
                t={t}
              />
            </div>
          </details>
        )}
      </Step>

      {/* 3. Make the finished video. */}
      <Step
        number={3}
        title={s.makeTitle}
        hint={done.edit ? (videoReady ? undefined : s.makeHint) : s.makeLocked}
        state={stateOf(3, done.make)}
        language={language}
        t={t}
      >
        {finished}
        {piece.content.edit && clipReady && <MakeVideo video={video} dirty={dirty} hidden={hidden} language={language} t={t} />}
      </Step>

      {/* 4. The words that go with it, and posting. */}
      <Step number={4} title={s.postTitle} state={stateOf(4, false)} language={language} t={t}>
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
        {sources.length > 0 && (
          <SourcesBox platform={platform} body={content.body} sources={sources} contentLanguage={contentLanguage} onChange={(body) => update({ body })} t={t} />
        )}
        {hasTitle ? (
          <label className="block">
            <span className="label mb-1 block">{t.videoTags}</span>
            <input
              form={formId}
              name="videoTags"
              value={(content.tags ?? []).join(", ")}
              onChange={(event) => update({ tags: event.target.value.split(/[,،]/).map((tag) => tag.trimStart()) })}
              dir="auto"
              className="field"
            />
          </label>
        ) : (
          <input type="hidden" form={formId} name="videoTags" value="" />
        )}

        {content.body.trim() && (
          <ReadyCheckPanel platform={platform} content={content} sources={sources} recent={recent} language={language} t={t} />
        )}
        {placeholder && !dirty && <Notice>{t.placeholderWarning}</Notice>}

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

        <details>
          <summary className="cursor-pointer text-sm font-medium text-cobalt">{s.more}</summary>
          <div className="mt-3 space-y-4">
            <PieceTools piece={piece} hidden={hidden} dirty={dirty} t={t} />
          </div>
        </details>
      </Step>

      {/* One save for everything above; it only shows while there's something to save. */}
      <ActionForm
        action={savePieceAction}
        id={formId}
        className={dirty ? "sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-cobalt bg-deep p-3 shadow-lg" : "hidden"}
      >
        {hidden}
        {content.edit && <input type="hidden" name="edit" value={JSON.stringify(content.edit)} />}
        {content.thumbnailAt !== undefined && <input type="hidden" name="thumbnailAt" value={content.thumbnailAt} />}
        <SubmitButton pendingLabel={t.saving} className="btn-primary" disabled={!dirty}>
          {t.saveEdits}
        </SubmitButton>
        <span role="status" className="text-sm font-medium text-amber-deep">
          {s.unsaved}
        </span>
      </ActionForm>
    </article>
  );
}

function PostPreview({ content }: { content: PieceContent }) {
  return (
    <div className="h-fit rounded-lg border border-[#d9d4cc] bg-white p-3 text-sm text-[#1e1e1e]">
      {content.title && <p className="font-semibold">{content.title}</p>}
      <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{content.body}</p>
    </div>
  );
}

function ScriptEditor({ formId, script, onChange, t }: { formId: string; script: ScriptPart[]; onChange: (script: ScriptPart[]) => void; t: Strings }) {
  const change = (index: number, fields: Partial<ScriptPart>) =>
    onChange(script.map((part, at) => (at === index ? { ...part, ...fields } : part)));
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{t.scriptTitle}</legend>
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

  const picker = (
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
  );

  return (
    <div className="space-y-3" aria-label={t.clipTitle} data-clip>
      {upload ? (
        <div role="status" className="space-y-1 text-sm font-medium">
          <p>{t.uploadingClip.replace("{percent}", percent(upload.progress, language))}</p>
          <div className="h-2 overflow-hidden rounded bg-mist">
            <div className="h-full bg-cobalt" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
        </div>
      ) : clip ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas p-3 text-sm">
          <p>
            <bdi className="font-medium">{clip.originalName}</bdi>
            {clip.duration ? <span className="text-ink-soft" dir="ltr"> · {formatTime(clip.duration)}</span> : null}
          </p>
          <label className={`text-sm font-medium text-cobalt ${dirty ? "pointer-events-none opacity-50" : "cursor-pointer hover:underline"}`}>
            {t.replaceClip}
            {picker}
          </label>
        </div>
      ) : (
        <label
          className={`flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-cobalt/60 p-6 text-center ${
            dirty ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-cobalt/10"
          }`}
        >
          <span className="btn btn-primary pointer-events-none">{t.chooseClip}</span>
          <span className="mt-2 text-sm text-ink-soft">{t.videoSteps.uploadHint}</span>
          {picker}
        </label>
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
      {dirty && <p className="text-sm text-ink-soft">{t.clipNeedsSave}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {video.otherClips.length > 0 && !upload && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-cobalt">{t.videoSteps.otherClips}</summary>
          <div className="mt-2 space-y-2">
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
        </details>
      )}
    </div>
  );
}

/** A long take for a short network: keep only its best parts, in this same post. */
function KeepBest({
  platform,
  duration,
  dirty,
  hidden,
  language,
  t,
}: {
  platform: VideoPlatform;
  duration: number;
  dirty: boolean;
  hidden: React.ReactNode;
  language: Language;
  t: Strings;
}) {
  const s = t.videoSteps;
  const max = Math.min(VIDEO_FORMATS[platform].maxSeconds, Math.floor(duration));
  return (
    <ActionForm action={makeHighlightsAction} className="space-y-3 rounded-lg bg-canvas p-3" data-highlights>
      {hidden}
      <input type="hidden" name="ui" value={language} />
      <input type="hidden" name="platform" value={platform} />
      <div>
        <p className="font-semibold">{s.long.replace("{length}", formatTime(duration))}</p>
        <p className="text-sm text-ink-soft">{s.longHint}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="label mb-1 block">{s.seconds}</span>
          <input
            name="seconds"
            type="number"
            min={HIGHLIGHT_SECONDS.min}
            max={max}
            step={5}
            defaultValue={Math.min(60, max)}
            dir="ltr"
            className="field w-28"
          />
        </label>
        <SubmitButton pendingLabel={s.keepingBest} disabled={dirty}>
          {s.keepBest}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The edit, simply: one button to plan it, then the few switches that matter. */
function EditSection({
  platform,
  plan,
  phrases,
  silences,
  duration,
  clipId,
  onPlan,
  dirty,
  hidden,
  language,
  t,
}: {
  platform: VideoPlatform;
  plan: EditPlan | undefined;
  phrases: Phrase[];
  silences: Silence[];
  duration: number;
  clipId: string;
  onPlan: (plan: EditPlan) => void;
  dirty: boolean;
  hidden: React.ReactNode;
  language: Language;
  t: Strings;
}) {
  const s = t.videoSteps;
  const aiFormId = `plan-ai-${clipId}`;
  const ask = (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-medium">{s.request}</span>
        <textarea form={aiFormId} name="request" rows={2} maxLength={2000} placeholder={s.requestHint} dir="auto" className="field" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input form={aiFormId} type="checkbox" name="explainers" defaultChecked={Boolean(plan?.explainers?.length)} className="size-4 accent-cobalt" />
        {s.explainers}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={planEditAction} id={aiFormId}>
          {hidden}
          <input type="hidden" name="mode" value="ai" />
          <SubmitButton pendingLabel={t.planningAi} className={plan ? "btn-quiet" : "btn-primary"} disabled={dirty}>
            {plan ? t.planAgain : s.editNow}
          </SubmitButton>
        </ActionForm>
        {!plan && (
          <ActionForm action={planEditAction}>
            {hidden}
            <input type="hidden" name="mode" value="simple" />
            <SubmitButton pendingLabel={t.planningSimple} disabled={dirty}>
              {s.captionsOnly}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );

  if (!plan) return ask;

  const set = (fields: Partial<EditPlan>) => onPlan({ ...plan, ...fields });
  const total = outputDuration(keepRanges(phrases, plan, duration, silences));
  const limit = VIDEO_FORMATS[platform].maxSeconds;
  const network = platformLabel(platform, language);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p role="status" className={`font-semibold ${total > limit ? "text-danger" : ""}`} data-length>
          {s.length.replace("{time}", formatTime(total))}{" "}
          <span className="font-normal text-ink-soft">{s.limit.replace("{platform}", network).replace("{limit}", formatTime(limit))}</span>
        </p>
        {total > limit && <p className="text-sm font-medium text-danger">{s.tooLong.replace("{platform}", network)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Toggle checked={plan.tightenPauses} onChange={(tightenPauses) => set({ tightenPauses })}>
          {s.silences}
        </Toggle>
        <Toggle checked={plan.captions} onChange={(captions) => set({ captions })}>
          {s.captions}
        </Toggle>
        <Toggle checked={plan.endCard} onChange={(endCard) => set({ endCard })}>
          {s.endCard}
        </Toggle>
      </div>
      <label className="block">
        <span className="label mb-1 block">{s.titleCard}</span>
        <input value={plan.titleCard} maxLength={80} onChange={(event) => set({ titleCard: event.target.value })} dir="auto" className="field" />
      </label>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-cobalt">{s.askAgain}</summary>
        <div className="mt-3">{ask}</div>
      </details>
    </div>
  );
}

/** Everything else about the edit, phrase by phrase, with the original clip to check against. */
function FineTune({
  platform,
  plan,
  phrases,
  silences,
  duration,
  clipId,
  sourceRef,
  thumbnailAt,
  chapters,
  onPlan,
  onThumbnail,
  t,
}: {
  platform: VideoPlatform;
  plan: EditPlan;
  phrases: Phrase[];
  silences: Silence[];
  duration: number;
  clipId: string;
  sourceRef: React.RefObject<HTMLVideoElement | null>;
  thumbnailAt: number | undefined;
  chapters: string[];
  onPlan: (plan: EditPlan) => void;
  onThumbnail: (seconds: number) => void;
  t: Strings;
}) {
  const set = (fields: Partial<EditPlan>) => onPlan({ ...plan, ...fields });
  const cut = new Set(plan.cut);
  const zooms = new Set(plan.zooms);
  const total = outputDuration(keepRanges(phrases, plan, duration, silences));
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
    <div className="space-y-4">
      {plan.reason && <p className="text-sm text-ink-soft">{plan.reason}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">{t.videoSteps.framing}</span>
          <select
            value={plan.framing}
            onChange={(event) => set({ framing: event.target.value === "fit" ? "fit" : "fill" })}
            dir="auto"
            className="field !py-1.5 text-sm"
          >
            <option value="fill">{t.framingFill}</option>
            <option value="fit">{t.framingFit}</option>
          </select>
        </label>
        {THUMBNAIL_PLATFORMS.includes(platform) && (
          <label className="block">
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
      </div>
      <label className="block">
        <span className="label mb-1 block">{t.planHighlights}</span>
        <input
          value={plan.highlights.join(", ")}
          onChange={(event) => set({ highlights: event.target.value.split(/[,،]/).map((word) => word.trimStart()) })}
          dir="auto"
          className="field"
        />
      </label>
      {(plan.explainers?.length ?? 0) > 0 && (
        <label className="block max-w-sm">
          <span className="label mb-1 block">{t.explainerLook}</span>
          <select
            value={plan.explainerStyle ?? "tech"}
            onChange={(event) => set({ explainerStyle: event.target.value as ExplainerStyle })}
            dir="auto"
            className="field !py-1.5 text-sm"
          >
            {EXPLAINER_STYLES.map((style) => (
              <option key={style} value={style}>
                {t.explainerStyles[style]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-soft">{t.explainersHint}</span>
        </label>
      )}

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
                    dir="auto"
                    className="field !py-1.5 text-sm"
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
                        dir="auto"
                        className="field !py-1.5 text-sm"
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
                          dir="auto"
                          className="field !py-1.5 text-sm"
                        />
                      )}
                    </div>
                  )}
                  {kept && (
                    <ExplainerControls
                      index={index}
                      phrases={phrases}
                      cut={cut}
                      explainers={plan.explainers ?? []}
                      onChange={(explainers) => set({ explainers })}
                      t={t}
                    />
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
    </div>
  );
}

/** The explainer starting at this phrase, if any: its mode, how far it runs and what it shows. */
function ExplainerControls({
  index,
  phrases,
  cut,
  explainers,
  onChange,
  t,
}: {
  index: number;
  phrases: Phrase[];
  cut: Set<number>;
  explainers: Explainer[];
  onChange: (explainers: Explainer[]) => void;
  t: Strings;
}) {
  const v = t.videoStudio;
  const own = explainers.find((item) => item.phrase === index);
  const covering = explainers.find((item) => item.phrase < index && item.until >= index);
  if (covering) {
    return <p className="text-xs font-semibold text-cobalt">{t.explainerInside.replace("{number}", String(covering.phrase + 1))}</p>;
  }
  const replace = (next: Explainer | null) =>
    onChange([...explainers.filter((item) => item.phrase !== index), ...(next ? [next] : [])].sort((a, b) => a.phrase - b.phrase));
  if (!own) {
    // A new explainer can only start where no other one is playing.
    return (
      <button
        type="button"
        className="text-xs font-semibold text-cobalt underline-offset-2 hover:underline"
        onClick={() =>
          replace({
            phrase: index,
            until: index,
            mode: "pip",
            scene: { kind: "statement", say: "", heading: phrases[index].text.split(/\s+/).slice(0, 8).join(" "), text: "", items: [] },
          })
        }
      >
        + {t.explainerAdd}
      </button>
    );
  }
  const scene = own.scene;
  const setScene = (fields: Partial<Explainer["scene"]>) => replace({ ...own, scene: { ...scene, ...fields } });
  const next = explainers.find((item) => item.phrase > index)?.phrase ?? phrases.length;
  const reach = Array.from({ length: next - index }, (_, offset) => index + offset).filter((number) => !cut.has(number) || number === index);
  const textLabel = (v.textFor as Partial<Record<string, string>>)[scene.kind];
  const headingLabel = (v.headingFor as Partial<Record<string, string>>)[scene.kind] ?? v.heading;
  return (
    <fieldset className="space-y-2 rounded-lg border border-cobalt/40 bg-canvas p-2" data-explainer={index}>
      <legend className="px-1 text-xs font-semibold text-cobalt">{t.explainerTitle}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          aria-label={t.explainerMode}
          value={own.mode}
          onChange={(event) => replace({ ...own, mode: event.target.value === "full" ? "full" : "pip" })}
          dir="auto" className="field !py-1.5 text-sm"
        >
          <option value="pip">{t.explainerModes.pip}</option>
          <option value="full">{t.explainerModes.full}</option>
        </select>
        <label className="flex items-center gap-1 text-xs">
          <span className="shrink-0">{t.explainerUntil}</span>
          <select value={own.until} onChange={(event) => replace({ ...own, until: Number(event.target.value) })} dir="ltr" className="field !py-1.5 text-sm">
            {reach.map((number) => (
              <option key={number} value={number}>
                {number + 1} · {formatTime(phrases[number].end)}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label={v.kind}
          value={scene.kind}
          onChange={(event) => setScene({ kind: event.target.value as Explainer["scene"]["kind"] })}
          dir="auto" className="field !py-1.5 text-sm"
        >
          {EXPLAINER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {v.kinds[kind]}
            </option>
          ))}
        </select>
      </div>
      <input aria-label={headingLabel} placeholder={headingLabel} value={scene.heading} maxLength={120} onChange={(event) => setScene({ heading: event.target.value })} dir="auto" className="field !py-1.5 text-sm" />
      {textLabel && (
        <input aria-label={textLabel} placeholder={textLabel} value={scene.text} maxLength={200} onChange={(event) => setScene({ text: event.target.value })} dir="auto" className="field !py-1.5 text-sm" />
      )}
      {hasItems(scene.kind) && (
        <textarea
          aria-label={scene.kind === "compare" ? v.itemsCompare : v.items}
          placeholder={scene.kind === "compare" ? v.itemsCompare : v.items}
          rows={3}
          value={scene.items.join("\n")}
          onChange={(event) => setScene({ items: event.target.value.split("\n").slice(0, own.mode === "pip" ? 3 : 5) })}
          dir="auto" className="field !py-1.5 text-sm"
        />
      )}
      <button type="button" className="text-xs text-danger underline-offset-2 hover:underline" onClick={() => replace(null)}>
        {t.explainerRemove}
      </button>
    </fieldset>
  );
}

/** The parts of a long clip that work alone, each one click from its own short video. */
function MomentsSection({
  platform,
  moments,
  phrases,
  taken,
  dirty,
  hidden,
  language,
  t,
}: {
  platform: VideoPlatform;
  moments: Moment[];
  phrases: Phrase[];
  taken: Partial<Record<VideoPlatform, boolean>>;
  dirty: boolean;
  hidden: React.ReactNode;
  language: Language;
  t: Strings;
}) {
  const m = t.moments;
  const targets = SHORT_PLATFORMS.filter((target) => target !== platform);
  return (
    <section aria-label={m.title} className="space-y-3" data-moments>
      <p className="text-sm text-ink-soft">{m.hint}</p>
      {moments.length > 0 && (
        <ol className="space-y-3">
          {moments.map((moment, index) => {
            const start = phrases[moment.from]?.start ?? 0;
            const end = phrases[moment.to]?.end ?? start;
            return (
              <li key={`${moment.from}-${moment.to}`} className="rounded-lg border border-mist p-3" data-moment={index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold" dir="auto">
                    {moment.title}
                  </p>
                  <span className="label" dir="ltr">
                    {formatTime(start)}–{formatTime(end)} · {formatTime(end - start)}
                  </span>
                </div>
                {moment.hook && (
                  <p className="mt-1 text-sm" dir="auto">
                    {moment.hook}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-soft">
                  {m.strength.replace("{score}", moment.score.toLocaleString(uiLocale(language)))}
                  {moment.why && (
                    <>
                      {" · "}
                      <bdi>{moment.why}</bdi>
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {targets.map((target) => (
                    <ActionForm key={target} action={makeShortAction}>
                      {hidden}
                      <input type="hidden" name="moment" value={index} />
                      <input type="hidden" name="platform" value={target} />
                      <input type="hidden" name="ui" value={language} />
                      <SubmitButton pendingLabel={m.making} className="btn-quiet text-sm" disabled={dirty || taken[target] === true}>
                        {m.make.replace("{platform}", platformLabel(target, language))}
                      </SubmitButton>
                      {taken[target] !== undefined && (
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          {taken[target] ? m.posted : m.replaces.replace("{platform}", platformLabel(target, language))}
                        </span>
                      )}
                    </ActionForm>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <ActionForm action={findMomentsAction}>
        {hidden}
        <SubmitButton pendingLabel={m.finding} className={moments.length ? "btn-quiet text-sm" : "btn-primary"} disabled={dirty}>
          {moments.length ? m.again : m.find}
        </SubmitButton>
      </ActionForm>
      <div className="border-t border-mist pt-3" data-highlights-other>
      <ActionForm action={makeHighlightsAction} className="space-y-2">
        {hidden}
        <input type="hidden" name="ui" value={language} />
        <h4 className="font-semibold">{m.highlightsTitle}</h4>
        <p className="text-sm text-ink-soft">{m.highlightsHint}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="label mb-1 block">{t.videoStudio.platformLabel}</span>
            <select name="platform" defaultValue={targets.find((target) => !taken[target]) ?? targets[0]} className="field">
              {targets.map((target) => (
                <option key={target} value={target} disabled={taken[target] === true}>
                  {platformLabel(target, language)}
                  {taken[target] ? ` (${m.posted})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="label mb-1 block">{m.highlightsLength}</span>
            <input name="seconds" type="number" min={HIGHLIGHT_SECONDS.min} max={180} step={5} defaultValue={HIGHLIGHT_SECONDS.default} dir="ltr" className="field w-28" />
          </label>
          <SubmitButton pendingLabel={m.highlightsMaking} disabled={dirty}>
            {m.highlightsMake}
          </SubmitButton>
        </div>
      </ActionForm>
      </div>
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
