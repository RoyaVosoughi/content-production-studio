import { z } from "zod";
import { StudioError } from "../errors";
import type { GenerateJson } from "./writer";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Free models, in the order to try them. The list changes over time: https://openrouter.ai/models?q=free
// Each backup runs on a different provider, so one busy provider can't stop all three. Models that
// think at length before answering (such as dots-3-note) are left out: on a long brief they can spend
// the whole answer on thinking and return no text.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "baidu/ernie-5.5-flash-preview:free",
];

/** Free models often wrap JSON in a code fence or add a sentence around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object in the answer");
  return JSON.parse(text.slice(start, end + 1));
}

/** Why one model gave no answer: "limit" when the free quota or a busy provider refused it. */
type Miss = { model: string; reason: "limit" | "offline" | "empty" | "error"; detail: string };

async function askModel(apiKey: string, model: string, system: string, prompt: string): Promise<string | Miss> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return { model, reason: "offline", detail: String(error) };
  }

  const body = await response.json().catch(() => null);
  // OpenRouter can also report a model failure inside a successful response.
  const status = body?.error?.code ?? response.status;
  if (status === 401) throw new StudioError("OpenRouter rejected the key. Check OPENROUTER_API_KEY in .env.local.");
  const detail = JSON.stringify(body?.error ?? { finish: body?.choices?.[0]?.finish_reason }).slice(0, 400);
  if (status === 429) return { model, reason: "limit", detail };
  const answer = body?.choices?.[0]?.message?.content;
  if (status !== 200) return { model, reason: "error", detail: `${status} ${detail}` };
  // A model that thinks at length can use up the whole answer and return no text.
  if (typeof answer !== "string" || !answer.trim()) return { model, reason: "empty", detail };
  return answer;
}

/** Tries each free model in turn, so one busy or silent model doesn't fail the whole step. */
async function requestAnswer(apiKey: string, system: string, prompt: string): Promise<string> {
  // One model, or several separated by commas to try in that order.
  const configured = (process.env.OPENROUTER_MODEL ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const misses: Miss[] = [];
  for (const model of configured.length > 0 ? configured : FREE_MODELS) {
    const result = await askModel(apiKey, model, system, prompt);
    if (typeof result === "string") return result;
    console.error(`OpenRouter: ${model} gave no answer (${result.reason}): ${result.detail}`);
    misses.push(result);
  }
  if (misses.every((miss) => miss.reason === "limit")) {
    throw new StudioError(
      "The free AI limit was reached: 20 requests a minute and 50 a day. Wait a minute and try again. If it still fails, try again tomorrow.",
    );
  }
  if (misses.every((miss) => miss.reason === "offline")) {
    throw new StudioError("Couldn't reach OpenRouter. Check your connection and try again.");
  }
  throw new StudioError("None of the free AI models answered, so nothing was saved. Please try again in a few minutes.");
}

export const openRouterJson: GenerateJson = async (system, prompt, schema) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new StudioError("Add OPENROUTER_API_KEY to .env.local to use the AI writer.");
  const shape = JSON.stringify(z.toJSONSchema(schema));
  const fullPrompt = `${prompt}\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${shape}`;

  // One retry, because free models sometimes return malformed JSON. Each attempt counts toward the daily limit.
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await requestAnswer(apiKey, system, fullPrompt);
    try {
      return schema.parse(extractJson(answer));
    } catch {
      // Falls through to the retry.
    }
  }
  throw new StudioError("The free AI model's answer was unusable, so nothing was saved. Please try again.");
};
