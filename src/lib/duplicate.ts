import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { ideas, pieces, publications } from "./db/schema";

/** Common words that say nothing about the topic, in English and Farsi. */
const STOP_WORDS = new Set(
  (
    "the and for with that this from your you are was were how why what when who into about over more most than then they them " +
    "their there here have has had not but can will just like make makes made use using its it's our out all any new one two " +
    "از به با در که این آن را برای تا یک هم یا اما بر هر چه چرا چطور چگونه است هست بود شد می‌شود کنید کردن شما ما خود دیگر نیست"
  ).split(" "),
);

/** The words that carry an idea's topic: lower case, without punctuation, short words or stop words. */
export function topicWords(text: string): Set<string> {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .split(/[^\p{L}\p{N}‌]+/u)
    .map((word) => word.replace(/‌/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return new Set(words);
}

/** How much two texts share, 0 to 1 (the Dice coefficient of their topic words). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** At or above this, a new idea reads as a repeat of something already published. */
export const DUPLICATE_THRESHOLD = 0.45;

export type PublishedIdea = { id: string; title: string; text: string };

/** The closest published idea to a new one, when they share enough to look like a repeat. */
export function closestPublished(text: string, published: PublishedIdea[]) {
  const words = topicWords(text);
  let best: { id: string; title: string; score: number } | null = null;
  for (const item of published) {
    const score = overlap(words, topicWords(item.text));
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) best = { id: item.id, title: item.title, score };
  }
  return best;
}

/** The text compared for repeats: what the idea is about, not why it matters now. */
export function ideaTopic(idea: { title: string; hook: string; angle: string }) {
  return `${idea.title} ${idea.hook} ${idea.angle}`;
}

/** Ideas in this language with at least one post live. Checked with code, so it costs no AI request. */
export async function publishedIdeas(db: Db, language: string): Promise<PublishedIdea[]> {
  const rows = await db
    .selectDistinct({ id: ideas.id, title: ideas.title, hook: ideas.hook, angle: ideas.angle })
    .from(ideas)
    .innerJoin(pieces, eq(pieces.ideaId, ideas.id))
    .innerJoin(publications, eq(publications.pieceId, pieces.id))
    .where(and(eq(ideas.language, language), eq(publications.status, "posted")));
  return rows.map((row) => ({ id: row.id, title: row.title, text: ideaTopic(row) }));
}
