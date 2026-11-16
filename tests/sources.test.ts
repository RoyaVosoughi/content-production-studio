import { describe, expect, it } from "vitest";
import { cleanSources, parseFeed, parseSources, pickFeedItems, readFeeds } from "@/lib/sources";

const RSS = `<rss><channel>
<item><title>AI for bakeries</title><link>https://a.example/1</link><description><![CDATA[<p>Ordering &amp; stock</p>]]></description><pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Old news</title><link>https://a.example/2</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

describe("your sources", () => {
  it("tells feeds from sites and keeps each once", () => {
    expect(parseSources(["arxiv.org", "https://www.nature.com/news", "https://a.example/feed", "nonsense"])).toEqual({
      domains: ["arxiv.org", "nature.com"],
      feeds: ["https://a.example/feed"],
    });
    expect(cleanSources(["arxiv.org", "https://arxiv.org", "nope"])).toEqual(["arxiv.org"]);
  });

  it("reads RSS items, drops old ones and reports feeds that fail", async () => {
    expect(parseFeed(RSS, "https://a.example/feed")[0]).toMatchObject({ title: "AI for bakeries", content: "Ordering & stock" });
    const { items, report } = await readFeeds(
      ["https://a.example/feed", "https://b.example/rss"],
      async (url) => {
        if (url.includes("b.example")) throw new Error("down");
        return RSS;
      },
      new Date(2026, 10, 14),
    );
    expect(items.map((item) => item.title)).toEqual(["AI for bakeries"]);
    expect(report).toEqual([{ url: "https://a.example/feed", items: 1 }, { url: "https://b.example/rss", items: 0, error: "down" }]);
  });

  it("puts the items closest to your topics first, with no AI", () => {
    const items = [
      { title: "Football results", url: "1", content: "", publishedDate: null },
      { title: "Bakery stock automation", url: "2", content: "", publishedDate: null },
    ];
    expect(pickFeedItems(items, ["bakery automation"])[0].url).toBe("2");
  });
});
