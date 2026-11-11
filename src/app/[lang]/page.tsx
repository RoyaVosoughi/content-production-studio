import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { readyPage } from "@/lib/view";
import { generateIdeasAction } from "../actions";

export const dynamic = "force-dynamic";

/** The studio's first page: one question. The map of the team opens on its own page once you ask. */
export default async function StudioPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, view } = await readyPage(param);

  const missingKeys = [
    ...(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY ? [] : ["OPENROUTER_API_KEY"]),
    ...(process.env.TAVILY_API_KEY ? [] : ["TAVILY_API_KEY"]),
  ];

  return (
    <>
      <ActionForm action={generateIdeasAction} resetOnSuccess className="ask-box">
        <input type="hidden" name="language" value={view} />
        <input type="hidden" name="ui" value={lang} />
        <h1 id="ask-title" className="font-display text-4xl font-semibold leading-tight md:text-5xl">
          {t.askTitle}
        </h1>
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/${lang}/map`} className="text-sm text-ink-soft underline underline-offset-2 hover:text-cobalt">
            {t.askOpenMap}
          </Link>
          <SubmitButton pendingLabel={t.generating} className="btn-primary">
            {t.askButton}
          </SubmitButton>
        </div>
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
