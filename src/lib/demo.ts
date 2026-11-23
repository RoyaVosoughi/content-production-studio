import { randomUUID } from "node:crypto";
import type { Db } from "./db/client";
import {
  agentLessons,
  agentRuns,
  agentSignals,
  brandKits,
  ideas,
  pieces,
  pieceVersions,
  postResults,
  profiles,
  publications,
  scenarios,
  scenarioVersions,
  scheduledPosts,
  scoutRuns,
  teamSettings,
  type ChannelPick,
  type PieceContent,
  type ResultNumbers,
  type ScenarioContent,
} from "./db/schema";
import { applyHook, type HookKind, type HookOption } from "./hooks";
import { weekStart } from "./plan-week";
import { RESULT_METRICS, type Platform } from "./platforms";

// Sample data for showing the studio: a made-up creator, Sara Rahimi, who helps small cafés and
// bakeries with marketing, in English and Farsi. Everything here is invented, links point to
// example.com, and it only ever goes into an empty database: `npm run demo` keeps it in .data/demo,
// away from your own work. Dates are counted back from the moment it is seeded, so the Results page,
// the weekly report and the calendar always look like a studio in use.

type Lang = "en" | "fa";
type Both = Record<Lang, string>;
type Point = { head: string; detail: string };

type Stage =
  /** Posted on every channel, with numbers. */
  | "live"
  /** Scenario approved and posts written, not posted yet. */
  | "written"
  /** Scenario approved, no posts yet. */
  | "scenario"
  /** Scenario written, waiting for your approval. */
  | "draft"
  /** A fresh idea from the scout. */
  | "proposed"
  | "rejected";

type IdeaSpec = {
  key: string;
  stage: Stage;
  pillar: 0 | 1 | 2;
  title: Both;
  angle: Both;
  whyNow: Both;
  points: Record<Lang, Point[]>;
  example: Both;
  cta: Both;
  /** Three openings of different kinds. The first is the one the writer opened with. */
  hooks: Record<Lang, HookOption[]>;
  /** Live ideas only: the hook you picked, how well the posts did against your usual (1 is typical), and when they went out. */
  picked?: HookKind;
  strength?: number;
  postedDaysAgo?: number;
};

export const DEMO_NAME = "Sara Rahimi";

const PILLARS: Record<Lang, string[]> = {
  en: ["Café stories", "AI tools that save time", "Pricing and profit"],
  fa: ["داستان کافه‌ها", "ابزارهای هوش مصنوعی", "قیمت‌گذاری و سود"],
};

