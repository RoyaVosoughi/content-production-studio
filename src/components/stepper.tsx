import Link from "next/link";
import type { Strings } from "@/lib/i18n";
import { nextStep, type Step, type StepId } from "@/lib/progress";

/**
 * The studio's path, always in view at the top of the main pages: every step with a tick once it's
 * done, the page you're on marked, and one button for the next step.
 */
export function Stepper({ steps, here, t }: { steps: Step[]; here?: StepId; t: Strings }) {
  const next = nextStep(steps);
  return (
    <nav aria-label={t.stepsLabel} className="mb-8 rounded-xl bg-paper p-3 md:p-4" data-stepper>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
        {steps.map((step, index) => {
          const current = step.id === here;
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden className="text-ink-soft/50 rtl:rotate-180">
                  ›
                </span>
              )}
              <Link
                href={step.href}
                aria-current={current ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  current ? "bg-cobalt/20 font-semibold text-ink" : step.done ? "text-ink-soft hover:text-ink" : "text-ink-soft/70 hover:text-ink"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${
                    step.done ? "bg-cobalt text-white" : current ? "border border-cobalt text-cobalt" : "border border-mist"
                  }`}
                >
                  {step.done ? "✓" : index + 1}
                </span>
                {t.steps[step.id]}
                {step.done && <span className="sr-only"> ({t.stepDone})</span>}
              </Link>
            </li>
          );
        })}
      </ol>
      {next && next.id !== here && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-3">
          <span className="text-sm text-ink-soft">{t.stepHints[next.id]}</span>
          <Link href={next.href} className="btn btn-primary">
            {t.stepNext.replace("{step}", t.steps[next.id])}
          </Link>
        </div>
      )}
    </nav>
  );
}
