import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { restoreScenarioAction, writeScenarioAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { IdeaMap } from "@/components/idea-map";
import { IdeaBody } from "@/components/idea-card";
import { ManagerNote } from "@/components/manager-note";
import { ScenarioWorkspace } from "@/components/scenario-workspace";
import { latestVerdicts } from "@/lib/agents/team";
import { ideas } from "@/lib/db/schema";
import { localize } from "@/lib/i18n";
import { textDirection } from "@/lib/language";
import { getScenario, getSibling } from "@/lib/studio";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function IdeaPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ writeError?: string }>;
}) {
  const { lang: param, id } = await params;
  const { writeError } = await searchParams;
  const { ui: lang, db, view, languages } = await readyPage(param);
  if (!UUID.test(id)) notFound();

  const [idea] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!idea) notFound();
  const sibling = await getSibling(db, idea);
  // The language switches keep the same id in the address, so send it to the version on screen.
  if (idea.language !== view && sibling?.language === view) redirect(`/${lang}/ideas/${sibling.id}`);

  const t = localize(lang, languages, idea.language);
  const dir = textDirection(idea.language);
  const scenario = await getScenario(db, id);
  const approved = scenario !== null && scenario.approvedVersion === scenario.currentVersion;
  const siblingScenario = sibling && (await getScenario(db, sibling.id));
  // The manager's note is about the draft it checked, so it shows only while that version is on screen.
  const verdict = (await latestVerdicts(db, [id])).get(id);
  const scenarioVerdict = verdict && scenario && verdict.version === scenario.currentVersion ? verdict : undefined;
  const origins = {
    ai: t.originAi,
    edit: t.originEdit,
    "ai-change": t.originAiChange,
    restore: t.originRestore,
  };

  return (
    <>
      <Link href={`/${lang}`} className="text-sm font-medium text-cobalt underline-offset-4 hover:underline">
        {t.backToIdeas}
      </Link>

      {/* The production line: the steps are a real sequence, and later ones arrive in later build stages. */}
      <IdeaMap db={db} ui={lang} t={t} languages={languages} view={view} idea={idea} sibling={sibling} here="scenario" />

      <details className="mt-6 rounded-xl bg-mist p-5" open={!scenario}>
        <summary className="cursor-pointer font-display text-lg font-semibold">
          <bdi lang={idea.language} dir={dir}>{idea.title}</bdi>
        </summary>
        <div className="mt-3">
          <IdeaBody idea={idea} t={t} language={idea.language} />
        </div>
      </details>

      <div className="mt-6">
        {scenario ? (
          <>
            <h1 className="mb-4 font-display text-3xl font-semibold">
              {t.stepScenario} <span className="label">· {t.version} {scenario.currentVersion}</span>
            </h1>
            {scenarioVerdict && (
              <div className="mb-4">
                <ManagerNote verdict={scenarioVerdict} language={lang} t={t} />
              </div>
            )}
            <ScenarioWorkspace
              key={scenario.currentVersion}
              ideaId={id}
              version={scenario.currentVersion}
              content={scenario.current.content}
              approved={approved}
              t={t}
            />
            {sibling && !siblingScenario && (
              <div className="mt-5 rounded-lg border-s-4 border-amber bg-paper p-4 text-sm">
                {writeError && (
                  <p role="alert" className="mb-2 font-medium text-danger">
                    {writeError}
                  </p>
                )}
                <p className="mb-3">{t.otherMissing}</p>
                <ActionForm action={writeScenarioAction}>
                  <input type="hidden" name="ideaId" value={id} />
                  <SubmitButton pendingLabel={t.writingScenario}>{t.otherWrite}</SubmitButton>
                </ActionForm>
              </div>
            )}
            {scenario.versions.length > 1 && (
              <section className="mt-8" aria-labelledby="history">
                <h2 id="history" className="font-display text-xl font-semibold">
                  {t.history}
                </h2>
                <ul className="mt-2">
                  {scenario.versions.map((version) => (
                    <li key={version.version} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist py-2">
                      <span>
                        {t.version} {version.version} · <span className="text-ink-soft">{origins[version.origin]}</span>
                      </span>
                      {version.version === scenario.currentVersion ? (
                        <span className="label">{t.current}</span>
                      ) : (
                        <ActionForm action={restoreScenarioAction}>
                          <input type="hidden" name="ideaId" value={id} />
                          <input type="hidden" name="version" value={scenario.currentVersion} />
                          <input type="hidden" name="restoreVersion" value={version.version} />
                          <SubmitButton pendingLabel={t.restoring}>{t.restore}</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* Last on the page: once approved, the next step is choosing platforms. */}
            {approved && (
              <div role="status" className="surface-raised mt-8 rounded-lg bg-deep p-4 text-ink">
                <p className="font-semibold">{t.approvedTitle.replace("{version}", String(scenario.currentVersion))}</p>
                {sibling && siblingScenario && siblingScenario.approvedVersion !== siblingScenario.currentVersion && (
                  <p className="mt-1 text-sm">{t.approvedOtherNote}</p>
                )}
                <Link href={`/${lang}/ideas/${id}/content`} className="btn mt-3 bg-paper !text-cobalt">
                  {t.goToContent}
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl bg-paper p-5 md:p-6">
            {writeError && (
              <p role="alert" className="mb-3 text-sm font-medium text-danger">
                {t.writeFailed} {writeError}
              </p>
            )}
            <p className="mb-3">{t.noScenarioBody}</p>
            <ActionForm action={writeScenarioAction}>
              <input type="hidden" name="ideaId" value={id} />
              <SubmitButton pendingLabel={t.writingScenario} className="btn-primary">
                {t.writeScenario}
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>
    </>
  );
}
