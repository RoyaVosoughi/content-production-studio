import { articleUrl } from "../profile";
import { uploadPublicImage } from "./storage";
import { missingSupabase, supabaseHeaders, supabaseUrl } from "./supabase";
import { PublishRejected, REQUEST_TIMEOUT_MS, type PostedImage, type Publisher } from "./types";

// Articles reach the website one of two ways, chosen in .env.local:
//
// - Webhook (WEBSITE_WEBHOOK_URL): the studio sends the finished article as JSON to an address you
//   choose. It works with WordPress, Ghost, n8n, Zapier, Make or your own site. See README.md.
// - Supabase (SUPABASE_URL and SUPABASE_SECRET_KEY): the studio adds a row to a blog table, one row per
//   language. The table is blog_posts unless WEBSITE_SUPABASE_TABLE names another.
//
// When both are set, the webhook is used.
//
// An article's brand image goes to your Supabase storage, when Supabase is set up, so the website can
// show it from a public address. A webhook also receives the image itself, so it works without Supabase.

type Mode = "webhook" | "supabase";

export function websiteMode(): Mode {
  return process.env.WEBSITE_WEBHOOK_URL ? "webhook" : "supabase";
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const tableName = () => process.env.WEBSITE_SUPABASE_TABLE || "blog_posts";
const imageColumn = () => process.env.WEBSITE_SUPABASE_IMAGE_COLUMN || "cover_image";

/** Puts the image in public storage, before anything is posted, and returns its address. */
async function publicCover(key: string, image: PostedImage): Promise<string> {
  try {
    return await uploadPublicImage(`articles/${key}.jpg`, image.jpeg);
  } catch (error) {
    throw new PublishRejected(`${error instanceof Error ? error.message : "The image upload failed."} Nothing was posted.`);
  }
}
const table = () => `${supabaseUrl()}/rest/v1/${tableName()}`;

function webhookHeaders(key: string): Record<string, string> {
  const secret = process.env.WEBSITE_WEBHOOK_SECRET;
  return {
    "Content-Type": "application/json",
    // The same key on a retry tells the receiver it's the same article, so it can avoid posting twice.
    "Idempotency-Key": key,
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
  };
}

const webhookPublisher: Publisher["publish"] = async ({ language, content, key, profile, image }) => {
  const slug = content.slug as string;
  const expected = profile ? articleUrl(profile, language, slug) : null;
  const picture = image ? await image() : null;
  // The webhook gets the image itself too, so a storage problem only leaves out the public address.
  const pictureUrl = picture && missingSupabase().length === 0 ? await publicCover(key, picture).catch(() => null) : null;
  let response: Response;
  try {
    response = await fetch(process.env.WEBSITE_WEBHOOK_URL as string, {
      method: "POST",
      headers: webhookHeaders(key),
      body: JSON.stringify({
        event: "article.publish",
        id: key,
        language,
        slug,
        title: content.title,
        excerpt: content.excerpt ?? "",
        body_markdown: content.body,
        tags: content.tags ?? [],
        url: expected,
        image: picture
          ? {
              url: pictureUrl,
              alt: picture.alt,
              width: picture.width,
              height: picture.height,
              content_type: "image/jpeg",
              data_base64: picture.jpeg.toString("base64"),
            }
          : null,
        published_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The article may have arrived before the connection dropped, so this isn't a clear "not posted".
    throw new Error("The website webhook didn't answer.");
  }
  if (response.status >= 500) throw new Error(`Website webhook error ${response.status}`);
  if (response.status === 401 || response.status === 403) {
    throw new PublishRejected("The website webhook refused the request. Check WEBSITE_WEBHOOK_SECRET in .env.local.");
  }
  if (response.status === 409) {
    throw new PublishRejected(`The web address "${slug}" is already used by another article. Change it and try again.`);
  }
  if (!response.ok) {
    throw new PublishRejected(`The website refused the article (error ${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  // The receiver may answer with the article's id and address. Both are optional.
  const reply = (await response.json().catch(() => null)) as { id?: unknown; url?: unknown } | null;
  const url = typeof reply?.url === "string" && /^https?:\/\//.test(reply.url) ? reply.url : expected;
  return { externalId: reply?.id != null ? String(reply.id) : null, url };
};

const supabasePublisher: Publisher["publish"] = async ({ language, content, profile, key, image }) => {
  if (!TABLE_NAME.test(tableName())) throw new PublishRejected("WEBSITE_SUPABASE_TABLE can only use letters, numbers and _.");
  if (!TABLE_NAME.test(imageColumn())) throw new PublishRejected("WEBSITE_SUPABASE_IMAGE_COLUMN can only use letters, numbers and _.");
  const slug = content.slug as string;
  const url = profile ? articleUrl(profile, language, slug) : null;

  // Checking first means a retry after a lost connection can't publish twice or be refused by mistake.
  let existing: { id: string; status: string; body_md: string }[];
  try {
    const found = await fetch(
      `${table()}?locale=eq.${encodeURIComponent(language)}&slug=eq.${encodeURIComponent(slug)}&select=id,status,body_md`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (found.status === 401 || found.status === 403) {
      throw new PublishRejected("The website database rejected the key. Check SUPABASE_SECRET_KEY in .env.local.");
    }
    if (!found.ok) throw new PublishRejected(`The website database returned error ${found.status}, so nothing was posted.`);
    existing = await found.json();
  } catch (error) {
    if (error instanceof PublishRejected) throw error;
    throw new PublishRejected("Couldn't reach the website database, so nothing was posted. Please try again.");
  }
  if (existing[0]) {
    if (existing[0].status === "published" && existing[0].body_md === content.body) {
      return { externalId: existing[0].id, url };
    }
    throw new PublishRejected(`The web address "${slug}" is already used by another article. Change it and try again.`);
  }

  const picture = image ? await image() : null;
  const pictureUrl = picture ? await publicCover(key, picture) : null;
  const now = new Date().toISOString();
  const response = await fetch(table(), {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      locale: language,
      slug,
      title: content.title,
      excerpt: content.excerpt ?? "",
      body_md: content.body,
      tags: content.tags ?? [],
      status: "published",
      published_at: now,
      updated_at: now,
      ...(pictureUrl && { [imageColumn()]: pictureUrl }),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status >= 500) throw new Error(`Website database error ${response.status}`);
  if (response.status === 409) {
    throw new PublishRejected(`The web address "${slug}" is already used by another article. Change it and try again.`);
  }
  if (!response.ok) {
    const reply = (await response.text()).slice(0, 300);
    if (pictureUrl && reply.includes(imageColumn())) {
      throw new PublishRejected(
        `The ${tableName()} table has no ${imageColumn()} column for the image. Add it (see README.md), or remove the image. Nothing was posted.`,
      );
    }
    throw new PublishRejected(`The website refused the article (error ${response.status}): ${reply}`);
  }
  const [row] = (await response.json()) as { id: string }[];
  return { externalId: row?.id ?? null, url };
};

export const websitePublisher: Publisher = {
  missingSettings() {
    return websiteMode() === "webhook" ? [] : missingSupabase();
  },
  publish(input) {
    return websiteMode() === "webhook" ? webhookPublisher(input) : supabasePublisher(input);
  },

  // A webhook only knows how to receive articles, so only the Supabase table can be deleted from here.
  canUnpublish() {
    return websiteMode() === "supabase" && missingSupabase().length === 0 && TABLE_NAME.test(tableName());
  },

  async unpublish(externalId) {
    let response: Response;
    try {
      response = await fetch(`${table()}?id=eq.${encodeURIComponent(externalId)}`, {
        method: "DELETE",
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Couldn't reach the website database. Please try again.");
    }
    if (response.ok) return;
    throw new Error(`The website database didn't delete the article (error ${response.status}). Delete it on your site yourself.`);
  },
};

/** For the Connections page. A webhook can't be tried without posting, so it is only checked when you post. */
export async function checkWebsite(): Promise<{ ok: boolean; problem: string | null }> {
  if (websiteMode() === "webhook") {
    try {
      new URL(process.env.WEBSITE_WEBHOOK_URL as string);
      return { ok: true, problem: null };
    } catch {
      return { ok: false, problem: "WEBSITE_WEBHOOK_URL isn't a valid web address." };
    }
  }
  if (!TABLE_NAME.test(tableName())) return { ok: false, problem: "WEBSITE_SUPABASE_TABLE can only use letters, numbers and _." };
  try {
    const response = await fetch(`${table()}?select=id&limit=1`, {
      headers: supabaseHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, problem: null };
    if (response.status === 404) return { ok: false, problem: `The table ${tableName()} wasn't found. Create it, or set WEBSITE_SUPABASE_TABLE.` };
    return { ok: false, problem: `The website database returned error ${response.status}. Check the address and key.` };
  } catch {
    return { ok: false, problem: "Couldn't reach the website database. Check SUPABASE_URL." };
  }
}
