import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canApproveAny, APPROVER_ROLES, type Role } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { approvalReassignSchema } from "@/lib/validators";
import { notify, recordAudit } from "@/lib/audit";

// Reassign a pending approval. Travel admins and super admins only.
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!canApproveAny(user)) {
      throw new ApiError(403, "Only a travel admin or super admin can reassign approvals.");
    }

    const approval = await db.approval.findUnique({
      where: { id },
      include: { tripRequest: { include: { requester: true } } },
    });
    if (!approval) throw new ApiError(404, "Approval not found");
    if (approval.decision !== "pending") {
      throw new ApiError(409, "Only a pending approval can be reassigned.");
    }
    if (approval.tripRequest.status !== "pending_approval") {
      throw new ApiError(409, "This trip is not awaiting approval.");
    }

    const parsed = approvalReassignSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid reassignment", {
        details: parsed.error.flatten(),
      });
    }
    const { approverId, note } = parsed.data;

    const nextApprover = await db.user.findUnique({ where: { id: approverId } });
    if (!nextApprover) throw new ApiError(404, "The selected approver does not exist.");
    if (!nextApprover.active) {
      throw new ApiError(409, "The selected approver is deactivated.");
    }
    if (!APPROVER_ROLES.includes(nextApprover.role as Role)) {
      throw new ApiError(409, "The selected user does not have an approver role.");
    }
    if (nextApprover.id === approval.tripRequest.requesterId) {
      throw new ApiError(409, "The requester cannot be their own approver.");
    }
    if (nextApprover.id === approval.approverId) {
      throw new ApiError(409, "This approval is already assigned to that approver.");
    }

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.approval.updateMany({
        where: { id, decision: "pending" },
        data: {
          approverId: nextApprover.id,
          assignedById: user.id,
          assignedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This approval changed before the reassignment was saved. Refresh and try again.",
        );
      }
      await tx.approvalEvent.create({
        data: {
          approvalId: id,
          type: "reassigned",
          actorId: user.id,
          comment: note ?? null,
          metadata: JSON.stringify({
            previousApproverId: approval.approverId,
            newApproverId: nextApprover.id,
          }),
        },
      });
      await notify(tx, {
        userId: nextApprover.id,
        type: "approval_assigned",
        title: "Approval reassigned to you",
        body: `${approval.tripRequest.requester.name}'s trip to ${approval.tripRequest.destination} was assigned to you.`,
        link: `/trips/${approval.tripRequestId}`,
      });
      await notify(tx, {
        userId: approval.tripRequest.requesterId,
        type: "approval_reassigned",
        title: "Approver changed",
        body: `Your trip to ${approval.tripRequest.destination} is now assigned to ${nextApprover.name}.`,
        link: `/trips/${approval.tripRequestId}`,
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "approval.reassigned",
        entityType: "Approval",
        entityId: id,
        summary: `Approval for ${approval.tripRequest.requester.name}'s trip reassigned to ${nextApprover.name}`,
        metadata: {
          tripRequestId: approval.tripRequestId,
          previousApproverId: approval.approverId,
          newApproverId: nextApprover.id,
        },
      });
      return tx.approval.findUnique({
        where: { id },
        include: { approver: true, events: { orderBy: { createdAt: "asc" } } },
      });
    });

    return NextResponse.json({ ok: true, approval: updated });
  },
);
