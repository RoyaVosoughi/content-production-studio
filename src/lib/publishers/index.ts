import type { Platform } from "../platforms";
import { instagramPublisher } from "./instagram";
import { linkedinPublisher } from "./linkedin";
import { telegramPublisher } from "./telegram";
import { PublishRejected, type Publisher } from "./types";
import { websitePublisher } from "./website";

/** Videos are posted by hand for now, so there's nothing to connect and nothing to send. */
const byHand: Publisher = {
  missingSettings: () => [],
  publish: async () => {
    throw new PublishRejected("Videos are posted by hand for now.");
  },
};

export const PUBLISHERS: Record<Platform, Publisher> = {
  telegram: telegramPublisher,
  linkedin: linkedinPublisher,
  instagram: instagramPublisher,
  website: websitePublisher,
  reel: byHand,
  short: byHand,
  youtube: byHand,
  linkedin_video: byHand,
};
