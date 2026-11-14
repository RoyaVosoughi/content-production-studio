import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLocalDb, type Db } from "@/lib/db/client";
import type { PieceContent } from "@/lib/db/schema";
import { EXAMPLE_BRAND as BRAND_SEED, studioDb } from "./fixtures/brand";
import {
  approveAndPublish,
  changePieceWithAi,
  createPieces,
  getPieces,
  markPosted,
  markPostedByHand,
  publishState,
  removePiece,
  restorePieceVersion,
  rewritePieceFromScenario,
  savePieceEdit,
  setPiecePhoto,
  type PublishDeps,
} from "@/lib/content";
import { StudioError } from "@/lib/errors";
import { passingTeam } from "./fakes";
import { contentProblem, slugify, uncheckedLinks, type Platform } from "@/lib/platforms";
import { instagramPublisher, PROCESSING } from "@/lib/publishers/instagram";
import { escapeForLinkedIn, linkedinPublisher } from "@/lib/publishers/linkedin";
import { telegramPostUrl, telegramPublisher } from "@/lib/publishers/telegram";
import { PublishRejected, type Publisher } from "@/lib/publishers/types";
import { websitePublisher } from "@/lib/publishers/website";
import { buildSystemPrompt, createWriter } from "@/lib/ai/writer";
import { hasPlaceholder } from "@/lib/scenario";
import { approveScenario, decideIdea, generateIdeas, getSibling, saveScenarioEdit, writeScenario, type StudioDeps } from "@/lib/studio";

const ARTICLE: PieceContent = { title: "Headline", excerpt: "Summary", tags: ["ai"], body: "## Article" };

