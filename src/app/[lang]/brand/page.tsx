import Link from "next/link";
import { saveBrandKitAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BrandOnboarding } from "@/components/brand-onboarding";
import { InstructionsForm } from "@/components/instructions-form";
import { Stepper } from "@/components/stepper";
import { GENERAL, getInstructions } from "@/lib/agents/team";
import { languageName, textDirection, uiLocale } from "@/lib/language";
import { nextStep, studioProgress } from "@/lib/progress";
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

/**
 * Your brand, in one place. The first time, it asks one question: do you have a brand guide? Upload
 * it, or answer a short interview, and check the kit the AI proposes. After that, the kit is a form
 * you can change, and the rules for the whole team sit below it.
 */
export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { lang: param } = await params;
  const { saved } = await searchParams;
  const { ui: lang, t, db, view, languages } = await readyPage(param);
  const [kits, general, steps] = await Promise.all([
    Promise.all(languages.map(async (code) => ({ code, kit: await getBrandKit(db, code) }))),
    getInstructions(db, GENERAL),
    studioProgress(db, lang, view),
  ]);
  // Each content language has its own kit; the one in the form follows the content language switch.
  const kit = kits.find((entry) => entry.code === view)?.kit ?? (await getBrandKit(db, view));
  const started = kits.some((entry) => !entry.kit.isDraft);
  const dir = textDirection(view);
  const next = nextStep(steps);
  const kitViews = kits.map(({ code, kit }) => ({ code, label: languageName(code, lang), dir: textDirection(code), kit, isDraft: kit.isDraft }));

  const form = (
    <ActionForm key={kit.updatedAt.toISOString()} action={saveBrandKitAction} className="space-y-6">
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
  );

  return (
    <>
      <Stepper steps={steps} here="brand" t={t} />
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.brandTitle}</h1>

      {!started ? (
        <>
          <p className="mt-3 max-w-2xl text-ink-soft">{t.brandStartIntro}</p>
          <div className="mt-8">
            <BrandOnboarding kits={kitViews} aboutEmpty={!general.both.trim()} ui={lang} t={t} />
          </div>
          <details className="mt-8 rounded-xl border border-mist p-4 md:p-5">
            <summary className="cursor-pointer font-semibold">{t.brandByHand}</summary>
            <p className="mt-1 mb-5 text-sm text-ink-soft">{t.brandIntro}</p>
            {form}
          </details>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-xl text-ink-soft">{t.brandIntro}</p>
          {kit.isDraft && <p className="mt-3 rounded-lg border-s-4 border-amber bg-paper p-3 text-sm">{t.draftKit}</p>}
          {saved && !kit.isDraft && (
            <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border-s-4 border-cobalt bg-paper p-3 text-sm">
              <span>{t.kitSaved}</span>
              {next && next.id !== "brand" && (
                <Link href={next.href} className="btn btn-primary">
                  {t.stepNext.replace("{step}", t.steps[next.id])}
                </Link>
              )}
            </div>
          )}
          <div className="mt-8">{form}</div>

          <details className="mt-10 rounded-xl border border-mist p-4 md:p-5">
            <summary className="cursor-pointer font-semibold">{t.brandRedo}</summary>
            <p className="mt-1 mb-5 text-sm text-ink-soft">{t.brandRedoHint}</p>
            <BrandOnboarding kits={kitViews} aboutEmpty={!general.both.trim()} ui={lang} t={t} />
          </details>

          <section id="team-rules" className="mt-10 scroll-mt-24 rounded-xl bg-paper p-5 md:p-6">
            <h2 className="font-display text-2xl font-semibold">{t.generalTitle}</h2>
            <p className="mt-2 mb-5 max-w-2xl text-sm text-ink-soft">{t.generalIntro}</p>
            <InstructionsForm instructions={general} languages={languages} ui={lang} t={t} placeholder={t.generalPlaceholder} rows={6} />
          </section>
        </>
      )}
    </>
  );
}
