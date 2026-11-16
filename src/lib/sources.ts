import type { SearchResult } from "./ai/types";
import { topicWords } from "./duplicate";

/**
 * Your own sources for the Idea Scout: sites and domains it may search, and RSS feeds it reads
 * directly. Reading a feed is a plain web request, so it costs no search credits or AI requests.
 */

export const MAX_SOURCES = 30;
/** Feed items older than this are left out, like the week-long news search. */
const FEED_MAX_AGE_DAYS = 14;
/** The most feed items passed on to the scout, after the free word filter. */
export const MAX_FEED_ITEMS = 15;
const FEED_TIMEOUT_MS = 8000;
const MAX_FEED_BYTES = 2_000_000;
const ITEM_TEXT_LENGTH = 800;

/** True when an address looks like an RSS or Atom feed rather than a site. */
export function isFeedUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return /\.(xml|rss|atom)$/.test(path) || /(^|\/)(feed|feeds|rss|atom)(\/|$)/.test(path) || url.searchParams.has("feed");
}

/** Reads what you typed, one source per line: feeds by their full address, everything else by its domain. */
export function parseSources(lines: string[]): { domains: string[]; feeds: string[] } {
  const domains = new Set<string>();
  const feeds = new Set<string>();
  for (const raw of lines.slice(0, MAX_SOURCES)) {
    const line = raw.trim();
    if (!line) continue;
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`);
    } catch {
      continue;
    }
    if (!url.hostname.includes(".")) continue;
    if (isFeedUrl(url)) feeds.add(url.toString());
    else domains.add(url.hostname.replace(/^www\./, ""));
  }
  return { domains: [...domains], feeds: [...feeds] };
}

/** The lines worth keeping: real addresses, each once. */
export function cleanSources(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines
    .map((line) => line.trim())
    .filter((line) => {
      const { domains, feeds } = parseSources([line]);
      const key = feeds[0] ?? domains[0];
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SOURCES);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text from a feed field: CDATA unwrapped, tags removed, entities decoded. */
function plain(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const number = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function field(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return match[1];
  }
  return "";
}

/** The items of an RSS or Atom feed. Anything it can't read is skipped. */
export function parseFeed(xml: string, feedUrl: string): SearchResult[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.flatMap((block) => {
    const title = plain(field(block, ["title"]));
    let link = plain(field(block, ["link", "guid"]));
    if (!/^https?:\/\//.test(link)) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
      link = href ? new URL(href, feedUrl).toString() : "";
    }
    if (!title || !link) return [];
    const content = plain(field(block, ["description", "summary", "content:encoded", "content"])).slice(0, ITEM_TEXT_LENGTH);
    const dateText = plain(field(block, ["pubDate", "published", "updated", "dc:date"]));
    const date = dateText ? new Date(dateText) : null;
    return [{ title, url: link, content: content || title, publishedDate: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null }];
  });
}

export type FetchText = (url: string) => Promise<string>;

/** Fetches a feed with a time limit and a size limit, so one slow or huge feed can't hold up the search. */
export const fetchFeedText: FetchText = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { "user-agent": "ContentProductionStudio/1.0 (RSS reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  if (!response.ok) throw new Error(`The feed answered ${response.status}.`);
  const text = await response.text();
  return text.slice(0, MAX_FEED_BYTES);
};

/** Reads every feed, keeps recent items, and says for each feed how many it found or what went wrong. */
export async function readFeeds(feeds: string[], fetchText: FetchText = fetchFeedText, now = new Date()) {
  const cutoff = now.getTime() - FEED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const settled = await Promise.allSettled(feeds.map(async (url) => parseFeed(await fetchText(url), url)));
  const items: SearchResult[] = [];
  const report = settled.map((outcome, index) => {
    if (outcome.status === "rejected") {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : "It couldn't be read.";
      return { url: feeds[index], items: 0, error: reason.slice(0, 200) };
    }
    const recent = outcome.value.filter((item) => !item.publishedDate || new Date(item.publishedDate).getTime() >= cutoff);
    items.push(...recent);
    return { url: feeds[index], items: recent.length };
  });
  return { items, report };
}

/**
 * The cheap first filter: feed items ranked by how many words they share with your topics and
 * request, newest first among equals. Plain code, no AI. Without topics, the newest items win.
 */
export function pickFeedItems(items: SearchResult[], topics: string[], limit = MAX_FEED_ITEMS): SearchResult[] {
  const wanted = topicWords(topics.join(" "));
  const seen = new Set<string>();
  return items
    .filter((item) => !seen.has(item.url) && seen.add(item.url))
    .map((item) => {
      const words = topicWords(`${item.title} ${item.content}`);
      return { item, score: [...wanted].filter((word) => words.has(word)).length };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.item.publishedDate ? Date.parse(b.item.publishedDate) : 0) - (a.item.publishedDate ? Date.parse(a.item.publishedDate) : 0),
    )
    .slice(0, limit)
    .map(({ item }) => item);
}
