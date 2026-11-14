import { bigint, boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const brandKits = pgTable("brand_kits", {
  language: text("language").primaryKey(),
  positioning: text("positioning").notNull(),
  audience: text("audience").notNull(),
  pillars: jsonb("pillars").$type<string[]>().notNull(),
  voiceGuide: text("voice_guide").notNull(),
  avoid: text("avoid").notNull(),
  samples: text("samples").notNull(),
  searchTopics: jsonb("search_topics").$type<string[]>().notNull(),
  /** Sites, domains and RSS feeds the Idea Scout reads, one per line as you typed them. */
  sources: jsonb("sources").$type<string[]>().notNull().default([]),
  isDraft: boolean("is_draft").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Where one idea search looked, so you can see it under the results. */
export type ScoutLook = {
  onlyMine: boolean;
  queries: string[];
  domains: string[];
  feeds: { url: string; items: number; error?: string }[];
  links: string[];
  results: number;
};

export const scoutRuns = pgTable("scout_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  language: text("language").notNull(),
  looked: jsonb("looked").$type<ScoutLook>().notNull(),
  ideas: integer("ideas").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdeaSource = { url: string; title: string; publishedDate: string | null };

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The English and Farsi versions of one idea share a pair id.
  pairId: uuid("pair_id").notNull().defaultRandom(),
  language: text("language").notNull(),
  title: text("title").notNull(),
  hook: text("hook").notNull(),
  angle: text("angle").notNull(),
  whyNow: text("why_now").notNull(),
  pillar: text("pillar").notNull(),
  sources: jsonb("sources").$type<IdeaSource[]>().notNull(),
  status: text("status").$type<"proposed" | "approved" | "rejected">().notNull().default("proposed"),
  /** The pair id of a past idea whose results this one builds on, when the scout says so. */
  buildsOn: uuid("builds_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scenarios = pgTable("scenarios", {
  ideaId: uuid("idea_id")
    .primaryKey()
    .references(() => ideas.id, { onDelete: "cascade" }),
  currentVersion: integer("current_version").notNull(),
  approvedVersion: integer("approved_version"),
  /** The scenario writer's advice on which channels fit this idea, with a brief for each. Null for older scenarios. */
  channels: jsonb("channels").$type<ChannelPick[]>(),
});

/** How well one channel fits an idea, 1 to 5, the angle to take there, and a short brief for its writer. */
export type ChannelPick = { platform: string; score: number; recommended: boolean; angle: string; brief: string };

export type ScenarioContent = {
  title: string;
  hook: string;
  mainPoints: string[];
  angle: string;
  example: string;
  callToAction: string;
};

export const scenarioVersions = pgTable(
  "scenario_versions",
  {
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").$type<ScenarioContent>().notNull(),
    origin: text("origin").$type<"ai" | "edit" | "ai-change" | "restore">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.version] })],
);

/** Social posts use only body. Website articles also use the other fields. */
/** One Instagram slide. The first is the cover and the last is the call to action. */
export type Slide = { title: string; text: string };

/** One part of a video script: what the speaker says, and what the camera shows meanwhile. */
export type ScriptPart = { say: string; show: string };

/**
 * How the studio edits one video, chosen for what that clip needs. Everything points at phrases of
 * the transcript by number, so the plan stays readable and never depends on exact timings.
 */
export type EditPlan = {
  /** light: trim and captions. full: also cuts mistakes and pauses and adds motion. */
  level: "light" | "full";
  /** Why the studio chose this edit, in a sentence or two. */
  reason: string;
  /** Phrases to remove, such as a false start or a repeated take. */
  cut: number[];
  /** Shortens every pause longer than about half a second. */
  tightenPauses: boolean;
  captions: boolean;
  /** Corrected caption text for phrases the transcription got wrong. */
  fixes: { phrase: number; text: string }[];
  /** Words drawn in amber in the captions. */
  highlights: string[];
  /** Shown over the first seconds. Empty for none. */
  titleCard: string;
  /** A short label that pops up while a phrase is said. */
  callouts: { phrase: number; text: string }[];
  /** Phrases where the picture pushes in slightly, for emphasis. */
  zooms: number[];
  /** YouTube chapters, each starting at a phrase. */
  chapters: { phrase: number; title: string }[];
  /** A closing card asking viewers to follow or subscribe. */
  endCard: boolean;
  /** fill crops to the frame; fit shows the whole picture over a blurred copy of itself. */
  framing: "fill" | "fit";
};

