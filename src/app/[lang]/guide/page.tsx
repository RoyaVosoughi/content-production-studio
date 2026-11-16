import Link from "next/link";
import { AGENTS } from "@/lib/agents/roster";
import type { Strings } from "@/lib/i18n";
import { uiLocale } from "@/lib/language";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

type StepId = keyof Strings["guide"]["steps"];

/** The production line in order, with who does each step. */
const LINE: { id: StepId; who: (t: Strings, ui: "en" | "fa") => string }[] = [
  { id: "brand", who: (t) => t.navBrand },
  { id: "scout", who: (_, ui) => AGENTS.scout.name[ui] },
  { id: "storyteller", who: (_, ui) => AGENTS.storyteller.name[ui] },
  {
    id: "writers",
    who: (_, ui) => [AGENTS.telegram, AGENTS.linkedin, AGENTS.carousel, AGENTS.blogger, AGENTS.scriptwriter].map((agent) => agent.name[ui]).join(" · "),
  },
  { id: "manager", who: (_, ui) => AGENTS.manager.name[ui] },
  { id: "editor", who: (_, ui) => AGENTS.editor.name[ui] },
  { id: "publish", who: (t) => t.steps.publish },
  { id: "coach", who: (_, ui) => AGENTS.coach.name[ui] },
];

/** A one-page guide to the studio: each step of the line, what it gets, what it gives and what you do. */
export default async function GuidePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t } = await readyPage(param);
  const guide = t.guide;
  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{guide.title}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{guide.intro}</p>

      <ol className="mt-8 space-y-3" data-guide-line>
        {LINE.map((step, index) => {
          const text = guide.steps[step.id];
          return (
            <li key={step.id} className="grid gap-3 rounded-xl bg-paper p-4 md:grid-cols-[2.5rem_1fr] md:p-5">
              <span aria-hidden className="font-display text-2xl font-semibold text-cobalt">
                {(index + 1).toLocaleString(uiLocale(lang))}
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold">{step.who(t, lang)}</h2>
                <dl className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                  <div>
                    <dt className="label">{guide.gets}</dt>
                    <dd>{text.gets}</dd>
                  </div>
                  <div>
                    <dt className="label">{guide.gives}</dt>
                    <dd>{text.gives}</dd>
                  </div>
                  <div>
                    <dt className="label">{guide.you}</dt>
                    <dd className="font-medium">{text.you}</dd>
                  </div>
                </dl>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="mt-10 max-w-2xl">
        <h2 className="font-display text-2xl font-semibold">{guide.skillsTitle}</h2>
        <p className="mt-2 text-ink-soft">{guide.skillsBody}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/${lang}`} className="btn btn-primary">
            {guide.linkStudio}
          </Link>
          <Link href={`/${lang}/team`} className="btn btn-quiet">
            {guide.linkTeam}
          </Link>
        </div>
      </section>
    </>
  );
}
