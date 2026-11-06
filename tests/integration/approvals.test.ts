import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolveApprover } from "@/lib/approvals";
import { freshDb, loadSeededUsers, resetTripData, TEST_USERS } from "../setup/test-db";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

describe("approvals.resolveApprover ordering", () => {
  it("returns the requester's assigned manager when present and eligible", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    const res = await resolveApprover(employee);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.approver.id).toBe(manager.id);
      expect(res.source).toBe("assigned_manager");
    }
  });

  it("skips an inactive assigned manager and falls back", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    await db.user.update({ where: { id: manager.id }, data: { active: false } });
    try {
      // Employee has department Engineering and no other manager there, so
      // resolution must jump to the travel admin.
      const res = await resolveApprover(employee);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.approver.email).toBe(TEST_USERS.travelAdmin.email);
        expect(res.source).toBe("travel_admin");
      }
    } finally {
      await db.user.update({ where: { id: manager.id }, data: { active: true } });
    }
  });

  it("falls back to the department manager when no assigned manager", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    // Strip the assignment so the only route is the department fallback.
    await db.user.update({
      where: { id: employee.id },
      data: { managerId: null },
    });
    const res = await resolveApprover(
      await db.user.findUniqueOrThrow({ where: { id: employee.id } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.approver.id).toBe(manager.id);
      expect(res.source).toBe("department_manager");
    }
  });

  it("falls back to the travel admin when the department has no manager", async () => {
    const { employee, manager } = await loadSeededUsers(db);
    // No assignment + no departmental manager (move employee to a dept of one).
    await db.user.update({
      where: { id: employee.id },
      data: { managerId: null, department: "Finance" },
    });
    // Manager is in Engineering so does not match Finance.
    void manager;
    const res = await resolveApprover(
      await db.user.findUniqueOrThrow({ where: { id: employee.id } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.source).toBe("travel_admin");
  });

  it("never returns the requester themselves", async () => {
    const { manager } = await loadSeededUsers(db);
    // Manager submits a trip; the department has no other manager, so the
    // resolver must jump past 'department_manager' to the travel admin, never
    // to the manager themselves.
    const res = await resolveApprover(manager);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.approver.id).not.toBe(manager.id);
    }
  });

  it("returns ok:false when no eligible approver exists at all", async () => {
    const { employee, manager, travelAdmin, superAdmin } = await loadSeededUsers(db);
    await db.user.update({ where: { id: manager.id }, data: { active: false } });
    await db.user.update({ where: { id: travelAdmin.id }, data: { active: false } });
    await db.user.update({ where: { id: superAdmin.id }, data: { active: false } });
    try {
      const res = await resolveApprover(employee);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toMatch(/approver/i);
        expect(res.action).toMatch(/super admin|assign|activate/i);
      }
    } finally {
      await db.user.update({ where: { id: manager.id }, data: { active: true } });
      await db.user.update({ where: { id: travelAdmin.id }, data: { active: true } });
      await db.user.update({ where: { id: superAdmin.id }, data: { active: true } });
    }
  });
});
