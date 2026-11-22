import { describe, expect, it } from "vitest";
import { EXAMPLE_BRAND } from "./fixtures/brand";
import { createWriter, type GenerateJson } from "@/lib/ai/writer";
import type { EditPlan, Explainer, Phrase, Word } from "@/lib/db/schema";
import { DEFAULT_COLORS } from "@/lib/profile";
import { animationHtml, pipBox, themeOf } from "@/lib/video/animation";
import { cleanPlan, explainerStyleFor, explainerWindows, keepRanges, outputDuration, simplePlan } from "@/lib/video/edit";
import { cardsFor, ffmpegArgs } from "@/lib/video/render";

const BRAND = { name: "Sam", instagram: "@sam", headline: "AI for small business", colors: DEFAULT_COLORS, headingStyle: "sans" as const };
const word = (text: string, start: number, end: number): Word => ({ text, start, end });

/** Ten phrases of three words, two seconds apart. */
const phrases: Phrase[] = Array.from({ length: 10 }, (_, i) => ({
  start: i * 2,
  end: i * 2 + 1.6,
  text: `phrase ${i} said`,
  words: [word("phrase", i * 2, i * 2 + 0.5), word(String(i), i * 2 + 0.55, i * 2 + 1), word("said", i * 2 + 1.05, i * 2 + 1.6)],
}));
const scene = (fields: Partial<Explainer["scene"]> = {}): Explainer["scene"] => ({ kind: "steps", say: "", heading: "Three steps", text: "", items: ["One", "Two", "Three"], ...fields });
const plan = (fields: Partial<EditPlan> = {}): EditPlan => ({ ...simplePlan("Save five hours"), ...fields });