const IDEAS: IdeaSpec[] = [
  {
    key: "regulars",
    stage: "live",
    pillar: 0,
    picked: "story",
    strength: 4,
    postedDaysAgo: 19,
    title: { en: "The café that wrote back to every review", fa: "کافه‌ای که به همه‌ی نظرها جواب داد" },
    angle: {
      en: "Replying to reviews isn't customer service, it's the cheapest marketing a small café has.",
      fa: "جواب دادن به نظرها خدمات مشتری نیست؛ ارزان‌ترین بازاریابی یک کافه‌ی کوچک است.",
    },
    whyNow: {
      en: "Map apps now show how often a business replies, right under its rating.",
      fa: "اپ‌های نقشه حالا زیر امتیاز هر کسب‌وکار نشان می‌دهند چقدر به نظرها جواب می‌دهد.",
    },
    points: {
      en: [
        { head: "Reply within a day", detail: "A fast, short reply tells the next reader someone is listening." },
        { head: "Use their words", detail: "Repeat the dish or moment they mentioned, so it reads as written by a person." },
        { head: "Answer the bad ones first", detail: "One calm reply to a complaint wins more trust than ten thank-yous." },
      ],
      fa: [
        { head: "تا یک روز جواب بده", detail: "یک جواب کوتاه و سریع به خواننده‌ی بعدی می‌گوید کسی می‌شنود." },
        { head: "با کلمه‌های خودشان", detail: "همان غذا یا لحظه‌ای را که گفته‌اند تکرار کن تا معلوم باشد آدم نوشته." },
        { head: "اول نظرهای بد", detail: "یک جواب آرام به یک گلایه بیشتر از ده تشکر اعتماد می‌سازد." },
      ],
    },
    example: {
      en: "Leila, who runs a six-table café, answered every review for a month. Her weekend queue started before opening time.",
      fa: "لیلا که یک کافه‌ی شش‌میزه دارد، یک ماه به همه‌ی نظرها جواب داد. صف آخر هفته‌اش قبل از باز شدن در شروع شد.",
    },
    cta: { en: "Reply to one review today and tell me how it went.", fa: "امروز به یک نظر جواب بده و بگو چه شد." },
    hooks: {
      en: [
        { kind: "story", text: "Leila answered every single review for a month. Then the queue started before 8am." },
        { kind: "question", text: "When did you last reply to a review of your café?" },
        { kind: "bold", text: "Your reviews page is your best ad, and you're ignoring it." },
      ],
      fa: [
        { kind: "story", text: "لیلا یک ماه به همه‌ی نظرها جواب داد. بعد صف از ساعت ۸ صبح شروع شد." },
        { kind: "question", text: "آخرین بار کی به نظر یک مشتری جواب دادی؟" },
        { kind: "bold", text: "صفحه‌ی نظرها بهترین تبلیغ توست و نادیده‌اش می‌گیری." },
      ],
    },
  },
  {
    key: "menu-photos",
    stage: "live",
    pillar: 1,
    picked: "number",
    strength: 1.05,
    postedDaysAgo: 16,
    title: { en: "Menu photos in 10 minutes with your phone and one free AI tool", fa: "عکس منو در ۱۰ دقیقه با گوشی و یک ابزار رایگان" },
    angle: {
      en: "Good menu photos don't need a photographer, they need window light and a cleaned-up background.",
      fa: "عکس خوب منو عکاس نمی‌خواهد؛ نور پنجره و یک پس‌زمینه‌ی تمیز می‌خواهد.",
    },
    whyNow: {
      en: "Free background tools got good enough this year to fix a cluttered counter in one tap.",
      fa: "ابزارهای رایگان پس‌زمینه امسال آن‌قدر خوب شده‌اند که پیشخوان شلوغ را با یک لمس درست کنند.",
    },
    points: {
      en: [
        { head: "Shoot by the window", detail: "Side light from a window beats any lamp. Turn the overhead lights off." },
        { head: "Clean the background", detail: "Let a free AI tool swap the clutter for a plain surface." },
        { head: "Same angle every time", detail: "One angle for the whole menu makes it look designed." },
      ],
      fa: [
        { head: "کنار پنجره عکس بگیر", detail: "نور کناری پنجره از هر لامپی بهتر است. چراغ سقف را خاموش کن." },
        { head: "پس‌زمینه را تمیز کن", detail: "بگذار یک ابزار رایگان هوش مصنوعی شلوغی را با یک سطح ساده عوض کند." },
        { head: "همیشه یک زاویه", detail: "یک زاویه برای کل منو آن را طراحی‌شده نشان می‌دهد." },
      ],
    },
    example: {
      en: "A bakery in our group reshot 24 items in one quiet afternoon and put them on its delivery app the same evening.",
      fa: "یک نانوایی در گروه ما ۲۴ محصول را در یک بعدازظهر خلوت دوباره عکس گرفت و همان شب در اپ سفارش گذاشت.",
    },
    cta: { en: "Save this for your next quiet afternoon.", fa: "این را برای بعدازظهر خلوت بعدی ذخیره کن." },
    hooks: {
      en: [
        { kind: "number", text: "24 menu photos, one afternoon, zero photographers." },
        { kind: "problem", text: "Your food tastes better than your photos look." },
        { kind: "question", text: "Would you order from your own menu photos?" },
      ],
      fa: [
        { kind: "number", text: "۲۴ عکس منو، یک بعدازظهر، بدون عکاس." },
        { kind: "problem", text: "غذایت از عکس‌هایش خوشمزه‌تر است." },
        { kind: "question", text: "خودت از روی عکس‌های منویت سفارش می‌دادی؟" },
      ],
    },
  },
  {
    key: "price-rise",
    stage: "live",
    pillar: 2,
    picked: "bold",
    strength: 0.6,
    postedDaysAgo: 13,
    title: { en: "How to raise prices without losing regulars", fa: "چطور قیمت را بالا ببری و مشتری ثابت را از دست ندهی" },
    angle: {
      en: "Regulars don't leave over a price rise, they leave over a surprise.",
      fa: "مشتری ثابت به خاطر گرانی نمی‌رود؛ به خاطر غافلگیری می‌رود.",
    },
    whyNow: {
      en: "Milk and coffee bean prices went up again this autumn.",
      fa: "قیمت شیر و دانه‌ی قهوه این پاییز دوباره بالا رفت.",
    },
    points: {
      en: [
        { head: "Tell them first", detail: "A note at the till two weeks before beats a new number on the board." },
        { head: "Raise less, more often", detail: "Small steps are easier to accept than one big jump." },
        { head: "Keep one anchor", detail: "Leave one favourite at its old price so the menu still feels fair." },
      ],
      fa: [
        { head: "اول خبر بده", detail: "یک یادداشت کنار صندوق دو هفته قبل، بهتر از یک عدد تازه روی تابلوست." },
        { head: "کم‌تر و بیشتر", detail: "قدم‌های کوچک راحت‌تر از یک جهش بزرگ پذیرفته می‌شوند." },
        { head: "یک لنگر نگه دار", detail: "یک محبوب را با قیمت قبلی نگه دار تا منو هنوز منصفانه به نظر برسد." },
      ],
    },
    example: {
      en: "One café kept its filter coffee at the old price and raised everything else by 5%. Nobody complained.",
      fa: "یک کافه قهوه‌ی فیلتر را با قیمت قبل نگه داشت و بقیه را ۵ درصد بالا برد. کسی گلایه نکرد.",
    },
    cta: { en: "What's your anchor item? Tell me in the comments.", fa: "لنگر منوی تو کدام است؟ در نظرها بگو." },
    hooks: {
      en: [
        { kind: "bold", text: "Stop apologising for your prices." },
        { kind: "problem", text: "Costs went up again and you still haven't touched your menu." },
        { kind: "story", text: "One café raised prices by 5% and nobody said a word. Here's what it did first." },
      ],
      fa: [
        { kind: "bold", text: "بابت قیمت‌هایت عذرخواهی نکن." },
        { kind: "problem", text: "هزینه‌ها دوباره بالا رفت و هنوز به منو دست نزده‌ای." },
        { kind: "story", text: "یک کافه ۵ درصد قیمت را بالا برد و کسی چیزی نگفت. اول این کار را کرد." },
      ],
    },
  },
  {
    key: "first-job",
    stage: "live",
    pillar: 0,
    picked: "story",
    strength: 2,
    postedDaysAgo: 10,
    title: { en: "What a 17-year-old barista taught me about Instagram", fa: "چیزی که یک باریستای ۱۷ ساله درباره‌ی اینستاگرام یادم داد" },
    angle: {
      en: "The best content in a café is already happening behind the counter; let the team film it.",
      fa: "بهترین محتوای یک کافه همین حالا پشت پیشخوان اتفاق می‌افتد؛ بگذار تیم فیلمش را بگیرد.",
    },
    whyNow: {
      en: "Short behind-the-scenes videos are what local accounts get recommended for this season.",
      fa: "این فصل، ویدیوهای کوتاه پشت صحنه همان چیزی است که حساب‌های محلی برایش پیشنهاد می‌شوند.",
    },
    points: {
      en: [
        { head: "Hand over the phone", detail: "Your team knows the funny, messy moments you never see." },
        { head: "One rule only", detail: "No customers' faces without asking. Everything else is fair game." },
        { head: "Post it raw", detail: "A shaky clip of latte art beats a polished ad nobody watches." },
      ],
      fa: [
        { head: "گوشی را بده دست تیم", detail: "تیمت لحظه‌های بامزه و شلوغی را می‌شناسد که تو هیچ‌وقت نمی‌بینی." },
        { head: "فقط یک قانون", detail: "بدون اجازه چهره‌ی مشتری نه. بقیه‌اش آزاد." },
        { head: "خام منتشرش کن", detail: "یک کلیپ لرزان از لاته‌آرت از تبلیغ براقی که کسی نمی‌بیند بهتر است." },
      ],
    },
    example: {
      en: "Arman filmed his first wobbly heart in the milk. It's still the café's most-shared video.",
      fa: "آرمان اولین قلب کج‌وکوله‌اش روی شیر را فیلم گرفت. هنوز پربازدیدترین ویدیوی کافه است.",
    },
    cta: { en: "Ask your team to film one moment this week.", fa: "این هفته از تیمت بخواه یک لحظه را فیلم بگیرد." },
    hooks: {
      en: [
        { kind: "story", text: "Arman is 17. His first wobbly latte heart is our most-shared video ever." },
        { kind: "bold", text: "Your staff are better at Instagram than your agency." },
        { kind: "number", text: "One 12-second clip did more than three months of planned posts." },
      ],
      fa: [
        { kind: "story", text: "آرمان ۱۷ سالش است. اولین قلب کج لاته‌اش پربازدیدترین ویدیوی ماست." },
        { kind: "bold", text: "کارمندهایت از آژانس تبلیغاتت اینستاگرام را بهتر بلدند." },
        { kind: "number", text: "یک کلیپ ۱۲ ثانیه‌ای بیشتر از سه ماه پست برنامه‌ریزی‌شده کار کرد." },
      ],
    },
  },
  {
    key: "order-bot",
    stage: "live",
    pillar: 1,
    picked: "number",
    strength: 3,
    postedDaysAgo: 7,
    title: { en: "Should a bakery let AI take its phone orders?", fa: "آیا نانوایی باید سفارش تلفنی را به هوش مصنوعی بسپارد؟" },
    angle: {
      en: "Let AI take the repeat orders, and keep a human for the birthday cakes.",
      fa: "سفارش‌های تکراری را به هوش مصنوعی بده و کیک تولد را برای آدم نگه دار.",
    },
    whyNow: {
      en: "Messaging apps now let a small business add an order assistant without a developer.",
      fa: "اپ‌های پیام‌رسان حالا اجازه می‌دهند بدون برنامه‌نویس یک دستیار سفارش اضافه کنی.",
    },
    points: {
      en: [
        { head: "Start with the menu", detail: "Give it your menu and opening hours, nothing else, and test it yourself." },
        { head: "Hand over the special ones", detail: "Custom cakes and complaints always go to you." },
        { head: "Read every chat for a week", detail: "You'll learn what customers really ask for." },
      ],
      fa: [
        { head: "با منو شروع کن", detail: "فقط منو و ساعت کاری را به آن بده و خودت امتحانش کن." },
        { head: "خاص‌ها با تو", detail: "کیک سفارشی و گلایه همیشه به خودت می‌رسد." },
        { head: "یک هفته همه‌ی گفتگوها را بخوان", detail: "می‌فهمی مشتری واقعاً چه می‌خواهد." },
      ],
    },
    example: {
      en: "A two-person bakery stopped missing morning orders and got its owner's 7am hour back.",
      fa: "یک نانوایی دونفره دیگر سفارش صبح را از دست نداد و ساعت ۷ صبح صاحبش به خودش برگشت.",
    },
    cta: { en: "Would you trust it with your orders? Yes or no below.", fa: "سفارش‌هایت را به آن می‌سپاری؟ بله یا نه؟" },
    hooks: {
      en: [
        { kind: "question", text: "Would you let AI answer your bakery's phone?" },
        { kind: "number", text: "A two-person bakery missed 0 morning orders last month. Here's the setup." },
        { kind: "bold", text: "Answering the phone is not your job anymore." },
      ],
      fa: [
        { kind: "question", text: "تلفن نانوایی‌ات را به هوش مصنوعی می‌سپاری؟" },
        { kind: "number", text: "یک نانوایی دونفره ماه پیش حتی یک سفارش صبح را از دست نداد." },
        { kind: "bold", text: "جواب دادن به تلفن دیگر کار تو نیست." },
      ],
    },
  },
  {
    key: "loyalty",
    stage: "live",
    pillar: 2,
    picked: "bold",
    strength: 0.65,
    postedDaysAgo: 4,
    title: { en: "Loyalty cards are losing you money", fa: "کارت وفاداری دارد ضررت می‌دهد" },
    angle: {
      en: "A free tenth coffee rewards people who'd come anyway; reward the second visit instead.",
      fa: "قهوه‌ی دهم رایگان به کسی جایزه می‌دهد که به‌هرحال می‌آمد؛ به جایش به بار دوم جایزه بده.",
    },
    whyNow: {
      en: "Card stamps are moving into phone wallets, which makes changing the rules cheap.",
      fa: "مهر کارت‌ها دارد به کیف پول گوشی می‌رود و عوض کردن قانون‌ها ارزان شده.",
    },
    points: {
      en: [
        { head: "The second visit matters most", detail: "Someone who comes twice usually comes ten times." },
        { head: "Make it small and soon", detail: "A pastry on the next visit beats a coffee in ten visits." },
        { head: "Count it", detail: "Write down how many first-timers come back within a week." },
      ],
      fa: [
        { head: "بار دوم از همه مهم‌تر است", detail: "کسی که دو بار بیاید معمولاً ده بار می‌آید." },
        { head: "کوچک و زود", detail: "یک شیرینی در بار بعد بهتر از یک قهوه بعد از ده بار است." },
        { head: "بشمارش", detail: "یادداشت کن چند مشتری تازه تا یک هفته برمی‌گردند." },
      ],
    },
    example: {
      en: "A café swapped its stamp card for a 'come back this week' pastry. Return visits doubled in a month.",
      fa: "یک کافه کارت مهری را با «این هفته برگرد، شیرینی مهمان ما» عوض کرد. برگشت‌ها در یک ماه دو برابر شد.",
    },
    cta: { en: "What does your loyalty card reward? Be honest.", fa: "کارت وفاداری‌ات به چه چیزی جایزه می‌دهد؟" },
    hooks: {
      en: [
        { kind: "bold", text: "Your loyalty card rewards the wrong customers." },
        { kind: "number", text: "Return visits doubled in a month when one café dropped its stamp card." },
        { kind: "question", text: "Who does your free tenth coffee really go to?" },
      ],
      fa: [
        { kind: "bold", text: "کارت وفاداری‌ات به مشتری اشتباه جایزه می‌دهد." },
        { kind: "number", text: "وقتی یک کافه کارت مهری را کنار گذاشت، برگشت‌ها در یک ماه دو برابر شد." },
        { kind: "question", text: "قهوه‌ی دهم رایگانت واقعاً به چه کسی می‌رسد؟" },
      ],
    },
  },
  {
    key: "rainy-day",
    stage: "written",
    pillar: 0,
    title: { en: "The rainy-day post that fills a quiet café", fa: "پست روز بارانی که کافه‌ی خلوت را پر می‌کند" },
    angle: {
      en: "Bad weather is a reason to come in, if you say so before noon.",
      fa: "هوای بد دلیلی برای آمدن است، اگر قبل از ظهر بگویی.",
    },
    whyNow: {
      en: "The first week of real autumn rain is forecast across the region.",
      fa: "پیش‌بینی شده اولین هفته‌ی باران واقعی پاییز در راه است.",
    },
    points: {
      en: [
        { head: "Post before 11", detail: "People decide where to escape the rain over their morning coffee." },
        { head: "Show the window seat", detail: "One photo of a warm corner with rain outside says everything." },
        { head: "Give a rain-only offer", detail: "A soup or hot chocolate deal that only exists while it rains." },
      ],
      fa: [
        { head: "قبل از ساعت ۱۱ پست بگذار", detail: "آدم‌ها سر قهوه‌ی صبح تصمیم می‌گیرند از باران کجا پناه ببرند." },
        { head: "صندلی کنار پنجره را نشان بده", detail: "یک عکس از گوشه‌ای گرم با باران بیرون همه‌چیز را می‌گوید." },
        { head: "پیشنهاد فقط برای باران", detail: "سوپ یا شکلات داغی که فقط تا وقتی باران می‌آید هست." },
      ],
    },
    example: {
      en: "Leila's 'it's raining, soup's on' story on a Tuesday brought in eleven people before 1pm.",
      fa: "استوری «باران می‌آید، سوپ آماده است» لیلا در یک سه‌شنبه تا ساعت ۱ یازده نفر را آورد.",
    },
    cta: { en: "Write your rain post tonight, so it's ready.", fa: "پست باران را امشب بنویس که آماده باشد." },
    hooks: {
      en: [
        { kind: "story", text: "It rained on Tuesday. By 1pm Leila's café had eleven extra people. One post did it." },
        { kind: "question", text: "What does your café post when it rains?" },
        { kind: "bold", text: "Rain is the best marketing day of the year." },
      ],
      fa: [
        { kind: "story", text: "سه‌شنبه باران آمد. تا ساعت ۱ کافه‌ی لیلا یازده مشتری اضافه داشت. با یک پست." },
        { kind: "question", text: "روزهای بارانی کافه‌ات چه پستی می‌گذارد؟" },
        { kind: "bold", text: "باران بهترین روز بازاریابی سال است." },
      ],
    },
  },
  {
    key: "voice-notes",
    stage: "written",
    pillar: 1,
    title: { en: "Turn your voice notes into a week of posts", fa: "پیام‌های صوتی‌ات را به یک هفته پست تبدیل کن" },
    angle: {
      en: "You already explain your café out loud every day; record it once and let AI write it down.",
      fa: "هر روز کافه‌ات را بلند توضیح می‌دهی؛ یک بار ضبطش کن و بگذار هوش مصنوعی بنویسدش.",
    },
    whyNow: {
      en: "Phone transcription now handles mixed languages and kitchen noise well.",
      fa: "تبدیل صدا به متن در گوشی حالا با زبان‌های مخلوط و سروصدای آشپزخانه هم خوب کار می‌کند.",
    },
    points: {
      en: [
        { head: "Talk for five minutes", detail: "Answer one question a customer asked you this week." },
        { head: "Let it transcribe", detail: "Your phone does this for free now." },
        { head: "Cut it into three", detail: "One story, one tip, one question: three posts from one walk." },
      ],
      fa: [
        { head: "پنج دقیقه حرف بزن", detail: "به سؤالی جواب بده که این هفته مشتری از تو پرسید." },
        { head: "بگذار بنویسد", detail: "گوشی‌ات حالا این کار را رایگان می‌کند." },
        { head: "سه تکه‌اش کن", detail: "یک داستان، یک نکته، یک سؤال: سه پست از یک پیاده‌روی." },
      ],
    },
    example: {
      en: "A pastry chef records on her walk to work and has her week's posts ready by Monday lunch.",
      fa: "یک شیرینی‌پز سر راه کار ضبط می‌کند و تا ناهار دوشنبه پست‌های هفته‌اش آماده است.",
    },
    cta: { en: "Record one voice note on your way home today.", fa: "امروز سر راه خانه یک پیام صوتی ضبط کن." },
    hooks: {
      en: [
        { kind: "number", text: "5 minutes of talking on the way to work. 3 posts by lunch." },
        { kind: "problem", text: "You know exactly what to say, you just never have time to type it." },
        { kind: "question", text: "What if you could post just by talking?" },
      ],
      fa: [
        { kind: "number", text: "۵ دقیقه حرف زدن سر راه کار. ۳ پست تا ظهر." },
        { kind: "problem", text: "دقیقاً می‌دانی چه بگویی؛ فقط هیچ‌وقت وقت تایپش را نداری." },
        { kind: "question", text: "اگر می‌شد فقط با حرف زدن پست گذاشت چه؟" },
      ],
    },
  },
  {
    key: "waste",
    stage: "scenario",
    pillar: 2,
    title: { en: "The end-of-day box that turns waste into new customers", fa: "جعبه‌ی آخر روز که دورریز را به مشتری تازه تبدیل می‌کند" },
    angle: {
      en: "Selling yesterday's pastries cheaply is how strangers try you for the first time.",
      fa: "فروش ارزان شیرینی دیروز راهی است که غریبه‌ها اولین بار امتحانت می‌کنند.",
    },
    whyNow: { en: "Food-waste apps are growing fast in smaller cities.", fa: "اپ‌های کاهش دورریز غذا در شهرهای کوچک‌تر سریع رشد می‌کنند." },
    points: {
      en: [
        { head: "Price it to move", detail: "A third of the usual price, and it's still better than the bin." },
        { head: "Add a card", detail: "A small card with your full menu turns a bargain into a visit." },
        { head: "Count who comes back", detail: "Ask new faces how they heard of you." },
      ],
      fa: [
        { head: "قیمتی که فروش برود", detail: "یک‌سوم قیمت معمول، و هنوز از سطل زباله بهتر است." },
        { head: "یک کارت بگذار", detail: "یک کارت کوچک با منوی کامل، یک تخفیف را به یک بازدید تبدیل می‌کند." },
        { head: "بشمار چه کسی برمی‌گردد", detail: "از چهره‌های تازه بپرس از کجا شنیده‌اند." },
      ],
    },
    example: {
      en: "A bakery's evening boxes sold out daily, and a third of buyers came back at full price.",
      fa: "جعبه‌های عصر یک نانوایی هر روز تمام شد و یک‌سوم خریدارها با قیمت کامل برگشتند.",
    },
    cta: { en: "What happens to your unsold pastries tonight?", fa: "امشب شیرینی‌های نفروخته‌ات چه می‌شوند؟" },
    hooks: {
      en: [
        { kind: "number", text: "A third of the people who bought the cheap box came back at full price." },
        { kind: "bold", text: "Your bin is your best marketing channel." },
        { kind: "question", text: "What happens to your unsold pastries tonight?" },
      ],
      fa: [
        { kind: "number", text: "یک‌سوم کسانی که جعبه‌ی ارزان خریدند با قیمت کامل برگشتند." },
        { kind: "bold", text: "سطل زباله‌ات بهترین کانال بازاریابی توست." },
        { kind: "question", text: "امشب شیرینی‌های نفروخته‌ات چه می‌شوند؟" },
      ],
    },
  },
  {
    key: "neighbours",
    stage: "draft",
    pillar: 0,
    title: { en: "Partner with the shop next door", fa: "با مغازه‌ی بغلی شریک شو" },
    angle: {
      en: "The florist next door has the customers you want; swap a shelf for a shelf.",
      fa: "گل‌فروشی بغلی همان مشتری‌هایی را دارد که تو می‌خواهی؛ یک قفسه بده، یک قفسه بگیر.",
    },
    whyNow: { en: "Holiday shopping starts in two weeks.", fa: "خرید تعطیلات دو هفته‌ی دیگر شروع می‌شود." },
    points: {
      en: [
        { head: "Pick a shop with the same customers", detail: "Not the same products, the same people." },
        { head: "Swap something small", detail: "Your cookies on their counter, their flowers on your tables." },
        { head: "Post about each other", detail: "Two small accounts together reach twice the street." },
      ],
      fa: [
        { head: "مغازه‌ای با همان مشتری‌ها", detail: "نه همان جنس، همان آدم‌ها." },
        { head: "چیز کوچکی عوض کنید", detail: "کلوچه‌ی تو روی پیشخوان آن‌ها، گل‌های آن‌ها روی میزهای تو." },
        { head: "برای هم پست بگذارید", detail: "دو حساب کوچک با هم دو برابر خیابان را می‌بینند." },
      ],
    },
    example: {
      en: "A café and a bookshop swapped a shelf each; both now sell a 'book and a coffee' gift.",
      fa: "یک کافه و یک کتاب‌فروشی هر کدام یک قفسه به هم دادند؛ حالا هر دو هدیه‌ی «کتاب و قهوه» می‌فروشند.",
    },
    cta: { en: "Which shop near you would you team up with?", fa: "با کدام مغازه‌ی نزدیکت شریک می‌شوی؟" },
    hooks: {
      en: [
        { kind: "story", text: "A café and a bookshop swapped one shelf. Now they sell a gift together." },
        { kind: "question", text: "Who's the shop next door to your café?" },
        { kind: "bold", text: "Your neighbours aren't competition, they're your next customers." },
      ],
      fa: [
        { kind: "story", text: "یک کافه و یک کتاب‌فروشی یک قفسه با هم عوض کردند. حالا با هم هدیه می‌فروشند." },
        { kind: "question", text: "مغازه‌ی بغل کافه‌ات کیست؟" },
        { kind: "bold", text: "همسایه‌هایت رقیب نیستند؛ مشتری بعدی‌ات هستند." },
      ],
    },
  },
  {
    key: "holiday-menu",
    stage: "proposed",
    pillar: 2,
    title: { en: "A holiday menu with three items, not thirty", fa: "منوی تعطیلات با سه قلم، نه سی قلم" },
    angle: { en: "A short seasonal menu sells more and wastes less.", fa: "منوی فصلی کوتاه بیشتر می‌فروشد و کمتر دور ریخته می‌شود." },
    whyNow: { en: "Cafés are planning their December menus this week.", fa: "کافه‌ها این هفته منوی آذر و دی را می‌چینند." },
    points: { en: [], fa: [] },
    example: { en: "", fa: "" },
    cta: { en: "", fa: "" },
    hooks: { en: [], fa: [] },
  },
  {
    key: "google-profile",
    stage: "proposed",
    pillar: 1,
    title: { en: "Let AI fill in your map listing in 15 minutes", fa: "پروفایل نقشه‌ات را در ۱۵ دقیقه با هوش مصنوعی کامل کن" },
    angle: {
      en: "Most small cafés leave half their map listing empty, and that's where nearby searches look.",
      fa: "بیشتر کافه‌های کوچک نیمی از پروفایل نقشه را خالی می‌گذارند و جست‌وجوهای نزدیک همان‌جا را نگاه می‌کنند.",
    },
    whyNow: { en: "Map listings added new fields for menus and accessibility this month.", fa: "پروفایل‌های نقشه این ماه بخش‌های تازه‌ای برای منو و دسترسی اضافه کردند." },
    points: { en: [], fa: [] },
    example: { en: "", fa: "" },
    cta: { en: "", fa: "" },
    hooks: { en: [], fa: [] },
  },
  {
    key: "tip-jar",
    stage: "proposed",
    pillar: 0,
    title: { en: "What the tip jar tells you about your service", fa: "صندوق انعام درباره‌ی خدماتت چه می‌گوید" },
    angle: { en: "Tips are the most honest review you get, and you get it every day.", fa: "انعام صادق‌ترین نظری است که می‌گیری، و هر روز می‌گیری." },
    whyNow: { en: "Card machines now ask for a tip on every payment.", fa: "کارتخوان‌ها حالا موقع هر پرداخت انعام می‌پرسند." },
    points: { en: [], fa: [] },
    example: { en: "", fa: "" },
    cta: { en: "", fa: "" },
    hooks: { en: [], fa: [] },
  },
  {
    key: "crypto-coffee",
    stage: "rejected",
    pillar: 1,
    title: { en: "Accept crypto at your café", fa: "در کافه‌ات رمزارز بپذیر" },
    angle: { en: "Crypto payments as a way to look modern.", fa: "پرداخت رمزارزی برای مدرن به نظر رسیدن." },
    whyNow: { en: "A payment app added crypto this week.", fa: "یک اپ پرداخت این هفته رمزارز اضافه کرد." },
    points: { en: [], fa: [] },
    example: { en: "", fa: "" },
    cta: { en: "", fa: "" },
    hooks: { en: [], fa: [] },
  },
];

