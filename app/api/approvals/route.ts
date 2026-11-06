import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canApproveAny, isApprover } from "@/lib/auth";
import { withApi } from "@/lib/api";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "pending";

  if (!isApprover(user)) {
    // Employees see the approval history for their own requests.
    const approvals = await db.approval.findMany({
      where: { tripRequest: { requesterId: user.id } },
      include: {
        tripRequest: { include: { requester: true } },
        approver: true,
        events: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(approvals);
  }

  const admin = canApproveAny(user);
  const where =
    scope === "history"
      ? {
          ...(admin ? {} : { approverId: user.id }),
          decision: { not: "pending" },
        }
      : scope === "all"
        ? admin
          ? {}
          : { approverId: user.id }
        : {
            ...(admin ? {} : { approverId: user.id }),
            decision: "pending",
          };

  const approvals = await db.approval.findMany({
    where,
    include: {
      tripRequest: { include: { requester: true } },
      approver: true,
      events: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(approvals);
});
