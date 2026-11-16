import { describe, expect, it } from "vitest";
import { cleanImage, draftPoints, imageAlt, imageHtml, imageProblem, suggestImage } from "@/lib/post-image";

const BRAND = {
  label: "Sam Bakes",
  colors: { primary: "#1d3fd6", dark: "#0b1640", light: "#f6f1e8", highlight: "#f5a524" },
  headingStyle: "serif" as const,
};

describe("post images", () => {
  it("drafts a wide title card for an article from its title and summary", () => {
    expect(suggestImage("website", { title: "Why bread rises", excerpt: "Yeast, sugar and time. Then some.", body: "## x" })).toEqual({
      kind: "cover",
      size: "wide",
      heading: "Why bread rises",
      text: "Yeast, sugar and time.",
      items: [],
    });
  });

  it("drafts key points from a LinkedIn list, and a quote from any other post", () => {
    const listed = suggestImage("linkedin", { body: "Three things I learned.\n\n- Rest the dough\n- Use **less** salt\n1) Bake hot" });
    expect(listed).toMatchObject({ kind: "points", size: "square", heading: "Three things I learned." });
    expect(listed.items).toEqual(["Rest the dough", "Use less salt", "Bake hot"]);
    expect(suggestImage("linkedin", { body: "مدیران فکر می‌کنند مسئله تمام شده است؛\nاما نه." }).heading).toBe("مدیران فکر می‌کنند مسئله تمام شده است");
    expect(suggestImage("linkedin", { body: "نان خوب صبر می‌خواهد. بقیه‌اش تمرین است." })).toMatchObject({
      kind: "quote",
      heading: "نان خوب صبر می‌خواهد.",
    });
    expect(draftPoints("One idea. Second idea here. Third one now. Fourth.")).toEqual(["Second idea here.", "Third one now.", "Fourth."]);
  });

  it("keeps only what the template can draw, and says what's missing", () => {
    const image = cleanImage({ kind: "points", size: "huge", heading: "  H  ", items: ["a", "", "b", "c", "d", "e", "f"], photo: "x.jpg" });
    expect(image).toEqual({ kind: "points", size: "square", heading: "H", text: "", items: ["a", "b", "c", "d", "e"] });
    expect(cleanImage({ kind: "cover", heading: "H", photo: "../secret" })).not.toHaveProperty("photo");
    expect(cleanImage({ kind: "cover", heading: "H", photo: "abc.jpg" })?.photo).toBe("abc.jpg");
    expect(cleanImage("nope")).toBeNull();
    expect(imageProblem({ kind: "quote", size: "square", heading: "", text: "", items: [] })).toMatch("quote");
    expect(imageProblem({ kind: "points", size: "square", heading: "H", text: "", items: ["one"] })).toMatch("two points");
    expect(imageAlt({ kind: "points", size: "square", heading: "H", text: "", items: ["a", "b"] })).toBe("H. a. b");
  });

  it("draws in the brand's colours, right to left for Farsi, with the text escaped", () => {
    const html = imageHtml(
      { kind: "points", size: "wide", heading: "<b>سه نکته</b>", text: "", items: ["یک", "دو"] },
      { language: "fa", brand: BRAND },
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("width: 1200px; height: 630px");
    expect(html).toContain("#0b1640");
    expect(html).toContain("&lt;b&gt;سه نکته&lt;/b&gt;");
    expect(html).toContain('<span class="n">۲</span>');
    expect(html).toContain("Vazirmatn");
    expect(html).toContain("Sam Bakes");

    const quote = imageHtml({ kind: "quote", size: "square", heading: "Bake hot.", text: "", items: [] }, { language: "en", brand: BRAND });
    expect(quote).not.toContain("— Sam Bakes");
    expect(imageHtml({ kind: "quote", size: "square", heading: "Q", text: "Grandma", items: [] }, { language: "en", brand: BRAND })).toContain("— Grandma");
    expect(quote).toContain("Fraunces");
    const cover = imageHtml({ kind: "cover", size: "portrait", heading: "H", text: "", items: [], photo: "p.jpg" }, { language: "en", brand: BRAND, photoSrc: "/api/media/p.jpg" });
    expect(cover).toContain('class="cover has-photo"');
    expect(cover).toContain('src="/api/media/p.jpg"');
  });
});
