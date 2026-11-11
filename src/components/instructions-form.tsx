import { saveInstructionsAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { INSTRUCTIONS_LENGTH, type Instructions, type InstructionsOwner } from "@/lib/agents/team";
import type { Strings } from "@/lib/i18n";
import { languageName, textDirection, uiLocale, type Language, type UiLanguage } from "@/lib/language";

/**
 * The boxes for one agent's instructions (or the general ones): one for all the work, and with two
 * content languages one more for each language on its own. Saving replaces every box, so all are always shown.
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
  const limit = INSTRUCTIONS_LENGTH.toLocaleString(uiLocale(ui));
  const boxes: { name: string; label: string; value: string; rows: number; dir: "ltr" | "rtl" | "auto" }[] = [
    { name: "both", label: t.instructionsBoth, value: instructions.both, rows, dir: "auto" },
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
    // Keyed by the save time, so the boxes show what was saved once a save goes through.
    <ActionForm key={instructions.updatedAt?.toISOString() ?? "new"} action={saveInstructionsAction} className="space-y-4">
      <input type="hidden" name="agent" value={owner} />
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
            {t.savedAt}: {instructions.updatedAt.toLocaleString(uiLocale(ui))}
          </span>
        )}
      </div>
    </ActionForm>
  );
}
