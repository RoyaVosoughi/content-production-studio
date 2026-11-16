import { tavily } from "@tavily/core";
import { StudioError } from "../errors";
import type { SearchProvider, SearchResult } from "./types";

/** Enough of a pasted page to understand it, without flooding the prompt. */
const MAX_PAGE_LENGTH = 6000;

export const tavilySearch: SearchProvider = {
  async search(queries, options) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new StudioError("Add TAVILY_API_KEY to .env.local to search for ideas.");
    const client = tavily({ apiKey });

    const settled = await Promise.allSettled(
      queries.map((query) =>
        options?.domains?.length
          ? client.search(query, { topic: "general", timeRange: "month", maxResults: 5, searchDepth: "basic", includeDomains: options.domains })
          : client.search(query, { topic: "news", timeRange: "week", maxResults: 5, searchDepth: "basic" }),
      ),
    );

    if (settled.every((outcome) => outcome.status === "rejected")) {
      console.error("Tavily search failed:", settled);
      throw new StudioError("Tavily search failed. Check TAVILY_API_KEY and your remaining credits.");
    }

    const byUrl = new Map<string, SearchResult>();
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.error("A Tavily query failed:", outcome.reason);
        continue;
      }
      for (const r of outcome.value.results) {
        if (!byUrl.has(r.url)) {
          byUrl.set(r.url, {
            title: r.title,
            url: r.url,
            content: r.content,
            publishedDate: r.publishedDate || null,
          });
        }
      }
    }
    return [...byUrl.values()];
  },

  async read(urls) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new StudioError("Add TAVILY_API_KEY to .env.local to read links.");
    if (urls.length === 0) return { pages: [], failed: [] };
    try {
      const response = await tavily({ apiKey }).extract(urls, { extractDepth: "advanced", format: "text" });
      const pages = response.results
        .filter((page) => page.rawContent.trim().length > 0)
        .map((page) => ({
          title: page.title || page.url,
          url: page.url,
          content: page.rawContent.slice(0, MAX_PAGE_LENGTH),
          publishedDate: null,
        }));
      const empty = response.results.filter((page) => !page.rawContent.trim()).map((page) => page.url);
      return { pages, failed: [...response.failedResults.map((failure) => failure.url), ...empty] };
    } catch (error) {
      console.error("Tavily couldn't read the links:", error);
      return { pages: [], failed: urls };
    }
  },
};
