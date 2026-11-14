import { describe, expect, it } from "vitest";
import { interviewDocument, interviewIsEnough } from "@/lib/brand-interview";
import { createLocalDb } from "@/lib/db/client";
import { ideas, pieces, scenarios } from "@/lib/db/schema";
import { saveProfile } from "@/lib/profile";
import { nextStep, studioProgress } from "@/lib/progress";
import { saveBrandKit } from "@/lib/studio";
import { EXAMPLE_BRAND, EXAMPLE_PROFILE } from "./fixtures/brand";

describe("the brand interview", () => {
  it("needs who you are, and who you write for or what about", () => {
    expect(interviewIsEnough({ who: "A designer" })).toBe(false);
    expect(interviewIsEnough({ who: "A designer", topics: "Checkout design" })).toBe(true);
    expect(interviewIsEnough({ audience: "Shop owners", topics: "Checkout" })).toBe(false);
  });

  it("becomes a short brand document with only the questions you answered", () => {
    const text = interviewDocument({ who: "A designer", audience: "Shop owners", avoid: "  " });
    expect(text).toContain("## Who are you and what do you do?\nA designer");
    expect(text).toContain("Shop owners");
    expect(text).not.toContain("never do or say");
  });
});

describe("the steps through the studio", () => {
  it("sends a new person to Setup, then to the Brand, then step by step to the next thing to do", async () => {
    const db = await createLocalDb();
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "setup", href: "/en/setup" });

    await saveProfile(db, { ...EXAMPLE_PROFILE, languages: ["en"] });
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "brand", href: "/en/brand" });

    await saveBrandKit(db, "en", EXAMPLE_BRAND.en);
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "idea", href: "/en" });

    const [idea] = await db
      .insert(ideas)
      .values({ language: "en", title: "T", hook: "H", angle: "A", whyNow: "N", pillar: "P", sources: [], status: "approved" })
      .returning();
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "scenario", href: `/en/ideas/${idea.id}` });

    await db.insert(scenarios).values({ ideaId: idea.id, currentVersion: 1, approvedVersion: 1 });
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "posts", href: `/en/ideas/${idea.id}/content` });

    await db.insert(pieces).values({ ideaId: idea.id, platform: "linkedin", currentVersion: 1 });
    expect(nextStep(await studioProgress(db, "en", "en"))).toMatchObject({ id: "publish", href: `/en/ideas/${idea.id}/content` });
  });
});
