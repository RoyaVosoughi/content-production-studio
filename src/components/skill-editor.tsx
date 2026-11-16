"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { resetSkillAction, saveSkillAction, tailorSkillAction, type SkillDraftState } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import type { AgentId } from "@/lib/agents/roster";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type Language, type UiLanguage } from "@/lib/language";

/**
 * One agent's Skill: shown as a readable page, opened for editing with one click, saved by you.
 * "Fit to my brand" asks the AI for a draft, which only replaces the text on screen until you save.
 */
export function SkillEditor({
  agent,
  saved,
  custom,
  updatedAt,
  ownerName,
  language,
  limit,
  ui,
  t,
}: {
  agent: AgentId;
  saved: string;
  custom: boolean;
  updatedAt: Date | null;
  ownerName: string;
  /** The content language whose Brand Kit the AI fits the Skill to. */
  language: Language;
  limit: number;
  ui: UiLanguage;
  t: Strings;
}) {
  const [text, setText] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [beforeDraft, setBeforeDraft] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, tailor, tailoring] = useActionState<SkillDraftState, FormData>(tailorSkillAction, null);

  useEffect(() => {
    if (draft?.skill) {
      setBeforeDraft((previous) => previous ?? text);
      setText(draft.skill);
    }
    // Only a new draft replaces the text, never a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.at]);

  const changed = text.trim() !== saved.trim();
  const preview = text.replaceAll("{OWNER}", ownerName.trim() || t.skillYou);

  function askForDraft() {
    const data = new FormData();
    data.set("agent", agent);
    data.set("skill", text);
    data.set("language", language);
    data.set("ui", ui);
    startTransition(() => tailor(data));
  }

  return (
    <div className="space-y-4" data-skill-editor>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${custom ? "bg-cobalt/20 text-periwinkle" : "bg-mist text-ink-soft"}`}>
          {custom ? t.skillCustom : t.skillDefault}
          {custom && updatedAt && ` · ${new Date(updatedAt).toLocaleDateString(uiLocale(ui))}`}
        </span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(!editing)} aria-pressed={editing}>
            {editing ? t.skillPreview : t.skillEdit}
          </button>
          <button type="button" className="btn btn-quiet" onClick={askForDraft} disabled={tailoring}>
            <span className={tailoring ? "pending-pulse" : undefined} aria-live="polite">
              {tailoring ? t.skillTailoring : t.skillTailor}
            </span>
          </button>
        </div>
      </div>

      {draft?.error && !tailoring && (
        <p role="alert" className="text-sm font-medium text-danger">
          {draft.error}
        </p>
      )}
      {beforeDraft !== null && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border-s-4 border-cobalt bg-canvas p-3 text-sm">
          <p className="min-w-0 flex-1">
            {t.skillDraftReady}
            {draft?.changes && <span className="mt-1 block text-ink-soft">{draft.changes}</span>}
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setText(beforeDraft);
              setBeforeDraft(null);
            }}
          >
            {t.brandDiscard}
          </button>
        </div>
      )}

      {editing ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={18}
          maxLength={limit}
          dir="auto"
          aria-label={t.skillTitle}
          className="field font-[family-name:var(--font-jetbrains)] text-sm"
        />
      ) : (
        <div dir="auto" className="rounded-lg border border-mist bg-canvas p-4 md:p-5">
          <Markdown source={preview} className="skill-preview text-base" />
        </div>
      )}
      {editing && <p className="text-xs text-ink-soft">{t.skillEditHint.replace("{count}", limit.toLocaleString(uiLocale(ui)))}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <ActionForm action={saveSkillAction}>
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="skill" value={text} />
          <SubmitButton pendingLabel={t.saving} className="btn-primary" disabled={!changed}>
            {t.skillSave}
          </SubmitButton>
        </ActionForm>
        {changed && <span className="text-sm text-amber-deep">{t.skillUnsaved}</span>}
        {custom &&
          (confirmReset ? (
            <ActionForm action={resetSkillAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="agent" value={agent} />
              <span className="text-sm">{t.skillResetSure}</span>
              <SubmitButton pendingLabel={t.saving} className="btn-quiet">
                {t.skillResetYes}
              </SubmitButton>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(false)}>
                {t.cancel}
              </button>
            </ActionForm>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(true)}>
              {t.skillReset}
            </button>
          ))}
      </div>
    </div>
  );
}
