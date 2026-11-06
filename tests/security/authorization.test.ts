// Security regression tests — these guard the invariants that must hold
// regardless of UI state. They drive the real route handlers against the
// isolated test DB.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import {
  freshDb,
  loadSeededUsers,
  resetTripData,
  TEST_USERS,
} from "../setup/test-db";
import { GET as GET_TRIP } from "@/app/api/trips/[id]/route";
import { POST as PLAN } from "@/app/api/trips/[id]/plan/route";
import { POST as SUBMIT } from "@/app/api/trips/[id]/submit/route";
import { POST as DECIDE } from "@/app/api/approvals/[id]/route";
import { POST as CONFIRM_BOOKING } from "@/app/api/trips/[id]/confirm-booking/route";
import { PATCH as UPDATE_USER } from "@/app/api/admin/users/[id]/route";
import { PATCH as UPDATE_POLICY } from "@/app/api/admin/policy/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

async function makePlannedTrip(
  requesterId: string,
  opts: { status?: "draft" | "pending_approval"; estimatedTotal?: number } = {},
) {
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
      purpose: "Security regression",
      origin: "Mumbai",
      destination: "Bengaluru",
      departDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      returnDate: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
      cabin: "economy",
      status: opts.status ?? "draft",
      currency: "INR",
      estimatedCost: total,
      estimateIsComplete: true,
      itinerary: JSON.stringify(itinerary),
      itineraryRetrievedAt: new Date(),
    },
  });
}

describe("security: trip access", () => {
  it("an employee cannot read another employee's trip", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    // Create a second active employee in another department.
    const other = await db.user.upsert({
      where: { email: "other.emp@test.local" },
      update: { active: true },
      create: {
        email: "other.emp@test.local",
        name: "Other Employee",
        role: "employee",
        department: "Finance",
        active: true,
        mustSetPassword: false,
        managerId: manager.id,
      },
    });
    const trip = await makePlannedTrip(other.id);

    const res = await callRoute(GET_TRIP, {
      method: "GET",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    expect(res.status).toBe(403);
    void employee;
  });

  it("an admin can read any trip", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(employee.id);
    const res = await callRoute(GET_TRIP, {
      method: "GET",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: trip.id },
    });
    expect(res.status).toBe(200);
  });
});

describe("security: approval guards", () => {
  it("an employee cannot approve their own request", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    const res = await callRoute(DECIDE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(403);
  });

  it("a manager cannot decide an approval assigned to someone else", async () => {
    const { manager, travelAdmin } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(travelAdmin.id, {
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
    const res = await callRoute(DECIDE, {
      method: "POST",
      userEmail: TEST_USERS.manager.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(403);
  });

  it("a travel admin may override and approve another approver's request", async () => {
    // Admins keep override authority (canApproveAny). This is intended — the
    // test pins the behavior so a future refactor cannot silently narrow it.
    const { employee } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(employee.id);
    await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    const approval = await db.approval.findFirstOrThrow({
      where: { tripRequestId: trip.id, decision: "pending" },
    });
    const res = await callRoute(DECIDE, {
      method: "POST",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: approval.id },
      body: { decision: "approved" },
    });
    expect(res.status).toBe(200);
  });
});

describe("security: role-restricted operations", () => {
  it("an employee cannot change accounts (super-admin-only path)", async () => {
    const { employee } = await loadSeededUsers(db);
    const res = await callRoute(UPDATE_USER, {
      method: "PATCH",
      userEmail: TEST_USERS.employee.email,
      params: { id: employee.id },
      body: { role: "super_admin" },
    });
    expect(res.status).toBe(403);
  });

  it("a travel admin cannot change accounts (super-admin-only path)", async () => {
    const { employee } = await loadSeededUsers(db);
    const res = await callRoute(UPDATE_USER, {
      method: "PATCH",
      userEmail: TEST_USERS.travelAdmin.email,
      params: { id: employee.id },
      body: { role: "super_admin" },
    });
    expect(res.status).toBe(403);
  });

  it("a travel admin cannot change travel policy (super-admin-only path)", async () => {
    const res = await callRoute(UPDATE_POLICY, {
      method: "PATCH",
      userEmail: TEST_USERS.travelAdmin.email,
      body: { requireApprovalAbove: 999_999 },
    });
    expect(res.status).toBe(403);
  });

  it("an employee cannot confirm a booking", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(employee.id, { estimatedTotal: 10_000 });
    // Jump the trip to a confirmable state by hand — we only care that the
    // route rejects on role, not that state is valid.
    await db.tripRequest.update({
      where: { id: trip.id },
      data: { status: "booking_links_generated" },
    });
    const booking = await db.booking.create({
      data: {
        tripRequestId: trip.id,
        kind: "flight",
        vendor: "Sample Air",
        url: "https://example.test/flight",
        source: "example.test",
        retrievedAt: new Date(),
        status: "link_only",
      },
    });
    const res = await callRoute(CONFIRM_BOOKING, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
      body: { bookingId: booking.id, reference: "ABC123" },
    });
    expect(res.status).toBe(403);
  });
});

describe("security: deactivated identities", () => {
  it("rejects a request when the local-dev identity is deactivated", async () => {
    const { employee } = await loadSeededUsers(db);
    await db.user.update({
      where: { id: employee.id },
      data: { active: false },
    });
    try {
      const trip = await makePlannedTrip(employee.id);
      const res = await callRoute(GET_TRIP, {
        method: "GET",
        userEmail: TEST_USERS.employee.email,
        params: { id: trip.id },
      });
      expect(res.status).toBe(401);
    } finally {
      await db.user.update({
        where: { id: employee.id },
        data: { active: true },
      });
    }
  });
});

describe("security: state-machine guards", () => {
  it("planning after submission is rejected with 409", async () => {
    const { employee } = await loadSeededUsers(db);
    const trip = await makePlannedTrip(employee.id, {
      status: "pending_approval",
    });
    const res = await callRoute(PLAN, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: trip.id },
    });
    // We don't care that AI isn't configured — the state guard runs before
    // any planner is invoked, so this must be a 409.
    expect(res.status).toBe(409);
  });
});