/** Which posts each idea gets: English for LinkedIn, Instagram, the website and Shorts; Farsi for Telegram and Reels. */
const LIVE_CHANNELS: Record<Lang, Platform[]> = { en: ["linkedin", "instagram", "website"], fa: ["telegram"] };
/** Three live ideas also went out as a Reel. */
const REEL_IDEAS = new Set(["regulars", "first-job", "order-bot"]);
const WRITTEN_CHANNELS: Record<string, Record<Lang, Platform[]>> = {
  "rainy-day": { en: ["linkedin", "instagram", "website", "short"], fa: ["telegram", "reel"] },
  "voice-notes": { en: ["linkedin", "website"], fa: ["telegram"] },
};

/** A typical post on each network, before an idea's strength is applied. */
const TYPICAL: Record<Platform, ResultNumbers> = {
  telegram: { views: 1800, likes: 60, shares: 25 },
  linkedin: { views: 3200, likes: 70, comments: 14, shares: 6 },
  instagram: { views: 2500, likes: 140, comments: 18, shares: 30, saves: 55, follows: 12 },
  website: { views: 420 },
  reel: { views: 6000, likes: 300, comments: 25, shares: 60, saves: 80, follows: 30 },
  short: { views: 2200, likes: 90, comments: 8, shares: 10, follows: 6 },
  youtube: { views: 800, likes: 40, comments: 6, follows: 4 },
  linkedin_video: { views: 1500, likes: 30, comments: 5, shares: 2 },
};

