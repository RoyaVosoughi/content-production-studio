import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { StudioError } from "../errors";
import type { GenerateJson } from "./writer";

const MODEL = "claude-opus-5-5";

export const claudeJson: GenerateJson = async (system, prompt, schema) => {
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(schema) },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") {
      throw new StudioError("Claude declined this request. Try rewording it.");
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      throw new StudioError("Claude's answer was incomplete, so nothing was saved. Please try again.");
    }
    return response.parsed_output as ReturnType<typeof schema.parse>;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new StudioError("Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.local.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new StudioError("Claude's rate limit was reached. Wait a minute and try again.");
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new StudioError("Couldn't reach Claude. Check your connection and try again.");
    }
    throw error;
  }
};
