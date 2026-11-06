// Transactional outbox for external notification delivery.
//
// Architecture:
//
//   1. Business routes call `notify(tx, …)` / `notifyMany(tx, …)` from
//      lib/audit.ts inside their state-changing transaction. In addition to
//      the in-app Notification row, these now ALSO insert one row per
//      configured external channel into NotificationDelivery (this file's
//      `enqueueDeliveriesForEvent`).
//
//   2. The DB transaction commits. In-app notifications are visible, and
//      the outbox has durable records of what needs to be sent externally.
//
//   3. After commit, callers fire-and-forget `kickOutboxProcessor()`. That
//      function is safe to call many times — it serialises processing per
//      Node process and drains a bounded batch. On provider failure the
//      row stays `pending` (or flips to `failed` once attempts >= MAX).
//
// Key invariants:
//   - No external send happens before commit (dispatches load pending rows
//     from the committed DB, not from in-flight transaction state).
//   - A retry never duplicates: `dedupeKey` is unique, and a `pending` row
//     being re-sent would still be the SAME row, not a new one.
//   - If Resend/Slack is unconfigured, no outbox row is created for that
//     channel, so no "stuck failed" entries pile up.
//   - In-app Notification rows are created unconditionally and are never
//     deleted if external delivery fails.

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  emailDeliveryConfigured,
  sendEmail,
  EmailProviderError,
} from "./mailer";
import {
  slackDeliveryConfigured,
  sendSlack,
  SlackProviderError,
} from "./slack-notify";

type Client = Prisma.TransactionClient | typeof db;

// Event types that trigger external delivery. The map doubles as the
// allow-list — anything not listed stays in-app only.
const DELIVERABLE_EVENTS = new Set<string>([
  "approval_assigned", // submit → assigned approver
  "trip_approved", // covers both the human and auto-approval paths
  "trip_rejected",
  "trip_changes_requested",
  "trip_ready_for_booking", // approved → notify travel admins
  "booking_links_ready", // admin generated booking links → requester
  "booking_confirmed", // provider reference recorded → requester
  "cancellation_requested", // requester asked to cancel → travel admins
  "trip_cancelled", // verified cancellation → requester
]);

export function isDeliverableEvent(type: string): boolean {
  return DELIVERABLE_EVENTS.has(type);
}

// Public shape describing one event to enqueue. Mirrors the in-app Notification
// fields plus optional entity pointers used for dedupeKey.
export type DeliveryInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
};

