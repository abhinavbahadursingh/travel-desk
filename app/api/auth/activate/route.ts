import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, readJson, withApi } from "@/lib/api";
import { hashPassword, isPasswordStrongEnough } from "@/lib/password";
import { recordAudit } from "@/lib/audit";
import {
  createSession,
  readClientMeta,
  revokeAllSessionsForUser,
  writeAuthCookies,
} from "@/lib/session";

// POST /api/auth/activate
// Body: { token, password }
//
// Trades a one-time activation token (issued by a super admin via
// /api/admin/users/[id]/reset-password OR by the seed script) for the first
// password. Starts a session on success. The activation token is consumed.

const schema = z.object({
  token: z.string().trim().min(16).max(256),
  password: z.string().min(8).max(200),
});

export const POST = withApi(async (req: NextRequest) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Token and a password of 8+ characters are required.");
  }
  const { token, password } = parsed.data;
  if (!isPasswordStrongEnough(password)) {
    throw new ApiError(400, "Password must be at least 8 characters.");
  }

  const user = await db.user.findUnique({ where: { activationToken: token } });
  if (
    !user ||
    !user.active ||
    !user.activationExpiresAt ||
    user.activationExpiresAt.getTime() <= Date.now()
  ) {
    throw new ApiError(400, "Activation link is invalid or expired.");
  }

  const { salt, hash } = hashPassword(password);
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordSalt: salt,
      passwordHash: hash,
      mustSetPassword: false,
      activationToken: null,
      activationExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessionsForUser(user.id);

  const meta = await readClientMeta();
  const { cookieValue, csrfToken, expiresAt } = await createSession(
    { ...user, mustSetPassword: false },
    meta,
  );
  await writeAuthCookies(cookieValue, csrfToken, expiresAt);

  await recordAudit(db, {
    actorId: user.id,
    action: "auth.activated",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} completed account activation`,
  });

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    csrfToken,
  });
});
