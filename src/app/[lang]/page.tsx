import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ScoutProgress } from "@/components/scout-progress";
import { Stepper } from "@/components/stepper";
import { studioProgress } from "@/lib/progress";
import { scoutProgressText } from "@/lib/i18n";
import { currentScoutJob } from "@/lib/scout-job";
import { readyPage } from "@/lib/view";
import { generateIdeasAction } from "../actions";

export const dynamic = "force-dynamic";

/** The studio's first page: one question. The map of the team opens on its own page once you ask. */
export default async function StudioPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, view, db, profile } = await readyPage(param);
  const job = currentScoutJob();
  const steps = await studioProgress(db, lang, view);
  const brandReady = steps.find((step) => step.id === "brand")!.done;

  const missingKeys = [
    ...(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY ? [] : ["GEMINI_API_KEY"]),
    ...(process.env.TAVILY_API_KEY ? [] : ["TAVILY_API_KEY"]),
  ];

  return (
    <>
      <Stepper steps={steps} here="idea" t={t} />
      {!brandReady && (
        <section className="mb-8 rounded-xl border-s-4 border-cobalt bg-paper p-5 md:p-6" data-welcome>
          <h1 className="font-display text-3xl font-semibold leading-tight">{t.welcomeTitle.replace("{name}", profile.name)}</h1>
          <p className="mt-3 max-w-2xl">{t.welcomeIntro}</p>
          <ol className="mt-4 max-w-2xl list-decimal space-y-1 ps-5 text-sm text-ink-soft">
            <li>{t.welcomeStep1}</li>
            <li>{t.welcomeStep2}</li>
            <li>{t.welcomeStep3}</li>
          </ol>
          <Link href={`/${lang}/brand`} className="btn btn-primary mt-5">
            {t.welcomeStart}
          </Link>
        </section>
      )}
      <ScoutProgress initial={job} text={scoutProgressText(t)} />
      <ActionForm action={generateIdeasAction} resetOnSuccess className="ask-box">
        <input type="hidden" name="language" value={view} />
        <input type="hidden" name="ui" value={lang} />
        <h2 id="ask-title" className="font-display text-4xl font-semibold leading-tight md:text-5xl">
          {t.askTitle}
        </h2>
        <p id="ask-hint" className="mt-3">
          {t.askHint}
        </p>
        <textarea
          id="focus"
          name="focus"
          rows={3}
          maxLength={2000}
          dir="auto"
          aria-labelledby="ask-title"
          aria-describedby="ask-hint"
          className="field mt-6 text-start"
          placeholder={t.askPlaceholder}
        />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <SubmitButton name="mode" value="topic" pendingLabel={t.generating} className="btn-primary">
            {t.askButton}
          </SubmitButton>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
          <span className="text-sm text-ink-soft">{t.askAutoHint}</span>
          <SubmitButton name="mode" value="auto" pendingLabel={t.generating}>
            {t.askAuto}
          </SubmitButton>
        </div>
        <p className="mt-4 text-sm">
          <Link href={`/${lang}/map`} className="text-ink-soft underline underline-offset-2 hover:text-cobalt">
            {t.askOpenMap}
          </Link>
        </p>
      </ActionForm>

      {missingKeys.length > 0 && (
        <div role="status" className="mt-6 rounded-lg border-s-4 border-amber bg-paper p-4 text-sm">
          <p className="font-semibold">{t.setupTitle}</p>
          <p dir="ltr" className="mt-1 text-start font-[family-name:var(--font-jetbrains)]">
            {missingKeys.join(", ")}
          </p>
        </div>
      )}
    </>
  );
}

