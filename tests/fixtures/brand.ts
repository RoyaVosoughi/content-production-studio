import type { BrandKitFields } from "@/lib/brand-seed";
import { createLocalDb, type Db } from "@/lib/db/client";
import { brandKits } from "@/lib/db/schema";
import { DEFAULT_BLOG_PATH, DEFAULT_COLORS, saveProfile, type Profile } from "@/lib/profile";

// A made-up person for the tests: a bakery consultant who posts in English and Farsi.

export const EXAMPLE_PROFILE: Profile = {
  name: "Sam Rivera",
  languages: ["en", "fa"],
  localNames: { fa: "سم ریورا" },
  headlines: { en: "Automation for small bakeries", fa: "اتوماسیون برای نانوایی‌های کوچک" },
  handles: { instagram: "sam.bakes.ai", youtube: "sambakes", linkedin: "", telegram: "" },
  websiteUrl: "https://sam.example",
  blogPath: DEFAULT_BLOG_PATH,
  colors: DEFAULT_COLORS,
  headingStyle: "serif",
};

export const EXAMPLE_BRAND: Record<"en" | "fa", BrandKitFields> = {
  en: {
    positioning: "Sam Rivera helps small bakeries automate ordering and stock.",
    audience: "Owners of bakeries with one to five shops.",
    pillars: ["Ordering without the phone", "Stock that counts itself"],
    voiceGuide: "Warm, practical and specific. Short sentences.",
    avoid: "Hype. Invented numbers.",
    samples: "",
    searchTopics: ["bakery automation news", "small food business software"],
  },
  fa: {
    positioning: "سم ریورا به نانوایی‌های کوچک کمک می‌کند سفارش و انبار را خودکار کنند.",
    audience: "صاحبان نانوایی‌هایی با یک تا پنج شعبه.",
    pillars: ["سفارش بدون تلفن", "انباری که خودش می‌شمارد"],
    voiceGuide: "گرم، کاربردی و دقیق. جمله‌های کوتاه.",
    avoid: "اغراق. عدد ساختگی.",
    samples: "",
    searchTopics: ["اتوماسیون نانوایی", "نرم‌افزار کسب‌وکار غذایی کوچک"],
  },
};

/** A fresh database with the example person set up, and draft Brand Kits in both languages. */
export async function studioDb(profile: Profile = EXAMPLE_PROFILE): Promise<Db> {
  const db = await createLocalDb();
  await saveProfile(db, profile);
  for (const language of profile.languages) {
    const kit = EXAMPLE_BRAND[language as "en" | "fa"];
    if (kit) await db.insert(brandKits).values({ language, ...kit });
  }
  return db;
}
