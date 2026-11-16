import JSZip from "jszip";
import type { Db } from "./db/client";
import { StudioError } from "./errors";
import { postedPieces, recordNumbers, type PostedRow } from "./results";

// LinkedIn doesn't let a personal account read its post numbers through the API, but it lets you export
// them (Analytics, then Export) as an Excel or CSV file. This reads that file and matches each row to
// a post the studio published, by the post's address or, failing that, by the day it went out.

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type Sheet = string[][];

/** Splits CSV text into rows, with quoted cells, doubled quotes and either line ending. */
export function parseCsv(text: string): Sheet {
  const source = text.replace(/^﻿/, "");
  // LinkedIn's files may use a semicolon or a tab where a spreadsheet's locale says so.
  const first = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, candidate) => (first.split(candidate).length > first.split(best).length ? candidate : best), ",");
  const rows: Sheet = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const decode = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/\d+/g, "")) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Reads every sheet of an Excel (.xlsx) file as rows of text. */
export async function parseXlsx(bytes: Buffer): Promise<Sheet[]> {
  const zip = await JSZip.loadAsync(bytes);
  const shared: string[] = [];
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  for (const item of sharedXml?.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    shared.push(decode([...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join("")));
  }
  const names = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  const sheets: Sheet[] = [];
  for (const name of names) {
    const xml = await zip.file(name)!.async("string");
    const rows: Sheet = [];
    for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const row: string[] = [];
      for (const match of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = match[1];
        const at = attributes.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attributes.match(/\bt="(\w+)"/)?.[1];
        const inner = match[2] ?? "";
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const value =
          type === "s" ? (shared[Number(raw)] ?? "") : type === "inlineStr" ? decode([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")) : decode(raw);
        if (at) row[columnIndex(at)] = value;
      }
      rows.push(Array.from(row, (cell) => cell ?? ""));
    }
    sheets.push(rows);
  }
  return sheets;
}

/** Reads an uploaded file as sheets, by what it is rather than what it is called. */
export async function readExport(name: string, bytes: Buffer): Promise<Sheet[]> {
  if (bytes.length === 0) throw new StudioError("That file is empty.");
  // An .xlsx file is a zip, which always starts with "PK".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return await parseXlsx(bytes);
    } catch {
      throw new StudioError("That Excel file couldn't be read. Export it from LinkedIn again.");
    }
  }
  if (/\.xls$/i.test(name)) throw new StudioError("That is an old Excel format. Open it and save it as .xlsx or .csv, then upload it.");
  return [parseCsv(bytes.toString("utf8"))];
}

export type LinkedInRow = { url: string; date: string | null; views?: number; likes?: number; comments?: number; shares?: number };

type Metric = "views" | "likes" | "comments" | "shares";
const HEADERS: [Metric | "date", RegExp][] = [
  ["views", /impression/i],
  ["likes", /reaction|\blikes?\b/i],
  ["comments", /comment/i],
  ["shares", /repost|\bshares?\b/i],
  ["date", /publish|posted|date/i],
];

function toNumber(value: string): number | undefined {
  const text = value.replace(/[,\s٬]/g, "").replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  if (!/^\d+$/.test(text)) return undefined;
  const number = Number(text);
  return number <= 1_000_000_000 ? number : undefined;
}

/**
 * Finds the post tables in a sheet. A table starts at a "Post URL" column and runs to the next one, so
 * two tables side by side (top posts by engagement and by impressions) are both read, and each post's
 * numbers from both are combined.
 */
export function extractRows(sheets: Sheet[]): LinkedInRow[] {
  const byUrl = new Map<string, LinkedInRow>();
  for (const rows of sheets) {
    let blocks: { start: number; end: number; columns: Map<Metric | "date", number> }[] = [];
    for (const row of rows) {
      const urls = row.flatMap((cell, index) => (/\b(post )?url\b|\blink\b/i.test(cell ?? "") && !/^https?:/i.test(cell) ? [index] : []));
      if (urls.length > 0) {
        blocks = urls.map((start, at) => {
          const end = urls[at + 1] ?? row.length;
          const columns = new Map<Metric | "date", number>();
          for (let index = start + 1; index < end; index++) {
            const header = row[index] ?? "";
            const found = HEADERS.find(([, pattern]) => pattern.test(header));
            if (found && !columns.has(found[0])) columns.set(found[0], index);
          }
          return { start, end, columns };
        });
        continue;
      }
      for (const block of blocks) {
        const url = (row[block.start] ?? "").trim();
        if (!/^https?:\/\//i.test(url)) continue;
        const entry = byUrl.get(url) ?? { url, date: null };
        for (const [key, index] of block.columns) {
          if (key === "date") entry.date ??= (row[index] ?? "").trim() || null;
          else {
            const value = toNumber(row[index] ?? "");
            if (value !== undefined) entry[key] = value;
          }
        }
        byUrl.set(url, entry);
      }
    }
  }
  return [...byUrl.values()];
}

const ids = (value: string | null | undefined) => new Set(value?.match(/\d{12,}/g) ?? []);

/** A date as a local day, from LinkedIn's usual formats (month/day/year, or year-month-day). */
function dayOfText(value: string | null): string | null {
  if (!value) return null;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parts = us ? [us[3], us[1], us[2]] : iso ? [iso[1], iso[2], iso[3]] : null;
  return parts ? `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}` : null;
}

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export type ImportReport = { updated: number; unmatched: number; noViews: number };

/**
 * Saves the numbers from a LinkedIn export onto the LinkedIn posts it matches. A row matches when it
 * shares a post number with the live post's address, or when it went out on the same day as exactly
 * one of your LinkedIn posts. Rows without impressions can't be compared, so they are counted and skipped.
 */
export async function importLinkedInExport(db: Db, name: string, bytes: Buffer): Promise<ImportReport> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new StudioError("That file is too big. LinkedIn's export is usually well under 5 MB.");
  const rows = extractRows(await readExport(name, bytes));
  if (rows.length === 0) {
    throw new StudioError("No posts were found in that file. Export your post analytics from LinkedIn (Analytics, then Export) and upload that file.");
  }
  const posts = (await postedPieces(db)).filter((post) => post.platform === "linkedin" || post.platform === "linkedin_video");
  const report: ImportReport = { updated: 0, unmatched: 0, noViews: 0 };
  const used = new Set<string>();
  for (const row of rows) {
    const rowIds = ids(row.url);
    let match: PostedRow | undefined = posts.find((post) => [...ids(post.url), ...ids(post.externalId)].some((id) => rowIds.has(id)));
    if (!match) {
      const day = dayOfText(row.date);
      const sameDay = day ? posts.filter((post) => post.postedAt && localDay(post.postedAt) === day) : [];
      if (sameDay.length === 1) match = sameDay[0];
    }
    if (!match || used.has(match.pieceId)) {
      report.unmatched++;
      continue;
    }
    if (row.views === undefined) {
      report.noViews++;
      continue;
    }
    used.add(match.pieceId);
    const { views, likes, comments, shares } = row;
    await recordNumbers(db, match, { views, ...(likes !== undefined && { likes }), ...(comments !== undefined && { comments }), ...(shares !== undefined && { shares }) }, match.note);
    report.updated++;
  }
  return report;
}
