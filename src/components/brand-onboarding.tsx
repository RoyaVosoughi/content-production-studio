"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { interviewBrandAction, readBrandFileAction, saveBrandSetupAction, type BrandFileState } from "@/app/actions";
import { INTERVIEW_QUESTIONS, type InterviewQuestion } from "@/lib/brand-interview";
import type { BrandKitFields } from "@/lib/brand-seed";
import type { Strings } from "@/lib/i18n";
import type { Language, UiLanguage } from "@/lib/language";

const ACCEPT = ".pdf,.docx,.txt,.md";
/** Answers survive a reload of the page, in this browser tab only. */
const ANSWERS_KEY = "studio-brand-interview";

export type KitView = { code: Language; label: string; dir: "ltr" | "rtl"; kit: BrandKitFields; isDraft: boolean };
type Mode = "choose" | "upload" | "interview";

/**
 * How a Brand Kit starts: from a brand guide you already have, or from a short interview when you
 * don't. Both end in the same place: a proposed kit for each content language, which you check,
 * change and save. Nothing is saved before that.
 */
export function BrandOnboarding({ kits, aboutEmpty, ui, t }: { kits: KitView[]; aboutEmpty: boolean; ui: UiLanguage; t: Strings }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [read, readAction, reading] = useActionState<BrandFileState, FormData>(readBrandFileAction, null);
  const [asked, askAction, asking] = useActionState<BrandFileState, FormData>(interviewBrandAction, null);
  const [shown, setShown] = useState<BrandFileState>(null);

  useEffect(() => {
    if (read?.proposal) setShown(read);
  }, [read]);
  useEffect(() => {
    if (asked?.proposal) setShown(asked);
  }, [asked]);

  if (shown?.proposal) {
    return <Review shown={shown} kits={kits} aboutEmpty={aboutEmpty} ui={ui} t={t} onDiscard={() => setShown(null)} />;
  }

  if (mode === "upload") {
    return (
      <Panel title={t.brandHaveGuide} onBack={() => setMode("choose")} t={t}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => readAction(data));
          }}
          className="space-y-3"
          data-brand-file
        >
          <p className="text-sm text-ink-soft">{t.brandFileHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" name="brandFile" accept={ACCEPT} required disabled={reading} className="max-w-full text-sm" />
            <button type="submit" className="btn btn-primary" disabled={reading}>
              <span className={reading ? "pending-pulse" : undefined} aria-live="polite">
                {reading ? t.brandFileReading : t.brandFileButton}
              </span>
            </button>
          </div>
          {read?.error && !reading && (
            <p role="alert" className="text-sm font-medium text-danger">
              {read.error}
            </p>
          )}
        </form>
      </Panel>
    );
  }

  if (mode === "interview") {
    return (
      <Panel title={t.brandNoGuide} onBack={() => setMode("choose")} t={t}>
        <Interview
          t={t}
          working={asking}
          error={asking ? undefined : asked?.error}
          onFinish={(answers) => {
            const data = new FormData();
            for (const [key, value] of Object.entries(answers)) data.set(key, value);
            startTransition(() => askAction(data));
          }}
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2" data-brand-choice>
      <Choice title={t.brandHaveGuide} text={t.brandHaveGuideHint} button={t.brandHaveGuideButton} onClick={() => setMode("upload")} />
      <Choice title={t.brandNoGuide} text={t.brandNoGuideHint} button={t.brandNoGuideButton} onClick={() => setMode("interview")} primary />
    </div>
  );
}

function Choice({ title, text, button, onClick, primary }: { title: string; text: string; button: string; onClick: () => void; primary?: boolean }) {
  return (
    <div className="flex flex-col rounded-xl border border-mist bg-paper p-5">
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="mt-2 flex-1 text-sm text-ink-soft">{text}</p>
      <button type="button" className={`btn mt-4 self-start ${primary ? "btn-primary" : "btn-quiet"}`} onClick={onClick}>
        {button}
      </button>
    </div>
  );
}

function Panel({ title, onBack, t, children }: { title: string; onBack: () => void; t: Strings; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-mist bg-paper p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        <button type="button" className="text-sm text-cobalt underline underline-offset-2" onClick={onBack}>
          {t.brandOtherWay}
        </button>
      </div>
      {children}
    </div>
  );
}

type Answers = Partial<Record<InterviewQuestion, string>>;

function loadAnswers(): Answers {
  try {
    return JSON.parse(sessionStorage.getItem(ANSWERS_KEY) ?? "{}") as Answers;
  } catch {
    return {};
  }
}

