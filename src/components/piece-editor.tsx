"use client";

import Link from "next/link";
import { useState } from "react";
import {
  changePieceAction,
  markPostedAction,
  markPostedByHandAction,
  removePhotoAction,
  uploadPhotoAction,
  publishPieceAction,
  cancelScheduleAction,
  schedulePostAction,
  restorePieceAction,
  rewritePieceAction,
  savePieceAction,
} from "@/app/actions";
import type { PublishState } from "@/lib/content";
import type { PieceContent, Slide } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type Language as ContentLanguage, type UiLanguage as Language } from "@/lib/language";
import {
  BODY_LIMITS,
  contentProblem,
  MANUAL_POSTING,
  platformLabel,
  SLIDE_LIMITS,
  uncheckedLinks,
  type Platform,
} from "@/lib/platforms";
import { hasPlaceholder } from "@/lib/scenario";
import { ActionForm, SubmitButton } from "./action-form";
import { PiecePreview, type PreviewBrand } from "./piece-preview";

export type EditorPiece = {
  id: string;
  platform: Platform;
  version: number;
  content: PieceContent;
  state: PublishState;
  postedVersion: number | null;
  postUrl: string | null;
  error: string | null;
  scenarioMoved: boolean;
  connected: boolean;
  otherPosted: boolean | null;
  history: { version: number; originLabel: string }[];
  /** A time this post is set to go out, or why a set time didn't work. Times are already formatted. */
  schedule: { status: "waiting" | "sending" | "missed" | "failed" | "cancelled"; version: number; value: string; label: string; error: string | null } | null;
};

export function name(template: string, platform: Platform, language: Language) {
  return template.replace("{platform}", platformLabel(platform, language));
}

