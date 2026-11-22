import { describe, expect, it } from "vitest";
import type { IdeaSource, PieceContent } from "@/lib/db/schema";
import { citesSource, readyCheck, withSources } from "@/lib/quality";

const SOURCES: IdeaSource[] = [
  { url: "https://www.reuters.com/tech/ai-agents-2026", title: "AI agents at work", publishedDate: "2026-11-10" },
  { url: "https://example.org/report", title: "The [2026] report", publishedDate: "2026-11-01" },
];
const TODAY = new Date("2026-11-20T12:00:00Z");
const post = (body: string, fields: Partial<PieceContent> = {}): PieceContent => ({ body, ...fields });
const level = (check: ReturnType<typeof readyCheck>, id: string) => check.items.find((item) => item.id === id)?.level;

describe("the ready check", () => {
  it("is green for a short, sourced post with a strong opening", () => {
    const check = readyCheck("linkedin", post("Small bakeries lose 6 hours a week to orders.\n\nHere's the fix. Source: reuters.com"), {
      sources: SOURCES,
      today: TODAY,
    });
    expect(check.level).toBe("pass");
    expect(level(check, "freshness")).toBe("pass");
  });

  it("is red when the post can't go out, such as a placeholder left in", () => {
    const check = readyCheck("linkedin", post("Our results: [add your number]"), { today: TODAY });
    expect(check.level).toBe("fail");
    expect(check.items[0]).toEqual({ id: "rules", level: "fail", values: { problem: "placeholder" } });
  });

  it("warns about a tired opening, a hook past 'see more', walls of text and long sentences", () => {
    const long = "word ".repeat(60).trim();
    const check = readyCheck("linkedin", post(`In today's fast-paced world, ${long}.\n\n${long}, ${long}.`), { today: TODAY });
    expect(level(check, "opener")).toBe("warn");
    expect(level(check, "hook")).toBe("warn");
    expect(level(check, "paragraphs")).toBe("warn");
    expect(level(check, "sentences")).toBe("warn");
    expect(check.level).toBe("warn");
  });

  it("checks the title instead of the first line where the title is what people see first", () => {
    const check = readyCheck("youtube", post("Description", { title: "A".repeat(70) }), { today: TODAY });
    expect(check.items.find((item) => item.id === "hook")).toMatchObject({ level: "warn", values: { kind: "title", limit: 60 } });
  });

  it("asks for a source when a post has numbers, and is happy once one is named", () => {
    const body = "73% of small teams already use AI agents.";
    expect(level(readyCheck("telegram", post(body), { sources: SOURCES, today: TODAY }), "numbers")).toBe("warn");
    expect(readyCheck("telegram", post(body), { today: TODAY }).items.find((item) => item.id === "numbers")?.values).toEqual({ sources: 0 });
    expect(level(readyCheck("telegram", post(withSources("telegram", body, SOURCES, "en")), { sources: SOURCES, today: TODAY }), "numbers")).toBe("pass");
    // A year or a list number isn't a statistic.
    expect(level(readyCheck("telegram", post("In 2026, try these 3 things."), { today: TODAY }), "numbers")).toBeUndefined();
  });

  it("notices too many hashtags, old news, unknown links and a repeat of a live post", () => {
    const check = readyCheck(
      "linkedin",
      post("Agents save bakeries hours every week on orders and invoices https://unknown.example #a #b #c #d #e #f"),
      {
        sources: [{ ...SOURCES[0], publishedDate: "2026-01-01" }],
        recent: [{ title: "Agents for bakeries", body: "Agents save bakeries hours every week on orders and invoices" }],
        today: TODAY,
      },
    );
    expect(level(check, "hashtags")).toBe("warn");
    expect(level(check, "freshness")).toBe("warn");
    expect(level(check, "links")).toBe("warn");
    expect(check.items.find((item) => item.id === "repeat")).toMatchObject({ level: "warn", values: { title: "Agents for bakeries" } });
  });
});

describe("sources in a post", () => {
  it("writes them in the post's language and the network's format, once", () => {
    const website = withSources("website", "Body", SOURCES, "en");
    expect(website).toBe("Body\n\n## Sources\n\n- [AI agents at work](https://www.reuters.com/tech/ai-agents-2026)\n- [The 2026 report](https://example.org/report)");
    expect(withSources("website", website, SOURCES, "en")).toBe(website);
    expect(withSources("linkedin", "متن", SOURCES, "fa")).toContain("منابع:\n- AI agents at work: https://www.reuters.com/tech/ai-agents-2026");
    // Instagram captions can't link, so they name the sites.
    expect(withSources("instagram", "Caption", SOURCES, "en")).toBe("Caption\n\nSources: reuters.com, example.org");
    expect(citesSource("see reuters.com", SOURCES)).toBe(true);
    expect(citesSource("nothing here", SOURCES)).toBe(false);
  });
});
