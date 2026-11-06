import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, readJson, withApi } from "@/lib/api";
import { verifyPassword } from "@/lib/password";
import {
  clearFailedLogins,
  createSession,
  isLockedOut,
  readClientMeta,
  recordFailedLogin,
  revokeAllSessionsForUser,
  writeAuthCookies,
} from "@/lib/session";
import { recordAudit } from "@/lib/audit";

// POST /api/auth/login
// Body: { email, password }
// Response: { user: { id, email, name, role }, csrfToken }
//
// Never logs the password. Rate-limits via failed-attempt counter + lockout.
// Timing-safe comparisons live inside verifyPassword. Error messages stay
// generic so that account enumeration is impossible.

// Permissive: dev deployments use bare hostnames like `rgl@localhost`. The
// important check is that an account with this email exists; invalid shapes
// just miss the DB lookup and get the generic error.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const schema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((s) => EMAIL_SHAPE.test(s), "email is required"),
  password: z.string().min(1).max(200),
});

const GENERIC_INVALID = "Email or password is incorrect.";

export const POST = withApi(async (req: NextRequest) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, GENERIC_INVALID);
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || !user.passwordHash || !user.passwordSalt) {
    // Spend a token amount of work to blur timing between unknown-user and
    // wrong-password responses.
    verifyPassword(password, "0000000000000000", "0".repeat(128));
    throw new ApiError(401, GENERIC_INVALID);
  }

  if (isLockedOut(user)) {
    throw new ApiError(
      423,
      "This account is temporarily locked after repeated failed sign-ins. Try again later.",
      { code: "LOCKED" },
    );
  }

  const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    await recordFailedLogin(user.id);
    throw new ApiError(401, GENERIC_INVALID);
  }

  if (user.mustSetPassword) {
    throw new ApiError(
      409,
      "This account must set a new password before signing in.",
      { code: "MUST_SET_PASSWORD" },
    );
  }

  await clearFailedLogins(user.id);
  // Rotate: revoke every existing session for this user before minting a
  // fresh one. A successful password proof is a trust anchor — any older
  // cookie (leaked, forgotten on a shared machine, or captured) stops
  // working the moment the real user signs in again.
  await revokeAllSessionsForUser(user.id);
  const meta = await readClientMeta();
  const { cookieValue, csrfToken, expiresAt } = await createSession(user, meta);
  await writeAuthCookies(cookieValue, csrfToken, expiresAt);

  await recordAudit(db, {
    actorId: user.id,
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} signed in`,
    metadata: { ip: meta.ipAddress, userAgent: meta.userAgent },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    csrfToken,
  });
});
