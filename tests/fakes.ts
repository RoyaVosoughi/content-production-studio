import { vi } from "vitest";

const PASS = { score: 9, problems: [], instructions: "", noteEn: "Ready for Sam.", noteFa: "آماده برای سم." };

/** A manager that passes every draft and a coach that learns nothing, for tests about other things. */
export function passingTeam() {
  return {
    reviewPiece: vi.fn(async () => PASS),
    learn: vi.fn(async () => ({ agents: [], summaryEn: "", summaryFa: "" })),
  };
}
