import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, readJson, withApi } from "@/lib/api";
import { hashPassword, isPasswordStrongEnough, verifyPassword } from "@/lib/password";
import {
  assertCsrf,
  createSession,
  readClientMeta,
  readSessionFromRequest,
  revokeAllSessionsForUser,
  writeAuthCookies,
} from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const POST = withApi(async (req: NextRequest) => {
  const session = await readSessionFromRequest(req);
  if (!session) throw new ApiError(401, "Sign in first.");
  if (!assertCsrf(req, session)) {
    throw new ApiError(403, "CSRF token missing or invalid.", { code: "CSRF" });
  }

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Current and new (8+ char) passwords are required.");
  }
  const { currentPassword, newPassword } = parsed.data;
  if (!isPasswordStrongEnough(newPassword)) {
    throw new ApiError(400, "New password must be at least 8 characters.");
  }

  const user = session.user;
  if (!user.passwordHash || !user.passwordSalt) {
    throw new ApiError(409, "This account has no password set yet; use activation.");
  }
  if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
    throw new ApiError(401, "Current password is incorrect.");
  }

  const { salt, hash } = hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordSalt: salt,
      passwordHash: hash,
      mustSetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  // Rotate: invalidate every existing session, then start a fresh one for
  // the caller so password change can't be hijacked via a stale cookie.
  await revokeAllSessionsForUser(user.id);
  const meta = await readClientMeta();
  const next = await createSession(user, meta);
  await writeAuthCookies(next.cookieValue, next.csrfToken, next.expiresAt);

  await recordAudit(db, {
    actorId: user.id,
    action: "auth.password_changed",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} changed their password`,
  });

  return NextResponse.json({ ok: true, csrfToken: next.csrfToken });
});
