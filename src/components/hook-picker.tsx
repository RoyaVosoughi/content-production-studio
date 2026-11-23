"use client";

import { pickHookAction, suggestHooksAction } from "@/app/actions";
import type { PieceContent } from "@/lib/db/schema";
import { hookKindOf } from "@/lib/hooks";
import type { Strings } from "@/lib/i18n";
import type { Platform } from "@/lib/platforms";
import { ActionForm, SubmitButton } from "./action-form";

/**
 * The post's three hooks, with the one in use marked. Picking one opens the post with it as a new
 * version, and tells the team which kind you chose. Works on the saved post, so it waits for a save.
 */
export function HookPicker({
  platform,
  content,
  hidden,
  dirty,
  t,
}: {
  platform: Platform;
  content: PieceContent;
  hidden: React.ReactNode;
  dirty: boolean;
  t: Strings;
}) {
  const options = content.hooks ?? [];
  const inUse = hookKindOf(platform, content);
  return (
    <section data-hooks className="space-y-3 rounded-lg border border-mist p-3 text-sm" aria-label={t.hooks.title}>
      <div>
        <p className="label">{t.hooks.title}</p>
        <p className="mt-1 text-ink-soft">{options.length ? t.hooks.hint : t.hooks.none}</p>
      </div>
      {options.length > 0 && (
        <ul className="space-y-2">
          {options.map((option, index) => {
            const active = option.kind === inUse;
            return (
              <li
                key={`${option.kind}-${index}`}
                data-hook={option.kind}
                data-active={active || undefined}
                className={`flex flex-col gap-2 rounded-md p-2.5 sm:flex-row sm:items-center sm:justify-between ${active ? "bg-mist" : "bg-canvas"}`}
              >
                <div className="min-w-0">
                  <span className="label">{t.hooks.kinds[option.kind]}</span>
                  <p dir="auto" className="mt-0.5 font-medium">
                    {option.text}
                  </p>
                </div>
                {active ? (
                  <span className="label shrink-0 text-cobalt">{t.hooks.inUse}</span>
                ) : (
                  <ActionForm action={pickHookAction} className="shrink-0">
                    {hidden}
                    <input type="hidden" name="hook" value={index} />
                    <SubmitButton pendingLabel={t.hooks.using} disabled={dirty}>
                      {t.hooks.use}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {options.length > 0 && !inUse && <p className="text-ink-soft">{t.hooks.own}</p>}
      <ActionForm action={suggestHooksAction}>
        {hidden}
        <SubmitButton pendingLabel={t.hooks.suggesting} disabled={dirty}>
          {options.length ? t.hooks.again : t.hooks.suggest}
        </SubmitButton>
      </ActionForm>
      {dirty && <p className="text-ink-soft">{t.hooks.saveFirst}</p>}
    </section>
  );
}
