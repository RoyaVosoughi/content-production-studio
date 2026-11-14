import type { ChannelPickDraft } from "./ai/types";
import type { ChannelPick } from "./db/schema";
import { isPlatform, PLATFORMS, type Platform } from "./platforms";

/** The most channels recommended for one idea, so it isn't spread everywhere. */
export const MAX_RECOMMENDED = 3;

/**
 * Tidies the scenario writer's channel advice: real channels only, each once, scores 1 to 5, and
 * 1 to 3 recommended, the best fits first. When the AI recommended none, the best fit is recommended.
 */
export function cleanChannelPicks(drafts: ChannelPickDraft[] | undefined): ChannelPick[] | null {
  if (!drafts?.length) return null;
  const seen = new Set<string>();
  const picks = drafts
    .filter((pick) => isPlatform(pick.platform) && !seen.has(pick.platform) && seen.add(pick.platform))
    .map((pick) => ({
      platform: pick.platform,
      score: Math.min(5, Math.max(1, Math.round(pick.score))),
      recommended: pick.recommended,
      angle: pick.angle.trim(),
      brief: pick.brief.trim(),
    }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score);
  if (picks.length === 0) return null;
  let count = 0;
  for (const pick of picks) {
    pick.recommended = pick.recommended && count < MAX_RECOMMENDED;
    if (pick.recommended) count++;
  }
  if (count === 0) picks[0].recommended = true;
  return picks;
}

/** The pick for a channel, to brief its writer. */
export function pickFor(channels: ChannelPick[] | null | undefined, platform: Platform) {
  const pick = channels?.find((item) => item.platform === platform);
  return pick && (pick.angle || pick.brief) ? { angle: pick.angle, brief: pick.brief } : undefined;
}

/** Channels in the order to offer them: the advice first, then any channel it didn't score. */
export function channelOrder(channels: ChannelPick[] | null | undefined): Platform[] {
  const scored = (channels ?? []).map((pick) => pick.platform).filter(isPlatform);
  return [...scored, ...PLATFORMS.filter((platform) => !scored.includes(platform))];
}
