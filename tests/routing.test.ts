import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { interactionText } from "@/lib/ai/gemini";
import { modelChain } from "@/lib/ai/routing";

const KEYS = ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_AGENTS", "GEMINI_WRITER_MODEL", "GEMINI_LIGHT_MODEL"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

const names = (task: Parameters<typeof modelChain>[0]) => modelChain(task).map((step) => `${step.provider}:${step.model}`);

describe("which model each team member uses", () => {
  it("writers try Gemini Flash, then Flash-Lite, then OpenRouter's free models", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.OPENROUTER_API_KEY = "o";
    expect(names("linkedin")).toEqual(["gemini:gemini-3.8-flash", "gemini:gemini-3.5-flash-lite", "openrouter:free"]);
  });

  it("the manager, coach and setup go straight to the light model", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(names("manager")).toEqual(["gemini:gemini-3.5-flash-lite"]);
    expect(names("setup")).toEqual(["gemini:gemini-3.5-flash-lite"]);
  });

  it("uses Claude only for the video editor by default, and only with its key", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(names("editor")[0]).toBe("gemini:gemini-3.8-flash");
    process.env.ANTHROPIC_API_KEY = "a";
    expect(names("editor")[0]).toBe("claude:claude");
    expect(names("linkedin")[0]).toBe("gemini:gemini-3.8-flash");
  });

  it("CLAUDE_AGENTS can turn Claude off or give it to others", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.CLAUDE_AGENTS = "";
    expect(names("editor")).toEqual([]);
    process.env.CLAUDE_AGENTS = "storyteller, editor";
    expect(names("storyteller")).toEqual(["claude:claude"]);
  });

  it("model names can be changed in .env.local", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.GEMINI_WRITER_MODEL = "gemini-flash-latest";
    process.env.GEMINI_LIGHT_MODEL = "gemini-flash-latest";
    expect(names("scout")).toEqual(["gemini:gemini-flash-latest"]);
  });

  it("works with only OpenRouter, as before", () => {
    process.env.OPENROUTER_API_KEY = "o";
    expect(names("scout")).toEqual(["openrouter:free"]);
  });
});

describe("Gemini answers", () => {
  it("reads the text from the model's output steps", () => {
    const body = {
      status: "completed",
      steps: [
        { type: "thought", content: [{ type: "text", text: "thinking" }] },
        { type: "model_output", content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }] },
      ],
    };
    expect(interactionText(body)).toBe('{"a":1}');
    expect(interactionText({ output_text: "hi" })).toBe("hi");
    expect(interactionText(null)).toBe("");
  });
});

describe("falling back when a free allowance runs out", () => {
  const schema = z.object({ ok: z.boolean() });
  const geminiAnswer = (text: string) =>
    new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }] }), { status: 200 });

  async function routed() {
    vi.doMock("@/lib/ai/usage", () => ({ recordRequest: async () => {} }));
    return (await import("@/lib/ai/routing")).routedJson;
  }

  it("moves from Flash to Flash-Lite when Flash's limit is used up", async () => {
    process.env.GEMINI_API_KEY = "g";
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      asked.push(model);
      return model === "gemini-3.8-flash" ? new Response("{}", { status: 429 }) : geminiAnswer('{"ok":true}');
    });
    const routedJson = await routed();
    await expect(routedJson("linkedin")("system", "prompt", schema)).resolves.toEqual({ ok: true });
    expect(asked).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("stops at once on a wrong key instead of trying other models", async () => {
    process.env.GEMINI_API_KEY = "bad";
    process.env.OPENROUTER_API_KEY = "o";
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 });
    });
    const routedJson = await routed();
    await expect(routedJson("scout")("system", "prompt", schema)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(calls).toBe(1);
  });

  it("says plainly when every free allowance is used up", async () => {
    process.env.GEMINI_API_KEY = "g";
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 429 }));
    const routedJson = await routed();
    await expect(routedJson("coach")("system", "prompt", schema)).rejects.toThrow(/free AI allowance is used up/);
  });

  it("asks for a key when none is set", async () => {
    const routedJson = await routed();
    await expect(routedJson("scout")("system", "prompt", schema)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
