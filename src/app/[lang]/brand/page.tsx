import { saveBrandKitAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { textDirection, uiLocale } from "@/lib/language";
import { getBrandKit } from "@/lib/studio";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

function Field({
  name,
  label,
  hint,
  defaultValue,
  rows,
  dir,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  rows: number;
  dir: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="font-semibold">{label}</span>
      {hint && <span className="block text-sm text-ink-soft">{hint}</span>}
      <textarea name={name} defaultValue={defaultValue} rows={rows} dir={dir} className="field mt-1" />
    </label>
  );
}

export default async function BrandPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, db, view } = await readyPage(param);
  // Each content language has its own kit; the one shown follows the content language switch.
  const kit = await getBrandKit(db, view);
  const dir = textDirection(view);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.brandTitle}</h1>
      <p className="mt-3 max-w-xl text-ink-soft">{t.brandIntro}</p>
      {kit.isDraft && <p className="mt-3 rounded-lg border-s-4 border-amber bg-paper p-3 text-sm">{t.draftKit}</p>}

      <ActionForm key={kit.updatedAt.toISOString()} action={saveBrandKitAction} className="mt-8 space-y-6">
        <input type="hidden" name="language" value={view} />
        <Field name="positioning" label={t.positioning} defaultValue={kit.positioning} rows={4} dir={dir} />
        <Field name="audience" label={t.audience} defaultValue={kit.audience} rows={3} dir={dir} />
        <Field name="pillars" label={t.pillars} defaultValue={kit.pillars.join("\n")} rows={6} dir={dir} />
        <Field name="voiceGuide" label={t.voiceGuide} defaultValue={kit.voiceGuide} rows={6} dir={dir} />
        <Field name="avoid" label={t.avoid} defaultValue={kit.avoid} rows={3} dir={dir} />
        <Field name="samples" label={t.samples} hint={t.samplesHint} defaultValue={kit.samples} rows={10} dir={dir} />
        <Field name="searchTopics" label={t.searchTopics} defaultValue={kit.searchTopics.join("\n")} rows={5} dir={dir} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel={t.saving} className="btn-primary">
            {t.saveKit}
          </SubmitButton>
          {!kit.isDraft && (
            <span className="label">
              {t.savedAt}: {kit.updatedAt.toLocaleString(uiLocale(lang))}
            </span>
          )}
        </div>
      </ActionForm>
    </>
  );
}
