import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import { freshDb, loadSeededUsers, resetTripData, TEST_USERS } from "../setup/test-db";
import { POST as REQUEST_CANCELLATION } from "@/app/api/trips/[id]/cancellation/route";
import { POST as DECIDE_CANCELLATION } from "@/app/api/cancellations/[id]/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

async function makeBookedTrip(requesterId: string) {
  return db.tripRequest.create({
    data: {
      requesterId,
      purpose: "Partner summit",
      origin: "Mumbai",
      destination: "Bengaluru",
      departDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      returnDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
      cabin: "economy",
      status: "booked",
      currency: "INR",
      estimatedCost: 15000,
      estimateIsComplete: true,
      bookedAt: new Date(),
    },
  });
}

describe("cancellation workflow", () => {
  it("request then complete with a reference marks the trip cancelled", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makeBookedTrip(employee.id);
    const req = await callRoute(REQUEST_CANCELLATION, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
      body: { reason: "Meeting moved to a different week" },
    });
    expect(req.status).toBe(201);
    const after = await db.tripRequest.findUnique({ where: { id: trip.id } });
    expect(after?.status).toBe("cancellation_requested");

    const cancellation = await db.cancellationRequest.findFirstOrThrow({
      where: { tripRequestId: trip.id, status: "pending" },
    });

    // Reject-then-complete sequence would require a separate instance; here
    // just complete directly with a reference to confirm the positive path.
    const decision = await callRoute(DECIDE_CANCELLATION, {
      method: "POST",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: cancellation.id },
      body: { action: "complete", reference: "PROVIDER-REF-123", note: "Verified via Amex" },
    });
    expect(decision.status).toBe(200);
    const cancelled = await db.tripRequest.findUnique({ where: { id: trip.id } });
    expect(cancelled?.status).toBe("cancelled");
  });

  it("refuses 'complete' when no provider reference is given", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makeBookedTrip(employee.id);
    await callRoute(REQUEST_CANCELLATION, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
      body: { reason: "Reason sufficient length" },
    });
    const cancellation = await db.cancellationRequest.findFirstOrThrow({
      where: { tripRequestId: trip.id, status: "pending" },
    });
    const decision = await callRoute(DECIDE_CANCELLATION, {
      method: "POST",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: cancellation.id },
      body: { action: "complete" },
    });
    expect(decision.status).toBe(400);
  });

  it("refuses cancellation of a non-booked trip", async () => {
    const { employee } = await loadSeededUsers(db);
    const draft = await db.tripRequest.create({
      data: {
        requesterId: employee.id,
        purpose: "Draft",
        origin: "Mumbai",
        destination: "Delhi",
        departDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        status: "draft",
        currency: "INR",
      },
    });
    const res = await callRoute(REQUEST_CANCELLATION, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: draft.id },
      body: { reason: "any reason here" },
    });
    expect(res.status).toBe(409);
  });
});
