import { NextResponse } from "next/server";
import { getCurrentUser, canViewAudit } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { buildSystemHealth } from "@/lib/health";

export const GET = withApi(async () => {
  const user = await getCurrentUser();
  if (!canViewAudit(user)) {
    throw new ApiError(403, "Only a super admin can view system health.");
  }
  return NextResponse.json(await buildSystemHealth());
});