/** body is the post text, or an Instagram caption. The other fields belong to one platform each. */
export type PieceContent = {
  body: string;
  title?: string;
  excerpt?: string;
  slug?: string;
  tags?: string[];
  slides?: Slide[];
  /** A photo uploaded for the Instagram cover, by its file name in the media folder. */
  photo?: string;
  /** Video only: the script and shot list to film from. */
  script?: ScriptPart[];
  /** Video only: the id of the uploaded clip. */
  footage?: string;
  edit?: EditPlan;
  /** Video only: the second of the finished video the thumbnail is taken from. */
  thumbnailAt?: number;
};

export type Word = { text: string; start: number; end: number };
/** A stretch of speech between pauses, which is what an edit plan cuts, zooms and captions. */
export type Phrase = { start: number; end: number; text: string; words: Word[] };

/** A filmed clip, stored on this computer, with its transcript once it's ready. */
export const footage = pgTable("footage", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Clips belong to an idea and can be used for any of its videos in the same language.
  pairId: uuid("pair_id").notNull(),
  language: text("language").notNull(),
  file: text("file").notNull(),
  originalName: text("original_name").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  duration: real("duration"),
  width: integer("width"),
  height: integer("height"),
  status: text("status").$type<"processing" | "ready" | "failed">().notNull(),
  stage: text("stage"),
  progress: real("progress"),
  error: text("error"),
  phrases: jsonb("phrases").$type<Phrase[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A finished video, kept by a fingerprint of everything that went into it. */
export const videoRenders = pgTable("video_renders", {
  key: text("key").primaryKey(),
  pieceId: uuid("piece_id")
    .notNull()
    .references(() => pieces.id, { onDelete: "cascade" }),
  status: text("status").$type<"working" | "ready" | "failed">().notNull(),
  progress: real("progress"),
  error: text("error"),
  duration: real("duration"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One post: one platform, for one language version of an idea. */
export const pieces = pgTable(
  "pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    currentVersion: integer("current_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("pieces_idea_platform").on(t.ideaId, t.platform)],
);

export const pieceVersions = pgTable(
  "piece_versions",
  {
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").$type<PieceContent>().notNull(),
    origin: text("origin").$type<"ai" | "edit" | "ai-change" | "restore">().notNull(),
    // The scenario version this was written from, to notice when the scenario has moved on.
    scenarioVersion: integer("scenario_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pieceId, t.version] })],
);

/** At most one per post, which is what stops a post from going out twice. */
export const publications = pgTable("publications", {
  pieceId: uuid("piece_id")
    .primaryKey()
    .references(() => pieces.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  // failed: the platform refused, so it's safe to retry. unknown: it may be live, so you check first.
  status: text("status").$type<"sending" | "posted" | "failed" | "unknown">().notNull(),
  externalId: text("external_id"),
  url: text("url"),
  error: text("error"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A post you approved to go out later: this exact version, at this time. waiting until then;
 * missed when the studio wasn't running at the time; failed when the post couldn't go out;
 * cancelled when the post changed after scheduling it. Once it goes out, the row is removed
 * and the post's publication shows the result.
 */
export const scheduledPosts = pgTable("scheduled_posts", {
  pieceId: uuid("piece_id")
    .primaryKey()
    .references(() => pieces.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  status: text("status").$type<"waiting" | "sending" | "missed" | "failed" | "cancelled">().notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ResultNumbers = Partial<Record<"views" | "likes" | "comments" | "shares" | "saves" | "follows", number>>;

/** The numbers you read off a live post, the last time you checked it. */
export const postResults = pgTable("post_results", {
  pieceId: uuid("piece_id")
    .primaryKey()
    .references(() => pieces.id, { onDelete: "cascade" }),
  numbers: jsonb("numbers").$type<ResultNumbers>().notNull(),
  note: text("note").notNull().default(""),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One manager check of a draft. subject is the idea pair, the idea (for a scenario) or the post it was about. */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent: text("agent").notNull(),
  task: text("task").notNull(),
  language: text("language").notNull(),
  subject: text("subject").notNull(),
  version: integer("version"),
  // Null when the manager couldn't check it, such as when the AI was unavailable.
  score: integer("score"),
  revised: boolean("revised").notNull().default(false),
  problems: jsonb("problems").$type<string[]>().notNull(),
  note: jsonb("note").$type<{ en: string; fa: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A lesson an agent follows from now on. The coach manages its own; yours are never changed by it. */
export const agentLessons = pgTable("agent_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent: text("agent").notNull(),
  textEn: text("text_en").notNull(),
  textFa: text("text_fa").notNull(),
  /** A content language code, or "both" for every language. */
  appliesTo: text("applies_to").notNull(),
  source: text("source").$type<"coach" | "owner">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Something the coach should learn from: your edits, requests and decisions, and the manager's notes. */
export const agentSignals = pgTable("agent_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent: text("agent").notNull(),
  language: text("language").notNull(),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  learnedAt: timestamp("learned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row: whether the manager checks drafts, and how the coach's last lesson went. */
/** What the studio measured in one of the Video Editor's sample videos. */
export type SampleMeasures = {
  duration: number;
  width: number;
  height: number;
  /** Changes of shot: jump cuts, new angles, B-roll. */
  cuts: number;
  cutsPerMinute: number;
  averageShot: number;
  /** Pauses of 0.4 seconds or more left in the sound. */
  pauses: number;
  longestPause: number;
  /** Null when the sample has no speech to read, or you said it has none. */
  speech: { wordsPerMinute: number; firstWordAt: number; opening: string; sampledSeconds: number } | null;
};

/** A video you uploaded to show the Video Editor an edit you like. Kept in the editor's own folder. */
export const editorSamples = pgTable("editor_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  file: text("file").notNull(),
  originalName: text("original_name").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  /** The language spoken in it, or "none" when it has no speech worth reading. */
  /** The language spoken in it, or "none". */
  language: text("language").notNull(),
  /** The network it is an example for, or null for any video. */
  platform: text("platform"),
  note: text("note").notNull().default(""),
  status: text("status").$type<"processing" | "ready" | "failed">().notNull(),
  stage: text("stage"),
  error: text("error"),
  measures: jsonb("measures").$type<SampleMeasures>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Your standing instructions for one agent: for all your work, and for each content language on its own. */
export const agentInstructions = pgTable("agent_instructions", {
  agent: text("agent").primaryKey(),
  both: text("all_languages").notNull().default(""),
  /** Instructions for one content language's work, by language code. */
  byLanguage: jsonb("by_language").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An agent's Skill as you edited it. No row means the agent works from its default Skill file. */
export const agentSkills = pgTable("agent_skills", {
  agent: text("agent").primaryKey(),
  text: text("text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamSettings = pgTable("team_settings", {
  id: integer("id").primaryKey(),
  managerEnabled: boolean("manager_enabled").notNull().default(true),
  lastLearnedAt: timestamp("last_learned_at", { withTimezone: true }),
  lastLearnError: text("last_learn_error"),
  lastLearnSummary: jsonb("last_learn_summary").$type<{ en: string; fa: string }>(),
  /** Your weekly posting pattern for the calendar. Null until you change the default. */
  weekPlan: jsonb("week_plan").$type<WeekPlan>(),
});

/** Which channels go out on each weekday (0 is Sunday), at what time, and how far apart one idea's posts are. */
export type WeekPlan = { days: string[][]; time: string; gapDays: number };

/** AI requests sent per model per day, for the usage counter. The day follows Google's quota day (Pacific time). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    day: text("day").notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.day, table.model] })],
);

/** The one person the studio works for. See lib/profile.ts. */
export const profiles = pgTable("profile", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  languages: jsonb("languages").$type<string[]>().notNull(),
  localNames: jsonb("local_names").$type<Record<string, string>>().notNull().default({}),
  headlines: jsonb("headlines").$type<Record<string, string>>().notNull().default({}),
  handles: jsonb("handles").$type<Partial<Record<"instagram" | "youtube" | "linkedin" | "telegram", string>>>().notNull().default({}),
  websiteUrl: text("website_url").notNull().default(""),
  blogPath: text("blog_path").notNull().default(""),
  colors: jsonb("colors").$type<Partial<Record<"primary" | "dark" | "light" | "highlight", string>>>().notNull().default({}),
  headingStyle: text("heading_style").notNull().default("serif"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS brand_kits (
  language text PRIMARY KEY,
  positioning text NOT NULL,
  audience text NOT NULL,
  pillars jsonb NOT NULL,
  voice_guide text NOT NULL,
  avoid text NOT NULL,
  samples text NOT NULL,
  search_topics jsonb NOT NULL,
  is_draft boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS scout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL,
  looked jsonb NOT NULL,
  ideas integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL,
  title text NOT NULL,
  hook text NOT NULL,
  angle text NOT NULL,
  why_now text NOT NULL,
  pillar text NOT NULL,
  sources jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS pair_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS builds_on uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ideas_pair_language ON ideas (pair_id, language);
CREATE TABLE IF NOT EXISTS scenarios (
  idea_id uuid PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  current_version integer NOT NULL,
  approved_version integer
);
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS channels jsonb;
CREATE TABLE IF NOT EXISTS scenario_versions (
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, version)
);
CREATE TABLE IF NOT EXISTS pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  platform text NOT NULL,
  current_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pieces_idea_platform UNIQUE (idea_id, platform)
);
CREATE TABLE IF NOT EXISTS piece_versions (
  piece_id uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  origin text NOT NULL,
  scenario_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (piece_id, version)
);
CREATE TABLE IF NOT EXISTS footage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL,
  language text NOT NULL,
  file text NOT NULL,
  original_name text NOT NULL,
  size bigint NOT NULL,
  duration real,
  width integer,
  height integer,
  status text NOT NULL,
  stage text,
  progress real,
  error text,
  phrases jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publications (
  piece_id uuid PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL,
  external_id text,
  url text,
  error text,
  posted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scheduled_posts (
  piece_id uuid PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  at timestamptz NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS post_results (
  piece_id uuid PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  numbers jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_renders (
  key text PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  status text NOT NULL,
  progress real,
  error text,
  duration real,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  task text NOT NULL,
  language text NOT NULL,
  subject text NOT NULL,
  version integer,
  score integer,
  revised boolean NOT NULL DEFAULT false,
  problems jsonb NOT NULL,
  note jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_subject ON agent_runs (subject);
CREATE TABLE IF NOT EXISTS agent_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  text_en text NOT NULL,
  text_fa text NOT NULL,
  applies_to text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  language text NOT NULL,
  kind text NOT NULL,
  detail text NOT NULL,
  claimed_at timestamptz,
  learned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS editor_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file text NOT NULL,
  original_name text NOT NULL,
  size bigint NOT NULL,
  language text NOT NULL,
  platform text,
  note text NOT NULL DEFAULT '',
  status text NOT NULL,
  stage text,
  error text,
  measures jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_instructions (
  agent text PRIMARY KEY,
  all_languages text NOT NULL DEFAULT '',
  en text NOT NULL DEFAULT '',
  fa text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS by_language jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE agent_instructions
  SET by_language = jsonb_strip_nulls(jsonb_build_object('en', NULLIF(en, ''), 'fa', NULLIF(fa, ''))), en = '', fa = ''
  WHERE en <> '' OR fa <> '';
CREATE TABLE IF NOT EXISTS agent_skills (
  agent text PRIMARY KEY,
  text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_settings (
  id integer PRIMARY KEY,
  manager_enabled boolean NOT NULL DEFAULT true,
  last_learned_at timestamptz,
  last_learn_error text,
  last_learn_summary jsonb
);
ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS week_plan jsonb;
CREATE TABLE IF NOT EXISTS ai_usage (
  day text NOT NULL,
  model text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
CREATE TABLE IF NOT EXISTS profile (
  id integer PRIMARY KEY,
  name text NOT NULL,
  languages jsonb NOT NULL,
  local_names jsonb NOT NULL DEFAULT '{}'::jsonb,
  headlines jsonb NOT NULL DEFAULT '{}'::jsonb,
  handles jsonb NOT NULL DEFAULT '{}'::jsonb,
  website_url text NOT NULL DEFAULT '',
  blog_path text NOT NULL DEFAULT '',
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  heading_style text NOT NULL DEFAULT 'serif',
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
