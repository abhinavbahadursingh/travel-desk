// Transactional outbox integration tests.
//
// These exercise the FULL pipeline: a business route runs inside its real
// transaction → enqueues outbox rows → processor dispatches via the
// injected fake Resend/Slack providers → rows transition to `sent` or
// `failed`. The fakes record what was dispatched so we can assert
// recipients, event types and bodies without touching the network.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { callRoute } from "../setup/api-harness";
import {
  freshDb,
  loadSeededUsers,
  resetTripData,
  TEST_USERS,
} from "../setup/test-db";
import { POST as SUBMIT } from "@/app/api/trips/[id]/submit/route";
import { POST as DECIDE } from "@/app/api/approvals/[id]/route";
import { POST as PROCESS } from "@/app/api/admin/notifications/process/route";
import { processOutbox } from "@/lib/notifications";
import {
  __setEmailDispatcherForTests,
  EmailProviderError,
} from "@/lib/mailer";
import { __setSlackDispatcherForTests } from "@/lib/slack-notify";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

type EmailCall = { to: string; subject: string; text: string };
type SlackCall = { user: string | null; text: string };

let emails: EmailCall[] = [];
let slacks: SlackCall[] = [];
let emailBehavior: "ok" | "throw" | "throw-once" = "ok";
let emailThrownOnce = false;
let slackBehavior: "ok" | "throw" = "ok";

function resetFakes() {
  emails = [];
  slacks = [];
  emailBehavior = "ok";
  emailThrownOnce = false;
  slackBehavior = "ok";
}

beforeEach(async () => {
  await resetTripData(db);
  resetFakes();
  // Pretend both channels are configured so the outbox enqueues rows.
  process.env.RESEND_API_KEY = "re_test";
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/T/B/C";
  delete process.env.SLACK_BOT_TOKEN;

  __setEmailDispatcherForTests(async (req) => {
    emails.push({ to: req.to, subject: req.subject, text: req.text });
    if (emailBehavior === "throw") {
      throw new EmailProviderError("Resend: injected fault", 502);
    }
    if (emailBehavior === "throw-once" && !emailThrownOnce) {
      emailThrownOnce = true;
      throw new EmailProviderError("Resend: transient fault", 502);
    }
    return { id: `resend_${emails.length}` };
  });
  __setSlackDispatcherForTests(async (req) => {
    slacks.push({ user: req.recipientSlackUserId, text: req.text });
    if (slackBehavior === "throw") {
      throw new Error("Slack: injected fault");
    }
    return { id: `slack_${slacks.length}`, via: "webhook" };
  });
});

afterEach(() => {
  __setEmailDispatcherForTests(null);
  __setSlackDispatcherForTests(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.SLACK_WEBHOOK_URL;
});

async function makeSubmittableTrip(requesterId: string, total = 13000) {
  const itinerary = {
    flights: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
    hotels: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
    trains: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
    cabs: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
    featured: {
      flight: { estimatedPrice: Math.round(total * 0.4) },
      hotel: { estimatedPrice: Math.round(total * 0.3) },
      train: null,
      cab: null,
    },
    estimatedTotal: total,
    rationale: "test",
    retrievedAt: new Date().toISOString(),
  };
  return db.tripRequest.create({
    data: {
      requesterId,
      purpose: "Phase 3 outbox",
      origin: "Mumbai",
      destination: "Bengaluru",
      departDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      returnDate: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
      cabin: "economy",
      status: "draft",
      currency: "INR",
      estimatedCost: total,
      estimateIsComplete: true,
      itinerary: JSON.stringify(itinerary),
      itineraryRetrievedAt: new Date(),
    },
  });
}

describe("outbox: enqueue on submit", () => {
  it("submit enqueues email + slack for the assigned approver", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);

    const res = await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    expect(res.status).toBe(200);

    const rows = await db.notificationDelivery.findMany({
      where: { recipientUserId: manager.id },
      orderBy: { channel: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "slack"]);
    expect(rows[0].eventType).toBe("approval_assigned");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].entityType).toBe("TripRequest");
    expect(rows[0].entityId).toBe(trip.id);
  });

  it("does NOT enqueue external rows when neither provider is configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SLACK_WEBHOOK_URL;

    const { employee } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    const res = await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    expect(res.status).toBe(200);

    const rows = await db.notificationDelivery.findMany({});
    expect(rows).toHaveLength(0);

    // And the in-app Notification was still created — in-app survives
    // when external delivery is disabled.
    const inApp = await db.notification.findMany({});
    expect(inApp.length).toBeGreaterThan(0);
  });

  it("does NOT enqueue duplicates when submit is retried for the same trip", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    // A second submit on an already-pending trip returns idempotent.
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const rows = await db.notificationDelivery.findMany({
      where: { recipientUserId: manager.id },
    });
    expect(rows).toHaveLength(2);
  });
});

