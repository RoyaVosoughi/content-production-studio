import { describe, expect, it } from "vitest";
import { loadEditPrompts, parseEditPrompts, selectEditPrompts } from "@/lib/agents/editor/edit-prompts";
import { createWriter, type GenerateJson } from "@/lib/ai/writer";
import { EXAMPLE_BRAND } from "./fixtures/brand";

const ids = (asked: string) => selectEditPrompts(loadEditPrompts(), asked).map((prompt) => prompt.id);
const ALWAYS = ["silence-cuts", "hook-first", "read-as-text", "length-follows", "keep-original"];

describe("the prompt of edits file", () => {
  it("reads every prompt with its title, keywords and body", () => {
    const prompts = loadEditPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(23);
    expect(new Set(prompts.map((prompt) => prompt.id)).size).toBe(prompts.length);
    for (const prompt of prompts) {
      expect(prompt.title).not.toBe("");
      expect(prompt.body).not.toBe("");
      expect(prompt.studio).toMatch(/^(yes|partly|no)\b/);
      if (!prompt.always) expect(prompt.keywords.length).toBeGreaterThan(0);
    }
    const reel = prompts.find((prompt) => prompt.id === "animated-explainer-reel")!;
    expect(reel.body).toContain("# QUALITY CHECK");
    // The note after the reel prompt introduces the next part of the file and is not part of the prompt.
    expect(reel.body).not.toContain("Runway");
  });

  it("always includes the core rules, and adds only the prompts that were asked for", () => {
    expect(ids("")).toEqual(ALWAYS);
    expect(ids("Make each step big, it's a tutorial")).toContain("step-callouts");
    expect(ids("please replace the background with an office")).toContain("background-swap");
    expect(ids("مراحل را با انیمیشن نشان بده")).toContain("animated-explainer-reel");
    expect(ids("زیرنویس‌ها خوانا باشند")).toContain("captions-readable");
    expect(ids("YouTube")).toContain("youtube-chapters");
  });

  it("matches whole words only", () => {
    expect(ids("check my settings and the pipeline")).toEqual(ALWAYS);
    expect(ids("listen closely")).not.toContain("step-callouts");
  });

  it("skips blocks without an id and still parses the rest", () => {
    const prompts = parseEditPrompts("# Intro\n\n## Not a prompt\ntext\n\n## my-one · Mine\n- Use when: always\n- Studio: yes\n- Keywords: a\n\nDo it.\n");
    expect(prompts).toEqual([{ id: "my-one", title: "Mine", always: true, studio: "yes", keywords: ["a"], body: "Do it." }]);
  });

  it("gives the editor the matching prompts and the request when planning", async () => {
    let prompt = "";
    const generate = (async (_system: string, text: string) => {
      prompt = text;
      return { level: "full", reason: "", cut: [], tightenPauses: true, titleCard: "", callouts: [], zooms: [], highlights: [], chapters: [] };
    }) as GenerateJson;
    await createWriter(generate).planEdit(
      { language: "en", brand: EXAMPLE_BRAND.en, instructions: { editor: "Never zoom in on my face." } },
      {
        platform: "reel",
        title: "T",
        script: [],
        phrases: [{ number: 0, start: 0, end: 2, text: "Hello" }],
        duration: 2,
        request: "Swap the background and show each step",
      },
    );
    expect(prompt).toContain("<owner_request>Swap the background and show each step</owner_request>");
    expect(prompt).toContain("<edit_prompts>");
    expect(prompt).toContain('title="Cut only in silence"');
    expect(prompt).toContain('title="Make every step big and clear"');
    expect(prompt).toContain('title="Keep text inside the safe zones"');
    expect(prompt).toContain("Replace the current background with [NEW_BACKGROUND]");
    expect(prompt).not.toContain("Outfit");
    expect(prompt).not.toContain("Professional face retouch");
  });
});