function fakeWriter() {
  return {
    generateIdeas: vi.fn(async () => [
      { title: "The Tuesday Test!", hook: "H", angle: "A", whyNow: "N", pillar: "P", sourceUrls: [] },
    ]),
    adaptIdeas: vi.fn(async (_c: unknown, { ideas }: { ideas: { title: string }[] }) =>
      ideas.map((idea) => ({ ...idea, title: "آزمون سه‌شنبه", hook: "H", angle: "A", whyNow: "N", pillar: "P" })),
    ),
    reviseIdea: vi.fn(),
    writeScenario: vi.fn(async () => ({ title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" })),
    adaptScenario: vi.fn(async (_c: unknown, { scenario }: { scenario: object }) => scenario),
    reviseScenario: vi.fn(),
    writePiece: vi.fn(async (_c: { language: string }, { platform }: { platform: Platform }) =>
      platform === "website"
        ? ARTICLE
        : platform === "instagram"
          ? { slides: [{ title: "Cover", text: "" }, { title: "Point", text: "Text" }, { title: "Follow", text: "" }], body: "Caption #ai" }
          : { body: `${platform} post` },
    ),
    revisePiece: vi.fn(async () => ({ body: "AI changed" })),
    planEdit: vi.fn(),
    ...passingTeam(),
  };
}

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return {
    missingSettings: () => [],
    publish: vi.fn(async () => ({ externalId: "42", url: "https://example.com/42" })),
  };
}

let db: Db;
let writer: ReturnType<typeof fakeWriter>;
let deps: StudioDeps;
let publishers: Record<Platform, ReturnType<typeof fakePublisher>>;
let slideImages: Mock<PublishDeps["slideImages"]>;
let ideaId: string;

/** An idea with approved scenarios in both languages. */
beforeEach(async () => {
  db = await studioDb();
  writer = fakeWriter();
  deps = { db, writer: writer as unknown as StudioDeps["writer"], searcher: { search: async () => [{ title: "T", url: "https://e.com", content: "C", publishedDate: null }] } };
  publishers = {
    telegram: fakePublisher(),
    linkedin: fakePublisher(),
    instagram: fakePublisher(),
    website: fakePublisher(),
    reel: fakePublisher(),
    short: fakePublisher(),
    youtube: fakePublisher(),
    linkedin_video: fakePublisher(),
  };
  slideImages = vi.fn<PublishDeps["slideImages"]>(async () => [Buffer.from("one"), Buffer.from("two")]);
  const [idea] = await generateIdeas(deps, "en", "");
  ideaId = idea.id;
  await decideIdea(db, ideaId, "approved");
  await writeScenario(deps, ideaId);
  const sibling = await getSibling(db, idea);
  await approveScenario(db, ideaId, 1);
  await approveScenario(db, sibling!.id, 1);
});

const publishDeps = () => ({ db, publishers, slideImages });
const BOTH = ["en", "fa"] as ("en" | "fa")[];

async function telegramPiece() {
  await createPieces(deps, ideaId, ["telegram"], BOTH);
  const [piece] = await getPieces(db, ideaId);
  return piece;
}

async function siblingId() {
  const [row] = await db.query.ideas.findMany({ where: (idea, { eq }) => eq(idea.id, ideaId) });
  return (await getSibling(db, row))!.id;
}

describe("creating content", () => {
  it("writes each platform in both languages from that language's Brand Kit", async () => {
    await createPieces(deps, ideaId, ["telegram", "website"], BOTH);
    expect(writer.writePiece).toHaveBeenCalledTimes(4);
    const contexts = writer.writePiece.mock.calls.map(([context]) => (context as unknown as { language: string; brand: { voiceGuide: string } }));
    expect(contexts.filter((c) => c.language === "fa").every((c) => c.brand.voiceGuide === BRAND_SEED.fa.voiceGuide)).toBe(true);
    expect((await getPieces(db, ideaId)).map((piece) => piece.platform).sort()).toEqual(["telegram", "website"]);
    expect(await getPieces(db, await siblingId())).toHaveLength(2);
  });

  it("gives both languages of an article one English web address", async () => {
    await createPieces(deps, ideaId, ["website"], BOTH);
    const [en] = await getPieces(db, ideaId);
    const [fa] = await getPieces(db, await siblingId());
    expect(en.current.content.slug).toBe("the-tuesday-test");
    expect(fa.current.content.slug).toBe("the-tuesday-test");
  });

  it("writes only the chosen language, which needs only its own approval", async () => {
    // Farsi has an unapproved edit, so it can't be written, but English can.
    await saveScenarioEdit(db, await siblingId(), 1, { title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" });
    await expect(createPieces(deps, ideaId, ["telegram"], BOTH)).rejects.toThrow("Approve the Farsi scenario");
    await expect(createPieces(deps, ideaId, ["telegram"], ["fa"])).rejects.toThrow("Approve the Farsi scenario");
    expect(writer.writePiece).not.toHaveBeenCalled();

    await createPieces(deps, ideaId, ["telegram"], ["en"]);
    expect(writer.writePiece).toHaveBeenCalledTimes(1);
    expect(writer.writePiece.mock.calls[0][0].language).toBe("en");
    expect(await getPieces(db, ideaId)).toHaveLength(1);
    expect(await getPieces(db, await siblingId())).toHaveLength(0);
  });

  it("adds the other language later with the same article web address", async () => {
    await createPieces(deps, ideaId, ["website"], ["fa"]);
    expect(await getPieces(db, ideaId)).toHaveLength(0);
    await createPieces(deps, ideaId, ["website"], ["en"]);
    const [en] = await getPieces(db, ideaId);
    const [fa] = await getPieces(db, await siblingId());
    expect(fa.current.content.slug).toBe("the-tuesday-test");
    expect(en.current.content.slug).toBe("the-tuesday-test");
  });

  it("needs at least one language", async () => {
    await expect(createPieces(deps, ideaId, ["telegram"], [])).rejects.toThrow("at least one language");
  });

  it("keeps what was written and retries only what failed", async () => {
    writer.writePiece.mockRejectedValueOnce(new StudioError("limit"));
    await expect(createPieces(deps, ideaId, ["telegram"], BOTH)).rejects.toThrow("1 of 2");
    expect(writer.writePiece).toHaveBeenCalledTimes(2);
    await createPieces(deps, ideaId, ["telegram"], BOTH);
    expect(writer.writePiece).toHaveBeenCalledTimes(3);
    await createPieces(deps, ideaId, ["telegram"], BOTH);
    expect(writer.writePiece).toHaveBeenCalledTimes(3);
  });
});

describe("approve and post", () => {
  it("posts only the exact version on screen", async () => {
    const piece = await telegramPiece();
    await savePieceEdit(db, piece.id, 1, { body: "Edited" });
    await expect(approveAndPublish(publishDeps(), piece.id, 1)).rejects.toBeInstanceOf(StudioError);
    expect(publishers.telegram.publish).not.toHaveBeenCalled();

    await approveAndPublish(publishDeps(), piece.id, 2);
    expect(publishers.telegram.publish.mock.calls[0][0].content.body).toBe("Edited");
    const [posted] = await getPieces(db, ideaId);
    expect(posted.publication).toMatchObject({ status: "posted", version: 2, url: "https://example.com/42" });
  });

  it("never posts twice, even from a double click at the same moment", async () => {
    const piece = await telegramPiece();
    const results = await Promise.allSettled([
      approveAndPublish(publishDeps(), piece.id, 1),
      approveAndPublish(publishDeps(), piece.id, 1),
    ]);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(publishers.telegram.publish).toHaveBeenCalledTimes(1);
    await expect(approveAndPublish(publishDeps(), piece.id, 1)).rejects.toThrow("already live");
    expect(publishers.telegram.publish).toHaveBeenCalledTimes(1);
  });

  it("locks a live post against edits", async () => {
    const piece = await telegramPiece();
    await approveAndPublish(publishDeps(), piece.id, 1);
    await expect(savePieceEdit(db, piece.id, 1, { body: "Too late" })).rejects.toThrow("already been sent");
    await expect(changePieceWithAi(deps, piece.id, 1, "x")).rejects.toThrow("already been sent");
    await expect(restorePieceVersion(db, piece.id, 1, 1)).rejects.toThrow("already been sent");
  });

  it("blocks placeholders and content over the limit, and posts nothing", async () => {
    const piece = await telegramPiece();
    await savePieceEdit(db, piece.id, 1, { body: "[Sam: add a story]" });
    await expect(approveAndPublish(publishDeps(), piece.id, 2)).rejects.toThrow("square brackets");
    await savePieceEdit(db, piece.id, 2, { body: "x".repeat(4097) });
    await expect(approveAndPublish(publishDeps(), piece.id, 3)).rejects.toThrow("too long");
    expect(publishers.telegram.publish).not.toHaveBeenCalled();
  });

  it("names the missing setting and records no attempt when a platform isn't connected", async () => {
    const piece = await telegramPiece();
    publishers.telegram.missingSettings = () => ["TELEGRAM_BOT_TOKEN"];
    await expect(approveAndPublish(publishDeps(), piece.id, 1)).rejects.toThrow("TELEGRAM_BOT_TOKEN");
    expect((await getPieces(db, ideaId))[0].publication).toBeNull();
  });

  it("after a refusal, shows why and allows an edit and a retry", async () => {
    const piece = await telegramPiece();
    publishers.telegram.publish.mockRejectedValueOnce(new PublishRejected("Not an admin"));
    await approveAndPublish(publishDeps(), piece.id, 1);
    const [failed] = await getPieces(db, ideaId);
    expect(failed.publication).toMatchObject({ status: "failed", error: "Not an admin" });

    await savePieceEdit(db, piece.id, 1, { body: "Fixed" });
    await approveAndPublish(publishDeps(), piece.id, 2);
    expect((await getPieces(db, ideaId))[0].publication).toMatchObject({ status: "posted", version: 2, error: null });
  });

  it("after a lost connection, sends nothing until Sam has checked", async () => {
    const piece = await telegramPiece();
    publishers.telegram.publish.mockRejectedValueOnce(new Error("timeout"));
    await approveAndPublish(publishDeps(), piece.id, 1);
    expect((await getPieces(db, ideaId))[0].publication?.status).toBe("unknown");

    await expect(approveAndPublish(publishDeps(), piece.id, 1)).rejects.toThrow("Check the platform");
    await expect(savePieceEdit(db, piece.id, 1, { body: "x" })).rejects.toThrow("already been sent");
    expect(publishers.telegram.publish).toHaveBeenCalledTimes(1);

    await approveAndPublish(publishDeps(), piece.id, 1, { checkedNotPosted: true });
    expect(publishers.telegram.publish).toHaveBeenCalledTimes(2);
    expect((await getPieces(db, ideaId))[0].publication?.status).toBe("posted");
  });

  it("lets Sam record that a post with an unknown result did go live", async () => {
    const piece = await telegramPiece();
    publishers.telegram.publish.mockRejectedValueOnce(new Error("timeout"));
    await approveAndPublish(publishDeps(), piece.id, 1);
    await markPosted(db, piece.id);
    expect((await getPieces(db, ideaId))[0].publication?.status).toBe("posted");
    await expect(approveAndPublish(publishDeps(), piece.id, 1, { checkedNotPosted: true })).rejects.toThrow("already live");
    await expect(markPosted(db, piece.id)).rejects.toBeInstanceOf(StudioError);
  });

  it("records a LinkedIn post Sam made by hand, once, for the version on screen", async () => {
    await createPieces(deps, ideaId, ["linkedin"], BOTH);
    const [piece] = await getPieces(db, ideaId);
    await savePieceEdit(db, piece.id, 1, { body: "Edited" });
    await expect(markPostedByHand(db, piece.id, 1)).rejects.toThrow("changed since");
    await expect(markPostedByHand(db, piece.id, 2, "https://evil.example/post")).rejects.toThrow("LinkedIn address");

    await markPostedByHand(db, piece.id, 2, "https://www.linkedin.com/posts/sam-123");
    const [posted] = await getPieces(db, ideaId);
    expect(posted.publication).toMatchObject({ status: "posted", version: 2, url: "https://www.linkedin.com/posts/sam-123" });
    expect(publishers.linkedin.publish).not.toHaveBeenCalled();

    await expect(markPostedByHand(db, piece.id, 2)).rejects.toThrow("already recorded");
    await expect(approveAndPublish(publishDeps(), piece.id, 2)).rejects.toThrow("already live");
    await expect(savePieceEdit(db, piece.id, 2, { body: "Too late" })).rejects.toThrow("already been sent");
  });

  it("won't record a hand-made post that breaks the rules, or one for another platform", async () => {
    await createPieces(deps, ideaId, ["linkedin", "telegram"], BOTH);
    const pieces = await getPieces(db, ideaId);
    const linkedin = pieces.find((piece) => piece.platform === "linkedin")!;
    const telegram = pieces.find((piece) => piece.platform === "telegram")!;
    await savePieceEdit(db, linkedin.id, 1, { body: "[Sam: add a story]" });
    await expect(markPostedByHand(db, linkedin.id, 2)).rejects.toThrow("square brackets");
    await expect(markPostedByHand(db, telegram.id, 1)).rejects.toThrow("can't be recorded by hand");
    expect((await getPieces(db, ideaId)).every((piece) => piece.publication === null)).toBe(true);
  });

  it("treats a send that never reported back as unknown", () => {
    const now = Date.now();
    expect(publishState({ status: "sending", updatedAt: new Date(now - 60_000) }, now)).toBe("sending");
    expect(publishState({ status: "sending", updatedAt: new Date(now - 6 * 60_000) }, now)).toBe("unknown");
    expect(publishState(null)).toBe("draft");
  });

  it("one language failing doesn't affect the other", async () => {
    await createPieces(deps, ideaId, ["telegram"], BOTH);
    const [en] = await getPieces(db, ideaId);
    const [fa] = await getPieces(db, await siblingId());
    publishers.telegram.publish.mockRejectedValueOnce(new PublishRejected("No"));
    await approveAndPublish(publishDeps(), en.id, 1);
    await approveAndPublish(publishDeps(), fa.id, 1);
    expect((await getPieces(db, ideaId))[0].publication?.status).toBe("failed");
    expect((await getPieces(db, await siblingId()))[0].publication?.status).toBe("posted");
  });

  it("requires one web address across both languages of an article", async () => {
    await createPieces(deps, ideaId, ["website"], BOTH);
    const [en] = await getPieces(db, ideaId);
    await savePieceEdit(db, en.id, 1, { ...en.current.content, slug: "another-address" });
    await expect(approveAndPublish(publishDeps(), en.id, 2)).rejects.toThrow("same web address");
    expect(publishers.website.publish).not.toHaveBeenCalled();
  });
});

describe("removing a post", () => {
  it("removes a draft from the idea, and the platform can be added again", async () => {
    const piece = await telegramPiece();
    await removePiece(publishDeps(), piece.id);
    expect((await getPieces(db, ideaId)).map((row) => row.id)).not.toContain(piece.id);
    await createPieces(deps, ideaId, ["telegram"], BOTH);
    expect((await getPieces(db, ideaId)).some((row) => row.platform === "telegram")).toBe(true);
  });

  it("deletes a live post from the network first, when the studio can", async () => {
    const unpublish = vi.fn(async () => {});
    Object.assign(publishers.telegram, { canUnpublish: () => true, unpublish });
    const piece = await telegramPiece();
    await approveAndPublish(publishDeps(), piece.id, 1);
    await removePiece(publishDeps(), piece.id);
    expect(unpublish).toHaveBeenCalledWith("42");
    expect((await getPieces(db, ideaId)).map((row) => row.id)).not.toContain(piece.id);
  });

  it("keeps the post when the network refuses to delete it, until Sam deletes it there", async () => {
    Object.assign(publishers.telegram, {
      canUnpublish: () => true,
      unpublish: vi.fn(async () => {
        throw new Error("Too old to delete.");
      }),
    });
    const piece = await telegramPiece();
    await approveAndPublish(publishDeps(), piece.id, 1);
    await expect(removePiece(publishDeps(), piece.id)).rejects.toThrow("Too old to delete.");
    expect((await getPieces(db, ideaId)).map((row) => row.id)).toContain(piece.id);
    await removePiece(publishDeps(), piece.id, { byHand: true });
    expect((await getPieces(db, ideaId)).map((row) => row.id)).not.toContain(piece.id);
  });

  it("asks Sam to delete a post made by hand on the network first", async () => {
    await createPieces(deps, ideaId, ["linkedin"], BOTH);
    const [piece] = await getPieces(db, ideaId);
    await markPostedByHand(db, piece.id, 1, "https://www.linkedin.com/posts/sam-123");
    await expect(removePiece(publishDeps(), piece.id)).rejects.toThrow("Delete it there yourself");
    await removePiece(publishDeps(), piece.id, { byHand: true });
    expect((await getPieces(db, ideaId)).map((row) => row.id)).not.toContain(piece.id);
  });
});

describe("changing a post", () => {
  it("keeps article fields when AI changes only the text, and keeps history", async () => {
    await createPieces(deps, ideaId, ["website"], BOTH);
    const [piece] = await getPieces(db, ideaId);
    await changePieceWithAi(deps, piece.id, 1, "Shorter");
    const [changed] = await getPieces(db, ideaId);
    expect(changed.current.content).toMatchObject({ body: "AI changed", title: "Headline", slug: "the-tuesday-test" });
    await restorePieceVersion(db, piece.id, 2, 1);
    const [restored] = await getPieces(db, ideaId);
    expect(restored.currentVersion).toBe(3);
    expect(restored.current.content.body).toBe("## Article");
  });

  it("rewrites from the current scenario once it's approved again", async () => {
    const piece = await telegramPiece();
    await saveScenarioEdit(db, ideaId, 1, { title: "New", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" });
    await expect(rewritePieceFromScenario(deps, piece.id, 1)).rejects.toThrow("Approve the scenario");
    await approveScenario(db, ideaId, 2);
    await rewritePieceFromScenario(deps, piece.id, 1);
    expect((await getPieces(db, ideaId))[0].current.scenarioVersion).toBe(2);
  });
});

describe("content rules", () => {
  it("doesn't mistake a Markdown link for a placeholder", async () => {
    const { hasPlaceholder } = await import("@/lib/scenario");
    expect(hasPlaceholder({ body: "See [the report](https://e.com)." })).toBe(false);
    expect(hasPlaceholder({ body: "See [Sam: add link]." })).toBe(true);
  });

  it("flags links that didn't come from the search", () => {
    expect(
      uncheckedLinks("Real https://e.com/a, made up (https://fake.example/b). Mine https://sam.example/en", [{ url: "https://e.com/a" }], "https://sam.example"),
    ).toEqual(["https://fake.example/b"]);
  });

  it("checks articles against the website's own rules", () => {
    const good = { title: "T", excerpt: "E", slug: "a-b", tags: ["x"], body: "B" };
    expect(contentProblem("website", good)).toBeNull();
    expect(contentProblem("website", { ...good, slug: "فارسی" })).toContain("web address");
    expect(contentProblem("website", { ...good, title: "" })).toContain("title");
    expect(contentProblem("telegram", { body: "ok" })).toBeNull();
    expect(slugify(" Why AI -- Fails! ")).toBe("why-ai-fails");
  });
});

describe("Instagram", () => {
  const slides = (count: number) => Array.from({ length: count }, (_, i) => ({ title: `Slide ${i + 1}`, text: "Text" }));

  it("checks slides, their length and the hashtag limit", () => {
    expect(contentProblem("instagram", { body: "Caption", slides: slides(3) })).toBeNull();
    expect(contentProblem("instagram", { body: "Caption", slides: [] })).toContain("1 to 10 slides");
    expect(contentProblem("instagram", { body: "Caption", slides: slides(11) })).toContain("1 to 10 slides");
    expect(contentProblem("instagram", { body: "C", slides: [{ title: "", text: "x" }] })).toContain("Slide 1 needs a title");
    expect(contentProblem("instagram", { body: "C", slides: [{ title: "T", text: "x".repeat(301) }] })).toContain("slide 1");
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
    expect(contentProblem("instagram", { body: tags, slides: slides(2) })).toContain("30 hashtags");
    expect(contentProblem("instagram", { body: "#هوش_مصنوعی", slides: slides(2) })).toBeNull();
  });

  it("finds a placeholder inside a slide, and nothing in clean slides", () => {
    expect(hasPlaceholder({ body: "Caption", slides: slides(2) })).toBe(false);
    expect(hasPlaceholder({ body: "Caption", slides: [{ title: "T", text: "[Sam: add a number]" }] })).toBe(true);
  });

  it("writes a carousel with its own job, different from the other platforms", async () => {
    const generate = vi.fn(async (_system: string, _prompt: string, schema: { parse: (v: unknown) => unknown }) =>
      schema.parse({ slides: slides(5), body: "Caption #ai" }),
    );
    const writer = createWriter(generate as never);
    const context = { language: "en" as const, brand: BRAND_SEED.en };
    const scenario = { title: "S", hook: "H", mainPoints: ["1"], angle: "A", example: "E", callToAction: "C" };
    const written = await writer.writePiece(context, { platform: "instagram", scenario, sources: [] });
    expect(written.slides).toHaveLength(5);
    const prompt = generate.mock.calls[0][1];
    expect(prompt).toContain("Instagram carousel");
    expect(prompt).toContain("would look out of place pasted on another");
    await writer.writePiece(context, { platform: "telegram", scenario, sources: [] }).catch(() => undefined);
    // Each channel's job is in its writer's Skill, in the system prompt.
    expect(generate.mock.calls[1][0]).toContain("insider note");
    expect(generate.mock.calls[0][0]).toContain("teaches one thing visually");
    expect(buildSystemPrompt(context)).not.toContain("Instagram carousel");
  });

  it("posts the slides of the exact version on screen, named by post and version", async () => {
    await createPieces(deps, ideaId, ["instagram"], ["en"]);
    const [piece] = await getPieces(db, ideaId);
    await savePieceEdit(db, piece.id, 1, { body: "Edited caption", slides: [{ title: "Only", text: "" }, { title: "Two", text: "" }] });
    await approveAndPublish(publishDeps(), piece.id, 2);
    const call = publishers.instagram.publish.mock.calls[0][0];
    expect(call.key).toBe(`${piece.id}-v2`);
    expect(call.content.body).toBe("Edited caption");
    await call.images();
    expect(slideImages).toHaveBeenCalledWith(call.content, "en", expect.objectContaining({ label: "@sam.bakes.ai" }));
    expect(publishers.telegram.publish).not.toHaveBeenCalled();
  });

  it("keeps the cover photo through text edits, and only Instagram posts have one", async () => {
    await createPieces(deps, ideaId, ["instagram", "telegram"], ["en"]);
    const pieces = await getPieces(db, ideaId);
    const instagram = pieces.find((piece) => piece.platform === "instagram")!;
    const telegram = pieces.find((piece) => piece.platform === "telegram")!;
    await setPiecePhoto(db, instagram.id, 1, "11111111-1111-4111-8111-111111111111.jpg");
    await savePieceEdit(db, instagram.id, 2, { body: "New caption" });
    let [current] = (await getPieces(db, ideaId)).filter((piece) => piece.platform === "instagram");
    expect(current.current.content.photo).toBe("11111111-1111-4111-8111-111111111111.jpg");
    await setPiecePhoto(db, instagram.id, 3, null);
    [current] = (await getPieces(db, ideaId)).filter((piece) => piece.platform === "instagram");
    expect(current.current.content.photo).toBeUndefined();
    expect(current.currentVersion).toBe(4);
    await expect(setPiecePhoto(db, telegram.id, 1, "x.jpg")).rejects.toThrow("Only Instagram");
  });

  it("records an Instagram post made by hand only with an Instagram link", async () => {
    await createPieces(deps, ideaId, ["instagram"], ["en"]);
    const [piece] = await getPieces(db, ideaId);
    await expect(markPostedByHand(db, piece.id, 1, "https://www.linkedin.com/posts/x")).rejects.toThrow("Instagram address");
    await markPostedByHand(db, piece.id, 1, "https://www.instagram.com/p/abc123/");
    expect((await getPieces(db, ideaId))[0].publication).toMatchObject({ status: "posted", url: "https://www.instagram.com/p/abc123/" });
  });
});

describe("platform connectors", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (status: number, body: unknown, headers?: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers });
  const input = {
    language: "fa" as const,
    content: { body: "سلام", title: "T", excerpt: "E", slug: "a-b", tags: ["x"] },
    key: "piece-v1",
    images: async () => [] as Buffer[],
    profile: { websiteUrl: "https://sam.example", blogPath: "/{lang}/blog/{slug}" },
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
    vi.stubEnv("TELEGRAM_CHANNEL_ID", "-100123");
    vi.stubEnv("LINKEDIN_ACCESS_TOKEN", "li-token");
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_abc");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("Telegram", () => {
    it("sends the text unchanged and links a private channel's post", async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: { message_id: 7, chat: { id: -100123 } } }));
      await expect(telegramPublisher.publish(input)).resolves.toEqual({ externalId: "7", url: "https://t.me/c/123/7" });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/botbot-token/sendMessage");
      expect(JSON.parse(options.body)).toEqual({ chat_id: "-100123", text: "سلام" });
      expect(telegramPostUrl({ id: -1, username: "sambakes" }, 5)).toBe("https://t.me/sambakes/5");
    });

    it("treats a refusal as safe to retry, and a server or connection failure as unknown", async () => {
      fetchMock.mockResolvedValueOnce(json(403, { ok: false, error_code: 403, description: "Forbidden" }));
      await expect(telegramPublisher.publish(input)).rejects.toBeInstanceOf(PublishRejected);
      fetchMock.mockResolvedValueOnce(json(429, { ok: false, error_code: 429, parameters: { retry_after: 9 } }));
      await expect(telegramPublisher.publish(input)).rejects.toThrow("9 seconds");
      fetchMock.mockResolvedValueOnce(json(502, { ok: false, error_code: 502 }));
      await expect(telegramPublisher.publish(input)).rejects.not.toBeInstanceOf(PublishRejected);
      fetchMock.mockRejectedValueOnce(new Error("timeout"));
      await expect(telegramPublisher.publish(input)).rejects.not.toBeInstanceOf(PublishRejected);
    });

    it("deletes a post, counts one already gone as deleted, and explains the 48-hour limit", async () => {
      fetchMock.mockResolvedValueOnce(json(200, { ok: true, result: true }));
      await telegramPublisher.unpublish!("7");
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/botbot-token/deleteMessage");
      expect(JSON.parse(options.body)).toEqual({ chat_id: "-100123", message_id: 7 });
      fetchMock.mockResolvedValueOnce(json(400, { ok: false, error_code: 400, description: "Bad Request: message to delete not found" }));
      await expect(telegramPublisher.unpublish!("7")).resolves.toBeUndefined();
      fetchMock.mockResolvedValueOnce(json(400, { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" }));
      await expect(telegramPublisher.unpublish!("7")).rejects.toThrow("48 hours");
    });
  });

  describe("LinkedIn", () => {
    it("escapes reserved characters but keeps hashtags", () => {
      expect(escapeForLinkedIn("Costs (a lot) *now* #AI #هوش_مصنوعی # alone")).toBe(
        "Costs \\(a lot\\) \\*now\\* #AI #هوش_مصنوعی \\# alone",
      );
    });

    it("posts as the signed-in member with the required headers", async () => {
      fetchMock
        .mockResolvedValueOnce(json(200, { sub: "abc" }))
        .mockResolvedValueOnce(json(201, {}, { "x-restli-id": "urn:li:share:9" }));
      await expect(linkedinPublisher.publish(input)).resolves.toEqual({
        externalId: "urn:li:share:9",
        url: "https://www.linkedin.com/feed/update/urn:li:share:9/",
      });
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toBe("https://api.linkedin.com/rest/posts");
      expect(options.headers["Linkedin-Version"]).toMatch(/^\d{6}$/);
      expect(options.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
      expect(JSON.parse(options.body)).toMatchObject({ author: "urn:li:person:abc", commentary: "سلام", visibility: "PUBLIC", lifecycleState: "PUBLISHED" });
    });

    it("explains an expired token, and never reports a server failure as a safe retry", async () => {
      fetchMock.mockResolvedValueOnce(json(401, {}));
      await expect(linkedinPublisher.publish(input)).rejects.toThrow("60 days");
      fetchMock.mockResolvedValueOnce(json(200, { sub: "abc" })).mockResolvedValueOnce(json(503, {}));
      await expect(linkedinPublisher.publish(input)).rejects.not.toBeInstanceOf(PublishRejected);
      fetchMock.mockResolvedValueOnce(json(200, { sub: "abc" })).mockRejectedValueOnce(new Error("timeout"));
      await expect(linkedinPublisher.publish(input)).rejects.not.toBeInstanceOf(PublishRejected);
    });
  });

  describe("Website", () => {
    it("publishes a row in the shape the website reads", async () => {
      fetchMock.mockResolvedValueOnce(json(200, [])).mockResolvedValueOnce(json(201, [{ id: "row1" }]));
      await expect(websitePublisher.publish(input)).resolves.toEqual({
        externalId: "row1",
        url: "https://sam.example/fa/blog/a-b",
      });
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toBe("https://x.supabase.co/rest/v1/blog_posts");
      expect(options.headers.apikey).toBe("sb_secret_abc");
      expect(options.headers.Authorization).toBeUndefined();
      const row = JSON.parse(options.body);
      expect(row).toMatchObject({ locale: "fa", slug: "a-b", title: "T", excerpt: "E", body_md: "سلام", tags: ["x"], status: "published" });
      expect(row.published_at).toBeTruthy();
    });

    it("sends an older service_role key in both headers", async () => {
      vi.stubEnv("SUPABASE_SECRET_KEY", "eyJold");
      fetchMock.mockResolvedValueOnce(json(200, [])).mockResolvedValueOnce(json(201, [{ id: "r" }]));
      await websitePublisher.publish(input);
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer eyJold");
    });

    it("recognises its own earlier post on a retry instead of publishing again", async () => {
      fetchMock.mockResolvedValueOnce(json(200, [{ id: "row1", status: "published", body_md: "سلام" }]));
      await expect(websitePublisher.publish(input)).resolves.toMatchObject({ externalId: "row1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("won't overwrite a different article or draft at the same address", async () => {
      fetchMock.mockResolvedValueOnce(json(200, [{ id: "other", status: "draft", body_md: "other" }]));
      await expect(websitePublisher.publish(input)).rejects.toThrow("already used");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports a bad key clearly, and a lost connection during the write as unknown", async () => {
      fetchMock.mockResolvedValueOnce(json(401, {}));
      await expect(websitePublisher.publish(input)).rejects.toThrow("SUPABASE_SECRET_KEY");
      fetchMock.mockResolvedValueOnce(json(200, [])).mockRejectedValueOnce(new Error("timeout"));
      await expect(websitePublisher.publish(input)).rejects.not.toBeInstanceOf(PublishRejected);
    });
  });

  describe("Instagram", () => {
    const post = { ...input, content: { body: "Caption #ai", slides: [] }, images: async () => [Buffer.from("a"), Buffer.from("b")] };
    beforeEach(() => {
      PROCESSING.delayMs = 0;
    });

    /** Answers each request by its address, in the order Instagram's steps happen. */
    function instagramFlow(overrides: { publish?: () => Response | Promise<Response>; status?: string } = {}) {
      let child = 0;
      fetchMock.mockImplementation(async (url: string, options: { method?: string; body?: URLSearchParams } = {}) => {
        if (url.includes("/storage/v1/bucket")) return json(200, { name: "studio-media" });
        if (url.includes("/storage/v1/object/")) return json(200, { Key: "ok" });
        if (url.includes("/me?")) return json(200, { user_id: "17841" });
        if (url.endsWith("/17841/media") && options.body?.get("is_carousel_item")) return json(200, { id: `child${++child}` });
        if (url.endsWith("/17841/media")) return json(200, { id: "carousel1" });
        if (url.includes("/carousel1?")) return json(200, { status_code: overrides.status ?? "FINISHED" });
        if (url.endsWith("/17841/media_publish")) return overrides.publish ? overrides.publish() : json(200, { id: "media9" });
        if (url.includes("/media9?")) return json(200, { permalink: "https://www.instagram.com/p/xyz/" });
        throw new Error(`Unexpected request ${url}`);
      });
    }

    it("uploads the slides, builds a carousel and returns the post's link", async () => {
      instagramFlow();
      await expect(instagramPublisher.publish(post)).resolves.toEqual({ externalId: "media9", url: "https://www.instagram.com/p/xyz/" });
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls).toContain("https://x.supabase.co/storage/v1/object/studio-media/instagram/piece-v1-1.jpg");
      expect(urls).toContain("https://x.supabase.co/storage/v1/object/studio-media/instagram/piece-v1-2.jpg");
      const carousel = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith("/17841/media") && options.body.get("media_type"));
      expect(carousel![1].body.get("children")).toBe("child1,child2");
      expect(carousel![1].body.get("caption")).toBe("Caption #ai");
      const firstChild = fetchMock.mock.calls.find(([, options]) => options?.body?.get?.("is_carousel_item"));
      expect(firstChild![1].body.get("image_url")).toBe("https://x.supabase.co/storage/v1/object/public/studio-media/instagram/piece-v1-1.jpg");
      expect(firstChild![1].body.get("access_token")).toBe("ig-token");
      const upload = fetchMock.mock.calls.find(([url]) => String(url).includes("/object/studio-media/"));
      expect(upload![1].headers).toMatchObject({ apikey: "sb_secret_abc", "x-upsert": "true", "Content-Type": "image/jpeg" });
    });

    it("treats any failure before publishing as safe to retry", async () => {
      instagramFlow();
      fetchMock.mockImplementationOnce(async () => {
        throw new Error("network down");
      });
      await expect(instagramPublisher.publish(post)).rejects.toBeInstanceOf(PublishRejected);
      instagramFlow({ status: "ERROR" });
      await expect(instagramPublisher.publish(post)).rejects.toThrow("couldn't process");
      await expect(instagramPublisher.publish({ ...post, images: async () => Promise.reject(new Error("no Chrome")) })).rejects.toBeInstanceOf(
        PublishRejected,
      );
    });

    it("reports a lost connection while publishing as unknown, and a refusal as safe", async () => {
      instagramFlow({ publish: () => Promise.reject(new Error("timeout")) });
      const lost = await instagramPublisher.publish(post).catch((error) => error);
      expect(lost).not.toBeInstanceOf(PublishRejected);
      instagramFlow({ publish: () => json(400, { error: { code: 190, message: "expired" } }) });
      await expect(instagramPublisher.publish(post)).rejects.toThrow("INSTAGRAM_ACCESS_TOKEN");
    });

    it("posts a single slide as a single image", async () => {
      instagramFlow();
      fetchMock.mockImplementation(async (url: string, options: { body?: URLSearchParams } = {}) => {
        if (url.includes("/storage/v1/")) return json(200, {});
        if (url.includes("/me?")) return json(200, { user_id: "17841" });
        if (url.endsWith("/17841/media")) {
          expect(options.body?.get("media_type")).toBeNull();
          expect(options.body?.get("caption")).toBe("Caption #ai");
          return json(200, { id: "carousel1" });
        }
        if (url.includes("/carousel1?")) return json(200, { status_code: "FINISHED" });
        if (url.endsWith("/media_publish")) return json(200, { id: "media9" });
        return json(500, {});
      });
      await expect(instagramPublisher.publish({ ...post, images: async () => [Buffer.from("a")] })).resolves.toEqual({
        externalId: "media9",
        url: null,
      });
    });

    it("needs the Instagram token and the Supabase settings", () => {
      vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "");
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      vi.stubEnv("WEBSITE_SUPABASE_KEY", "");
      expect(instagramPublisher.missingSettings()).toEqual(["INSTAGRAM_ACCESS_TOKEN", "SUPABASE_SECRET_KEY"]);
    });
  });

});
