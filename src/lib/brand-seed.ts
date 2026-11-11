export type BrandKitFields = {
  positioning: string;
  audience: string;
  pillars: string[];
  voiceGuide: string;
  avoid: string;
  samples: string;
  searchTopics: string[];
};

/** A new Brand Kit starts empty and stays marked as a draft until it's saved from the Brand Kit page. */
export function emptyBrandKit(): BrandKitFields {
  return { positioning: "", audience: "", pillars: [], voiceGuide: "", avoid: "", samples: "", searchTopics: [] };
}