/** Remount with key={version} so the fields always match the current version. */
export function PieceEditor({
  piece,
  sources,
  language,
  contentLanguage,
  brand,
  t,
}: {
  piece: EditorPiece;
  sources: { url: string }[];
  /** The interface language. */
  language: Language;
  /** The language the post is written in. */
  contentLanguage: ContentLanguage;
  brand: PreviewBrand;
  t: Strings;
}) {
  const { platform } = piece;
  const [content, setContent] = useState(piece.content);
  const [dirty, setDirty] = useState(false);
  const update = (fields: Partial<PieceContent>) => {
    setContent((current) => ({ ...current, ...fields }));
    setDirty(true);
  };

  const hidden = (
    <>
      <input type="hidden" name="pieceId" value={piece.id} />
      <input type="hidden" name="version" value={piece.version} />
    </>
  );
  const links = uncheckedLinks(content.body, sources, brand.websiteUrl);
  const placeholder = hasPlaceholder(content);
  const problem = contentProblem(platform, content);
  const overLimit = content.body.length > BODY_LIMITS[platform];
  const canEdit = piece.state === "draft" || piece.state === "failed";
  // Until the studio can post here itself, you copy the post, post it, and record it.
  const manual = !piece.connected && MANUAL_POSTING[platform] !== undefined;

  return (
    <article className="rounded-xl bg-paper p-5 md:p-6" data-platform={platform}>
      <h2 className="font-display text-2xl font-semibold">
        {platformLabel(platform, language)}{" "}
        <span className="label">
          · {t.version} {piece.version}
        </span>
      </h2>

      <PublishStatus piece={piece} language={language} t={t} />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="label mb-2">{t.previewLabel}</p>
          <PiecePreview platform={platform} content={content} language={contentLanguage} brand={brand} />
        </div>

        {canEdit && (
          <div className="min-w-0">
            <p className="label mb-2">{t.editLabel}</p>
            <ActionForm action={savePieceAction} className="space-y-3">
              {hidden}
              {platform === "website" && (
                <>
                  <Input label={t.postTitle} name="title" value={content.title ?? ""} onChange={(title) => update({ title })} />
                  <Input label={t.postExcerpt} name="excerpt" value={content.excerpt ?? ""} onChange={(excerpt) => update({ excerpt })} />
                  <Input label={t.postSlug} name="slug" dir="ltr" value={content.slug ?? ""} onChange={(slug) => update({ slug })} />
                  <Input
                    label={t.postTags}
                    name="tags"
                    value={(content.tags ?? []).join(", ")}
                    onChange={(tags) => update({ tags: tags.split(/[,،]/).map((tag) => tag.trimStart()) })}
                  />
                </>
              )}
              {platform === "instagram" && (
                <SlidesEditor slides={content.slides ?? []} onChange={(slides) => update({ slides })} t={t} />
              )}
              <label className="block">
                <span className="label mb-1 flex justify-between gap-2">
                  <span>{platform === "website" ? t.articleBody : platform === "instagram" ? t.caption : t.postBody}</span>
                  <span className={overLimit ? "font-bold text-danger" : ""} dir="ltr">
                    {content.body.length} / {BODY_LIMITS[platform]}
                  </span>
                </span>
                <textarea
                  name="body"
                  rows={platform === "website" ? 18 : 12}
                  value={content.body}
                  onChange={(event) => update({ body: event.target.value })}
                  className="field"
                />
              </label>
              <SubmitButton pendingLabel={t.saving} disabled={!dirty}>
                {t.saveEdits}
              </SubmitButton>
            </ActionForm>
            {platform === "instagram" && <CoverPhoto hidden={hidden} photo={content.photo} dirty={dirty} t={t} />}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-5 space-y-3">
          {overLimit && <Notice>{t.overLimit}</Notice>}
          {placeholder && !dirty && <Notice>{t.placeholderWarning}</Notice>}
          {links.length > 0 && (
            <Notice>
              {t.uncheckedLinksWarning}
              <ul className="mt-1 break-all" dir="ltr">
                {links.map((link) => (
                  <li key={link}>{link}</li>
                ))}
              </ul>
            </Notice>
          )}
          {dirty && (
            <p role="status" className="text-sm font-medium text-amber-deep">
              {t.unsaved}
            </p>
          )}
          {manual ? (
            <ManualPost
              platform={platform}
              pieceId={piece.id}
              version={piece.version}
              slideCount={content.slides?.length ?? 0}
              hidden={hidden}
              body={content.body}
              blocked={dirty || placeholder || problem !== null}
              language={language}
              t={t}
            />
          ) : (
            <>
              {!piece.connected && (
                <Notice>
                  {name(t.notConnected, platform, language)}{" "}
                  <Link href={`/${language}/connections`} className="font-semibold text-cobalt underline underline-offset-2">
                    {t.connectLink}
                  </Link>
                </Notice>
              )}

              <ActionForm action={publishPieceAction}>
                {hidden}
                <SubmitButton
                  pendingLabel={t.posting}
                  className="btn-primary"
                  disabled={dirty || !piece.connected || placeholder || problem !== null}
                >
                  {piece.state === "failed" ? t.postTryAgain : name(t.approvePost, platform, language)}
                </SubmitButton>
              </ActionForm>
              {piece.connected && (
                <ScheduleBox piece={piece} hidden={hidden} blocked={dirty || placeholder || problem !== null} t={t} />
              )}
            </>
          )}

          <PieceTools piece={piece} hidden={hidden} dirty={dirty} t={t} />
        </div>
      )}

      {piece.otherPosted !== null && (
        <p className="label mt-4">{piece.otherPosted ? t.otherPosted : t.otherNotPosted}</p>
      )}
    </article>
  );
}