/** A steady wobble between 0.85 and 1.15, so the numbers look real but every seed is the same. */
function wobble(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 0.85 + (hash % 1000) / 1000 * 0.3;
}

function numbersFor(platform: Platform, strength: number, seed: string): ResultNumbers {
  const typical = TYPICAL[platform];
  const numbers: ResultNumbers = {};
  for (const metric of RESULT_METRICS[platform]) {
    const base = typical[metric] ?? 0;
    // Reach moves less than response: a strong post is seen by more people, and far more of them act.
    const factor = metric === "views" ? Math.sqrt(strength) : strength;
    numbers[metric] = Math.max(0, Math.round(base * factor * wobble(`${seed}:${metric}`)));
  }
  return numbers;
}

const HASHTAGS: Record<Lang, string> = {
  en: "#smallbusiness #cafe #bakery #marketing",
  fa: "#کافه #کسب‌وکار_کوچک #بازاریابی #نانوایی",
};

/** The post as its writer would have drafted it, opening with the first hook. */
function draftFor(idea: IdeaSpec, lang: Lang, platform: Platform): PieceContent {
  const hooks = idea.hooks[lang];
  const opening = hooks[0].text;
  const points = idea.points[lang];
  const list = points.map((point, index) => `${index + 1}. ${point.head}: ${point.detail}`).join("\n");
  const arrows = points.map((point) => `→ ${point.head}. ${point.detail}`).join("\n");
  switch (platform) {
    case "telegram":
      return { body: `${opening}\n\n${idea.angle[lang]}\n\n${list}\n\n${idea.example[lang]}\n\n${idea.cta[lang]}`, hooks };
    case "linkedin":
      return { body: `${opening}\n\n${idea.angle[lang]}\n\n${arrows}\n\n${idea.example[lang]}\n\n${idea.cta[lang]}\n\n${HASHTAGS[lang]}`, hooks };
    case "instagram":
      return {
        body: `${idea.angle[lang]}\n\n${idea.cta[lang]}\n\n${HASHTAGS[lang]}`,
        slides: [
          { title: opening, text: idea.angle[lang] },
          ...points.map((point) => ({ title: point.head, text: point.detail })),
          { title: idea.cta[lang], text: idea.example[lang] },
        ],
        hooks,
      };
    case "website": {
      const sections = points.map((point) => `## ${point.head}\n\n${point.detail}`).join("\n\n");
      return {
        title: opening,
        excerpt: idea.angle[lang],
        slug: idea.key,
        tags: [PILLARS[lang][idea.pillar].toLowerCase(), "small business"],
        body: `${idea.angle[lang]}\n\n${idea.whyNow[lang]}\n\n${sections}\n\n## ${lang === "en" ? "In practice" : "در عمل"}\n\n${idea.example[lang]}\n\n${idea.cta[lang]}`,
        hooks,
      };
    }
    default:
      // Videos: a caption, and a script to film from.
      return {
        title: platform === "short" ? opening : undefined,
        body: `${opening}\n\n${idea.cta[lang]}\n\n${HASHTAGS[lang]}`,
        script: [
          { say: opening, show: lang === "en" ? "Close-up, straight to camera, behind the counter." : "نمای نزدیک، رو به دوربین، پشت پیشخوان." },
          ...points.map((point) => ({ say: `${point.head}. ${point.detail}`, show: lang === "en" ? "Cut to the counter as you say it." : "برش به پیشخوان هم‌زمان با گفتن." })),
          { say: idea.cta[lang], show: lang === "en" ? "Back to camera, smile, end card." : "برگشت به دوربین، لبخند، کارت پایانی." },
        ],
        hooks,
      };
  }
}