/** One question at a time. Every question can be skipped except the first. */
function Interview({ t, working, error, onFinish }: { t: Strings; working: boolean; error?: string; onFinish: (answers: Answers) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setAnswers(loadAnswers()), []);
  useEffect(() => {
    try {
      sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    } catch {
      // Private windows may refuse; the answers just won't survive a reload.
    }
  }, [answers]);
  useEffect(() => box.current?.focus(), [step]);

  const key = INTERVIEW_QUESTIONS[step];
  const question = t.interview[key];
  const last = step === INTERVIEW_QUESTIONS.length - 1;
  const value = answers[key] ?? "";

  function next(event?: FormEvent) {
    event?.preventDefault();
    if (last) onFinish(answers);
    else setStep(step + 1);
  }

  return (
    <form onSubmit={next} className="space-y-4" data-brand-interview>
      <div className="flex items-center gap-3">
        <span className="label">{t.interviewStep.replace("{n}", String(step + 1)).replace("{total}", String(INTERVIEW_QUESTIONS.length))}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist" aria-hidden>
          <div className="h-full bg-cobalt transition-all" style={{ width: `${((step + 1) / INTERVIEW_QUESTIONS.length) * 100}%` }} />
        </div>
      </div>
      <label className="block">
        <span className="block text-lg font-semibold">{question.q}</span>
        <span className="mt-1 block text-sm text-ink-soft">{question.hint}</span>
        <textarea
          ref={box}
          value={value}
          onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })}
          rows={key === "samples" ? 8 : 4}
          maxLength={3000}
          dir="auto"
          className="field mt-2"
          placeholder={question.example}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)} disabled={working}>
            {t.interviewBack}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={working || (step === 0 && !value.trim())}>
          <span className={working ? "pending-pulse" : undefined} aria-live="polite">
            {working ? t.interviewBuilding : last ? t.interviewFinish : t.interviewNext}
          </span>
        </button>
        {step > 0 && !last && !value.trim() && (
          <button type="button" className="text-sm text-ink-soft underline underline-offset-2" onClick={() => next()}>
            {t.interviewSkip}
          </button>
        )}
      </div>
    </form>
  );
}

/** The proposed kit for each language, to check and change before it's saved. */
function Review({
  shown,
  kits,
  aboutEmpty,
  ui,
  t,
  onDiscard,
}: {
  shown: NonNullable<BrandFileState>;
  kits: KitView[];
  /** The team rules are filled from the proposal only while they're empty, so the box shows only then. */
  aboutEmpty: boolean;
  ui: UiLanguage;
  t: Strings;
  onDiscard: () => void;
}) {
  const [saved, saveAction, saving] = useActionState(saveBrandSetupAction, null);
  const proposal = shown.proposal!;
  const reviewKits = kits.filter((view) => proposal.kits[view.code]).map((view) => ({ ...view, proposed: proposal.kits[view.code]! }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => saveAction(data));
  }

  useEffect(() => {
    try {
      sessionStorage.removeItem(ANSWERS_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border-s-4 border-cobalt bg-paper p-5 md:p-6" data-brand-review>
      <input type="hidden" name="ui" value={ui} />
      <div>
        <h3 className="font-display text-xl font-semibold">{t.brandReviewTitle}</h3>
        <p className="mt-1 text-sm text-ink-soft">
          {shown.fileName && (
            <>
              <bdi>{shown.fileName}</bdi> ·{" "}
            </>
          )}
          {t.brandReviewIntro}
        </p>
      </div>
      {aboutEmpty && proposal.about && <Field name="about" label={t.brandAboutLabel} value={proposal.about} rows={4} dir="auto" />}
      {reviewKits.map((view) => (
        <KitFields key={view.code} view={view} values={view.proposed} compare={view.isDraft ? null : view.kit} showTitle={kits.length > 1} t={t} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <span className={saving ? "pending-pulse" : undefined}>{saving ? t.saving : t.brandSave}</span>
        </button>
        <button type="button" className="btn btn-quiet" disabled={saving} onClick={onDiscard}>
          {t.brandDiscard}
        </button>
      </div>
      {saved?.error && !saving && (
        <p role="alert" className="text-sm font-medium text-danger">
          {saved.error}
        </p>
      )}
    </form>
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
      {field("positioning", t.positioning, 4, t.positioningHint)}
      {field("audience", t.audience, 3, t.audienceHint)}
      {field("pillars", t.pillars, 5, t.pillarsHint)}
      {field("voiceGuide", t.voiceGuide, 5, t.voiceGuideHint)}
      {field("avoid", t.avoid, 3, t.avoidHint)}
      {field("samples", t.samples, 6, t.samplesHint)}
      {field("searchTopics", t.searchTopics, 4, t.searchTopicsHint)}
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
