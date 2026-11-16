import type { UiLanguage } from "../language";
import type { Platform } from "../platforms";

/**
 * The content team. Each agent has one job and its own lessons, so a lesson about LinkedIn
 * never leaks into Telegram. The manager checks the workers' drafts; the coach turns feedback
 * into lessons.
 */
export const AGENT_IDS = [
  "scout",
  "storyteller",
  "telegram",
  "linkedin",
  "carousel",
  "scriptwriter",
  "blogger",
  "editor",
  "manager",
  "coach",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** A draft scoring this or more goes to the author as it is; below it, the writer gets one more try. */
export const PASS_SCORE = 7;

/**
 * The longest each instructions box may be: long enough for a full brief, short enough that every
 * prompt stays cheap on the free models. Kept here so the browser can use it without the database code.
 */
export const INSTRUCTIONS_LENGTH = 3000;

/** The longest a Skill may be. Every request carries the agent's Skill, so it stays short enough to be cheap. */
export const SKILL_LENGTH = 8000;

/** Agents whose work is checked by the manager and taught by the coach. The coach teaches the manager too. */
export const LEARNING_AGENTS: AgentId[] = AGENT_IDS.filter((id) => id !== "coach");

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

type AgentProfile = {
  name: Record<UiLanguage, string>;
  /** What the agent does, for the Team page. */
  job: Record<UiLanguage, string>;
  /** A sample instruction, shown in the empty box on the agent's page. */
  example: Record<UiLanguage, string>;
};

export const AGENTS: Record<AgentId, AgentProfile> = {
  scout: {
    name: { en: "Idea Scout", fa: "ایده‌یاب" },
    job: {
      en: "Reads this week's news and finds fresh ideas that fit your brand.",
      fa: "اخبار این هفته را می‌خواند و ایده‌های تازه‌ای پیدا می‌کند که به برند شما می‌خورد.",
    },
    example: {
      en: "Prefer ideas about AI tools for small businesses. Skip crypto news.",
      fa: "ایده‌های مربوط به ابزارهای هوش مصنوعی برای کسب‌وکارهای کوچک را ترجیح بده. اخبار کریپتو را کنار بگذار.",
    },
  },
  storyteller: {
    name: { en: "Scenario Writer", fa: "سناریونویس" },
    job: {
      en: "Turns an approved idea into the core story every post is built from, and recommends the 1 to 3 channels it fits best, with a brief for each.",
      fa: "ایده‌ی تأییدشده را به داستان اصلی‌ای تبدیل می‌کند که همه‌ی پست‌ها از آن ساخته می‌شوند، و ۱ تا ۳ کانالی را که بیشترین تناسب را دارند، هر کدام با یک brief، پیشنهاد می‌دهد.",
    },
    example: {
      en: "Build every story around one real problem my clients have.",
      fa: "هر داستان را حول یک مشکل واقعی مشتری‌هایم بساز.",
    },
  },
  telegram: {
    name: { en: "Telegram Writer", fa: "نویسنده‌ی تلگرام" },
    job: {
      en: "Writes the short insider note for your Telegram channel.",
      fa: "یادداشت کوتاه و خودمانی کانال تلگرام را می‌نویسد.",
    },
    example: {
      en: "Start with a short personal line, like a note to a friend.",
      fa: "با یک جمله‌ی کوتاه و شخصی شروع کن، مثل پیامی به یک دوست.",
    },
  },
  linkedin: {
    name: { en: "LinkedIn Writer", fa: "نویسنده‌ی لینکدین" },
    job: {
      en: "Writes the business case for business owners on LinkedIn.",
      fa: "نسخه‌ی کسب‌وکاری را برای صاحبان کسب‌وکار در لینکدین می‌نویسد.",
    },
    example: {
      en: "Open with a result or a number, never with a question.",
      fa: "با یک نتیجه یا عدد شروع کن، هیچ‌وقت با سؤال.",
    },
  },
  carousel: {
    name: { en: "Instagram Carousel Designer", fa: "طراح کاروسل اینستاگرام" },
    job: {
      en: "Writes Instagram carousels that teach one thing, slide by slide.",
      fa: "کاروسل اینستاگرام را می‌نویسد که اسلاید به اسلاید یک چیز را آموزش می‌دهد.",
    },
    example: {
      en: "Keep slide text very short: one idea, one sentence per slide.",
      fa: "متن اسلایدها را خیلی کوتاه نگه دار: هر اسلاید یک ایده و یک جمله.",
    },
  },
  scriptwriter: {
    name: { en: "Video Scriptwriter", fa: "فیلمنامه‌نویس ویدیو" },
    job: {
      en: "Writes the script and shot list you film for Reels, Shorts, YouTube and LinkedIn video.",
      fa: "متن و فهرست نماهایی را می‌نویسد که برای ریلز، شورتز، یوتیوب و ویدیوی لینکدین فیلم می‌گیرید.",
    },
    example: {
      en: "Keep Reels under 45 seconds. Show the result first, then how.",
      fa: "ریلز را زیر ۴۵ ثانیه نگه دار. اول نتیجه را نشان بده، بعد روش را.",
    },
  },
  blogger: {
    name: { en: "Blog Writer", fa: "نویسنده‌ی وبلاگ" },
    job: {
      en: "Writes the in-depth article for your website.",
      fa: "مقاله‌ی کامل و عمیق وب‌سایت را می‌نویسد.",
    },
    example: {
      en: "Add a short summary at the top and a checklist at the end.",
      fa: "بالای مقاله یک خلاصه‌ی کوتاه و آخرش یک چک‌لیست بگذار.",
    },
  },
  editor: {
    name: { en: "Video Editor", fa: "تدوینگر" },
    job: {
      en: "Reads your clip's transcript and plans the cuts, captions and motion.",
      fa: "متن کلیپ شما را می‌خواند و برش‌ها، زیرنویس و حرکت‌ها را برنامه‌ریزی می‌کند.",
    },
    example: {
      en: "Captions at the bottom, at most 4 words at a time. Never cut my laugh.",
      fa: "زیرنویس پایین تصویر و هر بار حداکثر ۴ کلمه. خنده‌ام را هیچ‌وقت حذف نکن.",
    },
  },
  manager: {
    name: { en: "Manager", fa: "مدیر" },
    job: {
      en: "Checks each channel's first draft before you see it, scores it and sends weak work back once. Ideas and scenarios come straight to you.",
      fa: "پیش‌نویس اول هر کانال را پیش از شما بررسی می‌کند، به آن نمره می‌دهد و کار ضعیف را یک بار برمی‌گرداند. ایده‌ها و سناریوها مستقیم به خود شما می‌رسند.",
    },
    example: {
      en: "Be strict about the hook. Send back anything that sounds like generic AI writing.",
      fa: "درباره‌ی قلاب شروع سخت‌گیر باش. هر چیزی که شبیه متن کلیشه‌ای هوش مصنوعی است را برگردان.",
    },
  },
  coach: {
    name: { en: "Learning Coach", fa: "مربی یادگیری" },
    job: {
      en: "Studies your edits, rejections and the manager's notes, and turns them into lessons for each agent.",
      fa: "ویرایش‌ها، ردکردن‌ها و یادداشت‌های مدیر را بررسی می‌کند و برای هر عضو تیم درس می‌سازد.",
    },
    example: {
      en: "Learn mostly from my edits, not from one-off requests.",
      fa: "بیشتر از ویرایش‌های من یاد بگیر، نه از درخواست‌های یک‌باره.",
    },
  },
};

/** Which writer owns each platform's posts. */
export function agentForPlatform(platform: Platform): AgentId {
  switch (platform) {
    case "telegram":
      return "telegram";
    case "linkedin":
      return "linkedin";
    case "instagram":
      return "carousel";
    case "website":
      return "blogger";
    default:
      return "scriptwriter";
  }
}
