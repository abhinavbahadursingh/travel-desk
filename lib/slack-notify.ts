// Slack outbound adapter.
//
// Two targets are supported, picked per delivery:
//
//   1. If SLACK_BOT_TOKEN is set AND the recipient has a `slackUserId`
//      cached on the User row, post a DM via `chat.postMessage` to that
//      user id (Slack converts a user id to its IM channel automatically).
//   2. Otherwise, if SLACK_WEBHOOK_URL is set, post to the configured
//      workspace channel. This is the "broadcast" fallback — operators use
//      it for admin-facing events (cancellation requested, trip ready for
//      booking) where "any travel admin" is a reasonable recipient.
//
// When neither is configured, outbound Slack is disabled and the outbox
// marks these rows `failed` with a clear reason so operators can see why
// they didn't go out. The in-app Notification still exists untouched.

export class SlackProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SlackProviderError";
    this.status = status;
  }
}

export function slackDeliveryConfigured(): boolean {
  return Boolean(
    process.env.SLACK_BOT_TOKEN?.trim() || process.env.SLACK_WEBHOOK_URL?.trim(),
  );
}

export type SlackRequest = {
  recipientSlackUserId: string | null;
  text: string;
  link?: string;
};

export type SlackResult = { id: string; via: "dm" | "webhook" };

export type SlackDispatcher = (
  req: SlackRequest & { botToken?: string; webhookUrl?: string },
) => Promise<SlackResult>;

let dispatcherOverride: SlackDispatcher | null = null;

export function __setSlackDispatcherForTests(d: SlackDispatcher | null): void {
  dispatcherOverride = d;
}

async function postDm(botToken: string, userId: string, text: string): Promise<SlackResult> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel: userId, text }),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; ts?: string; error?: string }
    | null;
  if (!res.ok || !data?.ok) {
    throw new SlackProviderError(
      `Slack chat.postMessage failed: ${data?.error ?? res.status}`,
      res.status,
    );
  }
  return { id: data.ts ?? "", via: "dm" };
}

async function postWebhook(webhookUrl: string, text: string): Promise<SlackResult> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SlackProviderError(
      `Slack webhook returned ${res.status}: ${detail.slice(0, 300)}`,
      res.status,
    );
  }
  return { id: `webhook-${Date.now()}`, via: "webhook" };
}

export async function sendSlack(req: SlackRequest): Promise<SlackResult> {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!botToken && !webhookUrl) {
    throw new SlackProviderError(
      "Neither SLACK_BOT_TOKEN nor SLACK_WEBHOOK_URL is configured — Slack delivery is disabled.",
      503,
    );
  }
  const text = req.link ? `${req.text}\n<${req.link}|Open in Travel Agent>` : req.text;
  if (dispatcherOverride) {
    return dispatcherOverride({ ...req, text, botToken, webhookUrl });
  }
  if (botToken && req.recipientSlackUserId) {
    return postDm(botToken, req.recipientSlackUserId, text);
  }
  if (webhookUrl) return postWebhook(webhookUrl, text);
  throw new SlackProviderError(
    "No Slack delivery channel available for this recipient (no bot token or recipient has no Slack ID, and no webhook URL set).",
    503,
  );
}