/** Asking the AI for a change, rewriting from a changed scenario, and the version history. */
export function PieceTools({
  piece,
  hidden,
  dirty,
  t,
}: {
  piece: EditorPiece;
  hidden: React.ReactNode;
  dirty: boolean;
  t: Strings;
}) {
  return (
    <>
      <ActionForm action={changePieceAction} resetOnSuccess className="space-y-2">
        {hidden}
        <label className="block">
          <span className="label mb-1 block">{t.aiChange}</span>
          <textarea name="request" required rows={2} maxLength={2000} dir="auto" className="field" placeholder={t.aiChangePlaceholder} />
        </label>
        <SubmitButton pendingLabel={t.applyingChange} disabled={dirty}>
          {t.applyChange}
        </SubmitButton>
      </ActionForm>

      {piece.scenarioMoved && (
        <ActionForm action={rewritePieceAction} className="rounded-lg bg-mist p-3 text-sm">
          {hidden}
          <p className="mb-2">{t.scenarioMoved}</p>
          <SubmitButton pendingLabel={t.rewritingPiece} disabled={dirty}>
            {t.rewritePiece}
          </SubmitButton>
        </ActionForm>
      )}

      {piece.history.length > 1 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-cobalt">{t.history}</summary>
          <ul className="mt-1">
            {piece.history.map((entry) => (
              <li key={entry.version} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist py-2 text-sm">
                <span>
                  {t.version} {entry.version} · <span className="text-ink-soft">{entry.originLabel}</span>
                </span>
                {entry.version === piece.version ? (
                  <span className="label">{t.current}</span>
                ) : (
                  <ActionForm action={restorePieceAction}>
                    {hidden}
                    <input type="hidden" name="restoreVersion" value={entry.version} />
                    <SubmitButton pendingLabel={t.restoring} disabled={dirty}>
                      {t.restore}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Approving this version to go out at a set time, or what happened to an earlier set time. */
function ScheduleBox({ piece, hidden, blocked, t }: { piece: EditorPiece; hidden: React.ReactNode; blocked: boolean; t: Strings }) {
  const schedule = piece.schedule;
  const active = schedule && (schedule.status === "waiting" || schedule.status === "sending") && schedule.version === piece.version;
  const cancel = (label: string) => (
    <ActionForm action={cancelScheduleAction}>
      <input type="hidden" name="pieceId" value={piece.id} />
      <SubmitButton pendingLabel={t.scheduleCancelling}>{label}</SubmitButton>
    </ActionForm>
  );
  if (active) {
    return (
      <div role="status" data-scheduled className="surface-raised space-y-3 rounded-lg bg-deep p-4 text-ink">
        <div>
          <p className="font-semibold">{t.scheduledFor.replace("{time}", schedule.label)}</p>
          <p className="mt-1 text-sm">{t.scheduledDetail.replace("{version}", String(schedule.version))}</p>
        </div>
        {cancel(t.scheduleCancel)}
      </div>
    );
  }
  const changed = schedule !== null && schedule.status === "waiting";
  return (
    <div className="space-y-3">
      {schedule && (
        <div role="alert" data-schedule-problem className="space-y-2 rounded-lg border-s-4 border-amber bg-canvas p-3 text-sm">
          {changed ? (
            <p>{t.scheduleChanged.replace("{time}", schedule.label)}</p>
          ) : (
            <>
              <p className="font-semibold">{t.scheduleMissed.replace("{time}", schedule.label)}</p>
              {schedule.error && <p>{schedule.error}</p>}
            </>
          )}
          {cancel(t.scheduleDismiss)}
        </div>
      )}
      <details data-post-later open={schedule !== null && !changed ? true : undefined}>
        <summary className="cursor-pointer text-sm font-medium text-cobalt">{t.postLater}</summary>
        <ActionForm action={schedulePostAction} className="mt-2 space-y-2">
          {hidden}
          <p className="text-sm text-ink-soft">{t.scheduleHint}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block">
              <span className="label mb-1 block">{t.scheduleAt}</span>
              <input type="datetime-local" name="at" required dir="ltr" defaultValue={schedule?.value ?? ""} className="field" />
            </label>
            <SubmitButton pendingLabel={t.scheduling} disabled={blocked}>
              {t.scheduleButton}
            </SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}

export function PublishStatus({ piece, language, t }: { piece: EditorPiece; language: Language; t: Strings }) {
  const { platform, state } = piece;
  if (state === "posted") {
    return (
      <div role="status" className="surface-raised mt-3 rounded-lg bg-deep p-4 text-ink">
        <p className="font-semibold">
          {name(t.statusPosted, platform, language).replace("{version}", String(piece.postedVersion ?? piece.version))}
        </p>
        {piece.postUrl && (
          <a href={piece.postUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm underline underline-offset-2">
            {t.viewPost}
          </a>
        )}
        {platform === "website" && <p className="mt-1 text-sm">{t.websiteDelay}</p>}
      </div>
    );
  }
  if (state === "sending") {
    return (
      <p role="status" className="mt-3 rounded-lg bg-mist p-3 text-sm font-medium">
        {t.statusSending}
      </p>
    );
  }
  if (state === "failed") {
    return (
      <div role="alert" className="mt-3 rounded-lg border-s-4 border-danger bg-canvas p-3 text-sm">
        <p className="font-semibold text-danger">{t.statusFailed}</p>
        <p className="mt-1">{piece.error}</p>
      </div>
    );
  }
  if (state === "unknown") {
    return (
      <div role="alert" className="mt-3 space-y-3 rounded-lg border-s-4 border-amber bg-canvas p-4 text-sm">
        <div>
          <p className="font-semibold">{t.statusUnknown}</p>
          {piece.error && <p className="mt-1">{piece.error}</p>}
          <p className="mt-1">{name(t.statusUnknownHelp, platform, language)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={markPostedAction}>
            <input type="hidden" name="pieceId" value={piece.id} />
            <SubmitButton pendingLabel={t.marking}>{t.didPost}</SubmitButton>
          </ActionForm>
          <ActionForm action={publishPieceAction}>
            <input type="hidden" name="pieceId" value={piece.id} />
            <input type="hidden" name="version" value={piece.version} />
            <input type="hidden" name="checkedNotPosted" value="yes" />
            <SubmitButton pendingLabel={t.posting}>{t.didNotPost}</SubmitButton>
          </ActionForm>
        </div>
      </div>
    );
  }
  return null;
}

function Input({
  label,
  name: fieldName,
  value,
  onChange,
  dir,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  dir?: "ltr";
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      <input name={fieldName} dir={dir} value={value} onChange={(event) => onChange(event.target.value)} className="field" />
    </label>
  );
}

/** LinkedIn by hand: copy the saved text, paste it on LinkedIn, then record it so it can't go out twice. */
function ManualPost({
  platform,
  pieceId,
  version,
  slideCount,
  hidden,
  body,
  blocked,
  language,
  t,
}: {
  platform: Platform;
  pieceId: string;
  version: number;
  slideCount: number;
  hidden: React.ReactNode;
  body: string;
  blocked: boolean;
  language: Language;
  t: Strings;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <section
      className="space-y-3 rounded-lg border-s-4 border-cobalt bg-canvas p-4 text-sm"
      aria-label={name(t.manualTitle, platform, language)}
    >
      <p className="font-semibold">{name(t.manualTitle, platform, language)}</p>
      <p className="text-ink-soft">
        {platform === "instagram" ? t.manualIntroInstagram : name(t.manualIntro, platform, language)}{" "}
        <Link href={`/${language}/connections`} className="font-semibold text-cobalt underline underline-offset-2">
          {t.connectLink}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copyText} disabled={blocked} className="btn btn-quiet">
          {t.manualCopy}
        </button>
        <a href={MANUAL_POSTING[platform]?.composeUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet">
          {name(t.manualOpen, platform, language)}
        </a>
        {copy === "copied" && (
          <span role="status" className="font-medium text-cobalt">
            {t.manualCopied}
          </span>
        )}
      </div>
      {copy === "failed" && (
        <p role="alert" className="font-medium text-danger">
          {t.manualCopyFailed}
        </p>
      )}
      {platform === "instagram" && !blocked && slideCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">{t.manualDownloadLabel}</span>
          {Array.from({ length: slideCount }, (_, index) => (
            <a
              key={index}
              href={`/api/slides/${pieceId}/${index + 1}?v=${version}`}
              download
              className="rounded-md border border-mist bg-paper px-2.5 py-1 font-medium text-cobalt underline-offset-2 hover:underline"
            >
              {t.manualDownload.replace("{n}", (index + 1).toLocaleString(uiLocale(language)))}
            </a>
          ))}
        </div>
      )}
      <ActionForm action={markPostedByHandAction} className="space-y-2">
        {hidden}
        <label className="block">
          <span className="label mb-1 block">{t.manualLink}</span>
          <input
            name="postUrl"
            type="url"
            dir="ltr"
            className="field"
            placeholder={`https://www.${MANUAL_POSTING[platform]?.hosts[0]}/…`}
          />
        </label>
        <p className="text-ink-soft">{platform === "instagram" ? t.manualLinkHintInstagram : t.manualLinkHint}</p>
        <SubmitButton pendingLabel={t.marking} className="btn-primary" disabled={blocked}>
          {t.manualDone}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}

/** Edits the slides in order. The first is the cover and the last is the call to action. */
function SlidesEditor({ slides, onChange, t }: { slides: Slide[]; onChange: (slides: Slide[]) => void; t: Strings }) {
  const change = (index: number, fields: Partial<Slide>) =>
    onChange(slides.map((slide, at) => (at === index ? { ...slide, ...fields } : slide)));
  const move = (index: number, by: number) => {
    const next = [...slides];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const small = "btn btn-quiet !min-h-8 !px-2 text-xs";
  return (
    <fieldset className="space-y-3">
      <legend className="label mb-1">{t.slides}</legend>
      {slides.map((slide, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-mist p-3" data-slide={index + 1}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {index + 1}
              {index === 0 ? ` · ${t.slideCover}` : index === slides.length - 1 ? ` · ${t.slideLast}` : ""}
            </span>
            <span className="flex gap-1">
              <button type="button" className={small} disabled={index === 0} onClick={() => move(index, -1)}>
                {t.moveEarlier}
              </button>
              <button type="button" className={small} disabled={index === slides.length - 1} onClick={() => move(index, 1)}>
                {t.moveLater}
              </button>
              <button
                type="button"
                className={small}
                disabled={slides.length <= SLIDE_LIMITS.min}
                onClick={() => onChange(slides.filter((_, at) => at !== index))}
              >
                {t.removeSlide}
              </button>
            </span>
          </div>
          <label className="block">
            <span className="label mb-1 flex justify-between gap-2">
              <span>{t.slideTitle}</span>
              <span dir="ltr" className={slide.title.length > SLIDE_LIMITS.title ? "font-bold text-danger" : ""}>
                {slide.title.length} / {SLIDE_LIMITS.title}
              </span>
            </span>
            <input
              name="slideTitle"
              value={slide.title}
              onChange={(event) => change(index, { title: event.target.value })}
              className="field"
            />
          </label>
          <label className="block">
            <span className="label mb-1 flex justify-between gap-2">
              <span>{t.slideText}</span>
              <span dir="ltr" className={slide.text.length > SLIDE_LIMITS.text ? "font-bold text-danger" : ""}>
                {slide.text.length} / {SLIDE_LIMITS.text}
              </span>
            </span>
            <textarea
              name="slideText"
              rows={3}
              value={slide.text}
              onChange={(event) => change(index, { text: event.target.value })}
              className="field"
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-quiet"
        disabled={slides.length >= SLIDE_LIMITS.max}
        onClick={() => onChange([...slides.slice(0, -1), { title: "", text: "" }, ...slides.slice(-1)])}
      >
        {t.addSlide}
      </button>
    </fieldset>
  );
}

/** The optional cover photo. Changing it adds a version, so it waits until other edits are saved. */
function CoverPhoto({ hidden, photo, dirty, t }: { hidden: React.ReactNode; photo?: string; dirty: boolean; t: Strings }) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-mist p-3 text-sm">
      <p className="label">{t.coverPhoto}</p>
      {photo && (
        // A small preview of your own upload, served by the studio itself.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/${photo}`} alt={t.coverPhoto} className="h-24 w-20 rounded object-cover" />
      )}
      <p className="text-ink-soft">{dirty ? t.photoNeedsSave : t.coverPhotoHint}</p>
      <ActionForm action={uploadPhotoAction} resetOnSuccess className="flex flex-wrap items-center gap-2">
        {hidden}
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          required
          disabled={dirty}
          className="max-w-full text-sm"
        />
        <SubmitButton pendingLabel={t.uploadingPhoto} disabled={dirty}>
          {t.uploadPhoto}
        </SubmitButton>
      </ActionForm>
      {photo && (
        <ActionForm action={removePhotoAction}>
          {hidden}
          <SubmitButton pendingLabel={t.removingPhoto} disabled={dirty}>
            {t.removePhoto}
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border-s-4 border-amber bg-canvas p-3 text-sm">{children}</div>;
}
