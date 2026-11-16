import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { ideas, pieces, pieceVersions, postResults, publications } from "@/lib/db/schema";
import { bestAndWorst, patternLines, patternsOf, weeklySummary } from "@/lib/insights";
import { extractRows, importLinkedInExport, parseCsv, readExport } from "@/lib/linkedin-import";
import type { Platform } from "@/lib/platforms";
import { fetchInstagramNumbers } from "@/lib/publishers/instagram";
import { resultsOverview, syncInstagramResults } from "@/lib/results";
import { studioDb } from "./fixtures/brand";

let db: Db;
const DAY = 24 * 3600 * 1000;

async function live(
  platform: Platform,
  { ageDays = 3, externalId = null, url = null, pillar = "Baking" }: { ageDays?: number; externalId?: string | null; url?: string | null; pillar?: string } = {},
) {
  const [idea] = await db
    .insert(ideas)
    .values({ language: "en", title: `Idea ${pillar}`, hook: "H", angle: "A", whyNow: "N", pillar, sources: [], status: "approved" })
    .returning();
  const [piece] = await db.insert(pieces).values({ ideaId: idea.id, platform, currentVersion: 1 }).returning();
  await db.insert(pieceVersions).values({ pieceId: piece.id, version: 1, content: { body: "Body" }, origin: "ai", scenarioVersion: 1 });
  await db.insert(publications).values({ pieceId: piece.id, version: 1, status: "posted", externalId, url, postedAt: new Date(Date.now() - ageDays * DAY) });
  return piece.id;
}

const stored = async (pieceId: string) => (await db.select().from(postResults)).find((row) => row.pieceId === pieceId)?.numbers;

beforeEach(async () => {
  db = await studioDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Instagram numbers", () => {
  it("reads the insights Instagram gives, under the studio's names", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig");
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({
          data: [
            { name: "views", values: [{ value: 1200 }] },
            { name: "likes", total_value: { value: 80 } },
            { name: "saved", values: [{ value: 14 }] },
            { name: "follows", values: [{ value: 3 }] },
            { name: "reach", values: [{ value: 900 }] },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchInstagramNumbers("media9")).toEqual({ views: 1200, likes: 80, saves: 14, follows: 3 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/media9/insights?metric=views%2Clikes%2Ccomments%2Cshares%2Csaved%2Cfollows");
  });

  it("asks again for the common numbers when Instagram refuses one, and fails without views", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "metric follows not supported", code: 100 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 50 }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchInstagramNumbers("m")).toEqual({ views: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ name: "likes", values: [{ value: 1 }] }] }), { status: 200 })));
    await expect(fetchInstagramNumbers("m")).rejects.toThrow("no view count");
  });

  it("syncs live Instagram posts, skipping recent readings and old posts, and keeps going after a failure", async () => {
    const fresh = await live("instagram", { externalId: "a" });
    const broken = await live("instagram", { externalId: "b" });
    const old = await live("instagram", { externalId: "c", ageDays: 90 });
    const checked = await live("instagram", { externalId: "d" });
    await live("telegram", { externalId: "e" });
    await db.insert(postResults).values({ pieceId: checked, numbers: { views: 7 }, note: "mine", checkedAt: new Date() });
    const read = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("Instagram is down");
      return { views: 100, likes: 5 };
    });
    const report = await syncInstagramResults(db, read);
    expect(report).toEqual({ updated: 1, failed: 1, firstError: "Instagram is down" });
    expect(read).toHaveBeenCalledTimes(2);
    expect(await stored(fresh)).toEqual({ views: 100, likes: 5 });
    expect(await stored(broken)).toBeUndefined();
    expect(await stored(old)).toBeUndefined();
    expect(await stored(checked)).toEqual({ views: 7 });
  });
});

