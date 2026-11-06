import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getCurrentUser, canManageUsers } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import {
  assertCsrf,
  readSessionFromRequest,
  revokeAllSessionsForUser,
} from "@/lib/session";
import { recordAudit } from "@/lib/audit";

// POST /api/admin/users/[id]/reset-password
// Super-admin issues a one-time activation token for a user. The user then
// POSTs it to /api/auth/activate with a new password. The response contains
// the token value exactly once so the super admin can hand it over securely.
// All existing sessions for the target user are revoked immediately.

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const user = await getCurrentUser();
    if (!canManageUsers(user)) {
      throw new ApiError(403, "Only a super admin can reset passwords.");
    }
    const session = await readSessionFromRequest(req);
    if (session && !assertCsrf(req, session)) {
      throw new ApiError(403, "CSRF token missing or invalid.", { code: "CSRF" });
    }
    const { id } = await ctx.params;
    if (id === user.id) {
      throw new ApiError(
        409,
        "Use the change-password flow to rotate your own credentials.",
      );
    }
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "User not found");
    if (!target.active) {
      throw new ApiError(409, "Reactivate the account before resetting its password.");
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    await db.user.update({
      where: { id },
      data: {
        passwordHash: null,
        passwordSalt: null,
        mustSetPassword: true,
        activationToken: token,
        activationExpiresAt: expiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await revokeAllSessionsForUser(id);

    await recordAudit(db, {
      actorId: user.id,
      action: "auth.password_reset_issued",
      entityType: "User",
      entityId: id,
      summary: `${user.name} issued a password-reset token for ${target.email}`,
      metadata: { expiresAt },
    });

    return NextResponse.json({
      ok: true,
      activationToken: token,
      expiresAt,
      activationUrl: `/activate?token=${token}`,
    });
  },
);