function scenarioFor(idea: IdeaSpec, lang: Lang): ScenarioContent {
  return {
    title: idea.title[lang],
    hook: idea.hooks[lang][0]?.text ?? idea.title[lang],
    mainPoints: idea.points[lang].map((point) => `${point.head}: ${point.detail}`),
    angle: idea.angle[lang],
    example: idea.example[lang],
    callToAction: idea.cta[lang],
  };
}

const CHANNEL_FIT: { platform: Platform; score: number; en: string; fa: string }[] = [
  { platform: "linkedin", score: 5, en: "Owners read LinkedIn at quiet hours; lead with the result.", fa: "صاحبان کسب‌وکار ساعت‌های خلوت لینکدین می‌خوانند؛ با نتیجه شروع کن." },
  { platform: "telegram", score: 4, en: "A short, practical note for the channel.", fa: "یک یادداشت کوتاه و کاربردی برای کانال." },
  { platform: "instagram", score: 4, en: "One step per slide, a cover worth saving.", fa: "هر اسلاید یک قدم، کاوری که ارزش ذخیره داشته باشد." },
  { platform: "reel", score: 4, en: "Film it behind the counter in under a minute.", fa: "پشت پیشخوان، زیر یک دقیقه فیلمش را بگیر." },
  { platform: "website", score: 3, en: "A longer how-to that search can find.", fa: "یک راهنمای بلندتر که در جست‌وجو پیدا شود." },
  { platform: "short", score: 3, en: "The same story, cut for YouTube.", fa: "همان داستان، برای یوتیوب." },
  { platform: "youtube", score: 2, en: "Too small for a full video on its own.", fa: "برای یک ویدیوی کامل کوچک است." },
  { platform: "linkedin_video", score: 2, en: "The text post will do better here.", fa: "این‌جا پست متنی بهتر جواب می‌دهد." },
];

