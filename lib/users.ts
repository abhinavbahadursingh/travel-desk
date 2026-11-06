import type { Prisma, User } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./api";
import { APPROVER_ROLES, type Role } from "./auth";

type Client = Prisma.TransactionClient | typeof db;

export async function validateManagerAssignment(
  client: Client,
  targetUserId: string | null,
  managerId: string | null,
): Promise<User | null> {
  if (!managerId) return null;
  if (targetUserId && managerId === targetUserId) {
    throw new ApiError(409, "A user cannot be their own manager.");
  }
  const manager = await client.user.findUnique({ where: { id: managerId } });
  if (!manager) throw new ApiError(404, "The selected manager does not exist.");
  if (!manager.active) {
    throw new ApiError(409, "The selected manager is deactivated.");
  }
  if (!APPROVER_ROLES.includes(manager.role as Role)) {
    throw new ApiError(
      409,
      "The selected manager must have a manager, travel admin or super admin role.",
    );
  }

  // Walk the reporting chain to prevent cycles.
  let cursor: string | null = manager.managerId;
  const seen = new Set<string>([manager.id]);
  let depth = 0;
  while (cursor && depth < 50) {
    if (targetUserId && cursor === targetUserId) {
      throw new ApiError(409, "That manager assignment would create a reporting cycle.");
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const next: { managerId: string | null } | null = await client.user.findUnique({
      where: { id: cursor },
      select: { managerId: true },
    });
    cursor = next?.managerId ?? null;
    depth += 1;
  }
  return manager;
}

export async function assertCanChangeSuperAdmin(
  client: Client,
  target: Pick<User, "id" | "role" | "active">,
  nextRole: string,
  nextActive: boolean,
): Promise<void> {
  const removesSuperAdmin =
    target.role === "super_admin" &&
    (nextRole !== "super_admin" || !nextActive);
  if (!removesSuperAdmin) return;
  const remaining = await client.user.count({
    where: { role: "super_admin", active: true, id: { not: target.id } },
  });
  if (remaining === 0) {
    throw new ApiError(
      409,
      "This is the last active super admin. Promote or activate another super admin first.",
    );
  }
}
