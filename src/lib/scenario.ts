/**
 * The writer marks anything only you can supply with square brackets, such as "[Add a real example]".
 * A Markdown link, "[label](address)", is not a placeholder.
 */
export function hasPlaceholder(content: object): boolean {
  return /\[[^\]]+\](?!\()/.test(allText(content).join("\n"));
}

/** Every piece of text inside, however deeply nested, such as the text on each Instagram slide. */
function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}
