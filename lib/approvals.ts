import type { Approval, TripRequest, User } from "@prisma/client";
import { db } from "./db";
import { ADMIN_ROLES, APPROVER_ROLES, hasRole, type Role } from "./auth";

export type ApproverSource =
  | "assigned_manager"
  | "department_manager"
  | "travel_admin"
  | "super_admin";

export type ApproverResolution =
  | { ok: true; approver: User; source: ApproverSource }
  | { ok: false; reason: string; action: string };

function eligible(requester: User, candidate: User | null): candidate is User {
  return Boolean(
    candidate &&
      candidate.id !== requester.id &&
      candidate.active &&
      APPROVER_ROLES.includes(candidate.role as Role),
  );
}

/**
 * Approval resolution order:
 *   1. requester's assigned manager
 *   2. active manager in the requester's department
 *   3. active travel admin
 *   4. active super admin
 *
 * Never returns the requester. Never invents an approver. If none is eligible,
 * the caller must return an actionable 409 rather than auto-approving.
 */
export async function resolveApprover(requester: User): Promise<ApproverResolution> {
  if (requester.managerId) {
    const assigned = await db.user.findUnique({ where: { id: requester.managerId } });
    if (eligible(requester, assigned)) {
      return { ok: true, approver: assigned, source: "assigned_manager" };
    }
  }

  if (requester.department) {
    const departmental = await db.user.findFirst({
      where: {
        department: requester.department,
        role: "manager",
        active: true,
        id: { not: requester.id },
      },
      orderBy: { createdAt: "asc" },
    });
    if (eligible(requester, departmental)) {
      return { ok: true, approver: departmental, source: "department_manager" };
    }
  }

  const travelAdmin = await db.user.findFirst({
    where: { role: "travel_admin", active: true, id: { not: requester.id } },
    orderBy: { createdAt: "asc" },
  });
  if (eligible(requester, travelAdmin)) {
    return { ok: true, approver: travelAdmin, source: "travel_admin" };
  }

  const superAdmin = await db.user.findFirst({
    where: { role: "super_admin", active: true, id: { not: requester.id } },
    orderBy: { createdAt: "asc" },
  });
  if (eligible(requester, superAdmin)) {
    return { ok: true, approver: superAdmin, source: "super_admin" };
  }

  return {
    ok: false,
    reason: "No independent approver is configured for this request.",
    action:
      "A super admin must assign this requester a manager, add an active manager in the requester's department, or activate a travel admin/super admin other than the requester. Then submit again.",
  };
}

export type TripWithApprovals = TripRequest & {
  approvals: Pick<Approval, "id" | "approverId" | "decision">[];
};

export function canViewTrip(user: User, trip: TripWithApprovals): boolean {
  if (trip.requesterId === user.id) return true;
  if (hasRole(user, ADMIN_ROLES)) return true;
  return trip.approvals.some((approval) => approval.approverId === user.id);
}

export function canEditTrip(user: User, trip: TripRequest): boolean {
  return trip.requesterId === user.id && trip.status === "draft";
}

export function canSubmitTrip(user: User, trip: TripRequest): boolean {
  return trip.requesterId === user.id && trip.status === "draft";
}

export function canGenerateBookingLinks(user: User, trip: TripRequest): boolean {
  if (!hasRole(user, ADMIN_ROLES) && trip.requesterId !== user.id) return false;
  return trip.status === "approved";
}

export function canRequestCancellation(user: User, trip: TripRequest): boolean {
  if (!hasRole(user, ADMIN_ROLES) && trip.requesterId !== user.id) return false;
  return trip.status === "booked";
}

export const APPROVAL_DECISIONS = [
  "approved",
  "rejected",
  "changes_requested",
] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return (
    typeof value === "string" &&
    APPROVAL_DECISIONS.includes(value as ApprovalDecision)
  );
}
