import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { aiUsage } from "../db/schema";

/**
 * Counts AI requests per model per day, so the studio can show how much of today's free allowance is
 * used. Free Gemini limits reset at midnight Pacific time, so the day is counted there.
 */
export function usageDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds one request. Counting must never stop the work, so a failure here is only logged. */
export async function recordRequest(model: string, db?: Db): Promise<void> {
  try {
    const database = db ?? (await (await import("../db/client")).getDb());
    await database
      .insert(aiUsage)
      .values({ day: usageDay(), model, requests: 1 })
      .onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: { requests: sql`${aiUsage.requests} + 1` } });
  } catch (error) {
    console.error("Couldn't count an AI request:", error);
  }
}

/** Today's requests by model, most used first. */
export async function todaysUsage(db: Db): Promise<{ model: string; requests: number }[]> {
  const rows = await db.select({ model: aiUsage.model, requests: aiUsage.requests }).from(aiUsage).where(eq(aiUsage.day, usageDay()));
  return rows.sort((a, b) => b.requests - a.requests);
}
