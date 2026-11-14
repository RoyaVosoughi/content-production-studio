"use client";

import { useEffect, useRef, useState } from "react";
import { removeImageAction, saveImageAction } from "@/app/actions";
import type { PieceContent } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { textDirection, type Language } from "@/lib/language";
import {
  IMAGE_KINDS,
  IMAGE_LIMITS,
  IMAGE_SIZES,
  cleanImage,
  draftPoints,
  imageHtml,
  imageProblem,
  suggestImage,
  type ImageSize,
  type PostImage,
} from "@/lib/post-image";
import type { SlideBrand } from "@/lib/slides";
import { ActionForm, SubmitButton } from "./action-form";

/**
 * The image page at its real size, scaled down to the width it is given.
 * The frame is sandboxed: it only displays the picture.
 */
export function ImageFrame({
  image,
  language,
  brand,
  title,
  photoSrc,
}: {
  image: PostImage;
  language: Language;
  brand: SlideBrand;
  title: string;
  /** A photo chosen but not saved yet, shown before it is uploaded. */
  photoSrc?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const size = IMAGE_SIZES[image.size];
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const photo = photoSrc ?? (image.photo ? `/api/media/${image.photo}` : null);
  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-md bg-mist"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      data-post-image={image.kind}
    >
      {width > 0 && (
        <iframe
          title={title}
          sandbox=""
          srcDoc={imageHtml(image, { language, brand, photoSrc: photo })}
          width={size.width}
          height={size.height}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ transform: `scale(${width / size.width})` }}
        />
      )}
    </div>
  );
}

/**
 * Adds, changes or removes the brand image of a LinkedIn post or an article. Each save is a new version
 * of the post, so it waits until changes to the text are saved.
 */
export function PostImageEditor({
  platform,
  content,
  hidden,
  dirty,
  language,
  brand,
  t,
}: {
  platform: "linkedin" | "website";
  content: PieceContent;
  hidden: React.ReactNode;
  /** The post's text has unsaved changes. */
  dirty: boolean;
  /** The language the post is written in. */
  language: Language;
  brand: SlideBrand;
  t: Strings;
}) {
  const p = t.postImage;
  const saved = content.image ?? null;
  const [draft, setDraft] = useState<PostImage | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const dir = textDirection(language);
  const editing = draft !== null;
  const change = (fields: Partial<PostImage>) => setDraft((current) => (current ? { ...current, ...fields } : current));
  const shown = draft ? { ...draft, photo: keepPhoto ? draft.photo : undefined } : null;
  // What would be saved: trimmed, with empty points left out.
  const clean = shown ? cleanImage(shown) : null;
  const problem = clean ? imageProblem(clean) : null;
  const reset = () => {
    setDraft(null);
    setPhoto(null);
    setKeepPhoto(true);
  };

  return (
    <section className="mt-4 space-y-3 rounded-lg border border-mist p-3 text-sm" aria-label={p.title} data-image-editor>
      <p className="label">{p.title}</p>
      {!editing && !saved && (
        <>
          <p className="text-ink-soft">{dirty ? p.needsSave : p.intro}</p>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={dirty}
            onClick={() => setDraft(suggestImage(platform, content))}
          >
            {p.add}
          </button>
          <p className="text-xs text-ink-soft">{p.addHint}</p>
        </>
      )}

      {!editing && saved && (
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <p className="w-full text-ink-soft">{p.needsSave}</p>}
          <button type="button" className="btn btn-quiet" disabled={dirty} onClick={() => setDraft(saved)}>
            {t.editLabel}
          </button>
          <ActionForm action={removeImageAction}>
            {hidden}
            <SubmitButton pendingLabel={p.removing} disabled={dirty}>
              {p.remove}
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      {editing && shown && (
        <ActionForm action={saveImageAction} resetOnSuccess className="space-y-3">
          {hidden}
          <input type="hidden" name="image" value={JSON.stringify(clean)} />
          <ImageFrame image={shown} language={language} brand={brand} title={p.preview} photoSrc={photo} />

          <fieldset>
            <legend className="label mb-1">{p.kind}</legend>
            <div className="flex flex-wrap gap-2">
              {IMAGE_KINDS.map((kind) => (
                <label key={kind} className={`btn ${draft.kind === kind ? "btn-primary" : "btn-quiet"} cursor-pointer`}>
                  <input
                    type="radio"
                    className="sr-only"
                    checked={draft.kind === kind}
                    onChange={() =>
                      change({ kind, items: kind === "points" && draft.items.length < 2 ? draftPoints(content.body) : draft.items })
                    }
                  />
                  {p.kinds[kind]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="label mb-1 block">{p.size}</span>
            <select className="field" value={draft.size} onChange={(event) => change({ size: event.target.value as ImageSize })}>
              {(Object.keys(IMAGE_SIZES) as ImageSize[]).map((size) => (
                <option key={size} value={size}>
                  {p.sizes[size]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label mb-1 block">{draft.kind === "quote" ? p.quote : p.heading}</span>
            <textarea
              rows={draft.kind === "quote" ? 3 : 2}
              dir={dir}
              maxLength={IMAGE_LIMITS.heading}
              className="field"
              value={draft.heading}
              onChange={(event) => change({ heading: event.target.value })}
            />
          </label>

          {draft.kind !== "points" && (
            <label className="block">
              <span className="label mb-1 block">{draft.kind === "quote" ? p.who : p.sub}</span>
              <input
                dir={dir}
                maxLength={IMAGE_LIMITS.text}
                className="field"
                value={draft.text}
                onChange={(event) => change({ text: event.target.value })}
              />
            </label>
          )}

          {draft.kind === "points" && (
            <label className="block">
              <span className="label mb-1 block">{p.points}</span>
              <textarea
                rows={5}
                dir={dir}
                className="field"
                value={draft.items.join("\n")}
                onChange={(event) => change({ items: event.target.value.split("\n").slice(0, IMAGE_LIMITS.items) })}
              />
            </label>
          )}

          {draft.kind === "cover" && (
            <div className="space-y-1">
              <span className="label block">{p.photo}</span>
              <span className="block text-xs text-ink-soft">{p.photoHint}</span>
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                className="max-w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setPhoto(file ? URL.createObjectURL(file) : null);
                  if (file) setKeepPhoto(true);
                }}
              />
              {draft.photo && !photo && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={keepPhoto} onChange={(event) => setKeepPhoto(event.target.checked)} />
                  {p.keepPhoto}
                </label>
              )}
            </div>
          )}

          {problem && <p className="text-xs text-ink-soft">{problem}</p>}
          <p role="status" className="text-sm font-medium text-amber-deep">
            {p.unsaved}
          </p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel={p.saving} className="btn-primary" disabled={problem !== null}>
              {p.save}
            </SubmitButton>
            <button type="button" className="btn btn-quiet" onClick={reset}>
              {p.cancel}
            </button>
          </div>
        </ActionForm>
      )}
    </section>
  );
}
