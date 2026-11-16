import { missingSupabase } from "./supabase";
import { uploadPublicImage } from "./storage";
import { PublishRejected, REQUEST_TIMEOUT_MS, type Publisher } from "./types";

// Instagram API with Instagram Login: a Business or Creator account, no Facebook Page needed.
// Steps: upload the slides, make a container for each, combine them into a carousel, wait until
// Instagram has processed it, then publish. Only the last step can make a post live, so a failure
// before it is always safe to retry.

const API = "https://graph.instagram.com/v26.0";

/** How long to wait for Instagram to process the images, checking every few seconds. */
export const PROCESSING = { attempts: 20, delayMs: 3000 };

type GraphError = { error?: { message?: string; code?: number; type?: string } };

async function graph<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...params, access_token: process.env.INSTAGRAM_ACCESS_TOKEN ?? "" });
  const response = await fetch(method === "GET" ? `${API}${path}?${query}` : `${API}${path}`, {
    method,
    ...(method === "POST" && { body: query }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const reply = (await response.json().catch(() => ({}))) as T & GraphError;
  if (response.status >= 500) throw new Error(`Instagram server error ${response.status}`);
  if (!response.ok || reply.error) throw new PublishRejected(rejectionFor(reply.error));
  return reply;
}

function rejectionFor(error: GraphError["error"]): string {
  if (error?.code === 10 && /insight/i.test(error.message ?? "")) return "The Instagram token doesn't allow reading numbers. It needs the instagram_business_manage_insights permission.";
  if (error?.code === 190) return "Instagram rejected the access token. It may have expired. Create a new one and put it in INSTAGRAM_ACCESS_TOKEN.";
  if (error?.code === 10 || error?.code === 200) return "The Instagram token doesn't allow posting. It needs the instagram_business_content_publish permission.";
  if (error?.code === 4 || error?.code === 9) return "Instagram's posting limit was reached. Try again later.";
  return `Instagram refused the post: ${error?.message ?? "no reason given"}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilReady(containerId: string) {
  for (let attempt = 0; attempt < PROCESSING.attempts; attempt++) {
    const { status_code } = await graph<{ status_code?: string }>("GET", `/${containerId}`, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new PublishRejected("Instagram couldn't process the slide images, so nothing was posted.");
    }
    await wait(PROCESSING.delayMs);
  }
  throw new PublishRejected("Instagram is still processing the images, so nothing was posted yet. Try again in a minute.");
}

export const instagramPublisher: Publisher = {
  missingSettings() {
    return [...(process.env.INSTAGRAM_ACCESS_TOKEN ? [] : ["INSTAGRAM_ACCESS_TOKEN"]), ...missingSupabase()];
  },

  async publish({ content, key, images }) {
    let containerId: string;
    let accountId: string;
    try {
      const slides = await images();
      const urls = await Promise.all(slides.map((image, index) => uploadPublicImage(`instagram/${key}-${index + 1}.jpg`, image)));
      ({ user_id: accountId } = await graph<{ user_id: string }>("GET", "/me", { fields: "user_id" }));
      if (urls.length === 1) {
        ({ id: containerId } = await graph<{ id: string }>("POST", `/${accountId}/media`, { image_url: urls[0], caption: content.body }));
      } else {
        const children: string[] = [];
        for (const url of urls) {
          const { id } = await graph<{ id: string }>("POST", `/${accountId}/media`, { image_url: url, is_carousel_item: "true" });
          children.push(id);
        }
        ({ id: containerId } = await graph<{ id: string }>("POST", `/${accountId}/media`, {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption: content.body,
        }));
      }
      await waitUntilReady(containerId);
    } catch (error) {
      // Nothing is live before media_publish, so every failure up to here is safe to retry.
      if (error instanceof PublishRejected) throw error;
      throw new PublishRejected(`Nothing was posted: ${error instanceof Error ? error.message : "the images couldn't be prepared"}. Please try again.`);
    }

    // From here the post may go live, so a lost connection is reported as unknown.
    const { id } = await graph<{ id: string }>("POST", `/${accountId}/media_publish`, { creation_id: containerId });
    let url: string | null = null;
    try {
      ({ permalink: url } = await graph<{ permalink: string }>("GET", `/${id}`, { fields: "permalink" }));
    } catch {
      // It's live; only its link is missing.
    }
    return { externalId: id, url };
  },
};

/** What Instagram reports for one post, in the studio's own metric names. */
export type InstagramNumbers = { views: number; likes?: number; comments?: number; shares?: number; saves?: number; follows?: number };

const INSIGHT_NAMES: Record<string, keyof InstagramNumbers> = {
  views: "views",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saved: "saves",
  follows: "follows",
};

type Insights = { data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] };

/**
 * Reads a live post's numbers. Instagram doesn't report every number for every kind of post, so when
 * the full list is refused, the common ones are asked for alone.
 */
export async function fetchInstagramNumbers(mediaId: string): Promise<InstagramNumbers> {
  let reply: Insights;
  try {
    reply = await graph<Insights>("GET", `/${encodeURIComponent(mediaId)}/insights`, { metric: "views,likes,comments,shares,saved,follows" });
  } catch (error) {
    if (error instanceof PublishRejected && /token|permission/i.test(error.message)) throw error;
    reply = await graph<Insights>("GET", `/${encodeURIComponent(mediaId)}/insights`, { metric: "views,likes,comments,shares,saved" });
  }
  const numbers: Partial<InstagramNumbers> = {};
  for (const item of reply.data ?? []) {
    const key = INSIGHT_NAMES[item.name];
    const value = item.total_value?.value ?? item.values?.[0]?.value;
    if (key && typeof value === "number" && Number.isFinite(value) && value >= 0) numbers[key] = Math.round(value);
  }
  if (numbers.views === undefined) throw new Error("Instagram gave no view count for this post.");
  return numbers as InstagramNumbers;
}

export async function checkInstagram(): Promise<{ username: string | null; problem: string | null }> {
  try {
    const me = await graph<{ username?: string; account_type?: string }>("GET", "/me", { fields: "user_id,username,account_type" });
    const problem =
      me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(me.account_type)
        ? "This Instagram account is personal. Switch it to a Business or Creator account to post from the studio."
        : null;
    return { username: me.username ? `@${me.username}` : null, problem };
  } catch (error) {
    return { username: null, problem: error instanceof PublishRejected ? error.message : "Couldn't reach Instagram. Check your connection." };
  }
}
