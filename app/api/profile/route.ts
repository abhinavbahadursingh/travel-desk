import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import {
  profilePatchSchema,
  profileExtendedPatchSchema,
  profilePasswordSchema,
} from "@/lib/validators";
import { recordAudit } from "@/lib/audit";
import {
  assertCsrf,
  createSession,
  readClientMeta,
  readSessionFromRequest,
  revokeAllSessionsForUser,
  writeAuthCookies,
} from "@/lib/session";
import {
  hashPassword,
  isPasswordStrongEnough,
  verifyPassword,
} from "@/lib/password";

// Public profile fields returned to the authenticated user's own profile.
const ownProfileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  department: true,
  slackUserId: true,
  managerId: true,
  manager: { select: { id: true, name: true, email: true, role: true } },
  reports: {
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: { name: "asc" },
  },
  _count: {
    select: {
      requests: true,
      approvals: true,
      notifications: { where: { readAt: null } },
    },
  },
  // Personal
  phone: true,
  alternatePhone: true,
  personalEmail: true,
  dateOfBirth: true,
  gender: true,
  address: true,
  city: true,
  state: true,
  country: true,
  pinCode: true,
  profilePicture: true,
  // Professional
  employeeId: true,
  jobTitle: true,
  designation: true,
  employmentType: true,
  joiningDate: true,
  officeLocation: true,
  businessUnit: true,
  costCentre: true,
  workLocation: true,
  lastLoginAt: true,
  lastPasswordChange: true,
  createdAt: true,
  sessions: {
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  // Travel preferences (1:1) — passportDetails excluded (super admin only).
  travelPreference: {
    select: {
      id: true,
      preferredSeat: true,
      preferredMeal: true,
      preferredAirline: true,
      preferredHotelCategory: true,
      preferredHotelChain: true,
      preferredTravelClass: true,
      frequentFlyerNumbers: true,
      hotelLoyaltyMembership: true,
      emergencyContactName: true,
      emergencyContactNumber: true,
      emergencyContactRelationship: true,
    },
  },
} as const;

/** GET /api/profile — the caller's own extended profile. */
export const GET = withApi(async () => {
  const user = await getCurrentUser();
  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: ownProfileSelect,
  });
  if (!profile) throw new ApiError(404, "Profile not found");

  // Activity statistics from real records.
  const [requestsByStatus, approvalsDecided, recentActivity] = await Promise.all([
    db.tripRequest.groupBy({
      by: ["status"],
      where: { requesterId: user.id },
      _count: { status: true },
    }),
    db.approval.aggregate({
      where: { approverId: user.id, decision: { not: "pending" } },
      _count: { id: true },
    }),
    db.auditLog.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        createdAt: true,
      },
    }),
  ]);

  const requestsByStatusMap: Record<string, number> = {};
  for (const row of requestsByStatus) {
    requestsByStatusMap[row.status] =
      (requestsByStatusMap[row.status] ?? 0) + row._count.status;
  }

  return NextResponse.json({
    ...profile,
    activity: {
      totalRequests: profile._count.requests,
      pendingRequests: requestsByStatusMap["draft"] ?? 0,
      submittedRequests: requestsByStatusMap["pending_approval"] ?? 0,
      approvedRequests: requestsByStatusMap["approved"] ?? 0,
      rejectedRequests: requestsByStatusMap["rejected"] ?? 0,
      bookedTrips: requestsByStatusMap["booked"] ?? 0,
      cancelledTrips: requestsByStatusMap["cancelled"] ?? 0,
      totalDecidedApprovals: approvalsDecided._count.id,
      unreadNotifications: profile._count.notifications,
      recentActivity,
    },
  });
});

/** PATCH /api/profile — update the caller's own personal/professional fields. */
export const PATCH = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const body = await readJson(req);

  // Try extended schema first, fall back to legacy name/slackUserId schema.
  let parsed: any;
  const ext = profileExtendedPatchSchema.safeParse(body);
  if (ext.success) {
    parsed = ext.data;
  } else {
    const legacy = profilePatchSchema.safeParse(body);
    if (!legacy.success) {
      throw new ApiError(
        400,
        legacy.error.issues[0]?.message ?? "Invalid profile",
      );
    }
    parsed = legacy.data;
  }

  try {
    const updated = await db.user.update({
      where: { id: user.id },
      data: parsed as Prisma.UserUpdateInput,
      select: ownProfileSelect,
    });

    await recordAudit(db, {
      actorId: user.id,
      action: "profile.updated",
      entityType: "User",
      entityId: user.id,
      summary: `${user.name} updated their profile`,
      metadata: { fields: Object.keys(parsed) },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(
        409,
        "That value is already linked to another profile.",
      );
    }
    throw error;
  }
});

/** POST /api/profile/password — change the caller's own password. */
export const POST = withApi(async (req: NextRequest) => {
  const session = await readSessionFromRequest(req);
  if (!session) throw new ApiError(401, "Sign in first.");
  if (!assertCsrf(req, session)) {
    throw new ApiError(403, "CSRF token missing or invalid.", { code: "CSRF" });
  }

  const parsed = profilePasswordSchema.safeParse(await readJson(req));
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
      lastPasswordChange: new Date(),
    },
  });
  // Rotate: invalidate every existing session, then start a fresh one.
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
