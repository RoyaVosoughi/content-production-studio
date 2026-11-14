import Link from "next/link";
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

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { lang: param } = await params;
  const { saved } = await searchParams;
  const { ui: lang, t, db, view } = await readyPage(param);
  // Each content language has its own kit; the one shown follows the content language switch.
  const kit = await getBrandKit(db, view);
  const dir = textDirection(view);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.brandTitle}</h1>
      <p className="mt-3 max-w-xl text-ink-soft">{t.brandIntro}</p>
      {kit.isDraft && <p className="mt-3 rounded-lg border-s-4 border-amber bg-paper p-3 text-sm">{t.draftKit}</p>}
      {saved && !kit.isDraft && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border-s-4 border-cobalt bg-paper p-3 text-sm">
          <span>{t.kitSaved}</span>
          <Link href={`/${lang}`} className="btn btn-primary">
            {t.nextFindIdeas}
          </Link>
        </div>
      )}

      <ActionForm key={kit.updatedAt.toISOString()} action={saveBrandKitAction} className="mt-8 space-y-6">
        <input type="hidden" name="language" value={view} />
        <input type="hidden" name="ui" value={lang} />
        <Field name="positioning" label={t.positioning} hint={t.positioningHint} defaultValue={kit.positioning} rows={4} dir={dir} />
        <Field name="audience" label={t.audience} hint={t.audienceHint} defaultValue={kit.audience} rows={3} dir={dir} />
        <Field name="pillars" label={t.pillars} hint={t.pillarsHint} defaultValue={kit.pillars.join("\n")} rows={6} dir={dir} />
        <Field name="voiceGuide" label={t.voiceGuide} hint={t.voiceGuideHint} defaultValue={kit.voiceGuide} rows={6} dir={dir} />
        <Field name="avoid" label={t.avoid} hint={t.avoidHint} defaultValue={kit.avoid} rows={3} dir={dir} />
        <Field name="samples" label={t.samples} hint={t.samplesHint} defaultValue={kit.samples} rows={10} dir={dir} />
        <Field name="searchTopics" label={t.searchTopics} hint={t.searchTopicsHint} defaultValue={kit.searchTopics.join("\n")} rows={5} dir={dir} />
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
