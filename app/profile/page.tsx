import { getCurrentUser } from "@/lib/auth";
import { canManageUsers, isApprover } from "@/lib/auth";
import { db } from "@/lib/db";
import { ProfilePageClient } from "./components/profile-page-client";

function calculateCompletion(user: any): number {
  let filled = 0;
  let total = 0;

  const fields = [
    user.name,
    user.email,
    user.phone,
    user.alternatePhone,
    user.personalEmail,
    user.dateOfBirth,
    user.gender,
    user.address,
    user.city,
    user.state,
    user.country,
    user.pinCode,
    user.profilePicture,
    user.employeeId,
    user.jobTitle,
    user.designation,
    user.employmentType,
    user.joiningDate,
    user.officeLocation,
    user.businessUnit,
    user.costCentre,
    user.workLocation,
    user.travelPreference?.preferredSeat,
    user.travelPreference?.preferredMeal,
    user.travelPreference?.preferredAirline,
    user.travelPreference?.preferredHotelCategory,
    user.travelPreference?.preferredHotelChain,
    user.travelPreference?.preferredTravelClass,
    user.travelPreference?.frequentFlyerNumbers,
    user.travelPreference?.hotelLoyaltyMembership,
    user.travelPreference?.emergencyContactName,
    user.travelPreference?.emergencyContactNumber,
    user.travelPreference?.emergencyContactRelationship,
  ];

  for (const f of fields) {
    if (f === undefined || f === null) continue;
    total += 1;
    if (typeof f === "string" && f.trim() === "") continue;
    filled += 1;
  }

  if (total === 0) return 0;
  return Math.round((filled / total) * 100);
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const canManage = canManageUsers(user);
  const isManager = isApprover(user);

  // Query the full extended profile directly from the database (server
  // components use Prisma directly rather than fetching internal APIs).
  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: {
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
      mustSetPassword: true,
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
      // Active sessions (not revoked, not expired).
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
    },
  });
  if (!profile) {
    throw new Error("Profile not found");
  }

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

  const activity = {
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
  };

  // Fetch team members for managers/admins.
  let teamMembers: any[] = [];
  if (isManager || canManage) {
    try {
      const teamRes = await db.user.findMany({
        where: canManage
          ? {}
          : { managerId: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          department: true,
        },
        orderBy: { name: "asc" },
        take: 100,
      });
      teamMembers = teamRes;
    } catch {
      // Team data is optional; continue without it.
    }
  }

  const completion = calculateCompletion(profile);

  return (
    <div className="space-y-6">
      <ProfilePageClient
        initialTab="overview"
        user={{ ...profile, activity }}
        teamMembers={teamMembers}
        completion={completion}
        canManageUsers={canManage}
        isManager={isManager}
      />
    </div>
  );
}
