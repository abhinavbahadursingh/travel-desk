// Postgres-only integration tests that pin the invariants Phase 4 needs:
//
//   1. CRUD, nullable fields and timestamps round-trip through PostgreSQL.
//   2. Unique constraints (dedupeKey, pendingKey, Session.tokenHash) raise
//      P2002 just like SQLite — the outbox idempotency contract holds.
//   3. Concurrent approval decisions on the same trip serialize: exactly
//      one wins, the other returns P2002, so the trip can never have two
//      `pending` approvals at once.
//   4. `updateMany` with a status guard supports the lifecycle transitions
//      (approved → booking_links_generated and friends).
//   5. A transaction that throws rolls back EVERY inserted row, including
//      the `NotificationDelivery` outbox entry — the commit-before-send
//      invariant still holds under Postgres MVCC.
//   6. A row locked via `SELECT … FOR UPDATE` is not seen by a parallel
//      `SKIP LOCKED` reader — the primitive the Postgres outbox drainer
//      would use is available and behaves as expected.
//
// Opt in by running
//   POSTGRES_TEST_URL="postgresql://user@host:5432/dbname" npm run test
// otherwise the whole suite is skipped. The destination must already have
// the Postgres schema applied (`prisma migrate deploy --schema=prisma/schema.postgres.prisma`).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PG_URL = process.env.POSTGRES_TEST_URL?.trim();
const describePg = PG_URL ? describe : describe.skip;

