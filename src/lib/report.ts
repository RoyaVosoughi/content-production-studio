import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { ideas, pieces, pieceVersions, publications, type IdeaSource, type PieceContent } from "./db/schema";
import { isContentLanguage, type Language, type UiLanguage } from "./language";
import { isPlatform, platformLabel, type Platform } from "./platforms";

// A record of everything that went out: when, where, about what, and where the idea came from.
// It is read from the posts themselves, so it needs no AI and covers posts made before it existed.

export type ReportRow = {
  pieceId: string;
  ideaId: string;
  postedAt: Date;
  platform: Platform;
  language: Language;
  pillar: string;
  ideaTitle: string;
  /** One line about the post, taken from its own words. */
  summary: string;
  url: string | null;
  sources: IdeaSource[];
};

export type ReportFilter = {
  /** The first day to include, as YYYY-MM-DD in this computer's time zone. */
  from?: string;
  /** The last day to include, as YYYY-MM-DD in this computer's time zone. */
  to?: string;
  platform?: Platform;
  pillar?: string;
  language?: Language;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight at the start of a YYYY-MM-DD day on this computer, or null when it isn't a real date. */
export function dayStart(value: string | undefined): Date | null {
  if (!value || !DAY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** A day as YYYY-MM-DD on this computer. */
export function dayOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const part = text.slice(0, limit - 1);
  const space = part.lastIndexOf(" ");
  return `${(space > limit / 2 ? part.slice(0, space) : part).trim()}…`;
}

/**
 * One line about a post: an article's summary, a video's title, a carousel's cover, or otherwise the
 * post's first sentence. Markdown, links and hashtags are left out.
 */
export function summaryOf(platform: Platform, content: PieceContent): string {
  const candidates = [
    platform === "website" ? content.excerpt : undefined,
    platform === "instagram" ? content.slides?.[0]?.title : undefined,
    content.title,
    content.body.split(/\n/).map(plain).find(Boolean)?.match(/^.+?[.!?؟](?=\s|$)/u)?.[0],
    plain(content.body),
    content.script?.[0]?.say,
  ];
  const line = candidates.map((value) => (value ? plain(value) : "")).find(Boolean) ?? "";
  return cut(line, 160);
}

/** Every live post that matches the filter, newest first. */
export async function reportRows(db: Db, filter: ReportFilter = {}): Promise<ReportRow[]> {
  const rows = await db
    .select({
      pieceId: pieces.id,
      platform: pieces.platform,
      ideaId: ideas.id,
      language: ideas.language,
      pillar: ideas.pillar,
      ideaTitle: ideas.title,
      sources: ideas.sources,
      content: pieceVersions.content,
      url: publications.url,
      postedAt: publications.postedAt,
      updatedAt: publications.updatedAt,
    })
    .from(publications)
    .innerJoin(pieces, eq(pieces.id, publications.pieceId))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, publications.version)))
    .where(eq(publications.status, "posted"));

  const from = dayStart(filter.from);
  const toStart = dayStart(filter.to);
  const until = toStart ? new Date(toStart.getFullYear(), toStart.getMonth(), toStart.getDate() + 1) : null;
  const pillar = filter.pillar?.trim().toLowerCase();

  return rows
    .flatMap((row): ReportRow[] => {
      if (!isPlatform(row.platform) || !isContentLanguage(row.language)) return [];
      const postedAt = row.postedAt ?? row.updatedAt;
      if (from && postedAt < from) return [];
      if (until && postedAt >= until) return [];
      if (filter.platform && row.platform !== filter.platform) return [];
      if (filter.language && row.language !== filter.language) return [];
      if (pillar && row.pillar.trim().toLowerCase() !== pillar) return [];
      return [
        {
          pieceId: row.pieceId,
          ideaId: row.ideaId,
          postedAt,
          platform: row.platform,
          language: row.language,
          pillar: row.pillar,
          ideaTitle: row.ideaTitle,
          summary: summaryOf(row.platform, row.content),
          url: row.url,
          sources: row.sources ?? [],
        },
      ];
    })
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
}

/** The topics that have live posts, for the filter. */
export async function reportPillars(db: Db): Promise<string[]> {
  const rows = await reportRows(db);
  return [...new Set(rows.map((row) => row.pillar.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * A cell as CSV writes it. A cell that starts like a formula is kept as text, so opening the file in a
 * spreadsheet never runs anything.
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type CsvHeadings = {
  date: string;
  channel: string;
  language: string;
  topic: string;
  idea: string;
  summary: string;
  link: string;
  sources: string;
};

/**
 * The report as CSV for Google Sheets or Excel. It starts with a byte-order mark so Persian and other
 * non-Latin text opens correctly, and several sources share one cell, one per line.
 */
export function reportCsv(rows: ReportRow[], headings: CsvHeadings, ui: UiLanguage): string {
  const lines = [
    [headings.date, headings.channel, headings.language, headings.topic, headings.idea, headings.summary, headings.link, headings.sources],
    ...rows.map((row) => [
      dayOf(row.postedAt),
      platformLabel(row.platform, ui),
      row.language,
      row.pillar,
      row.ideaTitle,
      row.summary,
      row.url ?? "",
      row.sources.map((source) => source.url).join("\n"),
    ]),
  ];
  return `﻿${lines.map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** The filter from a page's or download's address. Anything not understood is left out. */
export function filterFrom(params: Record<string, string | string[] | undefined>): ReportFilter {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const platform = one("platform");
  const language = one("language");
  return {
    from: dayStart(one("from")) ? one("from") : undefined,
    to: dayStart(one("to")) ? one("to") : undefined,
    platform: platform && isPlatform(platform) ? platform : undefined,
    pillar: one("pillar")?.slice(0, 200),
    language: language && isContentLanguage(language) ? language : undefined,
  };
}

/** The filter as an address query, for the download link. */
export function filterQuery(filter: ReportFilter): string {
  const entries = Object.entries(filter).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
  return new URLSearchParams(entries).toString();
}
