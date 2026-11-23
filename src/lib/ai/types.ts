import { z } from "zod";
import { AGENT_IDS, type AgentId } from "../agents/roster";
import type { BrandKitFields } from "../brand-seed";
import type { PieceContent, SampleMeasures, ScenarioContent, ScriptPart } from "../db/schema";
import type { Language } from "../language";
import { PLATFORMS, type Platform, type VideoPlatform } from "../platforms";
import type { AnimationStyle } from "../video/animation";

export const IdeaDraftSchema = z.object({
  title: z.string(),
  hook: z.string().describe("The opening line that would stop this audience from scrolling"),
  angle: z.string().describe("The author's specific point of view on the topic"),
  whyNow: z
    .string()
    .describe("Why this matters now, based only on the search results. For an evergreen idea, say so"),
  pillar: z.string().describe("The content pillar this belongs to, copied exactly from the Brand Kit"),
  sourceUrls: z.array(z.string()).describe("URLs of the search results this idea relies on, copied exactly"),
  buildsOn: z
    .number()
    .optional()
    .describe("The number of the past post in <what_worked> this idea builds on, or 0 if it builds on none"),
});
export type IdeaDraft = z.infer<typeof IdeaDraftSchema>;

export const IdeaBatchSchema = z.object({ ideas: z.array(IdeaDraftSchema) });

/** An idea's wording in the second language. It shares its sources with the first. */
export const IdeaTextSchema = IdeaDraftSchema.omit({ sourceUrls: true, buildsOn: true });
export type IdeaText = z.infer<typeof IdeaTextSchema>;
export const IdeaTextBatchSchema = z.object({ ideas: z.array(IdeaTextSchema) });

export const ScenarioSchema = z.object({
  title: z.string(),
  hook: z.string(),
  mainPoints: z.array(z.string()),
  angle: z.string(),
  example: z.string(),
  callToAction: z.string(),
}) satisfies z.ZodType<ScenarioContent>;

/** The scenario writer's advice on channels, written with the scenario in the same request. */
export const ChannelPickSchema = z.object({
  platform: z.enum(PLATFORMS),
  score: z.number().describe("1 to 5: how well this idea fits this channel's job and audience"),
  recommended: z.boolean().describe("true for the 1 to 3 channels worth making this idea for"),
  angle: z.string().describe("The angle this channel's post takes, different from the other channels. One sentence"),
  brief: z.string().describe("Two or three sentences for this channel's writer: what to focus on and what to leave out"),
});
export type ChannelPickDraft = z.infer<typeof ChannelPickSchema>;

export const ScenarioPlanSchema = ScenarioSchema.extend({
  channels: z.array(ChannelPickSchema).describe("Every channel, scored"),
});

export const SocialPieceSchema = z.object({ body: z.string().describe("The complete post, exactly as it will appear") });

export const InstagramPieceSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().describe("At most 8 words. On the first slide, the hook"),
        text: z.string().describe("At most 220 characters. May be empty on the first slide"),
      }),
    )
    .describe("5 to 8 slides: a cover, one point per slide, and a call to action last"),
  body: z.string().describe("The caption, exactly as it will appear, with the hashtags on the last line"),
});

export const VideoPieceSchema = z.object({
  title: z.string().describe("The video's title, at most 90 characters"),
  script: z
    .array(
      z.object({
        say: z.string().describe("What the author says in this part, in their own spoken words"),
        show: z.string().describe("What the camera shows meanwhile: the shot, a screen recording, or what they hold up"),
      }),
    )
    .describe("The parts of the video in order, from the hook to the call to action"),
  body: z.string().describe("The text posted with the video, exactly as it will appear"),
  tags: z.array(z.string()).describe("YouTube search tags. Empty for other networks"),
});

