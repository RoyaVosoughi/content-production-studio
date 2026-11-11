"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { readBrandFileAction, saveBrandSetupAction, type BrandFileState } from "@/app/actions";
import type { BrandKitFields } from "@/lib/brand-seed";
import type { Strings } from "@/lib/i18n";
import type { Language } from "@/lib/language";

const ACCEPT = ".pdf,.docx,.txt,.md";

type KitView = { code: Language; label: string; dir: "ltr" | "rtl"; kit: BrandKitFields; isDraft: boolean };

/**
 * The Brand Kit, inside the "About you" card. Upload a brand file and the AI proposes a kit for each
 * content language, shown here to check and change before anything is saved. Without a file, the
 * current kit can be opened and edited here too.
 */
export function BrandSetup({ kits, aboutEmpty, t }: { kits: KitView[]; aboutEmpty: boolean; t: Strings }) {
  const [read, readAction, reading] = useActionState<BrandFileState, FormData>(readBrandFileAction, null);
  const [saved, saveAction, saving] = useActionState(saveBrandSetupAction, null);
  // Which proposal is on screen. Cleared once it's saved or discarded; a new upload brings a new one.
  const [shown, setShown] = useState<BrandFileState>(null);
  const wasSaving = useRef(false);
  const fileForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (read?.proposal) setShown(read);
  }, [read]);
  useEffect(() => {
    if (wasSaving.current && !saving && !saved?.error) {
      setShown(null);
      fileForm.current?.reset();
    }
    wasSaving.current = saving;
  }, [saving, saved]);

  const submit = (action: (data: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  const proposal = shown?.proposal;
  const reviewKits = proposal
    ? kits.filter((view) => proposal.kits[view.code]).map((view) => ({ ...view, proposed: proposal.kits[view.code]! }))
    : [];

  return (
    <div className="space-y-5">
      <form ref={fileForm} onSubmit={submit(readAction)} className="space-y-3 rounded-lg border border-mist p-4" data-brand-file>
        <p className="font-semibold">{t.brandFileTitle}</p>
        <p className="text-sm text-ink-soft">{t.brandFileHint}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" name="brandFile" accept={ACCEPT} required disabled={reading} className="max-w-full text-sm" />
          <button type="submit" className="btn btn-primary" disabled={reading}>
            {reading ? t.brandFileReading : t.brandFileButton}
          </button>
        </div>
        {read?.error && !reading && (
          <p role="alert" className="text-sm font-medium text-danger">
            {read.error}
          </p>
        )}
      </form>

      {proposal ? (
        <form onSubmit={submit(saveAction)} className="space-y-5 rounded-lg border-s-4 border-cobalt bg-canvas p-4" data-brand-review>
          <div>
            <p className="font-semibold">{t.brandReviewTitle}</p>
            <p className="mt-1 text-sm text-ink-soft">
              <bdi>{shown?.fileName}</bdi> · {t.brandReviewIntro}
            </p>
          </div>
          {aboutEmpty && proposal.about && (
            <Field name="about" label={t.brandAboutLabel} value={proposal.about} rows={4} dir="auto" />
          )}
          {reviewKits.map((view) => (
            <KitFields key={view.code} view={view} values={view.proposed} compare={view.isDraft ? null : view.kit} showTitle={kits.length > 1} t={t} />
          ))}
          <Actions saving={saving} error={saved?.error} t={t}>
            <button type="button" className="btn btn-quiet" disabled={saving} onClick={() => setShown(null)}>
              {t.brandDiscard}
            </button>
          </Actions>
        </form>
      ) : (
        <details className="rounded-lg border border-mist p-4" data-brand-kit>
          <summary className="cursor-pointer font-semibold">{t.brandKitTitle}</summary>
          <p className="mt-1 text-sm text-ink-soft">{t.brandIntro}</p>
          <form onSubmit={submit(saveAction)} className="mt-4 space-y-5">
            {kits.map((view) => (
              <KitFields key={view.code} view={view} values={view.kit} compare={null} showTitle={kits.length > 1} t={t} />
            ))}
            <Actions saving={saving} error={saved?.error} t={t} />
          </form>
        </details>
      )}
    </div>
  );
}

function KitFields({
  view,
  values,
  compare,
  showTitle,
  t,
}: {
  view: KitView;
  values: BrandKitFields;
  /** The saved kit, to mark what the proposal would change. */
  compare: BrandKitFields | null;
  showTitle: boolean;
  t: Strings;
}) {
  const changed = (key: keyof BrandKitFields) => compare !== null && JSON.stringify(compare[key]) !== JSON.stringify(values[key]);
  const field = (key: keyof BrandKitFields, label: string, rows: number, hint?: string) => {
    const value = values[key];
    return (
      <Field
        name={`${view.code}:${key}`}
        label={label}
        hint={hint}
        value={Array.isArray(value) ? value.join("\n") : value}
        rows={rows}
        dir={view.dir}
        changed={changed(key) ? t.brandChanged : undefined}
      />
    );
  };
  return (
    <fieldset className="space-y-4">
      {showTitle && <legend className="mb-2 font-display text-lg font-semibold">{view.label}</legend>}
      {field("positioning", t.positioning, 4)}
      {field("audience", t.audience, 3)}
      {field("pillars", t.pillars, 5)}
      {field("voiceGuide", t.voiceGuide, 5)}
      {field("avoid", t.avoid, 3)}
      {field("samples", t.samples, 6, t.samplesHint)}
      {field("searchTopics", t.searchTopics, 4)}
    </fieldset>
  );
}

function Field({
  name,
  label,
  hint,
  value,
  rows,
  dir,
  changed,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  rows: number;
  dir: "ltr" | "rtl" | "auto";
  changed?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-medium">
        {label}
        {changed && <span className="rounded-full bg-cobalt/20 px-2 text-xs text-periwinkle">{changed}</span>}
      </span>
      {hint && <span className="mb-1 block text-xs text-ink-soft">{hint}</span>}
      <textarea name={name} defaultValue={value} rows={rows} dir={dir} className="field" />
    </label>
  );
}

function Actions({ saving, error, t, children }: { saving: boolean; error?: string; t: Strings; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t.saving : t.brandSave}
        </button>
        {children}
      </div>
      {error && !saving && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
