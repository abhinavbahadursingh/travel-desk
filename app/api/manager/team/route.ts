import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canApproveAny, isApprover } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";

export const GET = withApi(async () => {
  const user = await getCurrentUser();
  if (!isApprover(user) && !canApproveAny(user)) {
    throw new ApiError(403, "Manager or admin access is required.");
  }

  const reports = await db.user.findMany({
    where: canApproveAny(user) ? { id: { not: user.id } } : { managerId: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      department: true,
      createdAt: true,
      managerId: true,
      _count: { select: { requests: true } },
    },
    orderBy: { name: "asc" },
  });

  const reportIds = reports.map((r) => r.id);
  const [pending, recentTrips] = await Promise.all([
    db.approval.count({
      where: canApproveAny(user)
        ? { decision: "pending" }
        : { approverId: user.id, decision: "pending" },
    }),
    db.tripRequest.findMany({
      where: {
        requesterId: canApproveAny(user) ? { not: user.id } : { in: reportIds },
        status: { not: "draft" },
      },
      select: {
        id: true,
        requesterId: true,
        destination: true,
        status: true,
        departDate: true,
        returnDate: true,
        estimatedCost: true,
        estimateIsComplete: true,
        currency: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return NextResponse.json({ reports, pending, recentTrips });
});
