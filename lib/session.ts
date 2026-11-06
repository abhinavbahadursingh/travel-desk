// Server-side sessions with signed HTTP-only cookies + double-submit CSRF.
//
// The session cookie `tc_session` carries `<sessionId>.<rawToken>`.
//   - rawToken is 32 random bytes hex-encoded (256 bits).
//   - Only sha256(rawToken) is stored in the DB — a leaked DB row cannot be
//     replayed as a session.
//   - Cookie flags: HttpOnly, SameSite=Lax, Secure in production.
//
// The CSRF cookie `tc_csrf` is a readable (non-HttpOnly) copy of the session's
// csrfToken. Clients mirror it in `X-CSRF-Token` on state-changing requests.
// The server compares the header to the stored csrfToken (not the cookie), so
// a cross-site attacker — who can neither read the cookie's value from another
// origin nor set this specific header — cannot forge the request.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Session, User } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { db } from "./db";

const SESSION_COOKIE = "tc_session";
const CSRF_COOKIE = "tc_csrf";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h
const TOKEN_BYTES = 32;
const CSRF_BYTES = 16;

export type SessionWithUser = Session & { user: User };

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function parseCookiePair(raw: string | undefined): { id: string; token: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(".");
  if (idx <= 0) return null;
  const id = raw.slice(0, idx);
  const token = raw.slice(idx + 1);
  if (!id || !token) return null;
  return { id, token };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function cookieOptions(expires: Date, httpOnly: boolean) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

// ────────────────────────── create / revoke ───────────────────────────────

export async function createSession(
  user: User,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ cookieValue: string; csrfToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const csrfToken = randomBytes(CSRF_BYTES).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      csrfToken,
      expiresAt,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    },
  });

  return {
    cookieValue: `${session.id}.${rawToken}`,
    csrfToken,
    expiresAt,
  };
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ────────────────────────── read (server) ───────────────────────────────

export async function getSessionFromCookieHeader(
  rawCookie: string | undefined,
): Promise<SessionWithUser | null> {
  const parsed = parseCookiePair(rawCookie);
  if (!parsed) return null;
  const session = await db.session.findUnique({
    where: { id: parsed.id },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.active) return null;
  const expected = session.tokenHash;
  const given = sha256Hex(parsed.token);
  if (!timingSafeEqualStrings(expected, given)) return null;
  return session as SessionWithUser;
}

export async function readSessionFromCookies(): Promise<SessionWithUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return getSessionFromCookieHeader(raw);
}

// Lightweight route-handler helper. Returns the live user+session or null.
export async function readSessionFromRequest(
  req: NextRequest,
): Promise<SessionWithUser | null> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  return getSessionFromCookieHeader(raw);
}

// ────────────────────────── CSRF ───────────────────────────────

export function assertCsrf(
  req: NextRequest,
  session: Pick<Session, "csrfToken">,
): boolean {
  // Safe methods never need CSRF.
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const header = req.headers.get("x-csrf-token") ?? "";
  if (!header) return false;
  return timingSafeEqualStrings(header, session.csrfToken);
}

// ────────────────────────── cookie helpers ───────────────────────────────

export async function writeAuthCookies(
  cookieValue: string,
  csrfToken: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, cookieValue, cookieOptions(expiresAt, true));
  store.set(CSRF_COOKIE, csrfToken, cookieOptions(expiresAt, false));
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  const past = new Date(0);
  store.set(SESSION_COOKIE, "", cookieOptions(past, true));
  store.set(CSRF_COOKIE, "", cookieOptions(past, false));
}

// ────────────────────────── login attempt limiting ───────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 min

export async function recordFailedLogin(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const nextAttempts = user.failedLoginAttempts + 1;
  const lockUntil =
    nextAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_DURATION_MS)
      : user.lockedUntil;
  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: nextAttempts,
      lockedUntil: lockUntil,
    },
  });
}

export async function clearFailedLogins(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export function isLockedOut(user: Pick<User, "lockedUntil">): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
}

// Best-effort client-ip reader (reverse proxies).
export async function readClientMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip");
  return {
    ipAddress: ip || null,
    userAgent: h.get("user-agent"),
  };
}

export { SESSION_COOKIE, CSRF_COOKIE, SESSION_TTL_MS };
