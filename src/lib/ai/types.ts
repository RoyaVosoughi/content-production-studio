import { z } from "zod";
import { AGENT_IDS, type AgentId } from "../agents/roster";
import type { BrandKitFields } from "../brand-seed";
import type { PieceContent, SampleMeasures, ScenarioContent, ScriptPart } from "../db/schema";
import type { Language } from "../language";
import type { Platform, VideoPlatform } from "../platforms";

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
});
export type EditProposal = z.infer<typeof EditProposalSchema>;

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

export const IdeaReviewSchema = z.object({
  ideas: z
    .array(
      z.object({
        number: z.number().describe("The idea's number, as given"),
        score: z.number().describe("1 to 10. 7 or more means it's worth the author's time"),
        problem: z.string().describe("In English: what is weak about it, for the scout. Empty when it passes"),
        ...NOTE,
      }),
    )
    .describe("One entry per idea, in order"),
  instructions: z.string().describe("For the scout: how to replace the ideas that scored below 7. Empty if all pass"),
});
export type IdeaReview = z.infer<typeof IdeaReviewSchema>;

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
  instructions?: Partial<Record<AgentId, string>>;
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
      feedback?: Feedback;
    },
  ): Promise<IdeaDraft[]>;
  adaptIdeas(context: WritingContext, input: { ideas: IdeaText[] }): Promise<IdeaText[]>;
  reviseIdea(context: WritingContext, input: { idea: IdeaDraft; request: string }): Promise<IdeaDraft>;
  adaptScenario(context: WritingContext, input: { scenario: ScenarioContent }): Promise<ScenarioContent>;
  writeScenario(
    context: WritingContext,
    input: { idea: Omit<IdeaDraft, "sourceUrls">; sources: { title: string; url: string }[]; feedback?: Feedback },
  ): Promise<ScenarioContent>;
  reviseScenario(
    context: WritingContext,
    input: { scenario: ScenarioContent; request: string },
  ): Promise<ScenarioContent>;
  writePiece(
    context: WritingContext,
    input: { platform: Platform; scenario: ScenarioContent; sources: { title: string; url: string }[]; feedback?: Feedback },
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
    },
  ): Promise<EditProposal>;
  /** The manager checks a batch of ideas. */
  reviewIdeas(
    context: WritingContext,
    input: { ideas: IdeaDraft[]; results: SearchResult[]; pastTitles: string[] },
  ): Promise<IdeaReview>;
  reviewScenario(
    context: WritingContext,
    input: { idea: Omit<IdeaDraft, "sourceUrls">; scenario: ScenarioContent; sources: { title: string; url: string }[] },
  ): Promise<Review>;
  reviewPiece(
    context: WritingContext,
    input: { platform: Platform; content: PieceContent; scenario: ScenarioContent; sources: { title: string; url: string }[] },
  ): Promise<Review>;
  /** The coach turns feedback into lessons. */
  learn(context: WritingContext, input: LearningInput): Promise<LessonUpdate>;
}

export interface SearchProvider {
  search(queries: string[]): Promise<SearchResult[]>;
  /** Reads pages the owner pasted. Links that can't be opened come back in `failed`. */
  read?(urls: string[]): Promise<{ pages: SearchResult[]; failed: string[] }>;
}
