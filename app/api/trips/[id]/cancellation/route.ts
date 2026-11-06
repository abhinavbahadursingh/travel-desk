import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { cancellationRequestSchema } from "@/lib/validators";
import { recordAudit, notifyMany } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";

// Request cancellation of a booked trip. This never marks anything cancelled;
// it creates a pending review for travel operations.
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: { cancellationRequests: true },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }
    if (trip.status !== "booked") {
      throw new ApiError(
        409,
        "Only a fully booked trip can be cancelled.",
        { code: "INVALID_STATE" },
      );
    }
    if (trip.cancellationRequests.some((r) => r.status === "pending")) {
      throw new ApiError(409, "A cancellation request is already pending for this trip.");
    }

    const parsed = cancellationRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid cancellation request", {
        details: parsed.error.flatten(),
      });
    }

    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.tripRequest.updateMany({
        where: { id, status: "booked" },
        data: { status: "cancellation_requested" },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This trip changed while the cancellation request was being created. Refresh and try again.",
        );
      }
      const cancellation = await tx.cancellationRequest.create({
        data: {
          tripRequestId: id,
          requestedById: user.id,
          reason: parsed.data.reason,
          status: "pending",
          pendingKey: id,
        },
      });
      const admins = await tx.user.findMany({
        where: { role: { in: ["travel_admin", "super_admin"] }, active: true },
        select: { id: true },
      });
      await notifyMany(
        tx,
        admins.map((a) => a.id),
        {
          type: "cancellation_requested",
          title: "Cancellation request",
          body: `${user.name} requested cancellation for ${trip.destination}: ${parsed.data.reason}`,
          link: `/admin/cancellations`,
          entityType: "CancellationRequest",
          entityId: cancellation.id,
        },
      );
      await recordAudit(tx, {
        actorId: user.id,
        action: "cancellation.requested",
        entityType: "CancellationRequest",
        entityId: cancellation.id,
        summary: `Cancellation requested for ${trip.destination}`,
        metadata: { tripRequestId: id, reason: parsed.data.reason },
      });
      return cancellation;
    });

    kickOutboxProcessor();
    return NextResponse.json({ ok: true, cancellation: result }, { status: 201 });
  },
);