describe("LinkedIn export", () => {
  const CSV = [
    "Post URL,Post publish date,Impressions,Reactions,Comments,Reposts",
    "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/,2026-11-01,\"1,500\",60,8,4",
    "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000999/,2026-10-01,200,5,0,0",
  ].join("\n");

  it("parses CSV with quotes, a byte-order mark and other separators", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("combines two tables side by side, and ignores columns it doesn't know", () => {
    const sheet = [
      ["TOP POSTS"],
      ["Post URL", "Post publish date", "Engagements", "", "Post URL", "Post publish date", "Impressions"],
      ["https://l.in/p/1", "11/01/2026", "40", "", "https://l.in/p/2", "11/02/2026", "900"],
      ["https://l.in/p/2", "11/02/2026", "12", "", "https://l.in/p/1", "11/01/2026", "700"],
    ];
    const rows = extractRows([sheet]);
    expect(rows.find((row) => row.url.endsWith("/1"))).toMatchObject({ views: 700, date: "11/01/2026" });
    expect(rows.find((row) => row.url.endsWith("/2"))).toMatchObject({ views: 900 });
  });

  it("matches by post number, or by day when only one post went out then, and saves the numbers", async () => {
    const byId = await live("linkedin", { url: "https://www.linkedin.com/feed/update/urn:li:share:7300000000000000001/", ageDays: 20 });
    const byDay = await live("linkedin", { url: "https://www.linkedin.com/feed/update/urn:li:share:5/", ageDays: 0 });
    // The day-matched post goes out on the second row's date.
    const day = new Date(Date.now());
    const text = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const csv = `${CSV.split("\n")[0]}\n${CSV.split("\n")[1]}\nhttps://www.linkedin.com/feed/update/urn:li:activity:1/,${text},300,9,1,0\nhttps://www.linkedin.com/feed/update/urn:li:activity:2/,2020-01-01,5,1,0,0\nhttps://www.linkedin.com/feed/update/urn:li:activity:3/,${text},,1,0,0`;
    const report = await importLinkedInExport(db, "export.csv", Buffer.from(csv));
    expect(report.updated).toBe(2);
    // The 2020 row matches nothing, and the last row's day is already taken by the row before it.
    expect(report.unmatched).toBe(2);
    expect(await stored(byId)).toEqual({ views: 1500, likes: 60, comments: 8, shares: 4 });
    expect(await stored(byDay)).toEqual({ views: 300, likes: 9, comments: 1, shares: 0 });
  });

  it("reads a real .xlsx file, and refuses files that aren't exports", async () => {
    const zip = new JSZip();
    zip.file("xl/sharedStrings.xml", '<sst><si><t>Post URL</t></si><si><t>Impressions</t></si><si><t>https://www.linkedin.com/feed/update/urn:li:share:7300000000000000042/</t></si></sst>');
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2500</v></c></row></sheetData></worksheet>',
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    expect(extractRows(await readExport("a.xlsx", bytes))).toEqual([{ url: expect.stringContaining("42"), date: null, views: 2500 }]);
    const piece = await live("linkedin", { url: "https://www.linkedin.com/feed/update/urn:li:share:7300000000000000042/" });
    expect((await importLinkedInExport(db, "a.xlsx", bytes)).updated).toBe(1);
    expect(await stored(piece)).toEqual({ views: 2500 });

    await expect(importLinkedInExport(db, "notes.csv", Buffer.from("hello\nworld"))).rejects.toThrow("No posts were found");
    await expect(readExport("a.xls", Buffer.from("\xD0\xCF\x11\xE0"))).rejects.toThrow("old Excel");
  });
});

describe("what the numbers say", () => {
  async function scored() {
    // Four Telegram posts and two LinkedIn posts, so every one is compared (three needed per network).
    const ids = [
      await live("telegram", { pillar: "Baking", ageDays: 1 }),
      await live("telegram", { pillar: "Baking", ageDays: 2 }),
      await live("telegram", { pillar: "Tools", ageDays: 3 }),
      await live("telegram", { pillar: "Tools", ageDays: 4 }),
      await live("telegram", { pillar: "Baking", ageDays: 5 }),
      await live("telegram", { pillar: "Tools", ageDays: 20 }),
    ];
    const views = [900, 800, 100, 90, 700, 80];
    for (const [index, id] of ids.entries()) await db.insert(postResults).values({ pieceId: id, numbers: { views: views[index], likes: views[index] / 20 }, note: "" });
    return resultsOverview(db);
  }

  it("finds the best and weakest topic and writes sentences for the scout", async () => {
    const rows = await scored();
    const patterns = patternsOf(rows);
    expect(patterns.topics.map((topic) => topic.key)).toEqual(["Baking", "Tools"]);
    expect(bestAndWorst(patterns.topics, 2)?.best.key).toBe("Baking");
    const lines = patternLines(rows);
    expect(lines[0]).toMatch(/Best topic so far: "Baking"/);
    expect(lines[1]).toMatch(/Weakest topic so far: "Tools"/);
    expect(patternLines(rows.slice(0, 4))).toEqual([]);
  });

  it("summarises the last seven days", async () => {
    const week = weeklySummary(await scored());
    expect(week).toMatchObject({ posted: 5, measured: 5, views: 900 + 800 + 100 + 90 + 700 });
    expect(week.best?.numbers?.views).toBe(900);
    expect(week.weakest?.numbers?.views).toBe(90);
    expect(weeklySummary([]).posted).toBe(0);
  });
});
