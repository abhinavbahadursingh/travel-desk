import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isApprover, canApproveAny } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { approvalSchema } from "@/lib/validators";
import { recordAudit, notify, notifyMany } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";

export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!isApprover(user)) {
      throw new ApiError(403, "Approver access is required.");
    }

    const approval = await db.approval.findUnique({
      where: { id },
      include: { tripRequest: { include: { requester: true } } },
    });
    if (!approval) throw new ApiError(404, "Approval not found");

    const trip = approval.tripRequest;
    if (approval.isLegacy) {
      throw new ApiError(
        409,
        "This approval is a legacy self-approval and cannot be re-decided as a valid approval.",
        { code: "LEGACY_APPROVAL" },
      );
    }
    if (trip.requesterId === user.id) {
      throw new ApiError(403, "You cannot decide your own trip.");
    }
    if (approval.approverId !== user.id && !canApproveAny(user)) {
      throw new ApiError(403, "This approval is assigned to another approver.");
    }
    if (approval.decision !== "pending") {
      throw new ApiError(409, "This approval has already been decided.", {
        code: "ALREADY_DECIDED",
      });
    }
    if (trip.status !== "pending_approval") {
      throw new ApiError(409, "This trip is not awaiting approval.", {
        code: "INVALID_STATE",
      });
    }

    const parsed = approvalSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid approval decision", {
        details: parsed.error.flatten(),
      });
    }
    const { decision, comment, rejectionReason } = parsed.data;

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.approval.updateMany({
        where: { id, decision: "pending", pendingKey: trip.id },
        data: {
          decision,
          comment: comment ?? null,
          rejectionReason: rejectionReason ?? null,
          decidedAt: new Date(),
          pendingKey: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "Another decision was recorded first. Refresh to see the current status.",
          { code: "DECISION_RACE" },
        );
      }

      const nextStatus =
        decision === "approved"
          ? "approved"
          : decision === "rejected"
            ? "rejected"
            : "draft";
      const tripUpdate = await tx.tripRequest.updateMany({
        where: { id: trip.id, status: "pending_approval" },
        data: { status: nextStatus, decidedAt: new Date() },
      });
      if (tripUpdate.count !== 1) {
        throw new ApiError(
          409,
          "The trip changed while this decision was being recorded. Refresh and try again.",
          { code: "DECISION_RACE" },
        );
      }

      await tx.approvalEvent.create({
        data: {
          approvalId: id,
          type: decision,
          actorId: user.id,
          comment: rejectionReason ?? comment ?? null,
          metadata: JSON.stringify({ decision }),
        },
      });

      await recordAudit(tx, {
        actorId: user.id,
        action: `approval.${decision}`,
        entityType: "Approval",
        entityId: id,
        summary: `${user.name} ${decision.replaceAll("_", " ")} ${trip.requester.name}'s trip to ${trip.destination}`,
        metadata: { tripRequestId: trip.id, rejectionReason, comment },
      });

      if (decision === "approved") {
        await notify(tx, {
          userId: trip.requesterId,
          type: "trip_approved",
          title: "Trip approved",
          body: `${user.name} approved your trip to ${trip.destination}. A travel admin can now generate booking links.`,
          link: `/trips/${trip.id}`,
          entityType: "TripRequest",
          entityId: trip.id,
        });
        const admins = await tx.user.findMany({
          where: { role: { in: ["travel_admin", "super_admin"] }, active: true },
          select: { id: true },
        });
        await notifyMany(
          tx,
          admins.map((a) => a.id),
          {
            type: "trip_ready_for_booking",
            title: "Approved trip ready for booking",
            body: `${trip.requester.name}'s trip to ${trip.destination} is approved.`,
            link: `/trips/${trip.id}`,
            entityType: "TripRequest",
            entityId: trip.id,
          },
        );
      } else if (decision === "rejected") {
        await notify(tx, {
          userId: trip.requesterId,
          type: "trip_rejected",
          title: "Trip rejected",
          body: `${user.name} rejected your trip to ${trip.destination}: ${rejectionReason}`,
          link: `/trips/${trip.id}`,
          entityType: "TripRequest",
          entityId: trip.id,
        });
      } else {
        await notify(tx, {
          userId: trip.requesterId,
          type: "trip_changes_requested",
          title: "Changes requested",
          body: `${user.name} asked for changes to your trip to ${trip.destination}: ${comment}`,
          link: `/trips/${trip.id}`,
          entityType: "TripRequest",
          entityId: trip.id,
        });
      }

      return tx.tripRequest.findUnique({
        where: { id: trip.id },
        include: {
          approvals: {
            include: { approver: true, events: { orderBy: { createdAt: "asc" } } },
          },
          bookings: true,
        },
      });
    });

    kickOutboxProcessor();
    return NextResponse.json({ ok: true, trip: updated });
  },
);
