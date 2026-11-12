import { readFileSync } from "node:fs";
import path from "node:path";

/** The prompt file the video editor reads each time it plans an edit. Edit it to add or change prompts. */
export const EDIT_PROMPTS_FILE = path.join(process.cwd(), "src", "lib", "agents", "editor", "prompt-of-edits.md");

export type EditPrompt = {
  id: string;
  title: string;
  /** In every plan, whatever was asked for. */
  always: boolean;
  /** What the studio can do of it: yes, partly or no, with a note. */
  studio: string;
  keywords: string[];
  body: string;
};

/** Reads the prompt file's blocks: each starts with "## id · Title", then its "- Key: value" lines, then the prompt. */
export function parseEditPrompts(markdown: string): EditPrompt[] {
  const prompts: EditPrompt[] = [];
  for (const block of markdown.split(/^## /m).slice(1)) {
    const [heading, ...rest] = block.split("\n");
    const match = /^([a-z0-9-]+)\s*·\s*(.+)$/.exec(heading.trim());
    if (!match) continue;
    const fields: Record<string, string> = {};
    let start = 0;
    while (start < rest.length && (rest[start].startsWith("- ") || !rest[start].trim())) {
      const field = /^- ([A-Za-z ]+):\s*(.*)$/.exec(rest[start]);
      if (field) fields[field[1].trim().toLowerCase()] = field[2].trim();
      start++;
    }
    // A "---" line after a block starts the next part of the file, not this prompt.
    const body = rest.slice(start).join("\n").split(/^---\s*$/m)[0].trim();
    prompts.push({
      id: match[1],
      title: match[2].trim(),
      always: (fields["use when"] ?? "").toLowerCase() === "always",
      studio: fields.studio ?? "",
      keywords: (fields.keywords ?? "").split(",").map((word) => normalize(word)).filter(Boolean),
      body,
    });
  }
  return prompts;
}

export function loadEditPrompts(file = EDIT_PROMPTS_FILE): EditPrompt[] {
  try {
    return parseEditPrompts(readFileSync(file, "utf8"));
  } catch {
    // Without the file, the editor plans with its built-in rules only.
    return [];
  }
}

/** Lower case, one spelling of the Persian letters and spaces, so a keyword matches however it was typed. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏‎]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the keyword appears as a whole word, allowing a plural or verb ending: "steps" matches "step", "settings" doesn't match "set". */
function mentions(text: string, keyword: string): boolean {
  const word = escape(keyword).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${word}(?:s|es|ed|ing| ?ها| ?های)?(?![\\p{L}\\p{N}])`, "u").test(text);
}

/** The prompts for this edit: every "always" prompt, then each one a keyword of which appears in what was asked. */
export function selectEditPrompts(prompts: EditPrompt[], asked: string): EditPrompt[] {
  const text = normalize(asked);
  return prompts.filter((prompt) => prompt.always || prompt.keywords.some((keyword) => mentions(text, keyword)));
}