describe("explainers over a clip", () => {
  it("keeps explainers in order, on kept phrases, without overlaps, and drawable", () => {
    const cleaned = cleanPlan(
      plan({
        cut: [5],
        explainers: [
          { phrase: 6, until: 4, mode: "full", scene: scene({ kind: "cartoon" as never }) },
          { phrase: 1, until: 3, mode: "pip", scene: scene({ items: ["a", "b", "c", "d", "e"] }) },
          { phrase: 2, until: 2, mode: "pip", scene: scene() },
          { phrase: 5, until: 5, mode: "pip", scene: scene() },
          { phrase: 40, until: 41, mode: "pip", scene: scene() },
        ],
        explainerStyle: "nonsense" as never,
      }),
      phrases.length,
    );
    expect(cleaned.explainers).toEqual([
      // A pip explainer has room for three items.
      { phrase: 1, until: 3, mode: "pip", scene: scene({ items: ["a", "b", "c"] }) },
      // An end before the start is the start itself; kinds an explainer can't show become a big line.
      { phrase: 6, until: 6, mode: "full", scene: { ...scene(), kind: "statement", items: [] } },
    ]);
    expect(cleaned.explainerStyle).toBe("tech");
  });

  it("leaves plans without explainers exactly as they were", () => {
    const cleaned = cleanPlan(plan({ explainers: [] }), phrases.length);
    expect("explainers" in cleaned).toBe(false);
    expect("explainerStyle" in cleaned).toBe(false);
  });

  it("plays each explainer from its first phrase to its last kept word, in finished-video time", () => {
    const edit = cleanPlan(
      plan({
        cut: [2],
        explainers: [
          { phrase: 1, until: 3, mode: "pip", scene: scene() },
          { phrase: 7, until: 7, mode: "full", scene: scene({ kind: "number", text: "73%", items: [] }) },
        ],
      }),
      phrases.length,
    );
    const ranges = keepRanges(phrases, edit, 20);
    const total = outputDuration(ranges);
    const windows = explainerWindows(phrases, edit, ranges, total);
    expect(windows).toHaveLength(2);
    // Phrase 2 was cut, so phrase 3 comes straight after phrase 1.
    expect(windows[0].start).toBeCloseTo(2, 1);
    expect(windows[0].end - windows[0].start).toBeLessThan(5);
    expect(windows[1].mode).toBe("full");
    expect(windows[1].end).toBeLessThanOrEqual(total);
    // Explainers never overlap.
    expect(windows[1].start).toBeGreaterThan(windows[0].end);
  });

  it("leaves out callouts while an explainer plays, and ends the title card before an early one", () => {
    const edit = cleanPlan(
      plan({
        callouts: [{ phrase: 1, text: "Hidden" }, { phrase: 8, text: "Shown" }],
        explainers: [{ phrase: 1, until: 2, mode: "pip", scene: scene() }],
      }),
      phrases.length,
    );
    const ranges = keepRanges(phrases, edit, 20);
    const total = outputDuration(ranges);
    const windows = explainerWindows(phrases, edit, ranges, total);
    const cards = cardsFor(phrases, edit, ranges, total, windows);
    expect(cards.filter((card) => card.kind === "callout").map((card) => card.text)).toEqual(["Shown"]);
    const title = cards.find((card) => card.kind === "title")!;
    expect(title.start + title.duration).toBeLessThanOrEqual(windows[0].start);
  });

  it("lays each explainer over the clip with a fade, and plays the clip in a rounded card for pip", () => {
    const edit = plan();
    const ranges = [{ start: 0, end: 20 }];
    const base = { source: "clip.mp4", platform: "reel" as const, plan: edit, ranges, zoom: null, cards: [], captions: false, output: "out.mp4" };
    const without = ffmpegArgs(base);
    expect(without.join(" ")).not.toContain("exw");
    const args = ffmpegArgs({
      ...base,
      explainers: [
        { file: "explainer-0.mp4", start: 2, end: 6, mode: "pip" },
        { file: "explainer-1.mp4", start: 9, end: 12, mode: "full" },
      ],
      pip: { box: pipBox("reel"), mask: "mask.png" },
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // The clip, both explainers, the card's mask, then the clip again for the card.
    expect(args.filter((arg) => arg === "-i")).toHaveLength(5);
    expect(args[args.lastIndexOf("-i") + 1]).toBe("clip.mp4");
    expect(graph).toContain("[3:v]format=gray");
    expect(graph).toContain("alphamerge");
    expect(graph).toContain("[4:v]fps=30");
    expect(graph).toContain("trim=start=2.000:end=6.000");
    expect(graph).toContain("fade=in:st=2.000:d=0.35:alpha=1");
    expect(graph).toContain("enable='between(t,9.000,12.000)'");
    // Only the pip explainer gets the card.
    expect(graph.match(/alphamerge/g)).toHaveLength(1);
  });

  it("draws explainers in the tech or editorial look, leaving room for the card", () => {
    const tech = animationHtml({
      scenes: [scene()],
      times: [{ start: 0, end: 4 }],
      cues: [],
      platform: "reel",
      language: "en",
      brand: BRAND,
      theme: "tech",
      insert: { pip: pipBox("reel") },
    });
    expect(tech).toContain('class="t-tech"');
    expect(tech).toContain('id="grid"');
    expect(tech).toContain('id="pipframe"');
    expect(tech).toContain("#progress{display:none}");
    const editorial = animationHtml({
      scenes: [scene({ kind: "number", text: "73%", heading: "of prompts", items: [] }), scene({ kind: "statement", heading: "Here's the thing" })],
      times: [
        { start: 0, end: 4 },
        { start: 4, end: 8 },
      ],
      cues: [],
      platform: "reel",
      language: "fa",
      brand: BRAND,
      theme: "editorial",
    });
    expect(editorial).toContain('class="field f0"');
    expect(editorial).toContain('class="mark-ring"');
    expect(editorial).toContain('class="mark-line"');
    expect(editorial).toContain("data-grow");
    expect(editorial).not.toContain('id="pipframe"');
    expect(themeOf("editorial")).toBe("editorial");
    expect(themeOf("cartoon")).toBe("brand");
  });

  it("keeps the card clear of the app's buttons and the captions", () => {
    const tall = pipBox("reel");
    expect(tall.y).toBeGreaterThan(1920 * 0.15);
    expect(tall.y + tall.h).toBeLessThan(1920 - Math.round(1920 * 0.29) - 100);
    const wide = pipBox("youtube");
    expect(wide.x + wide.w).toBeLessThanOrEqual(1920 - 100);
    expect(pipBox("youtube", true).x).toBeLessThan(400);
  });

  it("picks the editorial look when asked for Vox or a collage, and otherwise keeps the edit's look", () => {
    expect(explainerStyleFor("make it Vox style")).toBe("editorial");
    expect(explainerStyleFor("یک کلاژ روزنامه‌ای")).toBe("editorial");
    expect(explainerStyleFor("white background, glass cards", "editorial")).toBe("tech");
    expect(explainerStyleFor("keep it short", "editorial")).toBe("editorial");
    expect(explainerStyleFor("")).toBe("tech");
  });

  it("asks the editor for explainers only when the explainer prompt is chosen", async () => {
    const prompts: string[] = [];
    const generate = (async (_system: string, text: string) => {
      prompts.push(text);
      return { level: "full", reason: "", cut: [], tightenPauses: true, titleCard: "", callouts: [], zooms: [], highlights: [], chapters: [] };
    }) as GenerateJson;
    const input = { platform: "reel" as const, title: "T", script: [], phrases: [{ number: 0, start: 0, end: 2, text: "Hello" }], duration: 2 };
    const context = { language: "en" as const, brand: EXAMPLE_BRAND.en };
    await createWriter(generate).planEdit(context, { ...input, request: "Add explainer animations: picture in picture and full screen." });
    await createWriter(generate).planEdit(context, { ...input, request: "Keep it under 45 seconds" });
    expect(prompts[0]).toContain("Explainers: the studio draws an animation");
    expect(prompts[0]).toContain('title="Animated explainer Reel (picture-in-picture + full-screen animation)"');
    expect(prompts[1]).toContain("Leave explainers empty.");
  });

  it("plans editorial animations in the shape of a Vox explainer", async () => {
    let prompt = "";
    const generate = (async (_system: string, text: string) => {
      prompt = text;
      return { scenes: [] };
    }) as GenerateJson;
    await createWriter(generate).planAnimation({ language: "en", brand: EXAMPLE_BRAND.en }, { platform: "reel", title: "T", script: "A script.", style: "editorial" });
    expect(prompt).toContain("Vox-style editorial collage");
    expect(prompt).toContain("cold open");
    await createWriter(generate).planAnimation({ language: "en", brand: EXAMPLE_BRAND.en }, { platform: "reel", title: "T", script: "A script.", style: "tech" });
    expect(prompt).toContain("light, modern tech look");
    expect(prompt).not.toContain("cold open");
  });
});
