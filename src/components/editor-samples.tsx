"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Strings } from "@/lib/i18n";
import { CONTENT_LANGUAGES, languageName, uiLocale, type Language, type UiLanguage } from "@/lib/language";
import { VIDEO_PLATFORMS } from "@/lib/platforms";

/** Sends a sample video to the editor's folder, with what you say about it. Videos are too big for a form action. */
export function SampleUpload({
  language,
  speech,
  t,
  noteLength,
}: {
  language: UiLanguage;
  /** The language picked first: the main content language. */
  speech: Language;
  t: Strings;
  noteLength: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("video");
    if (!(file instanceof File) || file.size === 0) {
      setError(t.chooseClip);
      return;
    }
    setError(null);
    setProgress(0);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/agents/editor/samples");
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.setRequestHeader("x-language", encodeURIComponent(String(data.get("language") ?? "")));
    request.setRequestHeader("x-platform", encodeURIComponent(String(data.get("platform") ?? "")));
    request.setRequestHeader("x-note", encodeURIComponent(String(data.get("note") ?? "")));
    request.upload.onprogress = (progressEvent) => progressEvent.lengthComputable && setProgress(progressEvent.loaded / progressEvent.total);
    request.onload = () => {
      let message: string | null = null;
      try {
        const body = JSON.parse(request.responseText) as { ok?: boolean; error?: string };
        if (!body.ok) message = body.error ?? t.uploadFailed;
      } catch {
        message = t.uploadFailed;
      }
      setProgress(null);
      if (message) setError(message);
      else {
        form.reset();
        router.refresh();
      }
    };
    request.onerror = () => {
      setProgress(null);
      setError(t.uploadFailed);
    };
    request.send(file);
  }

  const percent = progress === null ? "" : `${Math.round(progress * 100).toLocaleString(uiLocale(language))}%`;
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t.sampleFile}</span>
        <input type="file" name="video" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv" required dir="auto" className="field" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t.sampleLanguage}</span>
          <select name="language" defaultValue={speech} dir="auto" className="field">
            {CONTENT_LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {languageName(option.code, language)}
              </option>
            ))}
            <option value="none">{t.sampleNoSpeech}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t.samplePlatform}</span>
          <select name="platform" defaultValue="" dir="auto" className="field">
            <option value="">{t.sampleAnyVideo}</option>
            {VIDEO_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {t.sampleNetworks[platform]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t.sampleNote}</span>
        <textarea name="note" rows={2} maxLength={noteLength} dir="auto" className="field" placeholder={t.sampleNotePlaceholder} />
      </label>
      <button type="submit" disabled={progress !== null} className="btn btn-primary">
        <span className={progress !== null ? "pending-pulse" : undefined} aria-live="polite">
          {progress !== null ? t.uploadingSample.replace("{percent}", percent) : t.uploadSample}
        </span>
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/** Keeps the page up to date while a sample is being measured. */
export function RefreshWhileMeasuring({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