function channelsFor(lang: Lang): ChannelPick[] {
  return CHANNEL_FIT.map((fit) => ({ platform: fit.platform, score: fit.score, recommended: fit.score >= 4, angle: fit[lang], brief: fit[lang] }));
}

const SOURCE = (idea: IdeaSpec) => [
  { url: `https://example.com/news/${idea.key}`, title: `Sample source: ${idea.title.en}`, publishedDate: null },
];

/** True when this database has no studio in it yet, so sample data can't land on top of real work. */
async function isEmpty(db: Db): Promise<boolean> {
  const [profile] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  const [idea] = await db.select({ id: ideas.id }).from(ideas).limit(1);
  return !profile && !idea;
}

/**
 * Fills an empty database with the sample studio. Does nothing, and returns false, when the database
 * already holds a profile or any idea.
 */
export async function seedDemo(db: Db, now = new Date()): Promise<boolean> {
  if (!(await isEmpty(db))) return false;

  const at = (daysAgo: number, hour = 9, minute = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);

  await db.insert(profiles).values({
    id: 1,
    name: DEMO_NAME,
    languages: ["en", "fa"],
    localNames: { fa: "سارا رحیمی" },
    headlines: { en: "I help small cafés and bakeries get busier with simple marketing.", fa: "به کافه‌ها و نانوایی‌های کوچک کمک می‌کنم با بازاریابی ساده شلوغ‌تر شوند." },
    handles: { instagram: "sara.cafe.marketing", linkedin: "sara-rahimi-demo", telegram: "sara_cafe_demo", youtube: "SaraCafeMarketing" },
    websiteUrl: "https://example.com",
    blogPath: "/{lang}/blog/{slug}",
    colors: { primary: "#7c2d12", dark: "#1c1917", light: "#fdf8f3", highlight: "#f59e0b" },
    headingStyle: "serif",
  });

  await db.insert(brandKits).values([
    {
      language: "en",
      positioning: "Marketing for small cafés and bakeries that takes minutes a day, not an agency.",
      audience: "Owners of independent cafés and bakeries with 1 to 10 staff, who do their own marketing between shifts.",
      pillars: PILLARS.en,
      voiceGuide: "Warm, practical and short. Talk like a friend who has worked a busy counter. Real examples over theory, one idea per post.",
      avoid: "Jargon like 'funnel' or 'leverage', promises of overnight growth, and stock-photo clichés.",
      samples:
        "Leila didn't buy ads. She answered every review for a month. Her weekend queue now starts before she opens.\n\nYou don't need a content plan. You need one photo of today's bake, before 11am.",
      searchTopics: ["small café marketing", "bakery business news", "AI tools for small business", "food prices"],
      sources: ["example.com/cafe-news", "example.com/small-business/feed"],
      isDraft: false,
    },
    {
      language: "fa",
      positioning: "بازاریابی برای کافه‌ها و نانوایی‌های کوچک که روزی چند دقیقه وقت می‌گیرد، نه یک آژانس.",
      audience: "صاحبان کافه‌ها و نانوایی‌های مستقل با ۱ تا ۱۰ کارمند که بین شیفت‌ها خودشان بازاریابی می‌کنند.",
      pillars: PILLARS.fa,
      voiceGuide: "گرم، کاربردی و کوتاه. مثل دوستی که پشت یک پیشخوان شلوغ کار کرده. مثال واقعی به جای نظریه، هر پست یک ایده.",
      avoid: "اصطلاح‌های قلمبه مثل «قیف فروش»، وعده‌ی رشد یک‌شبه، و ترجمه‌ی کلمه‌به‌کلمه از انگلیسی.",
      samples:
        "لیلا تبلیغ نخرید. یک ماه به همه‌ی نظرها جواب داد. حالا صف آخر هفته‌اش قبل از باز شدن در شروع می‌شود.\n\nبرنامه‌ی محتوا لازم نداری. یک عکس از پخت امروز لازم داری، قبل از ساعت ۱۱.",
      searchTopics: ["بازاریابی کافه", "اخبار نانوایی", "هوش مصنوعی برای کسب‌وکار کوچک"],
      sources: ["example.com/cafe-news"],
      isDraft: false,
    },
  ]);

  await db.insert(teamSettings).values({
    id: 1,
    managerEnabled: true,
    lastLearnedAt: at(1, 21, 30),
    lastLearnSummary: {
      en: "Learned 4 lessons from 11 signals: story openings keep winning on LinkedIn and Instagram, short cover titles get saved more, and pricing ideas need a concrete café example.",
      fa: "از ۱۱ نشانه ۴ درس گرفت: شروع با داستان در لینکدین و اینستاگرام همچنان برنده است، تیترهای کوتاه کاور بیشتر ذخیره می‌شوند و ایده‌های قیمت‌گذاری یک مثال واقعی کافه لازم دارند.",
    },
  });

  await db.insert(scoutRuns).values({
    language: "en",
    looked: {
      onlyMine: false,
      queries: ["small café marketing this week", "bakery business news", "AI tools for small shops"],
      domains: ["example.com"],
      feeds: [{ url: "https://example.com/small-business/feed", items: 12 }],
      links: IDEAS.filter((idea) => idea.stage === "proposed").map((idea) => `https://example.com/news/${idea.key}`),
      results: 14,
    },
    ideas: 3,
    createdAt: at(0, 8, 15),
  });

  const ideaIds = new Map<string, Record<Lang, string>>();
  const pieceRows: (typeof pieces.$inferInsert)[] = [];
  const versionRows: (typeof pieceVersions.$inferInsert)[] = [];
  const publicationRows: (typeof publications.$inferInsert)[] = [];
  const resultRows: (typeof postResults.$inferInsert)[] = [];
  const runRows: (typeof agentRuns.$inferInsert)[] = [];
  const written = new Map<string, { id: string; platform: Platform; lang: Lang }[]>();

  for (const [index, idea] of IDEAS.entries()) {
    const pairId = randomUUID();
    const ids = { en: randomUUID(), fa: randomUUID() };
    ideaIds.set(idea.key, ids);
    const created =
      idea.stage === "live" ? at(idea.postedDaysAgo! + 3, 8) : idea.stage === "proposed" ? at(0, 8, 15) : at(3 + (index % 3), 8);
    const status = idea.stage === "proposed" ? "proposed" : idea.stage === "rejected" ? "rejected" : "approved";
    for (const lang of ["en", "fa"] as const) {
      await db.insert(ideas).values({
        id: ids[lang],
        pairId,
        language: lang,
        title: idea.title[lang],
        hook: idea.hooks[lang][0]?.text ?? idea.angle[lang],
        angle: idea.angle[lang],
        whyNow: idea.whyNow[lang],
        pillar: PILLARS[lang][idea.pillar],
        sources: SOURCE(idea),
        status,
        createdAt: created,
      });
      if (idea.stage === "proposed" || idea.stage === "rejected") continue;
      await db.insert(scenarios).values({
        ideaId: ids[lang],
        currentVersion: 1,
        approvedVersion: idea.stage === "draft" ? null : 1,
        channels: channelsFor(lang),
      });
      await db.insert(scenarioVersions).values({ ideaId: ids[lang], version: 1, content: scenarioFor(idea, lang), origin: "ai", createdAt: created });
    }

    if (idea.stage === "live") {
      for (const lang of ["en", "fa"] as const) {
        const channels = [...LIVE_CHANNELS[lang], ...(lang === "fa" && REEL_IDEAS.has(idea.key) ? (["reel"] as Platform[]) : [])];
        channels.forEach((platform, offset) => {
          const id = randomUUID();
          const draft = draftFor(idea, lang, platform);
          const chosen = idea.hooks[lang].find((hook) => hook.kind === idea.picked)!;
          const final: PieceContent = { ...applyHook(platform, draft, chosen.text), hookChosen: true };
          const postedAt = at(idea.postedDaysAgo! - (platform === "reel" ? 1 : offset), platform === "reel" ? 18 : 9);
          pieceRows.push({ id, ideaId: ids[lang], platform, currentVersion: 2, createdAt: at(idea.postedDaysAgo! + 2, 10) });
          versionRows.push(
            { pieceId: id, version: 1, content: draft, origin: "ai", scenarioVersion: 1, createdAt: at(idea.postedDaysAgo! + 2, 10) },
            { pieceId: id, version: 2, content: final, origin: "edit", scenarioVersion: 1, createdAt: at(idea.postedDaysAgo! + 2, 11) },
          );
          publicationRows.push({
            pieceId: id,
            version: 2,
            status: "posted",
            externalId: `demo-${idea.key}-${platform}`,
            url: `https://example.com/demo/${platform}/${idea.key}`,
            postedAt,
            updatedAt: postedAt,
          });
          // The newest website article has no numbers yet, as happens when a week is busy.
          const unmeasured = idea.key === "loyalty" && platform === "website";
          if (!unmeasured) {
            resultRows.push({
              pieceId: id,
              numbers: numbersFor(platform, idea.strength!, `${idea.key}:${platform}`),
              note: idea.key === "regulars" && platform === "linkedin" ? "Three café owners messaged me asking for a reply template." : "",
              checkedAt: at(Math.max(0, idea.postedDaysAgo! - offset - 2), 20),
            });
          }
        });
      }
    }

    if (idea.stage === "written") {
      const list: { id: string; platform: Platform; lang: Lang }[] = [];
      for (const lang of ["en", "fa"] as const) {
        for (const platform of WRITTEN_CHANNELS[idea.key][lang]) {
          const id = randomUUID();
          pieceRows.push({ id, ideaId: ids[lang], platform, currentVersion: 1, createdAt: at(1, 10) });
          versionRows.push({ pieceId: id, version: 1, content: draftFor(idea, lang, platform), origin: "ai", scenarioVersion: 1, createdAt: at(1, 10) });
          list.push({ id, platform, lang });
          // The manager checked every first draft; one went back to its writer once.
          const sentBack = idea.key === "rainy-day" && platform === "instagram";
          runRows.push({
            agent: platform === "telegram" ? "telegram" : platform === "linkedin" ? "linkedin" : platform === "instagram" ? "carousel" : platform === "website" ? "blogger" : "scriptwriter",
            task: platform,
            language: lang,
            subject: id,
            version: 1,
            score: sentBack ? 6 : 8,
            revised: sentBack,
            problems: sentBack ? ["The cover title was eleven words; covers work best at six or fewer."] : [],
            note: sentBack
              ? { en: "The cover was too long, so the writer shortened it.", fa: "کاور بلند بود و نویسنده کوتاهش کرد." }
              : { en: "Clear, in your voice, and the example is concrete.", fa: "روشن، با لحن خودت، و مثالش ملموس است." },
            createdAt: at(1, 10, 5),
          });
        }
      }
      written.set(idea.key, list);
    }
  }

  await db.insert(pieces).values(pieceRows);
  await db.insert(pieceVersions).values(versionRows);
  if (publicationRows.length) await db.insert(publications).values(publicationRows);
  if (resultRows.length) await db.insert(postResults).values(resultRows);
  if (runRows.length) await db.insert(agentRuns).values(runRows);

  // Two posts already booked for next week, on the days the default plan gives their channels.
  const nextMonday = weekStart(now, 1);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const slot = (dayOffset: number) => new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate() + dayOffset, 9);
  const voice = written.get("voice-notes")!;
  await db.insert(scheduledPosts).values([
    { pieceId: voice.find((piece) => piece.platform === "linkedin")!.id, version: 1, at: slot(0), status: "waiting" },
    { pieceId: voice.find((piece) => piece.platform === "telegram")!.id, version: 1, at: slot(1), status: "waiting" },
  ]);

  await db.insert(agentLessons).values([
    {
      agent: "linkedin",
      textEn: "Open with a moment from a real café before any advice; story openings did about twice as well as claims.",
      textFa: "قبل از هر توصیه، با لحظه‌ای از یک کافه‌ی واقعی شروع کن؛ شروع با داستان حدود دو برابر ادعا جواب داد.",
      appliesTo: "both",
      source: "coach",
      createdAt: at(8, 21),
    },
    {
      agent: "carousel",
      textEn: "Keep cover titles to six words or fewer; short covers were saved more often.",
      textFa: "تیتر کاور را حداکثر شش کلمه نگه دار؛ کاورهای کوتاه بیشتر ذخیره شدند.",
      appliesTo: "both",
      source: "coach",
      createdAt: at(5, 21),
    },
    {
      agent: "scout",
      textEn: "Pricing ideas did worse than usual twice; propose them only with a concrete café example and a number from the sources.",
      textFa: "ایده‌های قیمت‌گذاری دو بار ضعیف‌تر از معمول بودند؛ فقط با یک مثال واقعی کافه و عددی از منبع پیشنهادشان بده.",
      appliesTo: "both",
      source: "coach",
      createdAt: at(1, 21, 30),
    },
    {
      agent: "telegram",
      textEn: "In Farsi, end every Telegram post with one short question to the reader.",
      textFa: "در فارسی، هر پست تلگرام را با یک سؤال کوتاه از خواننده تمام کن.",
      appliesTo: "fa",
      source: "coach",
      createdAt: at(1, 21, 30),
    },
    {
      agent: "blogger",
      textEn: "End every article with a three-line checklist the reader can screenshot.",
      textFa: "هر مقاله را با یک چک‌لیست سه‌خطی تمام کن که خواننده بتواند از آن عکس بگیرد.",
      appliesTo: "both",
      source: "owner",
      createdAt: at(12, 19),
    },
  ]);

  const learned = at(1, 21, 30);
  await db.insert(agentSignals).values([
    { agent: "linkedin", language: "en", kind: "hook-pick", detail: "{OWNER} picked the story hook for a LinkedIn post over a question and a bold claim.", learnedAt: learned, claimedAt: learned, createdAt: at(10, 11) },
    { agent: "carousel", language: "en", kind: "hook-pick", detail: "{OWNER} picked the story hook for an Instagram carousel post.", learnedAt: learned, claimedAt: learned, createdAt: at(10, 11) },
    { agent: "linkedin", language: "en", kind: "results", detail: "Results: a LinkedIn post that opened with a story hook did much better than usual.", learnedAt: learned, claimedAt: learned, createdAt: at(9, 20) },
    { agent: "scout", language: "en", kind: "results", detail: "Results: a pricing idea did much worse than usual on LinkedIn and Telegram.", learnedAt: learned, claimedAt: learned, createdAt: at(2, 20) },
    { agent: "telegram", language: "fa", kind: "edit", detail: "{OWNER} added a closing question to a Telegram post before posting it.", learnedAt: learned, claimedAt: learned, createdAt: at(4, 9) },
    { agent: "carousel", language: "en", kind: "manager", detail: "The manager sent a draft back (6/10): the cover title was eleven words.", createdAt: at(1, 10, 5) },
  ]);

  return true;
}
