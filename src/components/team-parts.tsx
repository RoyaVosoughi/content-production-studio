import { addLessonAction, deleteLessonAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import type { teamOverview } from "@/lib/agents/team";
import type { Strings } from "@/lib/i18n";
import { languageName, uiLocale, type Language as ContentLanguage, type UiLanguage as Language } from "@/lib/language";

export type AgentStats = Awaited<ReturnType<typeof teamOverview>>["agents"][number];

export function formatNumber(language: Language) {
  return (value: number, digits = 0) =>
    value.toLocaleString(uiLocale(language), { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function Stat({ label, value, light = false }: { label: string; value: string; light?: boolean }) {
  return (
    <div>
      <dt className={`text-xs ${light ? "text-periwinkle" : "label"}`}>{label}</dt>
      <dd className="font-display text-2xl font-semibold">{value}</dd>
    </div>
  );
}

/** The numbers that say how an agent is doing. The manager checks drafts, not translations or edit plans. */
export function AgentNumbers({ agent, language, t }: { agent: AgentStats; language: Language; t: Strings }) {
  const number = formatNumber(language);
  const checked = agent.checked > 0;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {checked && <Stat label={t.statChecked} value={number(agent.checked)} />}
      {checked && agent.averageScore !== null && <Stat label={t.statAverage} value={number(agent.averageScore, 1)} />}
      {checked && <Stat label={t.statSentBack} value={number(agent.sentBack)} />}
      <Stat label={t.statYourChanges} value={number(agent.ownerChanges)} />
      {agent.id === "scout" && <Stat label={t.statApproved} value={number(agent.approvals)} />}
      {agent.id === "manager" && <Stat label={t.statMissed} value={number(agent.missed)} />}
    </dl>
  );
}

export function RecentNotes({ agent, language, t }: { agent: AgentStats; language: Language; t: Strings }) {
  if (agent.recent.length === 0) return null;
  const number = formatNumber(language);
  return (
    <div className="mt-5">
      <h3 className="label">{t.recentNotes}</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {agent.recent.map((run) => (
          <li key={run.id} className="border-b border-mist pb-2">
            <span className="label me-2">{run.score != null ? `${number(run.score)}/${number(10)}` : ""}</span>
            {/* The manager writes its findings for the writer in English. */}
            <bdi>{run.problems.join(" · ")}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Lessons({
  agent,
  language,
  languages,
  t,
}: {
  agent: AgentStats;
  language: Language;
  /** The content languages, for which work a lesson is about. */
  languages: ContentLanguage[];
  t: Strings;
}) {
  const applies = (code: string) =>
    code === "both" ? t.appliesBoth : t.appliesLanguage.replace("{name}", languageName(code, language));
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">{t.lessonsTitle}</h2>
      {agent.lessons.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">{t.noLessons}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {agent.lessons.map((lesson) => (
            <li key={lesson.id} className="flex items-start justify-between gap-3 text-sm">
              <span>
                <bdi>{language === "fa" ? lesson.textFa : lesson.textEn}</bdi>
                <span className="ms-2 text-xs text-ink-soft">
                  {lesson.source === "owner" ? t.fromYou : t.fromCoach}
                  {languages.length > 1 && ` · ${applies(lesson.appliesTo)}`}
                </span>
              </span>
              <ActionForm action={deleteLessonAction}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <SubmitButton pendingLabel={t.deleting}>{t.deleteLesson}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-cobalt">{t.addLesson}</summary>
        <ActionForm action={addLessonAction} resetOnSuccess className="mt-2 space-y-2">
          <input type="hidden" name="agent" value={agent.id} />
          <label className="block">
            <span className="mb-1 block text-xs text-ink-soft">{t.lessonLabel}</span>
            <textarea name="lesson" required rows={2} maxLength={300} dir="auto" className="field" placeholder={t.lessonPlaceholder} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-soft">{t.lessonLanguage}</span>
            <select name="appliesTo" defaultValue="both" dir="auto" className="field">
              <option value="both">{t.appliesBoth}</option>
              {languages.length > 1 &&
                languages.map((code) => (
                  <option key={code} value={code}>
                    {applies(code)}
                  </option>
                ))}
            </select>
          </label>
          <SubmitButton pendingLabel={t.addingLesson}>{t.saveLesson}</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
