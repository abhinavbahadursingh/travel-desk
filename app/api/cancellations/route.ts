import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!canHandleBookings(user)) {
    throw new ApiError(403, "Travel operations access is required.");
  }
  const scope = new URL(req.url).searchParams.get("scope") ?? "pending";
  const cancellations = await db.cancellationRequest.findMany({
    where: scope === "all" ? {} : { status: "pending" },
    include: {
      tripRequest: {
        include: {
          requester: { select: { id: true, name: true, email: true } },
          bookings: true,
        },
      },
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(cancellations);
});
