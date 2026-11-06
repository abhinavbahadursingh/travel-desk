// Resend adapter. Minimal HTTP client so tests don't need the SDK.
//
// The function is a THIN wrapper: it only translates (to, subject, body)
// into a Resend API call and either resolves with a provider id or throws
// with a diagnostic. The outbox worker (lib/notifications.ts) owns retry,
// attempt counting and idempotency.

export class EmailProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EmailProviderError";
    this.status = status;
  }
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function defaultFrom(): string {
  // "noreply <noreply@example.local>" when EMAIL_FROM is unset. Operators
  // should set EMAIL_FROM to a domain they own in production or Resend will
  // reject the request.
  return process.env.EMAIL_FROM?.trim() || "Travel Agent <noreply@example.local>";
}

export type EmailRequest = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult = { id: string };

// Allow tests to inject a fake dispatcher. Not set in production; the real
// HTTP client is used when this is undefined.
export type EmailDispatcher = (req: EmailRequest & { from: string; apiKey: string }) => Promise<EmailResult>;

let dispatcherOverride: EmailDispatcher | null = null;

export function __setEmailDispatcherForTests(d: EmailDispatcher | null): void {
  dispatcherOverride = d;
}

async function postToResend(
  req: EmailRequest & { from: string; apiKey: string },
): Promise<EmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      from: req.from,
      to: req.to,
      subject: req.subject,
      text: req.text,
      ...(req.html ? { html: req.html } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new EmailProviderError(
      `Resend returned ${res.status}: ${detail.slice(0, 500)}`,
      res.status,
    );
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!data?.id) {
    throw new EmailProviderError("Resend response missing message id", 502);
  }
  return { id: data.id };
}

export async function sendEmail(req: EmailRequest): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailProviderError(
      "RESEND_API_KEY is not configured — email delivery is disabled.",
      503,
    );
  }
  const payload = { ...req, from: defaultFrom(), apiKey };
  if (dispatcherOverride) return dispatcherOverride(payload);
  return postToResend(payload);
}
