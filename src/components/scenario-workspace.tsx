"use client";

import { useState } from "react";
import { approveScenarioAction, changeScenarioAction, saveScenarioAction } from "@/app/actions";
import type { ScenarioContent } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { hasPlaceholder } from "@/lib/scenario";
import { ActionForm, SubmitButton } from "./action-form";

function Field({
  name,
  label,
  defaultValue,
  rows = 3,
}: {
  name: string;
  label: string;
  defaultValue: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      <textarea name={name} defaultValue={defaultValue} rows={rows} dir="auto" className="field" />
    </label>
  );
}

/** Remount with key={version} so the fields and unsaved-changes state always match the current version. */
export function ScenarioWorkspace({
  ideaId,
  version,
  content,
  approved,
  t,
}: {
  ideaId: string;
  version: number;
  content: ScenarioContent;
  approved: boolean;
  t: Strings;
}) {
  // Approval must match what's on screen, so it stays locked while there are unsaved edits.
  const [dirty, setDirty] = useState(false);
  const hidden = (
    <>
      <input type="hidden" name="ideaId" value={ideaId} />
      <input type="hidden" name="version" value={version} />
    </>
  );

  return (
    <div className="space-y-5">
      <ActionForm action={saveScenarioAction} onInput={() => setDirty(true)} className="space-y-4 rounded-xl bg-paper p-5 md:p-6">
        {hidden}
        <Field name="title" label={t.scenarioTitle} defaultValue={content.title} rows={1} />
        <Field name="hook" label={t.hook} defaultValue={content.hook} rows={2} />
        <Field name="mainPoints" label={t.scenarioPoints} defaultValue={content.mainPoints.join("\n")} rows={7} />
        <Field name="angle" label={t.angle} defaultValue={content.angle} />
        <Field name="example" label={t.scenarioExample} defaultValue={content.example} />
        <Field name="callToAction" label={t.scenarioCta} defaultValue={content.callToAction} rows={2} />
        <SubmitButton pendingLabel={t.saving} disabled={!dirty}>
          {t.saveEdits}
        </SubmitButton>
      </ActionForm>

      {hasPlaceholder(content) && !dirty && (
        <p className="rounded-lg border-s-4 border-amber bg-paper p-3 text-sm">{t.placeholderWarning}</p>
      )}
      {dirty && (
        <p role="status" className="text-sm font-medium text-amber-deep">
          {t.unsaved}
        </p>
      )}

      {!approved && (
        <ActionForm action={approveScenarioAction}>
          {hidden}
          <SubmitButton pendingLabel={t.approving} className="btn-primary" disabled={dirty}>
            {t.approveScenario}
          </SubmitButton>
        </ActionForm>
      )}

      <ActionForm action={changeScenarioAction} className="space-y-2">
        {hidden}
        <label className="block">
          <span className="label mb-1 block">{t.aiChange}</span>
          <textarea name="request" required rows={2} maxLength={2000} dir="auto" className="field" placeholder={t.aiChangePlaceholder} />
        </label>
        <SubmitButton pendingLabel={t.applyingChange} disabled={dirty}>
          {t.applyChange}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
