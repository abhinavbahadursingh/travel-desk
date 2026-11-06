import { NextResponse } from "next/server";
import { getCurrentUser, canViewReports } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { buildOperationalReport } from "@/lib/reports";

export const GET = withApi(async () => {
  const user = await getCurrentUser();
  if (!canViewReports(user)) {
    throw new ApiError(403, "Travel operations access is required.");
  }
  return NextResponse.json(await buildOperationalReport());
});
