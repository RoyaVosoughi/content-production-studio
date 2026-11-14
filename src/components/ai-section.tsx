import { AGENT_IDS, AGENTS } from "@/lib/agents/roster";
import { DEFAULT_MODELS, modelChain, type Step } from "@/lib/ai/routing";
import { todaysUsage } from "@/lib/ai/usage";
import type { Db } from "@/lib/db/client";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";

/** Roughly how many free requests a day Google allows for the default models, as of late 2026. */
const FREE_PER_DAY: Record<string, number> = {
  [`gemini:${DEFAULT_MODELS.writer}`]: 20,
  [`gemini:${DEFAULT_MODELS.light}`]: 500,
};

function stepName(step: Step, t: Strings): string {
  if (step.provider === "claude") return `Claude (${t.aiPaid})`;
  if (step.provider === "openrouter") return `OpenRouter (${t.aiFree})`;
  return step.model;
}

/** The AI card on the Connections page: which keys are set, who uses which model, and today's use. */
export async function AiSection({ db, ui, t }: { db: Db; ui: UiLanguage; t: Strings }) {
  const usage = await todaysUsage(db);
  const keys = [
    { name: "GEMINI_API_KEY", set: Boolean(process.env.GEMINI_API_KEY), note: t.aiGeminiNote },
    { name: "OPENROUTER_API_KEY", set: Boolean(process.env.OPENROUTER_API_KEY), note: t.aiOpenRouterNote },
    { name: "ANTHROPIC_API_KEY", set: Boolean(process.env.ANTHROPIC_API_KEY), note: t.aiClaudeNote },
  ];
  const ready = keys[0].set || keys[1].set;

  return (
    <section className="space-y-4 rounded-xl bg-paper p-5 md:p-6" data-connection="ai">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{t.aiTitle}</h2>
        <span className={`text-sm font-semibold ${ready ? "text-cobalt" : "text-danger"}`}>{ready ? t.connected : t.needsAttention}</span>
      </div>
      <p className="text-sm text-ink-soft">{t.aiIntro}</p>

      <ul className="space-y-1 text-sm">
        {keys.map((key) => (
          <li key={key.name}>
            <span dir="ltr" className="font-[family-name:var(--font-jetbrains)]">
              {key.name}
            </span>
            : <span className={key.set ? "text-cobalt" : "text-ink-soft"}>{key.set ? t.aiKeySet : t.aiKeyNotSet}</span>
            <span className="text-ink-soft"> · {key.note}</span>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="font-semibold">{t.aiWhoUses}</h3>
        <ul className="mt-1 divide-y divide-mist text-sm">
          {AGENT_IDS.map((agent) => {
            const chain = modelChain(agent);
            return (
              <li key={agent} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                <span>{AGENTS[agent].name[ui]}</span>
                <span dir="ltr" className="text-ink-soft">
                  {chain.length ? chain.map((step) => stepName(step, t)).join(" → ") : t.aiChainNone}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold">{t.aiUsageToday}</h3>
        {usage.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">{t.aiNoUsage}</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm">
            {usage.map((row) => (
              <li key={row.model} dir="ltr" className="text-start">
                {row.model.replace(/^gemini:/, "")}: {row.requests}
                {FREE_PER_DAY[row.model] ? ` / ~${FREE_PER_DAY[row.model]}` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-ink-soft">{t.aiLimitsNote}</p>
      </div>
      <p className="text-sm text-ink-soft">{t.aiPrivacyNote}</p>
    </section>
  );
}
