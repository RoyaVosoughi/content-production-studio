import Link from "next/link";
import { approveIdeaAction, refineIdeaAction, rejectIdeaAction } from "@/app/actions";
import type { IdeaSource } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { textDirection, type Language, type UiLanguage } from "@/lib/language";
import { ActionForm, SubmitButton } from "./action-form";
import { ManagerNote } from "./manager-note";

type CardIdea = {
  id: string;
  title: string;
  hook: string;
  angle: string;
  whyNow: string;
  pillar: string;
  sources: IdeaSource[];
  /** The title of the past idea whose results this one builds on. */
  buildsOnTitle?: string | null;
};

/** The idea is shown in its own language's direction, whatever the interface language. */
export function IdeaBody({ idea, t, language }: { idea: CardIdea; t: Strings; language: Language }) {
  return (
    <div lang={language} dir={textDirection(language)}>
      <p className="label">{idea.pillar}</p>
      <h3 className="mt-1 font-display text-2xl font-semibold leading-snug">{idea.hook}</h3>
      <p className="mt-1 font-medium text-ink-soft">{idea.title}</p>
      {idea.buildsOnTitle && (
        <p data-builds-on className="mt-3 rounded-md bg-mist px-3 py-2 text-sm">
          <span className="font-semibold text-cobalt">{t.buildsOn}</span> <bdi>{idea.buildsOnTitle}</bdi>
        </p>
      )}
      <dl className="mt-4 space-y-3 text-[0.95rem]">
        <div>
          <dt className="label">{t.angle}</dt>
          <dd>{idea.angle}</dd>
        </div>
        <div>
          <dt className="label">{t.whyNow}</dt>
          <dd>{idea.whyNow}</dd>
        </div>
        <div>
          <dt className="label">{t.sources}</dt>
          <dd>
            {idea.sources.length === 0 ? (
              <span className="text-amber-deep">{t.noSources}</span>
            ) : (
              <ul className="space-y-1">
                {idea.sources.map((source) => (
                  <SourceLink key={source.url} source={source} />
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SourceLink({ source }: { source: IdeaSource }) {
  // Links come from web search, so only ordinary web addresses become clickable.
  const clickable = /^https?:\/\//i.test(source.url);
  return (
    <li>
      {/* bdi keeps an English title readable inside Farsi text, and the reverse. */}
      <bdi>
        {clickable ? (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-cobalt underline underline-offset-2">
            {source.title}
          </a>
        ) : (
          source.title
        )}
      </bdi>
      {source.publishedDate && (
        <span className="label ms-2" dir="ltr">
          {new Date(source.publishedDate).toISOString().slice(0, 10)}
        </span>
      )}
    </li>
  );
}

export function ProposedIdeaCard({
  idea,
  ui,
  language,
  verdict,
  t,
}: {
  idea: CardIdea;
  ui: UiLanguage;
  language: Language;
  verdict?: Parameters<typeof ManagerNote>[0]["verdict"];
  t: Strings;
}) {
  return (
    <article className="rounded-xl bg-paper p-5 md:p-6">
      <IdeaBody idea={idea} t={t} language={language} />
      <div className="mt-4">
        <ManagerNote verdict={verdict} language={ui} t={t} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionForm action={approveIdeaAction}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <input type="hidden" name="ui" value={ui} />
          <SubmitButton pendingLabel={t.writingScenario} className="btn-primary">
            {t.approveIdea}
          </SubmitButton>
        </ActionForm>
        <ActionForm action={rejectIdeaAction}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <SubmitButton pendingLabel={t.rejecting}>{t.reject}</SubmitButton>
        </ActionForm>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-cobalt">{t.refine}</summary>
        <ActionForm action={refineIdeaAction} resetOnSuccess className="mt-2 space-y-2">
          <input type="hidden" name="ideaId" value={idea.id} />
          <label className="block">
            <span className="label mb-1 block">{t.refineLabel}</span>
            <textarea name="request" required rows={2} maxLength={2000} dir="auto" className="field" placeholder={t.refinePlaceholder} />
          </label>
          <SubmitButton pendingLabel={t.refining}>{t.applyRefine}</SubmitButton>
        </ActionForm>
      </details>
    </article>
  );
}

export function IdeaRow({ href, title, status }: { href?: string; title: string; status: string }) {
  const content = (
    <>
      <bdi className="min-w-0 font-medium">{title}</bdi>
      <span className="label shrink-0">{status}</span>
    </>
  );
  const className = "flex items-baseline justify-between gap-4 border-b border-mist py-3";
  return href ? (
    <Link href={href} className={`${className} hover:text-cobalt`}>
      {content}
    </Link>
  ) : (
    <div className={`${className} text-ink-soft`}>{content}</div>
  );
}
