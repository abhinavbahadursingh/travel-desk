import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canApproveAny } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { approvalCommentSchema } from "@/lib/validators";
import { notify, recordAudit } from "@/lib/audit";

// Comments and clarification questions on an approval thread. Both the
// requester and the assigned approver (plus travel/super admins) may comment.
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const approval = await db.approval.findUnique({
      where: { id },
      include: { tripRequest: { include: { requester: true } } },
    });
    if (!approval) throw new ApiError(404, "Approval not found");

    const trip = approval.tripRequest;
    const isRequester = trip.requesterId === user.id;
    const isAssigned = approval.approverId === user.id;
    if (!isRequester && !isAssigned && !canApproveAny(user)) {
      throw new ApiError(403, "You do not have access to this approval thread.");
    }

    const parsed = approvalCommentSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid comment", {
        details: parsed.error.flatten(),
      });
    }

    const event = await db.$transaction(async (tx) => {
      const created = await tx.approvalEvent.create({
        data: {
          approvalId: id,
          type: "comment",
          actorId: user.id,
          comment: parsed.data.comment,
        },
      });

      const recipientId = isRequester ? approval.approverId : trip.requesterId;
      if (recipientId !== user.id) {
        await notify(tx, {
          userId: recipientId,
          type: "approval_comment",
          title: isRequester ? "New comment on a request" : "New comment on your trip",
          body: `${user.name}: ${parsed.data.comment.slice(0, 300)}`,
          link: `/trips/${trip.id}`,
        });
      }

      await recordAudit(tx, {
        actorId: user.id,
        action: "approval.comment",
        entityType: "Approval",
        entityId: id,
        summary: `${user.name} commented on ${trip.requester.name}'s trip`,
        metadata: { tripRequestId: trip.id },
      });

      return created;
    });

    return NextResponse.json({ ok: true, event });
  },
);
