// Phase 2 — dev-identity hardening.
//
// `ALLOW_DEV_IDENTITY=1` + `DEV_USER_EMAIL=<address>` is a local-only
// convenience that lets `getCurrentUser()` resolve an identity without a
// signed session cookie. This suite pins two guarantees:
//
//   1. In non-production (NODE_ENV !== "production") the flag works.
//   2. In production (NODE_ENV === "production") the flag is a no-op — a
//      request with no cookies is rejected as unauthenticated regardless of
//      what DEV_USER_EMAIL resolves to.

import { describe, it, expect, afterAll } from "vitest";
import { callRoute } from "../setup/api-harness";
import { freshDb, TEST_USERS } from "../setup/test-db";
import { GET as GET_TRIPS } from "@/app/api/trips/route";
import { devIdentityAllowed } from "@/lib/auth";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

// Next/Node type NODE_ENV as a read-only union. These tests pivot it
// deliberately to simulate production — go through the index signature.
function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe("dev-identity production hardening", () => {
  it("devIdentityAllowed is false in production even when the flag is 1", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_IDENTITY;
    try {
      setNodeEnv("production");
      process.env.ALLOW_DEV_IDENTITY = "1";
      expect(devIdentityAllowed()).toBe(false);
    } finally {
      setNodeEnv(prevNode);
      if (prevFlag === undefined) delete process.env.ALLOW_DEV_IDENTITY;
      else process.env.ALLOW_DEV_IDENTITY = prevFlag;
    }
  });

  it("devIdentityAllowed is true in development with the flag", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_IDENTITY;
    try {
      setNodeEnv("development");
      process.env.ALLOW_DEV_IDENTITY = "1";
      expect(devIdentityAllowed()).toBe(true);
    } finally {
      setNodeEnv(prevNode);
      if (prevFlag === undefined) delete process.env.ALLOW_DEV_IDENTITY;
      else process.env.ALLOW_DEV_IDENTITY = prevFlag;
    }
  });

  it("GET /api/trips returns 401 in production even with DEV_USER_EMAIL set", async () => {
    const prevNode = process.env.NODE_ENV;
    try {
      setNodeEnv("production");
      const res = await callRoute(GET_TRIPS, {
        method: "GET",
        url: "http://localhost/api/trips",
        userEmail: TEST_USERS.employee.email,
      });
      expect(res.status).toBe(401);
    } finally {
      setNodeEnv(prevNode);
    }
  });

  it("GET /api/trips returns 200 in development with DEV_USER_EMAIL set", async () => {
    const prevNode = process.env.NODE_ENV;
    try {
      setNodeEnv("development");
      const res = await callRoute(GET_TRIPS, {
        method: "GET",
        url: "http://localhost/api/trips",
        userEmail: TEST_USERS.employee.email,
      });
      expect(res.status).toBe(200);
    } finally {
      setNodeEnv(prevNode);
    }
  });
});
