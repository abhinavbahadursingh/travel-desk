import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { cancellationDecisionSchema } from "@/lib/validators";
import { recordAudit, notify } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";

// Travel operations review a cancellation request. "complete" requires a real
// provider cancellation reference; only then is the trip marked cancelled.
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!canHandleBookings(user)) {
      throw new ApiError(403, "Travel operations access is required.");
    }

    const cancellation = await db.cancellationRequest.findUnique({
      where: { id },
      include: { tripRequest: { include: { requester: true } } },
    });
    if (!cancellation) throw new ApiError(404, "Cancellation request not found");
    if (cancellation.status !== "pending") {
      throw new ApiError(409, "This cancellation request has already been reviewed.");
    }
    const trip = cancellation.tripRequest;
    if (trip.status !== "cancellation_requested") {
      throw new ApiError(409, "This trip is not awaiting cancellation review.");
    }

    const parsed = cancellationDecisionSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid cancellation decision", {
        details: parsed.error.flatten(),
      });
    }
    const { action, note, reference } = parsed.data;

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.cancellationRequest.updateMany({
        where: { id, status: "pending" },
        data: {
          status: action === "complete" ? "completed" : "rejected",
          pendingKey: null,
          reviewNote: note ?? null,
          cancellationReference: reference ?? null,
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This cancellation request changed before the review was saved. Refresh and try again.",
        );
      }

      if (action === "complete") {
        const tripUpdate = await tx.tripRequest.updateMany({
          where: { id: trip.id, status: "cancellation_requested" },
          data: { status: "cancelled", cancelledAt: new Date() },
        });
        if (tripUpdate.count !== 1) {
          throw new ApiError(409, "The trip changed while cancellation was being completed.");
        }
        await tx.booking.updateMany({
          where: {
            tripRequestId: trip.id,
            status: { in: ["pending", "link_only", "booked", "manually_confirmed"] },
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancellationReference: reference ?? null,
          },
        });
        await notify(tx, {
          userId: trip.requesterId,
          type: "trip_cancelled",
          title: "Trip cancelled",
          body: `The cancellation for ${trip.destination} was verified. Reference: ${reference}`,
          link: `/trips/${trip.id}`,
          entityType: "TripRequest",
          entityId: trip.id,
        });
      } else {
        const tripUpdate = await tx.tripRequest.updateMany({
          where: { id: trip.id, status: "cancellation_requested" },
          data: { status: "booked" },
        });
        if (tripUpdate.count !== 1) {
          throw new ApiError(409, "The trip changed while the cancellation was being rejected.");
        }
        await notify(tx, {
          userId: trip.requesterId,
          type: "cancellation_rejected",
          title: "Cancellation request rejected",
          body: note ?? "Travel operations rejected the cancellation request.",
          link: `/trips/${trip.id}`,
        });
      }

      await recordAudit(tx, {
        actorId: user.id,
        action:
          action === "complete"
            ? "cancellation.completed"
            : "cancellation.rejected",
        entityType: "CancellationRequest",
        entityId: id,
        summary:
          action === "complete"
            ? `Cancellation verified for ${trip.destination} (${reference})`
            : `Cancellation rejected for ${trip.destination}`,
        metadata: { tripRequestId: trip.id, reference, note },
      });

      return tx.tripRequest.findUnique({
        where: { id: trip.id },
        include: { bookings: true, cancellationRequests: true },
      });
    });

    kickOutboxProcessor();
    return NextResponse.json({ ok: true, trip: updated });
  },
);
