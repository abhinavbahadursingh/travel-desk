import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import { freshDb, loadSeededUsers, resetTripData, TEST_USERS } from "../setup/test-db";
import { POST as CREATE, GET as LIST } from "@/app/api/trips/route";
import { POST as SUBMIT } from "@/app/api/trips/[id]/submit/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

const departDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function tripBody(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "Client meeting",
    origin: "Mumbai",
    destination: "Bengaluru",
    departDate,
    ...overrides,
  };
}

describe("trip type (official vs personal)", () => {
  it("creates an official trip by default with tripType=official", async () => {
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody(),
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; tripType: string; tripReason: string | null };
    expect(body.tripType).toBe("official");
    expect(body.tripReason).toBeNull();

    const stored = await db.tripRequest.findUnique({ where: { id: body.id } });
    expect(stored?.tripType).toBe("official");
    expect(stored?.tripReason).toBeNull();
  });

  it("creates a personal trip with tripType=personal and an optional reason", async () => {
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "personal", tripReason: "Family wedding in Bengaluru" }),
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; tripType: string; tripReason: string | null };
    expect(body.tripType).toBe("personal");
    expect(body.tripReason).toBe("Family wedding in Bengaluru");

    const stored = await db.tripRequest.findUnique({ where: { id: body.id } });
    expect(stored?.tripType).toBe("personal");
    expect(stored?.tripReason).toBe("Family wedding in Bengaluru");
  });

  it("creates a personal trip without a reason (tripReason is optional)", async () => {
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "personal" }),
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; tripType: string; tripReason: string | null };
    expect(body.tripType).toBe("personal");
    expect(body.tripReason).toBeNull();
  });

  it("rejects an invalid tripType with 400", async () => {
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "leisure" }),
    });
    expect(res.status).toBe(400);
  });

  it("a personal trip submits to auto-approved with no approval row", async () => {
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "personal" }),
    });
    expect(res.status).toBe(201);
    const tripId = (res.json as { id: string }).id;

    const submit = await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: tripId },
    });
    expect(submit.status).toBe(200);
    expect(submit.json).toMatchObject({ autoApproved: true, tripType: "personal" });

    const stored = await db.tripRequest.findUnique({ where: { id: tripId } });
    expect(stored?.status).toBe("approved");
    expect(stored?.submittedAt).toBeTruthy();
    expect(stored?.decidedAt).toBeTruthy();

    // No approval row should exist for a personal trip.
    const approvals = await db.approval.findMany({ where: { tripRequestId: tripId } });
    expect(approvals).toHaveLength(0);
  });

  it("an official trip still creates a pending approval row on submit", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const res = await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "official" }),
    });
    expect(res.status).toBe(201);
    const tripId = (res.json as { id: string }).id;

    // Give the trip an itinerary so submit can proceed.
    await db.tripRequest.update({
      where: { id: tripId },
      data: {
        itinerary: JSON.stringify({
          flights: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
          hotels: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
          trains: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
          cabs: { status: "ok", candidates: [], retrievedAt: new Date().toISOString(), provider: "tavily" },
          featured: { flight: { estimatedPrice: 13000 }, hotel: { estimatedPrice: null } },
          estimatedTotal: 13000,
          rationale: "test",
          retrievedAt: new Date().toISOString(),
        }),
        itineraryRetrievedAt: new Date(),
        estimatedCost: 13000,
        estimateIsComplete: true,
      },
    });

    const submit = await callRoute(SUBMIT, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      params: { id: tripId },
    });
    expect(submit.status).toBe(200);

    const stored = await db.tripRequest.findUnique({ where: { id: tripId } });
    expect(stored?.status).toBe("pending_approval");

    const approvals = await db.approval.findMany({ where: { tripRequestId: tripId } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approverId).toBe(manager.id);
    expect(approvals[0].decision).toBe("pending");
  });

  it("GET /api/trips returns tripType and tripReason", async () => {
    await callRoute(CREATE, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: tripBody({ tripType: "personal", tripReason: "Doctor appointment" }),
    });

    const res = await callRoute(LIST, {
      method: "GET",
      userEmail: TEST_USERS.employee.email,
    });
    expect(res.status).toBe(200);
    const trips = res.json as Array<{ tripType: string; tripReason: string | null }>;
    const personal = trips.find((t) => t.tripReason === "Doctor appointment");
    expect(personal).toBeDefined();
    expect(personal!.tripType).toBe("personal");
  });
});
