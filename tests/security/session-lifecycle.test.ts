// Session-lifecycle regressions. These pin the Phase 2 invariants:
//   - a successful login revokes every prior session for the account,
//   - deactivating a user revokes every active session for that user,
//   - demoting a user's role revokes every active session,
//   - cosmetic edits (name, department) do NOT revoke sessions,
//   - logout and password change revoke the caller's session.

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { callRoute, callRouteWithCookies } from "../setup/api-harness";
import { freshDb, loadSeededUsers, resetTripData, TEST_USERS } from "../setup/test-db";
import { PATCH as UPDATE_USER } from "@/app/api/admin/users/[id]/route";
import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { hashPassword } from "@/lib/password";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
  // resetTripData clears sessions; good. Reset the employee's password so
  // the login test can actually sign in.
  const { salt, hash } = hashPassword("passw0rd-abc");
  await db.user.update({
    where: { email: TEST_USERS.employee.email },
    data: {
      passwordHash: hash,
      passwordSalt: salt,
      mustSetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
});

// These tests mutate user state (active flag, role, name). With singleFork
// the worker is shared across files, so uncleared state would poison later
// suites. Restore every seeded user back to its canonical shape after each
// test here.
afterEach(async () => {
  for (const seed of Object.values(TEST_USERS)) {
    await db.user.update({
      where: { email: seed.email },
      data: {
        name: seed.name,
        role: seed.role,
        department: seed.department,
        active: true,
      },
    });
  }
});

async function createSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(16).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const row = await db.session.create({
    data: {
      userId,
      tokenHash,
      csrfToken,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  });
  return { id: row.id, cookieValue: `${row.id}.${rawToken}`, csrfToken };
}

describe("session rotation on login", () => {
  it("login revokes every pre-existing session for the account", async () => {
    const { employee } = await loadSeededUsers(db);
    const prior1 = await createSession(employee.id);
    const prior2 = await createSession(employee.id);

    const res = await callRoute(LOGIN, {
      method: "POST",
      userEmail: TEST_USERS.employee.email,
      body: { email: TEST_USERS.employee.email, password: "passw0rd-abc" },
    });
    expect(res.status).toBe(200);

    const after = await db.session.findMany({
      where: { userId: employee.id },
    });
    const revoked = after.filter(
      (s) => s.id === prior1.id || s.id === prior2.id,
    );
    expect(revoked).toHaveLength(2);
    expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
    // A single fresh session now exists.
    const active = after.filter((s) => s.revokedAt === null);
    expect(active).toHaveLength(1);
  });
});

describe("session revocation on deactivation / role change", () => {
  it("revokes sessions when a super admin deactivates an account", async () => {
    const { employee, superAdmin } = await loadSeededUsers(db);
    const session = await createSession(employee.id);

    const res = await callRoute(UPDATE_USER, {
      method: "PATCH",
      userEmail: TEST_USERS.superAdmin.email,
      params: { id: employee.id },
      body: { active: false },
    });
    expect(res.status).toBe(200);

    const stored = await db.session.findUnique({ where: { id: session.id } });
    expect(stored?.revokedAt).not.toBeNull();
    void superAdmin;
  });

  it("revokes sessions when a super admin changes an account's role", async () => {
    const { manager } = await loadSeededUsers(db);
    const session = await createSession(manager.id);

    const res = await callRoute(UPDATE_USER, {
      method: "PATCH",
      userEmail: TEST_USERS.superAdmin.email,
      params: { id: manager.id },
      body: { role: "employee" },
    });
    expect(res.status).toBe(200);

    const stored = await db.session.findUnique({ where: { id: session.id } });
    expect(stored?.revokedAt).not.toBeNull();
  });

  it("does NOT revoke sessions on a cosmetic edit (name change)", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createSession(employee.id);

    const res = await callRoute(UPDATE_USER, {
      method: "PATCH",
      userEmail: TEST_USERS.superAdmin.email,
      params: { id: employee.id },
      body: { name: "Eva Employee (renamed)" },
    });
    expect(res.status).toBe(200);

    const stored = await db.session.findUnique({ where: { id: session.id } });
    expect(stored?.revokedAt).toBeNull();
  });
});

describe("logout invalidates the session", () => {
  it("POST /auth/logout revokes the current session", async () => {
    const { employee } = await loadSeededUsers(db);
    const session = await createSession(employee.id);

    const res = await callRouteWithCookies(LOGOUT, {
      method: "POST",
      cookies: [{ name: "tc_session", value: session.cookieValue }],
      extraHeaders: { "x-csrf-token": session.csrfToken },
    });
    expect(res.status).toBe(200);

    const stored = await db.session.findUnique({ where: { id: session.id } });
    expect(stored?.revokedAt).not.toBeNull();
  });
});
