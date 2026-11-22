import { and, desc, eq, ne } from "drizzle-orm";
import type { Db } from "./db/client";
import { ideas, pieceVersions, pieces, publications } from "./db/schema";
import { overlap, topicWords } from "./text-overlap";

export { overlap, topicWords };

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

/**
 * The texts of your latest live posts on one network in one language, other than this idea's, as
 * they went out. The ready check compares a new post with them to notice a repeat.
 */
export async function recentPosts(db: Db, platform: string, language: string, exceptIdea: string, limit = 30) {
  const rows = await db
    .select({ title: ideas.title, content: pieceVersions.content })
    .from(publications)
    .innerJoin(pieces, eq(pieces.id, publications.pieceId))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, publications.version)))
    .where(and(eq(publications.status, "posted"), eq(pieces.platform, platform), eq(ideas.language, language), ne(ideas.id, exceptIdea)))
    .orderBy(desc(publications.postedAt))
    .limit(limit);
  return rows.map((row) => ({ title: row.content.title || row.title, body: row.content.body }));
}
