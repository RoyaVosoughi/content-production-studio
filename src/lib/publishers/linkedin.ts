import { PublishRejected, REQUEST_TIMEOUT_MS, type PostedImage, type Publisher } from "./types";

// LinkedIn supports each monthly version for at least a year, then rejects it. This one is from October 2026.
const API_VERSION = "202610";

const TOKEN_EXPIRED =
  "LinkedIn rejected the access token. Tokens last 60 days, so create a new one and update LINKEDIN_ACCESS_TOKEN in .env.local.";

/**
 * LinkedIn's "little" text format treats these characters as commands, and they must be escaped.
 * Hashtags stay as they are so LinkedIn links them.
 */
export function escapeForLinkedIn(text: string): string {
  return text
    .split(/(#[\p{L}\p{N}_]+)/u)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/[\\|{}@[\]()<>#*_~]/g, "\\$&")))
    .join("");
}

async function memberProfile(): Promise<{ sub: string; name?: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PublishRejected("Couldn't reach LinkedIn, so nothing was posted. Please try again.");
  }
  if (response.status === 401) throw new PublishRejected(TOKEN_EXPIRED);
  if (!response.ok) {
    throw new PublishRejected(
      `LinkedIn couldn't confirm your profile (error ${response.status}). The token needs the openid and profile permissions.`,
    );
  }
  return response.json();
}

const restHeaders = () => ({
  Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
  "Linkedin-Version": API_VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
});

/**
 * Uploads the image in LinkedIn's two steps and returns its id for the post. This happens before the
 * post is made, so any failure here means nothing was posted.
 */
export async function uploadLinkedInImage(owner: string, image: PostedImage): Promise<string> {
  let started: Response;
  try {
    started = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: { ...restHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PublishRejected("Couldn't reach LinkedIn to upload the image, so nothing was posted. Please try again.");
  }
  if (started.status === 401) throw new PublishRejected(TOKEN_EXPIRED);
  if (!started.ok) {
    throw new PublishRejected(
      `LinkedIn refused the image (error ${started.status}), so nothing was posted. The token needs the w_member_social permission.`,
    );
  }
  const { value } = (await started.json()) as { value?: { uploadUrl?: string; image?: string } };
  if (!value?.uploadUrl || !value.image) throw new PublishRejected("LinkedIn didn't give an address for the image, so nothing was posted.");

  let uploaded: Response;
  try {
    uploaded = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`, "Content-Type": "image/jpeg" },
      body: new Uint8Array(image.jpeg),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2),
    });
  } catch {
    throw new PublishRejected("The image upload to LinkedIn didn't finish, so nothing was posted. Please try again.");
  }
  if (!uploaded.ok) throw new PublishRejected(`LinkedIn refused the image upload (error ${uploaded.status}), so nothing was posted.`);
  return value.image;
}

export const linkedinPublisher: Publisher = {
  missingSettings() {
    return process.env.LINKEDIN_ACCESS_TOKEN ? [] : ["LINKEDIN_ACCESS_TOKEN"];
  },

  async publish({ content, image }) {
    const { sub } = await memberProfile();
    const author = `urn:li:person:${sub}`;
    const picture = image ? await image() : null;
    const media = picture ? { media: { id: await uploadLinkedInImage(author, picture), altText: picture.alt } } : null;
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: { ...restHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        author,
        commentary: escapeForLinkedIn(content.body),
        ...(media && { content: media }),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401) throw new PublishRejected(TOKEN_EXPIRED);
    if (response.status === 403) {
      throw new PublishRejected("LinkedIn refused the post. The token needs the w_member_social permission.");
    }
    if (response.status >= 500) throw new Error(`LinkedIn server error ${response.status}`);
    if (response.status !== 201) {
      throw new PublishRejected(`LinkedIn refused the post (error ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const urn = response.headers.get("x-restli-id");
    return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },

  canUnpublish() {
    return Boolean(process.env.LINKEDIN_ACCESS_TOKEN);
  },

  async unpublish(externalId) {
    const response = await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(externalId)}`, {
      method: "DELETE",
      headers: restHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok || response.status === 404) return;
    if (response.status === 401) throw new Error(TOKEN_EXPIRED);
    throw new Error(`LinkedIn didn't delete the post (error ${response.status}). Delete it on LinkedIn yourself.`);
  },
};

export async function checkLinkedIn(): Promise<{ name: string | null; problem: string | null }> {
  try {
    const profile = await memberProfile();
    return { name: profile.name ?? "Connected", problem: null };
  } catch (error) {
    return { name: null, problem: error instanceof Error ? error.message : "Couldn't reach LinkedIn." };
  }
}
