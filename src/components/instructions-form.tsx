import { saveInstructionsAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { INSTRUCTIONS_LENGTH } from "@/lib/agents/roster";
import type { Instructions } from "@/lib/agents/team";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, uiLocale, type Language, type UiLanguage } from "@/lib/language";

/**
 * Your rules for the whole team: one box for all the work, and with two content languages one more
 * for each language on its own. Every agent reads them, after its own Skill. Saving replaces every box.
 */
export function InstructionsForm({
  instructions,
  languages,
  ui,
  t,
  placeholder,
  rows = 6,
}: {
  instructions: Instructions & { updatedAt: Date | null };
  languages: Language[];
  ui: UiLanguage;
  t: Strings;
  placeholder?: string;
  rows?: number;
}) {
  const savedAt = instructions.updatedAt ? new Date(instructions.updatedAt).getTime() : 0;
  const limit = INSTRUCTIONS_LENGTH.toLocaleString(uiLocale(ui));
  const boxes = [
    { name: "both", label: t.instructionsBoth, value: instructions.both, rows, dir: "auto" as const },
    ...(languages.length > 1
      ? languages.map((code) => ({
          name: `lang:${code}`,
          label: t.instructionsLanguage.replace("{name}", languageName(code, ui)),
          value: instructions.byLanguage[code] ?? "",
          rows: 3,
          dir: textDirection(code),
        }))
      : []),
  ];

  return (
    <ActionForm key={savedAt} action={saveInstructionsAction} className="space-y-4">
      <input type="hidden" name="agent" value="general" />
      {boxes.map((box) => (
        <label key={box.name} className="block">
          <span className="mb-1 block text-sm font-medium">{box.label}</span>
          <textarea
            name={box.name}
            rows={box.rows}
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
  );
}
