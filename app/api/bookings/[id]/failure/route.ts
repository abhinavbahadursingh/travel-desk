import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { recordAudit, notify } from "@/lib/audit";
import { allRequiredLegsResolved, isFailedBooking, isPendingBooking, nextTripBookingStatus } from "@/lib/booking";

// Travel operations record that a booking leg's external provider attempt
// failed. The leg keeps a durable "failed" state that is distinct from an
// unattempted ("pending") leg; while a required leg is failed the trip can never
// be booked.
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!canHandleBookings(user)) {
      throw new ApiError(403, "Travel operations access is required.");
    }

    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) throw new ApiError(404, "Booking not found.");
    const trip = await db.tripRequest.findUnique({
      where: { id: booking.tripRequestId },
      include: { bookings: true },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (
      trip.status !== "booking_links_generated" &&
      trip.status !== "booking_pending_confirmation"
    ) {
      throw new ApiError(
        409,
        "A booking leg can only be marked failed while the trip is awaiting or going through booking confirmation.",
        { code: "INVALID_STATE" },
      );
    }
    if (isFailedBooking(booking.status)) {
      // Idempotent: repeating the failure record changes nothing.
      return NextResponse.json({ ok: true, booking, trip });
    }
    if (!isPendingBooking(booking.status)) {
      throw new ApiError(409, "Only a booking leg awaiting confirmation can be marked failed.");
    }

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, tripRequestId: trip.id, status: { in: ["pending", "link_only"] } },
        data: { status: "failed" },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This booking changed before the failure was recorded. Refresh and try again.",
        );
      }

      const bookings = await tx.booking.findMany({
        where: { tripRequestId: trip.id },
      });
      const resolved = allRequiredLegsResolved(bookings);
      const nextStatus = nextTripBookingStatus(trip.status, bookings);

      if (nextStatus !== trip.status) {
        await tx.tripRequest.update({
          where: { id: trip.id },
          data: resolved ? { status: "booked", bookedAt: new Date() } : { status: nextStatus },
        });
      }

      await recordAudit(tx, {
        actorId: user.id,
        action: "booking.failed",
        entityType: "Booking",
        entityId: booking.id,
        summary: `${user.name} recorded a failed ${booking.kind} booking for ${trip.destination}`,
        metadata: { tripRequestId: trip.id },
      });
      await notify(tx, {
        userId: trip.requesterId,
        type: "booking_failed",
        title: "Booking leg failed",
        body: `${user.name} recorded a failed ${booking.kind} booking for ${trip.destination}. The trip cannot be booked while this leg is unresolved.`,
        link: `/trips/${trip.id}`,
      });

      return tx.tripRequest.findUnique({
        where: { id: trip.id },
        include: { bookings: true },
      });
    });

    return NextResponse.json({ ok: true, trip: updated });
  },
);
