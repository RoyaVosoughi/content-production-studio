import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorSamples } from "@/components/editor-samples-list";
import { SkillEditor } from "@/components/skill-editor";
import { AgentNumbers, Lessons, RecentNotes } from "@/components/team-parts";
import { AGENTS, isAgentId, LEARNING_AGENTS } from "@/lib/agents/roster";
import { getSkill, SKILL_LENGTH } from "@/lib/agents/skills";
import { teamOverview } from "@/lib/agents/team";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

/** One agent's own space: its Skill, how it's doing, and what it has learned. */
export default async function AgentSpacePage({ params }: { params: Promise<{ lang: string; agent: string }> }) {
  const { lang: param, agent: id } = await params;
  const { ui: lang, t, db, languages, view, profile: owner } = await readyPage(param);
  if (!isAgentId(id)) notFound();
  const [overview, skill] = await Promise.all([teamOverview(db), getSkill(db, id)]);
  const agent = overview.agents.find((entry) => entry.id === id)!;
  const profile = AGENTS[id];

  return (
    <>
      <Link href={`/${lang}/team`} className="text-sm font-medium text-cobalt">
        {t.backToTeam}
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">{profile.name[lang]}</h1>
      <p className="mt-3 max-w-xl text-ink-soft">{profile.job[lang]}</p>
      <p className="mt-2 max-w-xl text-sm text-ink-soft">{t.spaceIntro.replace("{name}", profile.name[lang])}</p>

      <section className="mt-8 rounded-xl bg-paper p-5 md:p-6">
        <h2 className="font-display text-xl font-semibold">{t.skillTitle}</h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-ink-soft">{t.skillIntro}</p>
        <SkillEditor
          key={skill.updatedAt?.getTime() ?? (skill.custom ? "custom" : "default")}
          agent={id}
          saved={skill.text}
          custom={skill.custom}
          updatedAt={skill.updatedAt}
          ownerName={owner.name}
          language={view}
          limit={SKILL_LENGTH}
          ui={lang}
          t={t}
        />
      </section>

      {id === "editor" && <EditorSamples language={lang} speech={languages[0]} t={t} />}

      {/* The coach writes the lessons and nobody checks its work, so it has neither numbers nor lessons. */}
      {LEARNING_AGENTS.includes(id) && (
        <>
          <section className="mt-6 rounded-xl bg-paper p-5 md:p-6">
            <h2 className="mb-4 font-display text-xl font-semibold">{t.statsTitle}</h2>
            <AgentNumbers agent={agent} language={lang} t={t} />
            <RecentNotes agent={agent} language={lang} t={t} />
          </section>
          <section className="mt-6 rounded-xl bg-paper p-5 md:p-6">
            <Lessons agent={agent} language={lang} languages={languages} t={t} />
          </section>
        </>
      )}
    </>
  );
}
