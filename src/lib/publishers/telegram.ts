import { PublishRejected, REQUEST_TIMEOUT_MS, type Publisher } from "./types";

type TelegramReply = {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

async function call(method: string, params: Record<string, unknown> = {}): Promise<TelegramReply> {
  // TELEGRAM_API_URL lets a test copy talk to a stand-in server instead of the real Telegram.
  const base = process.env.TELEGRAM_API_URL || "https://api.telegram.org";
  const response = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.json();
}

/** A private channel's numeric id "-1001234" links as t.me/c/1234. A public one uses its name. */
export function telegramPostUrl(chat: { id: number; username?: string }, messageId: number): string {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  return `https://t.me/c/${String(chat.id).replace(/^-100/, "")}/${messageId}`;
}

function rejectionFor(reply: TelegramReply): string {
  if (reply.error_code === 401) return "Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN in .env.local.";
  if (reply.error_code === 403) return "The bot can't post in this channel. Make it an admin with permission to post.";
  if (reply.error_code === 429) {
    return `Telegram asked to wait ${reply.parameters?.retry_after ?? 60} seconds before posting again.`;
  }
  return `Telegram refused the post: ${reply.description ?? "no reason given"}`;
}

export const telegramPublisher: Publisher = {
  missingSettings() {
    return ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID"].filter((name) => !process.env[name]);
  },

  async publish({ content }) {
    // No parse_mode: the text is sent exactly as written, so symbols can't cause a formatting failure.
    const reply = await call("sendMessage", { chat_id: process.env.TELEGRAM_CHANNEL_ID, text: content.body });
    if (!reply.ok) {
      if ((reply.error_code ?? 500) >= 500) throw new Error(`Telegram server error ${reply.error_code}`);
      throw new PublishRejected(rejectionFor(reply));
    }
    const message = reply.result as { message_id: number; chat: { id: number; username?: string } };
    return { externalId: String(message.message_id), url: telegramPostUrl(message.chat, message.message_id) };
  },

  canUnpublish() {
    return this.missingSettings().length === 0;
  },

  async unpublish(externalId) {
    const reply = await call("deleteMessage", { chat_id: process.env.TELEGRAM_CHANNEL_ID, message_id: Number(externalId) });
    if (reply.ok || /not found/i.test(reply.description ?? "")) return;
    if (/can't be deleted/i.test(reply.description ?? "")) {
      throw new Error("Telegram only lets bots delete posts from the last 48 hours. Delete it in the channel yourself.");
    }
    if (reply.error_code === 403 || /rights|permission/i.test(reply.description ?? "")) {
      throw new Error("The bot isn't allowed to delete posts. Give it the \"Delete messages\" right in the channel, or delete the post yourself.");
    }
    throw new Error(`Telegram didn't delete the post: ${reply.description ?? "no reason given"}`);
  },
};

export type TelegramStatus = {
  botName: string | null;
  channelName: string | null;
  canPost: boolean;
  problem: string | null;
  /** Channels seen in the bot's recent updates, to help find the numeric channel id. */
  foundChannels: { id: number; title: string }[];
};

export async function checkTelegram(): Promise<TelegramStatus> {
  const status: TelegramStatus = { botName: null, channelName: null, canPost: false, problem: null, foundChannels: [] };
  try {
    const me = await call("getMe");
    if (!me.ok) return { ...status, problem: rejectionFor(me) };
    const bot = me.result as { id: number; username: string };
    status.botName = `@${bot.username}`;

    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    if (!channelId) {
      const updates = await call("getUpdates", { allowed_updates: ["channel_post", "my_chat_member"] });
      const channels = new Map<number, string>();
      for (const update of (updates.result ?? []) as {
        channel_post?: { chat: { id: number; title?: string } };
        my_chat_member?: { chat: { id: number; title?: string; type: string } };
      }[]) {
        const chat = update.channel_post?.chat ?? update.my_chat_member?.chat;
        if (chat && chat.id < 0) channels.set(chat.id, chat.title ?? String(chat.id));
      }
      status.foundChannels = [...channels].map(([id, title]) => ({ id, title }));
      return status;
    }

    const chat = await call("getChat", { chat_id: channelId });
    if (!chat.ok) return { ...status, problem: rejectionFor(chat) };
    status.channelName = (chat.result as { title?: string }).title ?? channelId;
    const member = await call("getChatMember", { chat_id: channelId, user_id: bot.id });
    if (!member.ok) return { ...status, problem: rejectionFor(member) };
    const rights = member.result as { status: string; can_post_messages?: boolean };
    status.canPost = rights.status === "creator" || (rights.status === "administrator" && rights.can_post_messages === true);
    if (!status.canPost) status.problem = "The bot needs to be a channel admin with permission to post.";
    return status;
  } catch {
    return { ...status, problem: "Couldn't reach Telegram. Check your connection." };
  }
}
