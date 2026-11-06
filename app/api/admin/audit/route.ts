import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAudit } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!canViewAudit(user)) {
    throw new ApiError(403, "Only a super admin can view the system activity log.");
  }
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);
  const action = url.searchParams.get("action")?.trim();
  const entityType = url.searchParams.get("entityType")?.trim();

  const logs = await db.auditLog.findMany({
    where: {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(entityType ? { entityType } : {}),
    },
    include: {
      actor: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(logs);
});
