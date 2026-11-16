import type { AgentId } from "../agents/roster";
import { StudioError } from "../errors";
import { claudeJson } from "./claude";
import { AiUnavailableError } from "./errors";
import { geminiJson } from "./gemini";
import { openRouterJson } from "./openrouter";
import type { GenerateJson } from "./writer";

/**
 * Which AI answers each job, cheapest first. The studio is meant to cost nothing in daily use:
 *
 * - Writing (ideas, scenarios, posts): Gemini Flash, which writes best but has a small free allowance
 *   (about 20 requests a day), then Gemini Flash-Lite (about 500 a day), then OpenRouter's free models.
 * - Checking, teaching and setup (manager, coach, reading a brand file): Flash-Lite first, since these
 *   don't need the stronger writer.
 * - Claude only for the jobs named in CLAUDE_AGENTS (the video editor by default), and only when
 *   ANTHROPIC_API_KEY is set, because it costs money for every request.
 *
 * Free limits and model names change; the names can be set in .env.local without touching code.
 */
export type AiTask = AgentId | "setup";
export type Tier = "writer" | "light";

export const TIERS: Record<AiTask, Tier> = {
  scout: "writer",
  storyteller: "writer",
  telegram: "writer",
  linkedin: "writer",
  carousel: "writer",
  scriptwriter: "writer",
  blogger: "writer",
  editor: "writer",
  manager: "light",
  coach: "light",
  setup: "light",
};

export const DEFAULT_MODELS = { writer: "gemini-3.8-flash", light: "gemini-3.5-flash-lite" } as const;

/** One model to try. */
export type Step = { provider: "claude" | "gemini" | "openrouter"; model: string };

const env = (name: string) => process.env[name]?.trim() || "";

/** The jobs that may use Claude, from CLAUDE_AGENTS (comma separated). The video editor by default. */
export function claudeTasks(): string[] {
  const raw = process.env.CLAUDE_AGENTS;
  const list = raw === undefined ? ["editor"] : raw.split(",");
  return list.map((item) => item.trim()).filter(Boolean);
}

/** The models to try for a job, in order. */
export function modelChain(task: AiTask): Step[] {
  const writer = env("GEMINI_WRITER_MODEL") || DEFAULT_MODELS.writer;
  const light = env("GEMINI_LIGHT_MODEL") || DEFAULT_MODELS.light;
  const steps: Step[] = [];
  if (env("ANTHROPIC_API_KEY") && claudeTasks().includes(task)) steps.push({ provider: "claude", model: "claude" });
  if (env("GEMINI_API_KEY")) {
    const models = TIERS[task] === "writer" ? [writer, light] : [light];
    for (const model of [...new Set(models)]) steps.push({ provider: "gemini", model });
  }
  if (env("OPENROUTER_API_KEY")) steps.push({ provider: "openrouter", model: "free" });
  return steps;
}

function generatorFor(step: Step): GenerateJson {
  if (step.provider === "claude") return claudeJson;
  if (step.provider === "gemini") return geminiJson(step.model);
  return openRouterJson;
}

/**
 * Asks the first model in line, and moves to the next only when one can't answer right now (its free
 * limit is used up, it's busy, or it's offline). A real problem, such as a wrong key, stops at once.
 */
export function routedJson(task: AiTask): GenerateJson {
  return async (system, prompt, schema) => {
    const chain = modelChain(task);
    if (chain.length === 0) {
      throw new StudioError("Add a free GEMINI_API_KEY (or OPENROUTER_API_KEY) to .env.local, then restart the studio.");
    }
    let last: AiUnavailableError | null = null;
    for (const step of chain) {
      try {
        return await generatorFor(step)(system, prompt, schema);
      } catch (error) {
        if (!(error instanceof AiUnavailableError)) throw error;
        console.error(`AI ${step.provider}:${step.model} couldn't answer (${error.reason}): ${error.message}`);
        last = error;
      }
    }
    if (last?.reason === "limit") {
      throw new StudioError("Today's free AI allowance is used up on every model. Try again later, or tomorrow.");
    }
    throw new StudioError(last?.message ?? "No AI model answered, so nothing was saved. Please try again in a few minutes.");
  };
}

/** Every AI job goes through the routing, picked by the agent doing it. */
export const routedGenerate: GenerateJson = (system, prompt, schema, meta) => routedJson(meta?.agent ?? "setup")(system, prompt, schema);
