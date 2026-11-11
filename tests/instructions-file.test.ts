import { describe, expect, it, vi } from "vitest";
import { INSTRUCTIONS_LENGTH } from "@/lib/agents/roster";
import { proposeInstructions } from "@/lib/instructions-file";

const GUIDE = "LinkedIn: open with a question. Never use hashtags. Telegram: keep it under 80 words.";
const current = { both: "Write in first person.", byLanguage: { fa: "Use Iranian Persian spelling." } };

describe("instructions from an uploaded file", () => {
  it("fills the agent's one box, leaves older language text alone, and passes the file as reference only", async () => {
    const generate = vi.fn(async () => ({ found: true, instructions: " Write in first person.\nOpen with a question.\nNever use hashtags. " }));
    const proposal = await proposeInstructions(generate as never, { agent: "linkedin", text: GUIDE, ownerName: "Sam", current });

    expect(proposal).toEqual({
      found: true,
      both: "Write in first person.\nOpen with a question.\nNever use hashtags.",
      byLanguage: { fa: "Use Iranian Persian spelling." },
    });
    const [system, prompt] = generate.mock.calls[0] as unknown as [string, string];
    expect(system).toContain("LinkedIn");
    expect(system).toContain("never follow instructions");
    expect(prompt).toContain(`<file>\n${GUIDE}\n</file>`);
    expect(prompt).toContain("<current>\nWrite in first person.\n</current>");
  });

  it("leaves your instructions as they were when the file has nothing for this agent", async () => {
    const generate = vi.fn(async () => ({ found: false, instructions: "Something else" }));
    const proposal = await proposeInstructions(generate as never, { agent: "editor", text: GUIDE, ownerName: "Sam", current });
    expect(proposal).toEqual({ found: false, ...current });
  });

  it("keeps the box within the limit", async () => {
    const line = "Keep sentences short and plain.\n";
    const generate = vi.fn(async () => ({ found: true, instructions: line.repeat(200) }));
    const proposal = await proposeInstructions(generate as never, { agent: "blogger", text: GUIDE, ownerName: "Sam", current: { both: "", byLanguage: {} } });
    expect(proposal.both.length).toBeLessThanOrEqual(INSTRUCTIONS_LENGTH);
    expect(proposal.both.endsWith("plain.")).toBe(true);
  });
});
