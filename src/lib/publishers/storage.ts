import { REQUEST_TIMEOUT_MS } from "./types";
import { supabaseHeaders, supabaseUrl } from "./supabase";

// Instagram fetches each image from a public address, and the studio only runs on this computer.
// So slides go to a public folder ("bucket") in your Supabase project, which nothing else
// uses. Anyone with an image's address can see it, which is fine because it is about
// to be public on Instagram.

export const MEDIA_BUCKET = "studio-media";

const base = () => `${supabaseUrl()}/storage/v1`;

function keyHeaders(): Record<string, string> {
  const { "Content-Type": _json, ...rest } = supabaseHeaders();
  return rest;
}

export function publicImageUrl(path: string): string {
  return `${base()}/object/public/${MEDIA_BUCKET}/${path}`;
}

/** Creates the public folder the first time. Creating one that already exists is fine. */
async function ensureBucket() {
  const response = await fetch(`${base()}/bucket`, {
    method: "POST",
    headers: { ...keyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id: MEDIA_BUCKET, name: MEDIA_BUCKET, public: true }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok) return;
  const reply = await response.text();
  if (/already exists|duplicate/i.test(reply)) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error("Supabase rejected the key while creating the image folder. Check SUPABASE_SECRET_KEY.");
  }
  throw new Error(`Supabase couldn't create the image folder (error ${response.status}): ${reply.slice(0, 200)}`);
}

let bucketReady: Promise<void> | null = null;

/** Uploads one JPEG, replacing any earlier file at the same path, and returns its public address. */
export async function uploadPublicImage(path: string, image: Buffer): Promise<string> {
  bucketReady ??= ensureBucket().catch((error) => {
    bucketReady = null;
    throw error;
  });
  await bucketReady;
  const response = await fetch(`${base()}/object/${MEDIA_BUCKET}/${path}`, {
    method: "POST",
    headers: { ...keyHeaders(), "Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "max-age=3600" },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Supabase refused the image upload (error ${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  return publicImageUrl(path);
}

/** For the Connections page: whether the key can reach storage. The folder itself is made on the first post. */
export async function checkStorage(): Promise<string | null> {
  try {
    const response = await fetch(`${base()}/bucket/${MEDIA_BUCKET}`, {
      headers: keyHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok || response.status === 404 || response.status === 400) return null;
    if (response.status === 401 || response.status === 403) return "Supabase storage rejected the key. Check SUPABASE_SECRET_KEY.";
    return `Supabase storage returned error ${response.status}.`;
  } catch {
    return "Couldn't reach Supabase storage. Check SUPABASE_URL.";
  }
}