describe("outbox: processor dispatches", () => {
  it("processOutbox sends both email and slack, marks the rows `sent`", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });

    const summary = await processOutbox();
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(manager.email);
    expect(emails[0].subject).toBe("New approval request");

    expect(slacks).toHaveLength(1);
    expect(slacks[0].text).toContain("New approval request");

    const rows = await db.notificationDelivery.findMany({
      where: { recipientUserId: manager.id },
    });
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
    expect(rows.every((r) => r.providerMessageId !== null)).toBe(true);
  });

  it("a provider failure keeps the row `pending` and bumps `attempts`", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    emailBehavior = "throw";

    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });

    const summary = await processOutbox();
    expect(summary.sent).toBe(1); // slack succeeded
    expect(summary.skipped).toBe(1); // email failed and will retry

    const emailRow = await db.notificationDelivery.findFirstOrThrow({
      where: { recipientUserId: manager.id, channel: "email" },
    });
    expect(emailRow.status).toBe("pending");
    expect(emailRow.attempts).toBe(1);
    expect(emailRow.lastError).toContain("injected fault");
  });

  it("transient fault recovers on retry (same row, no duplicate send)", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    emailBehavior = "throw-once";

    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });

    await processOutbox(); // first pass: email throws
    await processOutbox(); // second pass: email succeeds

    const emailRow = await db.notificationDelivery.findFirstOrThrow({
      where: { recipientUserId: manager.id, channel: "email" },
    });
    expect(emailRow.status).toBe("sent");
    expect(emailRow.attempts).toBe(2);
    // Only one actual successful dispatch recorded.
    expect(emails).toHaveLength(2); // the fake records every attempt
    // Slack only ran once (no retry needed).
    expect(slacks).toHaveLength(1);
  });

  it("exhausting MAX_ATTEMPTS marks the row `failed`", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    emailBehavior = "throw";
    slackBehavior = "throw";

    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });

    for (let i = 0; i < 5; i += 1) {
      await processOutbox();
    }

    const rows = await db.notificationDelivery.findMany({
      where: { recipientUserId: manager.id },
    });
    expect(rows.every((r) => r.status === "failed")).toBe(true);
    expect(rows.every((r) => r.attempts >= 5)).toBe(true);
  });

  it("processor is a no-op when there is nothing pending", async () => {
    const summary = await processOutbox();
    expect(summary).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });
});

describe("outbox: recipients across the lifecycle", () => {
  it("approve sends email+slack to the requester and to travel admins", async () => {
    const { employee, manager, travelAdmin } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });

    await callRoute(DECIDE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });

    const toEmployee = await db.notificationDelivery.findMany({
      where: { recipientUserId: employee.id, eventType: "trip_approved" },
    });
    expect(toEmployee).toHaveLength(2);
    const toAdmins = await db.notificationDelivery.findMany({
      where: { eventType: "trip_ready_for_booking" },
    });
    expect(toAdmins.some((r) => r.recipientUserId === travelAdmin.id)).toBe(true);
    void manager;
  });

  it("reject sends only to the requester", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    await callRoute(DECIDE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "rejected", rejectionReason: "budget frozen" },
    });

    const rejectRows = await db.notificationDelivery.findMany({
      where: { eventType: "trip_rejected" },
    });
    expect(rejectRows.every((r) => r.recipientUserId === employee.id)).toBe(
      true,
    );
    expect(rejectRows).toHaveLength(2);
    void manager;
  });
});

describe("outbox: authorization on the processor endpoint", () => {
  it("non super-admin cannot drive the processor", async () => {
    const res = await callRoute(PROCESS, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
    });
    expect(res.status).toBe(403);
  });

  it("super admin can drive the processor", async () => {
    const res = await callRoute(PROCESS, {
      method: "POST",
      userEmail: TEST_USERS.superAdmin.email,
    });
    expect(res.status).toBe(200);
  });
});

describe("outbox: transaction atomicity", () => {
  it("rolling back the business transaction leaves the outbox clean", async () => {
    const { employee } = await loadSeededUsers(db);
    // Deliberately force the transaction to throw AFTER the notify call.
    const spy = vi.spyOn(db, "$transaction");
    try {
      await expect(
        db.$transaction(async (tx) => {
          const { notify } = await import("@/lib/audit");
          await notify(tx, {
            userId: employee.id,
            type: "trip_approved",
            title: "will roll back",
            body: "will roll back",
            entityType: "TripRequest",
            entityId: "deadbeef-roll-back",
          });
          throw new Error("aborting after notify");
        }),
      ).rejects.toThrow("aborting after notify");
    } finally {
      spy.mockRestore();
    }

    const deliveries = await db.notificationDelivery.findMany({
      where: { entityId: "deadbeef-roll-back" },
    });
    expect(deliveries).toHaveLength(0);

    const notifications = await db.notification.findMany({
      where: { title: "will roll back" },
    });
    expect(notifications).toHaveLength(0);
  });
});
