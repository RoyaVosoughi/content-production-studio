import { PublishRejected, REQUEST_TIMEOUT_MS, type Publisher } from "./types";

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

export const linkedinPublisher: Publisher = {
  missingSettings() {
    return process.env.LINKEDIN_ACCESS_TOKEN ? [] : ["LINKEDIN_ACCESS_TOKEN"];
  },

  async publish({ content }) {
    const { sub } = await memberProfile();
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Linkedin-Version": API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${sub}`,
        commentary: escapeForLinkedIn(content.body),
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
      headers: {
        Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        "Linkedin-Version": API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
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
