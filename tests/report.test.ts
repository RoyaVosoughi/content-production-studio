import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ideas, pieces, pieceVersions, publications, type PieceContent } from "@/lib/db/schema";
import { filterFrom, filterQuery, reportCsv, reportPillars, reportRows, summaryOf } from "@/lib/report";
import { studioDb } from "./fixtures/brand";

let db: Db;

async function posted(
  platform: string,
  content: PieceContent,
  { at, pillar = "Baking", language = "en", status = "posted", url = "https://example.com/p" }: { at: string; pillar?: string; language?: string; status?: "posted" | "failed"; url?: string | null },
) {
  const [idea] = await db
    .insert(ideas)
    .values({
      language,
      title: `Idea about ${pillar}`,
      hook: "H",
      angle: "A",
      whyNow: "N",
      pillar,
      status: "approved",
      sources: [{ url: "https://source.example/a", title: "Source A", publishedDate: null }],
    })
    .returning();
  const [piece] = await db.insert(pieces).values({ ideaId: idea.id, platform, currentVersion: 2 }).returning();
  await db.insert(pieceVersions).values([
    { pieceId: piece.id, version: 1, content: { body: "Old version" }, origin: "ai", scenarioVersion: 1 },
    { pieceId: piece.id, version: 2, content, origin: "edit", scenarioVersion: 1 },
  ]);
  await db.insert(publications).values({ pieceId: piece.id, version: 2, status, url, postedAt: new Date(at) });
  return piece.id;
}

beforeEach(async () => {
  db = await studioDb();
});

describe("published report", () => {
  it("summarises each post in one line from its own words", () => {
    expect(summaryOf("website", { title: "T", excerpt: "The **short** summary.", body: "## Body" })).toBe("The short summary.");
    expect(summaryOf("linkedin", { body: "**Most bakers** rush the dough. Here's why it matters.\n\nMore #baking https://x.y" })).toBe(
      "Most bakers rush the dough.",
    );
    expect(summaryOf("instagram", { body: "Caption", slides: [{ title: "Cover title", text: "" }] })).toBe("Cover title");
    expect(summaryOf("telegram", { body: "x".repeat(300) }).length).toBeLessThanOrEqual(160);
  });

  it("lists live posts newest first from the posted version, and filters them", async () => {
    await posted("linkedin", { body: "First post. More." }, { at: "2026-10-02T10:00:00" });
    await posted("telegram", { body: "Second post." }, { at: "2026-10-20T10:00:00", pillar: "Tools" });
    await posted("website", { body: "x", title: "T", excerpt: "Article." }, { at: "2026-11-05T10:00:00", language: "fa", url: null });
    await posted("telegram", { body: "Failed post." }, { at: "2026-11-06T10:00:00", status: "failed" });

    const all = await reportRows(db);
    expect(all.map((row) => row.summary)).toEqual(["Article.", "Second post.", "First post."]);
    expect(all[2]).toMatchObject({ platform: "linkedin", pillar: "Baking", url: "https://example.com/p" });
    expect(all[2].sources).toEqual([{ url: "https://source.example/a", title: "Source A", publishedDate: null }]);

    expect((await reportRows(db, { from: "2026-10-02", to: "2026-10-20" })).map((row) => row.platform)).toEqual(["telegram", "linkedin"]);
    expect((await reportRows(db, { to: "2026-10-01" }))).toHaveLength(0);
    expect((await reportRows(db, { platform: "telegram" })).map((row) => row.summary)).toEqual(["Second post."]);
    expect((await reportRows(db, { pillar: "tools" })).map((row) => row.platform)).toEqual(["telegram"]);
    expect((await reportRows(db, { language: "fa" })).map((row) => row.platform)).toEqual(["website"]);
    expect(await reportPillars(db)).toEqual(["Baking", "Tools"]);
  });

  it("reads filters from the address, ignoring anything it doesn't understand", () => {
    expect(filterFrom({ from: "2026-10-01", to: "2026-02-31", platform: "myspace", pillar: " Tools ", language: "fa" })).toEqual({
      from: "2026-10-01",
      to: undefined,
      platform: undefined,
      pillar: "Tools",
      language: "fa",
    });
    expect(filterQuery({ from: "2026-10-01", platform: "linkedin" })).toBe("from=2026-10-01&platform=linkedin");
  });

  it("writes CSV that opens Persian correctly and never runs a formula", async () => {
    await posted("linkedin", { body: '=HYPERLINK("bad"), "quoted", نان.' }, { at: "2026-10-02T10:00:00", pillar: "نان" });
    const csv = reportCsv(
      await reportRows(db),
      { date: "Date", channel: "Channel", language: "Language", topic: "Topic", idea: "Idea", summary: "Summary", link: "Post", sources: "Sources" },
      "en",
    );
    expect(csv.startsWith("﻿Date,Channel,Language,Topic,Idea,Summary,Post,Sources\r\n")).toBe(true);
    expect(csv).toContain(`2026-10-02,LinkedIn,en,نان,Idea about نان,"'=HYPERLINK(""bad""), ""quoted"", نان.",https://example.com/p,https://source.example/a`);
  });
});
