import { describe, expect, it } from "vitest";
import { closestPublished, ideaTopic, overlap, publishedIdeas, topicWords } from "@/lib/duplicate";
import { cleanChannelPicks, channelOrder, pickFor } from "@/lib/channels";
import { ideas, pieces, publications } from "@/lib/db/schema";
import { studioDb } from "./fixtures/brand";

describe("the repeat check", () => {
  it("finds an idea that covers a published one, and ignores a different topic", () => {
    const published = [
      { id: "a", title: "AI agents for small shops", text: "AI agents for small shops automate customer support replies" },
      { id: "b", title: "Pricing your course", text: "How to price your online course without underselling" },
    ];
    expect(closestPublished("Small shops can automate customer support with AI agents", published)?.id).toBe("a");
    expect(closestPublished("A morning routine for deep work", published)).toBeNull();
  });

  it("reads Farsi, with either form of ی and ک", () => {
    expect(overlap(topicWords("هوش مصنوعی برای کسب‌وکار کوچك"), topicWords("هوش مصنوعی برای کسب‌وکار کوچک"))).toBe(1);
  });

  it("only compares ideas that have a post live, in the same language", async () => {
    const db = await studioDb();
    const [live, draft, farsi] = await db
      .insert(ideas)
      .values([
        { language: "en", title: "Live one", hook: "AI agents automate support", angle: "Small shops", whyNow: "", pillar: "", sources: [] },
        { language: "en", title: "Draft only", hook: "Pricing courses", angle: "", whyNow: "", pillar: "", sources: [] },
        { language: "fa", title: "فارسی", hook: "هوش مصنوعی", angle: "", whyNow: "", pillar: "", sources: [] },
      ])
      .returning();
    const made = await db
      .insert(pieces)
      .values([live, draft, farsi].map((idea) => ({ ideaId: idea.id, platform: "telegram", currentVersion: 1 })))
      .returning();
    await db.insert(publications).values([
      { pieceId: made[0].id, version: 1, status: "posted" },
      { pieceId: made[1].id, version: 1, status: "failed" },
      { pieceId: made[2].id, version: 1, status: "posted" },
    ]);
    const found = await publishedIdeas(db, "en");
    expect(found).toEqual([{ id: live.id, title: "Live one", text: ideaTopic(live) }]);
  });
});

describe("channel picks", () => {
  it("recommends the best fit when the AI recommended none, and never more than three", () => {
    const none = cleanChannelPicks([
      { platform: "telegram", score: 3, recommended: false, angle: "", brief: "" },
      { platform: "linkedin", score: 4, recommended: false, angle: "", brief: "" },
    ])!;
    expect(none.filter((pick) => pick.recommended).map((pick) => pick.platform)).toEqual(["linkedin"]);

    const all = cleanChannelPicks(
      ["telegram", "linkedin", "instagram", "website", "reel"].map((platform) => ({ platform, score: 4, recommended: true, angle: "", brief: "" })) as never,
    )!;
    expect(all.filter((pick) => pick.recommended)).toHaveLength(3);
    expect(cleanChannelPicks([])).toBeNull();
  });

  it("orders the channels by the advice and briefs only channels with something to say", () => {
    const picks = cleanChannelPicks([{ platform: "website", score: 5, recommended: true, angle: "Deep", brief: "Long read" }]);
    expect(channelOrder(picks)[0]).toBe("website");
    expect(channelOrder(null)[0]).toBe("telegram");
    expect(pickFor(picks, "website")).toEqual({ angle: "Deep", brief: "Long read" });
    expect(pickFor(picks, "telegram")).toBeUndefined();
  });
});
