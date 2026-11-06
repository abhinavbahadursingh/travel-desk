// CSRF regression — build real session rows in the isolated DB and drive the
// PATCH /api/trips/[id] route through its full withApi wrapper (which invokes
// readSessionFromRequest + assertCsrf and then getCurrentUser).

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { callRouteWithCookies } from "../setup/api-harness";
import { freshDb, loadSeededUsers, resetTripData } from "../setup/test-db";
import { PATCH as UPDATE_TRIP } from "@/app/api/trips/[id]/route";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

async function createRealSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(16).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const session = await db.session.create({
    data: {
      userId,
      tokenHash,
      csrfToken,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  });
  return {
    sessionId: session.id,
    cookieValue: `${session.id}.${rawToken}`,
    csrfToken,
  };
}

async function makeDraftTrip(requesterId: string) {
  return db.tripRequest.create({
    data: {
      requesterId,
      purpose: "CSRF test",
      origin: "Mumbai",
      destination: "Bengaluru",
      departDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cabin: "economy",
      status: "draft",
      currency: "INR",
    },
  });
}

describe("security: CSRF enforcement on state-changing routes", () => {
  it("rejects a PATCH with no x-csrf-token header", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createRealSession(employee.id);
    const trip = await makeDraftTrip(employee.id);

    const res = await callRouteWithCookies(UPDATE_TRIP, {
      method: "PATCH",
      url: `http://localhost/api/trips/${trip.id}`,
      params: { id: trip.id },
      cookies: [{ name: "tc_session", value: session.cookieValue }],
      body: { purpose: "Updated purpose" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { code?: string })?.code).toBe("CSRF");
  });

  it("rejects a PATCH with the wrong x-csrf-token header", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createRealSession(employee.id);
    const trip = await makeDraftTrip(employee.id);

    const res = await callRouteWithCookies(UPDATE_TRIP, {
      method: "PATCH",
      url: `http://localhost/api/trips/${trip.id}`,
      params: { id: trip.id },
      cookies: [{ name: "tc_session", value: session.cookieValue }],
      extraHeaders: { "x-csrf-token": "not-the-token" },
      body: { purpose: "Updated purpose" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { code?: string })?.code).toBe("CSRF");
  });

  it("accepts a PATCH with the correct x-csrf-token header", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createRealSession(employee.id);
    const trip = await makeDraftTrip(employee.id);

    const res = await callRouteWithCookies(UPDATE_TRIP, {
      method: "PATCH",
      url: `http://localhost/api/trips/${trip.id}`,
      params: { id: trip.id },
      cookies: [{ name: "tc_session", value: session.cookieValue }],
      extraHeaders: { "x-csrf-token": session.csrfToken },
      body: { purpose: "Updated purpose" },
    });
    expect(res.status).toBe(200);
  });

  it("revoked session → 401 (not 403) because there's no identity at all", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createRealSession(employee.id);
    await db.session.update({
      where: { id: session.sessionId },
      data: { revokedAt: new Date() },
    });
    const trip = await makeDraftTrip(employee.id);

    const res = await callRouteWithCookies(UPDATE_TRIP, {
      method: "PATCH",
      url: `http://localhost/api/trips/${trip.id}`,
      params: { id: trip.id },
      cookies: [{ name: "tc_session", value: session.cookieValue }],
      extraHeaders: { "x-csrf-token": session.csrfToken },
      body: { purpose: "Updated purpose" },
    });
    expect(res.status).toBe(401);
  });

  it("unauthenticated PATCH with no cookies → 401", async () => {
    const trip = await makeDraftTrip((await loadSeededUsers(db)).employee.id);
    const res = await callRouteWithCookies(UPDATE_TRIP, {
      method: "PATCH",
      url: `http://localhost/api/trips/${trip.id}`,
      params: { id: trip.id },
      cookies: [],
      body: { purpose: "Updated purpose" },
    });
    expect(res.status).toBe(401);
  });
});