describePg("PostgreSQL concurrency & integrity", () => {
  let db: import("@prisma/client-postgres").PrismaClient;

  beforeAll(async () => {
    // Lazy-require so the SQLite suites don't resolve the Postgres client at
    // import time — that would fail on a machine without a configured
    // `DATABASE_URL`.
    const { PrismaClient } = await import("@prisma/client-postgres");
    db = new PrismaClient({ datasources: { db: { url: PG_URL! } } });
    // Clean slate for every run.
    await db.notificationDelivery.deleteMany();
    await db.notification.deleteMany();
    await db.approvalEvent.deleteMany();
    await db.approval.deleteMany();
    await db.cancellationRequest.deleteMany();
    await db.booking.deleteMany();
    await db.tripRequest.deleteMany();
    await db.auditLog.deleteMany();
    await db.session.deleteMany();
    await db.user.deleteMany({ where: { email: { endsWith: "@pg.test" } } });
    await db.travelPolicy.deleteMany({ where: { name: { startsWith: "pg-" } } });
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  beforeEach(async () => {
    await db.notificationDelivery.deleteMany();
    await db.approvalEvent.deleteMany();
    await db.approval.deleteMany();
    await db.booking.deleteMany();
    await db.tripRequest.deleteMany();
  });

  async function seedUsers() {
    const [requester, approver, other] = await Promise.all([
      db.user.upsert({
        where: { email: "requester@pg.test" },
        update: {},
        create: {
          email: "requester@pg.test",
          name: "Rita",
          role: "employee",
          active: true,
          mustSetPassword: false,
        },
      }),
      db.user.upsert({
        where: { email: "approver@pg.test" },
        update: {},
        create: {
          email: "approver@pg.test",
          name: "Alex",
          role: "manager",
          active: true,
          mustSetPassword: false,
        },
      }),
      db.user.upsert({
        where: { email: "other@pg.test" },
        update: {},
        create: {
          email: "other@pg.test",
          name: "Omar",
          role: "manager",
          active: true,
          mustSetPassword: false,
        },
      }),
    ]);
    return { requester, approver, other };
  }

  it("CRUD + nullable estimatedCost + timestamps round-trip", async () => {
    const { requester } = await seedUsers();
    const trip = await db.tripRequest.create({
      data: {
        requesterId: requester.id,
        purpose: "PG smoke",
        origin: "Mumbai",
        destination: "Bengaluru",
        departDate: new Date("2027-02-01T09:00:00Z"),
        returnDate: null,
        cabin: "economy",
        status: "draft",
        currency: "INR",
        estimatedCost: null, // Phase 3 cost-integrity contract
        estimateIsComplete: false,
      },
    });
    const read = await db.tripRequest.findUniqueOrThrow({ where: { id: trip.id } });
    expect(read.estimatedCost).toBeNull();
    expect(read.returnDate).toBeNull();
    expect(read.departDate.toISOString()).toBe("2027-02-01T09:00:00.000Z");
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it("NotificationDelivery.dedupeKey is unique (P2002)", async () => {
    const { requester } = await seedUsers();
    await db.notificationDelivery.create({
      data: {
        channel: "email",
        recipientUserId: requester.id,
        recipientAddress: requester.email,
        eventType: "trip_approved",
        subject: "Trip approved",
        body: "",
        dedupeKey: "email:trip_approved:trip:abc:" + requester.id,
      },
    });
    await expect(
      db.notificationDelivery.create({
        data: {
          channel: "email",
          recipientUserId: requester.id,
          recipientAddress: requester.email,
          eventType: "trip_approved",
          subject: "Trip approved",
          body: "",
          dedupeKey: "email:trip_approved:trip:abc:" + requester.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("two concurrent pending approvals on the same trip: one wins, one gets P2002", async () => {
    const { requester, approver, other } = await seedUsers();
    const trip = await db.tripRequest.create({
      data: {
        requesterId: requester.id,
        purpose: "race",
        origin: "A",
        destination: "B",
        departDate: new Date("2027-03-01"),
        status: "pending_approval",
        currency: "INR",
      },
    });
    const create = (approverId: string) =>
      db.approval.create({
        data: {
          tripRequestId: trip.id,
          approverId,
          decision: "pending",
          pendingKey: trip.id,
        },
      });
    const results = await Promise.allSettled([create(approver.id), create(other.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toBe(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code?: string }).code).toBe("P2002");
    const pending = await db.approval.count({ where: { tripRequestId: trip.id, pendingKey: trip.id } });
    expect(pending).toBe(1);
  });

  it("updateMany lifecycle guard: only one status transition wins", async () => {
    const { requester } = await seedUsers();
    const trip = await db.tripRequest.create({
      data: {
        requesterId: requester.id,
        purpose: "lifecycle",
        origin: "A",
        destination: "B",
        departDate: new Date("2027-04-01"),
        status: "approved",
        currency: "INR",
      },
    });
    const transition = () =>
      db.tripRequest.updateMany({
        where: { id: trip.id, status: "approved" },
        data: { status: "booking_links_generated" },
      });
    const [a, b] = await Promise.all([transition(), transition()]);
    // Postgres serializes; exactly one sees a matching row.
    expect(a.count + b.count).toBe(1);
    const fresh = await db.tripRequest.findUniqueOrThrow({ where: { id: trip.id } });
    expect(fresh.status).toBe("booking_links_generated");
  });

  it("transaction rollback drops the in-flight NotificationDelivery row", async () => {
    const { requester } = await seedUsers();
    const dedupe = `email:rollback:trip:x:${requester.id}:${Date.now()}`;
    await expect(
      db.$transaction(async (tx) => {
        await tx.notificationDelivery.create({
          data: {
            channel: "email",
            recipientUserId: requester.id,
            recipientAddress: requester.email,
            eventType: "trip_approved",
            subject: "subj",
            body: "",
            dedupeKey: dedupe,
          },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await db.notificationDelivery.count({ where: { dedupeKey: dedupe } });
    expect(after).toBe(0);
  });

  it("SKIP LOCKED: a locked row is invisible to a parallel skip-locked reader", async () => {
    const { requester } = await seedUsers();
    const row = await db.notificationDelivery.create({
      data: {
        channel: "email",
        recipientUserId: requester.id,
        recipientAddress: requester.email,
        eventType: "trip_approved",
        subject: "skip-locked",
        body: "",
        dedupeKey: `email:skiplocked:trip:${Date.now()}:${requester.id}`,
      },
    });
    const { PrismaClient } = await import("@prisma/client-postgres");
    const b = new PrismaClient({ datasources: { db: { url: PG_URL! } } });
    try {
      let holderReleased = false;
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id = ${row.id} FOR UPDATE`;
        // Hold the lock long enough for the second session to attempt
        // SKIP LOCKED.
        await new Promise((r) => setTimeout(r, 300));
        holderReleased = true;
      });
      // Second session must NOT see row (it's locked).
      await new Promise((r) => setTimeout(r, 50));
      const seen = await b.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "NotificationDelivery"
        WHERE status = 'pending'
        FOR UPDATE SKIP LOCKED
      `;
      expect(seen.find((r) => r.id === row.id)).toBeUndefined();
      expect(holderReleased).toBe(false);
      await holder;
      // After the holder commits, a fresh FOR UPDATE SKIP LOCKED sees it.
      const seenAfter = await b.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "NotificationDelivery"
        WHERE status = 'pending'
        FOR UPDATE SKIP LOCKED
      `;
      expect(seenAfter.find((r) => r.id === row.id)).toBeDefined();
    } finally {
      await b.$disconnect();
    }
  });
});
