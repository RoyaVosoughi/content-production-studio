import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { StudioError } from "./errors";

// Photos you upload stay on this computer, next to the database. Only the finished slides are
// uploaded, and only when you post.

const MEDIA_DIR = () => path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? ".data/media");
const NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function savePhoto(file: File): Promise<string> {
  const extension = TYPES[file.type as keyof typeof TYPES];
  if (!extension) throw new StudioError("Use a JPEG, PNG or WebP photo.");
  if (file.size > MAX_PHOTO_BYTES) throw new StudioError("The photo can be up to 8 MB.");
  if (file.size === 0) throw new StudioError("Choose a photo first.");
  const name = `${randomUUID()}.${extension}`;
  await mkdir(/*turbopackIgnore: true*/ MEDIA_DIR(), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MEDIA_DIR(), name), Buffer.from(await file.arrayBuffer()));
  return name;
}

/** The photo's bytes and type, or null for a name that isn't one of the studio's own files. */
export async function readPhoto(name: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!NAME.test(name)) return null;
  try {
    const bytes = await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MEDIA_DIR(), name));
    return { bytes, type: CONTENT_TYPES[name.split(".")[1] as keyof typeof CONTENT_TYPES] };
  } catch {
    return null;
  }
}
