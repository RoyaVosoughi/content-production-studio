/**
 * The brand interview, for people without a brand guide: a few plain questions, one at a time. The
 * answers become a short brand document, which is read like an uploaded brand file.
 */
export const INTERVIEW_QUESTIONS = ["who", "offer", "audience", "topics", "voice", "avoid", "samples", "goal"] as const;
export type InterviewQuestion = (typeof INTERVIEW_QUESTIONS)[number];

/** The questions as the AI reads them, in English whatever the interface language is. */
const ASKED: Record<InterviewQuestion, string> = {
  who: "Who are you and what do you do?",
  offer: "What do you offer, and what result do people get from it?",
  audience: "Who do you want to reach, and what problem do they have?",
  topics: "Which 3 to 5 topics do you want to be known for?",
  voice: "How do you want to sound?",
  avoid: "What should your content never do or say?",
  samples: "Posts or texts you wrote that sound like you",
  goal: "What should your content achieve?",
};

/** The longest answer kept, so the whole interview fits in one cheap request. */
export const ANSWER_LENGTH = 3000;

export function interviewDocument(answers: Partial<Record<InterviewQuestion, string>>): string {
  return [
    "Brand interview. The author answered these questions themselves.",
    ...INTERVIEW_QUESTIONS.filter((key) => answers[key]?.trim()).map(
      (key) => `## ${ASKED[key]}\n${answers[key]!.trim().slice(0, ANSWER_LENGTH)}`,
    ),
  ].join("\n\n");
}

/** Enough to build a kit from: who they are, and who they write for or what about. */
export function interviewIsEnough(answers: Partial<Record<InterviewQuestion, string>>): boolean {
  const has = (key: InterviewQuestion) => (answers[key]?.trim().length ?? 0) >= 3;
  return has("who") && (has("audience") || has("topics"));
}
