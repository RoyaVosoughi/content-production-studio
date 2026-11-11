"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { readInstructionsFileAction, saveInstructionsAction, type InstructionsFileState } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { INSTRUCTIONS_LENGTH, isAgentId } from "@/lib/agents/roster";
import type { Instructions, InstructionsOwner } from "@/lib/agents/team";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, uiLocale, type Language, type UiLanguage } from "@/lib/language";

const ACCEPT = ".pdf,.docx,.txt,.md";

/**
 * The boxes for one agent's instructions (or the general ones): one for all the work, and with two
 * content languages one more for each language on its own. Saving replaces every box, so all are always shown.
 * An agent's instructions can also come from an uploaded file: the AI fills the boxes, and nothing
 * changes until you save.
 */
export function InstructionsForm({
  owner,
  instructions,
  languages,
  ui,
  t,
  placeholder,
  rows = 6,
}: {
  owner: InstructionsOwner;
  instructions: Instructions & { updatedAt: Date | null };
  languages: Language[];
  ui: UiLanguage;
  t: Strings;
  placeholder?: string;
  rows?: number;
}) {
  const [read, readAction, reading] = useActionState<InstructionsFileState, FormData>(readInstructionsFileAction, null);
  // The proposal on screen. Cleared once it's saved or discarded; a new upload brings a new one.
  const [shown, setShown] = useState<{ state: InstructionsFileState; at: number } | null>(null);
  const fileForm = useRef<HTMLFormElement>(null);
  const savedAt = instructions.updatedAt ? new Date(instructions.updatedAt).getTime() : 0;

  useEffect(() => {
    if (read?.proposal) setShown({ state: read, at: Date.now() });
  }, [read]);
  // A save brings a new save time: the boxes now hold what was saved, so the proposal is done.
  useEffect(() => {
    setShown(null);
    fileForm.current?.reset();
  }, [savedAt]);

  const proposal = shown?.state?.proposal;
  const values = proposal?.found ? proposal : instructions;
  const limit = INSTRUCTIONS_LENGTH.toLocaleString(uiLocale(ui));
  const boxes: { name: string; label: string; value: string; rows: number; dir: "ltr" | "rtl" | "auto" }[] = [
    { name: "both", label: t.instructionsBoth, value: values.both, rows, dir: "auto" },
    // Agents have one box. A language box shows only while it still holds older text, so nothing
    // an agent follows is ever hidden; empty it and save, and it's gone. The general instructions keep theirs.
    ...(languages.length > 1
      ? languages
          .filter((code) => !isAgentId(owner) || values.byLanguage[code]?.trim())
          .map((code) => ({
          name: `lang:${code}`,
          label: t.instructionsLanguage.replace("{name}", languageName(code, ui)),
          value: values.byLanguage[code] ?? "",
          rows: 3,
          dir: textDirection(code),
        }))
      : []),
  ];

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reading) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => readAction(data));
  }

  const fileName = <bdi>{shown?.state?.fileName}</bdi>;

  return (
    <div className="space-y-4">
      {/* The general instructions have their own upload: the brand file in the same card. */}
      {isAgentId(owner) && (
        <form ref={fileForm} onSubmit={upload} className="space-y-2 rounded-lg border border-dashed border-mist p-3" data-instructions-file>
          <p className="text-sm font-medium">{t.instructionsFileTitle}</p>
          <input type="hidden" name="agent" value={owner} />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="instructionsFile"
              accept={ACCEPT}
              required
              disabled={reading}
              aria-label={t.instructionsFileTitle}
              className="max-w-full text-sm"
            />
            <button type="submit" className="btn btn-quiet" disabled={reading}>
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
      )}

      {proposal && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border-s-4 border-cobalt bg-canvas p-3 text-sm">
          <p className="min-w-0 flex-1">
            {proposal.found ? (
              <>
                {t.instructionsFileFilled.split("{file}")[0]}
                {fileName}
                {t.instructionsFileFilled.split("{file}")[1]}
              </>
            ) : (
              <>
                {t.instructionsFileNothing.split("{file}")[0]}
                {fileName}
                {t.instructionsFileNothing.split("{file}")[1]}
              </>
            )}
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setShown(null);
              fileForm.current?.reset();
            }}
          >
            {proposal.found ? t.brandDiscard : t.instructionsFileOk}
          </button>
        </div>
      )}

      {/* Keyed by the save time and the proposal, so the boxes show what was saved or what the file gave. */}
      <ActionForm key={`${savedAt}-${shown?.at ?? 0}`} action={saveInstructionsAction} className="space-y-4">
        <input type="hidden" name="agent" value={owner} />
        {boxes.map((box) => (
          <label key={box.name} className="block">
            <span className="mb-1 block text-sm font-medium">{box.label}</span>
            <textarea
              name={box.name}
              rows={proposal?.found ? Math.max(box.rows, 8) : box.rows}
              maxLength={INSTRUCTIONS_LENGTH}
              defaultValue={box.value}
              dir={box.dir}
              className="field"
              placeholder={box.name === "both" ? placeholder : undefined}
            />
          </label>
        ))}
        <p className="text-xs text-ink-soft">{t.instructionsLimit.replace("{count}", limit)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel={t.savingInstructions} className="btn-primary">
            {t.saveInstructions}
          </SubmitButton>
          {instructions.updatedAt && (
            <span className="label">
              {t.savedAt}: {new Date(instructions.updatedAt).toLocaleString(uiLocale(ui))}
            </span>
          )}
        </div>
      </ActionForm>
    </div>
  );
}
