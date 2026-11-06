import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import { freshDb, resetTripData, TEST_USERS } from "../setup/test-db";
import { POST, GET } from "@/app/api/trips/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

describe("POST /api/trips", () => {
  it("creates a draft trip for the authenticated user", async () => {
    const departDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const res = await callRoute(POST, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: {
        purpose: "Partner summit in Bengaluru",
        origin: "Mumbai",
        destination: "Bengaluru",
        departDate,
      },
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; currency: string; status: string; estimatedCost: number | null };
    expect(body.status).toBe("draft");
    expect(body.currency).toBe("INR");
    expect(body.estimatedCost).toBeNull();

    const stored = await db.tripRequest.findUnique({ where: { id: body.id } });
    expect(stored?.requesterId).toBeTruthy();
  });

  it("rejects an invalid payload with 400", async () => {
    const res = await callRoute(POST, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: { purpose: "x", origin: "A", destination: "B", departDate: "garbage" },
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/trips scopes employees to their own trips", async () => {
    // Create two trips: one owned by the employee, one by another user.
    const employee = await db.user.findUniqueOrThrow({
      where: { email: TEST_USERS.employee.email },
    });
    const travelAdmin = await db.user.findUniqueOrThrow({
      where: { email: TEST_USERS.travelAdmin.email },
    });
    await db.tripRequest.create({
      data: {
        requesterId: employee.id,
        purpose: "Mine",
        origin: "Mumbai",
        destination: "Delhi",
        departDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });
    await db.tripRequest.create({
      data: {
        requesterId: travelAdmin.id,
        purpose: "Theirs",
        origin: "Mumbai",
        destination: "Delhi",
        departDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await callRoute(GET, {
      method: "GET",
      url: "http://localhost/api/trips",
      userEmail: TEST_USERS.employee.email,
    });
    expect(res.status).toBe(200);
    const trips = res.json as Array<{ purpose: string }>;
    expect(trips.map((t) => t.purpose).sort()).toEqual(["Mine"]);
  });
});
