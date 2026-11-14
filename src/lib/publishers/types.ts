import type { PieceContent } from "../db/schema";
import type { Language } from "../language";
import type { Profile } from "../profile";

export type Published = { externalId: string | null; url: string | null };

/** The brand image that goes out with a LinkedIn post or an article, as a JPEG. */
export type PostedImage = { jpeg: Buffer; alt: string; width: number; height: number };

/**
 * The platform definitely did not publish, so posting again is safe.
 * Any other error means the outcome is unknown, and you check before anything is sent again.
 */
export class PublishRejected extends Error {}

export interface Publisher {
  /** Names of the settings still missing from .env.local. */
  missingSettings(): string[];
  publish(input: {
    language: Language;
    content: PieceContent;
    /** Names this exact post and version, so files uploaded on a retry replace those from before. */
    key: string;
    /** The slide images, made only for platforms that post them. */
    images: () => Promise<Buffer[]>;
    /** The post's brand image, drawn only when a platform sends it. Null when the post has none. */
    image?: () => Promise<PostedImage | null>;
    /** Who is posting, for the website's article address. */
    profile?: Pick<Profile, "websiteUrl" | "blogPath"> | null;
  }): Promise<Published>;
  /** Whether the studio can delete a live post here itself, with the settings as they are now. */
  canUnpublish?(): boolean;
  /**
   * Deletes a live post, by the id publish returned. A post that is already gone counts as deleted.
   * Throws an Error whose message tells you what to do when the platform refuses.
   */
  unpublish?(externalId: string): Promise<void>;
}

export const REQUEST_TIMEOUT_MS = 30_000;
