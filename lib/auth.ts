import type { User } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./api";
import { readSessionFromCookies } from "./session";

export type Role = "employee" | "manager" | "travel_admin" | "super_admin";

export const ROLES: Role[] = ["employee", "manager", "travel_admin", "super_admin"];

export const APPROVER_ROLES: Role[] = ["manager", "travel_admin", "super_admin"];

export const ADMIN_ROLES: Role[] = ["travel_admin", "super_admin"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

/**
 * Resolves the authenticated user from the session cookie (Issue 3).
 *
 * The `ALLOW_DEV_IDENTITY` / `DEV_USER_EMAIL` fallback is a *local-only*
 * convenience: it is HARD-DISABLED in production so a misconfigured env can
 * never grant anonymous callers an identity. Production deployments must set
 * `NODE_ENV=production`; setting `ALLOW_DEV_IDENTITY=1` there is a no-op.
 */
export function devIdentityAllowed(): boolean {
  if (process.env.ALLOW_DEV_IDENTITY !== "1") return false;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

export async function getCurrentUser(): Promise<User> {
  const session = await readSessionFromCookies();
  if (session) {
    if (!session.user.active) {
      throw new ApiError(
        403,
        "This account is deactivated. Ask a super admin to reactivate it.",
        { code: "ACCOUNT_INACTIVE" },
      );
    }
    return session.user;
  }

  if (devIdentityAllowed()) {
    const email = process.env.DEV_USER_EMAIL?.trim();
    if (email) {
      const user = await db.user.findUnique({ where: { email } });
      if (user && user.active) return user;
    }
  }

  throw new ApiError(401, "You need to sign in to continue.", {
    code: "NOT_AUTHENTICATED",
  });
}

export async function tryGetCurrentUser(): Promise<User | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export function assertRole(user: Pick<User, "role">, allowed: Role[]): void {
  if (!allowed.includes(user.role as Role)) {
    throw new ApiError(403, "You do not have permission to perform this action.", {
      code: "FORBIDDEN",
    });
  }
}

export function hasRole(user: Pick<User, "role">, allowed: Role[]): boolean {
  return allowed.includes(user.role as Role);
}

export function isApprover(user: Pick<User, "role">): boolean {
  return hasRole(user, APPROVER_ROLES);
}

export function canViewAllTrips(user: Pick<User, "role">): boolean {
  return hasRole(user, ADMIN_ROLES);
}

export function canApproveAny(user: Pick<User, "role">): boolean {
  return hasRole(user, ADMIN_ROLES);
}

export function canHandleBookings(user: Pick<User, "role">): boolean {
  return hasRole(user, ADMIN_ROLES);
}

export function canManageUsers(user: Pick<User, "role">): boolean {
  return hasRole(user, ["super_admin"]);
}

export function canConfigurePolicy(user: Pick<User, "role">): boolean {
  return hasRole(user, ["super_admin"]);
}

export function canViewAudit(user: Pick<User, "role">): boolean {
  return hasRole(user, ["super_admin"]);
}

export function canViewReports(user: Pick<User, "role">): boolean {
  return hasRole(user, ADMIN_ROLES);
}

export function canAssignManagers(user: Pick<User, "role">): boolean {
  return hasRole(user, ADMIN_ROLES);
}
