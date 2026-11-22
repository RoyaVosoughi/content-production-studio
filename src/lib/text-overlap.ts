// Word overlap between two texts, in code: no AI request and safe to run in the browser.

/** Common words that say nothing about the topic, in English and Farsi. */
const STOP_WORDS = new Set(
  (
    "the and for with that this from your you are was were how why what when who into about over more most than then they them " +
    "their there here have has had not but can will just like make makes made use using its it's our out all any new one two " +
    "از به با در که این آن را برای تا یک هم یا اما بر هر چه چرا چطور چگونه است هست بود شد می‌شود کنید کردن شما ما خود دیگر نیست"
  ).split(" "),
);

/** The words that carry an idea's topic: lower case, without punctuation, short words or stop words. */
export function topicWords(text: string): Set<string> {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .split(/[^\p{L}\p{N}‌]+/u)
    .map((word) => word.replace(/‌/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return new Set(words);
}

/** How much two texts share, 0 to 1 (the Dice coefficient of their topic words). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return (2 * shared) / (a.size + b.size);
}
