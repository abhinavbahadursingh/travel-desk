import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { enqueueDeliveriesForEvent, isDeliverableEvent } from "./notifications";

type Client = Prisma.TransactionClient | typeof db;

export async function recordAudit(
  client: Client,
  input: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    metadata?: unknown;
  },
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata:
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
    },
  });
}

export type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  // Optional entity pointers — used by the outbox to compute a stable,
  // per-event dedupeKey so a retry of the same business event cannot
  // double-send. In-app Notification rows have always ignored these.
  entityType?: string;
  entityId?: string;
};

export async function notify(client: Client, input: NotifyInput): Promise<void> {
  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    },
  });
  // External delivery enqueue runs INSIDE the same transaction. It is a
  // no-op for non-deliverable event types.
  if (isDeliverableEvent(input.type)) {
    await enqueueDeliveriesForEvent(client, input);
  }
}

export async function notifyMany(
  client: Client,
  userIds: string[],
  input: Omit<NotifyInput, "userId">,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await client.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });
  if (isDeliverableEvent(input.type)) {
    for (const userId of unique) {
      await enqueueDeliveriesForEvent(client, { ...input, userId });
    }
  }
}
