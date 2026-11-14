import Link from "next/link";
import { learnNowAction, setManagerAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatNumber, Stat, type AgentStats } from "@/components/team-parts";
import { AGENTS, type AgentId } from "@/lib/agents/roster";
import { LEARN_AFTER, teamOverview } from "@/lib/agents/team";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage as Language } from "@/lib/language";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

/** The order agents appear in: how an idea travels through the team, then the manager and the coach. */
const ORDER: AgentId[] = [
  "scout",
  "storyteller",
  "telegram",
  "linkedin",
  "carousel",
  "blogger",
  "scriptwriter",
  "editor",
  "manager",
  "coach",
];

export default async function TeamPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, db } = await readyPage(param);
  const overview = await teamOverview(db);
  const byId = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const number = formatNumber(lang);
  const { settings } = overview;

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{t.teamTitle}</h1>
      <p className="mt-3 max-w-xl text-ink-soft">{t.teamIntro}</p>

      <p className="mt-4 max-w-2xl rounded-lg border-s-4 border-cobalt bg-paper p-3 text-sm">
        {t.teamSkillsNote}{" "}
        <Link href={`/${lang}/brand#team-rules`} className="text-cobalt underline underline-offset-2">
          {t.teamRulesLink}
        </Link>
      </p>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {ORDER.map((id) => {
          const agent = byId.get(id)!;
          return (
            <article key={id} className="flex flex-col rounded-xl bg-paper p-5 md:p-6">
              <h2 className="font-display text-xl font-semibold">{AGENTS[id].name[lang]}</h2>
              <p className="mt-1 text-ink-soft">{AGENTS[id].job[lang]}</p>

              {id === "manager" && (
                <div className="mt-3">
                  <p className="font-medium">{settings.managerEnabled ? t.managerOn : t.managerOff}</p>
                  <dl className="mt-3 flex gap-6">
                    <Stat label={t.statReviews} value={number(overview.reviews)} />
                    <Stat label={t.statMissed} value={number(agent.missed)} />
                  </dl>
                  <p className="mt-3 text-sm text-ink-soft">{t.managerHint}</p>
                  <ActionForm action={setManagerAction} className="mt-3">
                    <input type="hidden" name="enabled" value={settings.managerEnabled ? "no" : "yes"} />
                    <SubmitButton pendingLabel={t.switching} className="btn-quiet">
                      {settings.managerEnabled ? t.pauseManager : t.resumeManager}
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}

              {id === "coach" && (
                <div className="mt-3 text-sm">
                  <p className="text-base">
                    {t.coachPending.replace("{count}", number(overview.pending)).replace("{after}", number(LEARN_AFTER))}
                  </p>
                  {settings.lastLearnedAt ? (
                    <>
                      <p className="label mt-2">
                        {t.coachLast}: {settings.lastLearnedAt.toLocaleString(lang === "fa" ? "fa-IR" : "en-GB")}
                      </p>
                      {settings.lastLearnSummary && <p className="mt-1">{settings.lastLearnSummary[lang]}</p>}
                    </>
                  ) : (
                    <p className="mt-2 text-ink-soft">{t.coachNever}</p>
                  )}
                  {settings.lastLearnError && (
                    <p className="mt-2 text-danger">
                      {t.coachError} {settings.lastLearnError}
                    </p>
                  )}
                  <ActionForm action={learnNowAction} className="mt-3">
                    <SubmitButton pendingLabel={t.learning} className="btn-quiet" disabled={overview.pending === 0}>
                      {t.learnNow}
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}

              <div className="mt-auto">
                <SpaceLink agent={agent} language={lang} t={t} />
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

/** How many lessons this agent has learned, and the way into its own space. */
function SpaceLink({ agent, language, t }: { agent: AgentStats; language: Language; t: Strings }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
      <span className="text-sm text-ink-soft">
        {agent.customSkill ? t.skillCustom : t.skillDefault}
        {agent.lessons.length > 0 && ` · ${t.lessonsTitle}: ${formatNumber(language)(agent.lessons.length)}`}
      </span>
      <Link href={`/${language}/team/${agent.id}`} className="btn btn-quiet">
        {t.openSpace}
      </Link>
    </div>
  );
}
