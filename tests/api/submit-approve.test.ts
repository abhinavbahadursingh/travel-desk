import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import { freshDb, loadSeededUsers, resetTripData, TEST_USERS } from "../setup/test-db";
import { POST as SUBMIT } from "@/app/api/trips/[id]/submit/route";
import { POST as APPROVE } from "@/app/api/approvals/[id]/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

async function makeSubmittableTrip(
  requesterId: string,
  opts: { estimatedTotal?: number } = {},
) {
  // The submit route refuses without a stored itinerary. Build one that looks
  // like a planned round-trip. Cost defaults to 13000 (under the policy
  // approval threshold); callers can bump it over 124500 to force the
  // human-approval path for non-employee requesters.
  const total = opts.estimatedTotal ?? 13000;
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
      purpose: "Partner summit",
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

describe("submit → approve workflow", () => {
  it("moves a draft to pending_approval and creates a pending approval row for the manager", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    const res = await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    expect(res.status).toBe(200);
    const stored = await db.tripRequest.findUnique({ where: { id: trip.id } });
    expect(stored?.status).toBe("pending_approval");
    const approvals = await db.approval.findMany({ where: { tripRequestId: trip.id } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approverId).toBe(manager.id);
    expect(approvals[0].decision).toBe("pending");
  });

  it("the assigned manager can approve and the trip moves to approved", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    const res = await callRoute(APPROVE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(200);
    const stored = await db.tripRequest.findUnique({ where: { id: trip.id } });
    expect(stored?.status).toBe("approved");
  });

  it("the manager cannot approve a trip not assigned to them", async () => {
    // Travel admin creates a trip for themselves, submits — manager is not
    // the resolved approver (no manager relation on travel admin) so the
    // approver becomes the super admin. Any attempt by the manager to decide
    // that approval must 403 (not their inbox).
    const { manager, travelAdmin, superAdmin } = await loadSeededUsers(db);
    void manager;
    void superAdmin;
    // Push the cost above the policy's requireApprovalAbove (124500 INR) so
    // the non-employee submitter is forced onto the human approval path.
    const trip = await makeSubmittableTrip(travelAdmin.id, {
      estimatedTotal: 200_000,
    });
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    expect(approval.approverId).not.toBe(manager.id);
    const res = await callRoute(APPROVE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(403);
  });

  it("an employee cannot approve their own trip", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    const res = await callRoute(APPROVE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(403);
  });

  it("rejection without a reason returns 400", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makeSubmittableTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    const res = await callRoute(APPROVE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "rejected" },
    });
    expect(res.status).toBe(400);
  });
});