/** The AI's edit plan, by phrase number. The studio checks and completes it before saving. */
export const EditProposalSchema = z.object({
  level: z.enum(["light", "full"]).describe("light when the take is clean; full when it needs cuts or more motion to hold attention"),
  reason: z.string().describe("One or two sentences for the author on why this edit, in the language of the work"),
  cut: z.array(z.number()).describe("Phrase numbers to remove: false starts, repeated takes except the best, mistakes, filler-only phrases"),
  tightenPauses: z.boolean().describe("true to shorten long pauses"),
  titleCard: z.string().describe("At most 6 words shown over the opening, or an empty string"),
  callouts: z
    .array(z.object({ phrase: z.number(), text: z.string().describe("At most 4 words") }))
    .describe("Short labels that pop up on key moments. 0 to 5"),
  zooms: z.array(z.number()).describe("Phrase numbers for a slight push-in on the strongest moments. 0 to 6"),
  highlights: z.array(z.string()).describe("Up to 8 key words, exactly as they appear in the transcript, drawn in colour in the captions"),
  chapters: z
    .array(z.object({ phrase: z.number(), title: z.string() }))
    .describe("YouTube only: where each chapter starts, the first at the first kept phrase. Empty for other networks"),
  explainers: z
    .array(
      z.object({
        from: z.number().describe("The phrase number where the animation starts"),
        to: z.number().describe("The phrase number where it ends: the same as from for a single phrase"),
        mode: z.enum(["pip", "full"]).describe("pip: the clip in a small card, the animation fills the main area. full: only the animation, with the voice"),
        kind: z.enum(["title", "statement", "number", "points", "steps", "quote", "compare"]),
        heading: z.string().describe("At most 8 words"),
        text: z.string().describe("statement: a small label above. number: the big number. quote: the quote. compare: the two column names as 'A | B'. title: a subtitle. Otherwise empty"),
        items: z.array(z.string()).describe("points and steps: 2 to 5 items of at most 5 words (at most 3 in pip). compare: 2 to 3 rows as 'left | right'. Otherwise empty"),
      }),
    )
    .optional()
    .describe("Explainer animations over parts of the clip. Only when the edit prompts ask for them; otherwise empty"),
});
export type EditProposal = z.infer<typeof EditProposalSchema>;

export const MomentsSchema = z.object({
  moments: z
    .array(
      z.object({
        from: z.number().describe("The #number of the phrase the short video starts at, not a time in seconds: its first sentence must hook on its own"),
        to: z.number().describe("The #number of the last phrase it keeps, where the thought ends, not a time in seconds"),
        title: z.string().describe("A title of at most 60 characters, in the language of the transcript"),
        hook: z.string().describe("The caption's first line: at most 120 characters, in the language of the transcript"),
        why: z.string().describe("One sentence for the author on why this part works alone"),
        score: z.number().describe("1 to 10: how likely it is to hold a stranger scrolling past"),
      }),
    )
    .describe("3 to 5 moments, strongest first, that don't overlap"),
});
export type MomentsProposal = z.infer<typeof MomentsSchema>;

export const AnimationPlanSchema = z.object({
  scenes: z
    .array(
      z.object({
        kind: z.enum(["title", "statement", "number", "points", "steps", "quote", "compare", "end"]),
        say: z.string().describe("The exact words of the script read while this scene is on screen, copied verbatim. Empty only for a silent end card"),
        heading: z.string().describe("The on-screen heading: at most 8 words"),
        text: z.string().describe("title: a subtitle. statement: a small label above. number: the big number. quote: the quote. compare: the two column names as 'A | B'. Otherwise empty"),
        items: z.array(z.string()).describe("points and steps: 2 to 5 items of at most 6 words. compare: 2 to 4 rows as 'left | right'. Otherwise empty"),
      }),
    )
    .describe("The scenes in the order of the script"),
});
/**
 * Cartoon scenes. Places, actions and props are plain strings here, not enums, so a free model that
 * answers with a near miss isn't rejected; the studio maps anything unknown to a safe default.
 */
