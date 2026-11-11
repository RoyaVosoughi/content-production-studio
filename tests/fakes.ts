import { vi } from "vitest";

const PASS = { score: 9, problems: [], instructions: "", noteEn: "Ready for Sam.", noteFa: "آماده برای سم." };

/** A manager that passes every draft and a coach that learns nothing, for tests about other things. */
export function passingTeam() {
  return {
    reviewIdeas: vi.fn(async (_c: unknown, { ideas }: { ideas: unknown[] }) => ({
      ideas: ideas.map((_, index) => ({ number: index + 1, score: 9, problem: "", noteEn: "Strong.", noteFa: "قوی." })),
      instructions: "",
    })),
    reviewScenario: vi.fn(async () => PASS),
    reviewPiece: vi.fn(async () => PASS),
    learn: vi.fn(async () => ({ agents: [], summaryEn: "", summaryFa: "" })),
  };
}