function absoluteLink(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function dedupeKey(
  channel: string,
  userId: string,
  input: DeliveryInput,
): string {
  // dedupeKey is the server-side idempotency anchor. A retry of the same
  // business event produces the same key and the DB rejects the insert.
  const entity = `${input.entityType ?? "-"}:${input.entityId ?? "-"}`;
  return `${channel}:${input.type}:${entity}:${userId}`;
}

/**
 * Enqueue external deliveries for one event. Call INSIDE the business
 * transaction so the outbox row commits with the state change.
 *
 * Only creates a row for each channel that is actually configured. When
 * the deduplication key already exists, the insert is treated as a no-op
 * so re-fires are safe.
 */
export async function enqueueDeliveriesForEvent(
  client: Client,
  input: DeliveryInput,
): Promise<void> {
  if (!isDeliverableEvent(input.type)) return;

  const user = await client.user.findUnique({
    where: { id: input.userId },
    select: { email: true, slackUserId: true, active: true },
  });
  if (!user || !user.active) return;

  const rows: Prisma.NotificationDeliveryCreateInput[] = [];
  if (emailDeliveryConfigured() && user.email) {
    rows.push({
      channel: "email",
      recipientUserId: input.userId,
      recipientAddress: user.email,
      eventType: input.type,
      subject: input.title,
      body: input.body ?? "",
      link: absoluteLink(input.link),
      dedupeKey: dedupeKey("email", input.userId, input),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  }
  if (slackDeliveryConfigured()) {
    rows.push({
      channel: "slack",
      recipientUserId: input.userId,
      recipientAddress: user.slackUserId,
      eventType: input.type,
      subject: input.title,
      body: input.body ?? "",
      link: absoluteLink(input.link),
      dedupeKey: dedupeKey("slack", input.userId, input),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  }
  if (rows.length === 0) return;

  // `createMany({ skipDuplicates: true })` isn't supported on SQLite, so
  // insert row-by-row and swallow the unique-constraint violation that
  // signals a duplicate dedupeKey. Business retries that re-fire the
  // same event become a no-op here.
  for (const row of rows) {
    try {
      await client.notificationDelivery.create({ data: row });
    } catch (error: unknown) {
      const isDup =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (!isDup) throw error;
    }
  }
}

// ──────────────────────────── Processor ─────────────────────────────

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

let processing = false;

/**
 * Drain pending outbox rows in a bounded batch. Safe to call multiple
 * times — a per-process lock prevents overlapping drains.
 *
 * Returns the number of rows that transitioned to `sent` (or `failed`
 * after exhausting attempts).
 */
export async function processOutbox(options: { limit?: number } = {}): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  if (processing) return { sent: 0, failed: 0, skipped: 0 };
  processing = true;
  try {
    const limit = options.limit ?? BATCH_SIZE;
    const pending = await db.notificationDelivery.findMany({
      where: { status: "pending", attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of pending) {
      try {
        const result = await dispatch(row);
        await db.notificationDelivery.update({
          where: { id: row.id },
          data: {
            status: "sent",
            sentAt: new Date(),
            attempts: row.attempts + 1,
            lastAttemptAt: new Date(),
            providerMessageId: result.id,
            lastError: null,
          },
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextAttempts = row.attempts + 1;
        const exhausted = nextAttempts >= MAX_ATTEMPTS;
        await db.notificationDelivery.update({
          where: { id: row.id },
          data: {
            status: exhausted ? "failed" : "pending",
            attempts: nextAttempts,
            lastAttemptAt: new Date(),
            lastError: message.slice(0, 2000),
          },
        });
        if (exhausted) failed += 1;
        else skipped += 1;
      }
    }
    return { sent, failed, skipped };
  } finally {
    processing = false;
  }
}

type DeliveryRow = {
  id: string;
  channel: string;
  recipientAddress: string | null;
  subject: string;
  body: string;
  link: string | null;
};

async function dispatch(row: DeliveryRow): Promise<{ id: string }> {
  if (row.channel === "email") {
    if (!row.recipientAddress) {
      throw new EmailProviderError("recipient has no email address", 400);
    }
    const linkLine = row.link ? `\n\n${row.link}` : "";
    const result = await sendEmail({
      to: row.recipientAddress,
      subject: row.subject,
      text: `${row.body}${linkLine}`.trim(),
    });
    return { id: result.id };
  }
  if (row.channel === "slack") {
    const text = `*${row.subject}*\n${row.body}`.trim();
    const result = await sendSlack({
      recipientSlackUserId: row.recipientAddress,
      text,
      link: row.link ?? undefined,
    });
    return { id: result.id };
  }
  throw new Error(`Unknown delivery channel: ${row.channel}`);
}

/**
 * Fire-and-forget kick. Safe in the request lifecycle — the processor
 * swallows its own errors into the outbox row, so a failed send cannot
 * surface as a 500 to the caller.
 *
 * Suppressed under `NODE_ENV=test` so tests can control dispatch timing
 * explicitly via `processOutbox()`. Operators drain manually via the
 * `/api/admin/notifications/process` endpoint, or an external scheduler.
 */
export function kickOutboxProcessor(): void {
  if (process.env.NODE_ENV === "test") return;
  // Deliberately not awaited. The caller returned its response before
  // this runs, and the outbox guarantees we can always retry on the next
  // kick (or a manual /api/admin/notifications/process call).
  void processOutbox().catch((e) => {
    console.error("[outbox] processor error", e);
  });
}