export const CartoonPlanSchema = z.object({
  scenes: z
    .array(
      z.object({
        say: z.string().describe("The exact words of the script read while this scene is on screen, copied verbatim. Empty only for the closing scene"),
        place: z.string().describe("Where it happens: office, home, street, park, classroom, shop, stage or night"),
        action: z.string().describe("What the host does: walk_in, talk, wave, point, think, surprised, celebrate, open_box, type_laptop, shrug, sad, present or run"),
        prop: z.string().describe("The one object in the scene: none, box, laptop, phone, lightbulb, chart, coffee, book, rocket, money, clock or key"),
        friend: z.boolean().describe("Whether a second character is in the scene with the host"),
        sign: z.string().describe("Optional sign at the top of the screen, at most 6 words. Usually empty; use it for the title and key turns"),
        bubble: z.string().describe("Optional speech bubble from the host, at most 8 words, that adds to what is said rather than repeating it. Often empty"),
      }),
    )
    .describe("The scenes in the order of the script"),
});

/** The planned scenes, in either style. The studio cleans them into drawable scenes. */
export type AnimationPlan = {
  scenes: { kind: string; say: string; heading: string; text: string; items: string[]; cartoon?: Record<string, unknown> }[];
};

export const ArticlePieceSchema = z.object({
  title: z.string().describe("The article headline, at most 100 characters"),
  excerpt: z.string().describe("A one or two sentence summary, at most 300 characters"),
  tags: z.array(z.string()).describe("Three to six short topic tags"),
  body: z.string().describe("The article in Markdown, without repeating the title"),
});

const NOTE = {
  noteEn: z.string().describe("One short sentence for the author on this draft's quality, in English"),
  noteFa: z.string().describe("The same sentence in natural Persian"),
};

/** The manager's check of one draft. Whether it passes is decided by the studio from the score. */
export const ReviewSchema = z.object({
  score: z.number().describe("1 to 10. 7 or more means it's ready for the author; below 7 sends it back"),
  problems: z.array(z.string()).describe("Each a specific, fixable problem, in English. Empty when there are none"),
  instructions: z.string().describe("For a score below 7: exactly what the writer must change. Otherwise empty"),
  ...NOTE,
});
export type Review = z.infer<typeof ReviewSchema>;

export const LessonUpdateSchema = z.object({
  agents: z.array(
    z.object({
      agent: z.enum(AGENT_IDS),
      lessons: z
        .array(
          z.object({
            en: z.string().describe("The lesson as one instruction to the agent, in English, at most 250 characters"),
            fa: z.string().describe("The same lesson in natural Persian, for the author to read"),
            appliesTo: z.string().describe('The language code of the work it is about, from the codes given, or "both" for all of it'),
          }),
        )
        .describe("The agent's complete new list of coach lessons, at most 8"),
    }),
  ),
  summaryEn: z.string().describe("One or two sentences for the author on what the team learned this time, in English"),
  summaryFa: z.string().describe("The same in natural Persian"),
});
export type LessonUpdate = z.infer<typeof LessonUpdateSchema>;

/** The manager's reasons for sending a draft back, given to the writer for its second try. */
export type Feedback = { previous: unknown; problems: string[]; instructions: string };

export type LearningInput = {
  agents: {
    agent: AgentId;
    coachLessons: string[];
    ownerLessons: string[];
    /** The author's standing instructions for this agent: for every language, and for each language on its own. */
    ownerInstructions: { both: string; byLanguage: Record<string, string> };
    signals: { kind: string; language: string; detail: string }[];
  }[];
};

export type SearchResult = { title: string; url: string; content: string; publishedDate: string | null };

/**
 * lessons holds each agent's current lessons for this language, and instructions the author's own
 * instructions for each agent in this language. Both are read fresh for every run.
 * owner is who the work is for, from Setup: the name the AI writes as, and every content language.
 */
export type WritingContext = {
  language: Language;
  owner?: { name: string; languages: Language[] };
  brand: BrandKitFields;
  lessons?: Partial<Record<AgentId, string[]>>;
  /** Rules for the whole team, from the Brand page, given to every agent. */
  instructions?: Partial<Record<AgentId, string>>;
  /** Each agent's Skill; custom when the author edited it. Missing agents use their default Skill file. */
  skills?: Partial<Record<AgentId, { text: string; custom: boolean }>>;
};

