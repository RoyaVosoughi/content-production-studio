import { z } from "zod";
import { StudioError } from "../errors";
import { AiUnavailableError } from "./errors";
import { extractJson } from "./openrouter";
import { recordRequest } from "./usage";
import type { GenerateJson } from "./writer";

/** Google's Gemini API. A free key from https://aistudio.google.com/apikey covers everyday use. */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

/** The text of a finished interaction: the model's output steps, joined. */
export function interactionText(body: unknown): string {
  const data = body as { output_text?: unknown; steps?: { type?: string; content?: { type?: string; text?: string }[] }[] } | null;
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

async function ask(apiKey: string, model: string, system: string, prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json", "Api-Revision": API_REVISION },
      body: JSON.stringify({
        model,
        system_instruction: system,
        input: prompt,
        response_format: { type: "text", mime_type: "application/json" },
        generation_config: { max_output_tokens: 16000 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new AiUnavailableError("Couldn't reach Gemini. Check your connection and try again.", "offline");
  } finally {
    await recordRequest(`gemini:${model}`);
  }

  const body = await response.json().catch(() => null);
  if (response.status === 400 && /api key/i.test(JSON.stringify(body))) {
    throw new StudioError("Gemini rejected the key. Check GEMINI_API_KEY in .env.local.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new StudioError("Gemini rejected the key. Check GEMINI_API_KEY in .env.local.");
  }
  if (response.status === 429) {
    throw new AiUnavailableError(`Gemini's free limit for ${model} is used up for now.`, "limit");
  }
  if (response.status === 404) {
    // A retired or misspelled model name: the next model in line can still answer.
    throw new AiUnavailableError(`Gemini doesn't offer ${model}. Check the model names in .env.local.`, "busy");
  }
  if (response.status >= 500) {
    throw new AiUnavailableError("Gemini is busy right now.", "busy");
  }
  if (!response.ok) {
    console.error(`Gemini ${model}: ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
    throw new AiUnavailableError("Gemini couldn't answer this request.", "busy");
  }
  const status = (body as { status?: string } | null)?.status;
  const text = interactionText(body);
  if ((status && status !== "completed") || !text.trim()) {
    console.error(`Gemini ${model}: finished as ${status ?? "unknown"} with ${text.length} characters`);
    throw new AiUnavailableError("Gemini's answer was cut short.", "busy");
  }
  return text;
}

/** Asks one Gemini model for JSON matching the schema, with one retry for an unusable answer. */
export function geminiJson(model: string): GenerateJson {
  return async (system, prompt, schema) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AiUnavailableError("No GEMINI_API_KEY is set.", "offline");
    const shape = JSON.stringify(z.toJSONSchema(schema));
    const fullPrompt = `${prompt}\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${shape}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await ask(apiKey, model, system, fullPrompt);
      try {
        return schema.parse(extractJson(answer));
      } catch {
        // Falls through to the retry.
      }
    }
    throw new AiUnavailableError(`Gemini ${model}'s answer was unusable.`, "busy");
  };
}