export interface WritingModel {
  generateIdeas(
    context: WritingContext,
    input: {
      count: number;
      focus: string;
      /** Links {OWNER} pasted: the ones read (they lead the results) and the ones that couldn't be opened. */
      shared?: { urls: string[]; failed: string[] };
      results: SearchResult[];
      pastTitles: string[];
      today: string;
      /** How the author's past ideas did once they were live, strongest first. */
      performance?: { number: number; title: string; pillar: string; results: string }[];
      /** What the numbers say overall: the best and weakest topic, channel and weekday. */
      patterns?: string[];
      feedback?: Feedback;
    },
  ): Promise<IdeaDraft[]>;
  adaptIdeas(context: WritingContext, input: { ideas: IdeaText[] }): Promise<IdeaText[]>;
  reviseIdea(context: WritingContext, input: { idea: IdeaDraft; request: string }): Promise<IdeaDraft>;
  adaptScenario(context: WritingContext, input: { scenario: ScenarioContent }): Promise<ScenarioContent>;
  /** The scenario, and in the same request the writer's advice on which channels fit it. */
  writeScenario(
    context: WritingContext,
    input: { idea: Omit<IdeaDraft, "sourceUrls">; sources: { title: string; url: string }[] },
  ): Promise<ScenarioContent & { channels?: ChannelPickDraft[] }>;
  reviseScenario(
    context: WritingContext,
    input: { scenario: ScenarioContent; request: string },
  ): Promise<ScenarioContent>;
  writePiece(
    context: WritingContext,
    input: {
      platform: Platform;
      scenario: ScenarioContent;
      sources: { title: string; url: string }[];
      /** The scenario writer's angle and brief for this channel, when it gave one. */
      channel?: { angle: string; brief: string };
      feedback?: Feedback;
    },
  ): Promise<PieceContent>;
  revisePiece(
    context: WritingContext,
    input: { platform: Platform; content: PieceContent; request: string },
  ): Promise<PieceContent>;
  planEdit(
    context: WritingContext,
    input: {
      platform: VideoPlatform;
      title: string;
      script: ScriptPart[];
      phrases: { number: number; start: number; end: number; text: string }[];
      duration: number;
      /** Videos the author likes the editing of, as measured by the studio, with their notes. */
      samples?: { platform: VideoPlatform | null; note: string; measures: SampleMeasures }[];
      /** What the author asked this edit to do, in their own words. Picks prompts from their prompt file. */
      request?: string;
    },
  ): Promise<EditProposal>;
  /** The video editor finds the parts of a long clip that work as short videos on their own. */
  findMoments(
    context: WritingContext,
    input: {
      title: string;
      phrases: { number: number; start: number; end: number; text: string }[];
      duration: number;
      /** For one video of the main moments, about this many seconds long, instead of separate shorts. */
      highlights?: number;
    },
  ): Promise<MomentsProposal>;
  /** The video editor turns a script into scenes for an animation: cartoon moments, or animated text cards. */
  planAnimation(
    context: WritingContext,
    input: { platform: VideoPlatform; title: string; script: string; style?: AnimationStyle },
  ): Promise<AnimationPlan>;
  /** The manager checks a channel's final draft. Ideas and scenarios are checked by you. */
  reviewPiece(
    context: WritingContext,
    input: { platform: Platform; content: PieceContent; scenario: ScenarioContent; sources: { title: string; url: string }[] },
  ): Promise<Review>;
  /** The coach turns feedback into lessons. */
  learn(context: WritingContext, input: LearningInput): Promise<LessonUpdate>;
}

export interface SearchProvider {
  /** With `domains`, searches only those sites, over a longer period, since a few sites publish less often. */
  search(queries: string[], options?: { domains?: string[] }): Promise<SearchResult[]>;
  /** Reads pages the owner pasted. Links that can't be opened come back in `failed`. */
  read?(urls: string[]): Promise<{ pages: SearchResult[]; failed: string[] }>;
}
