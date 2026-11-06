import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { recordAudit, notify } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";
import {
  allRequiredLegsResolved,
  isBookedBooking,
  isCancelledBooking,
  isFailedBooking,
  isPendingBooking,
  normalizeBookingState,
} from "@/lib/booking";

// Admin-only: record that a specific booking row was manually booked
// externally. A real provider reference is mandatory. When every required
// booking leg is resolved successfully the trip moves to "booked"; otherwise
// it stays in "booking_pending_confirmation".
const schema = z.object({
  bookingId: z.string().min(1),
  reference: z.string().trim().min(1, "A provider confirmation reference is required").max(200),
});

export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!canHandleBookings(user)) {
      throw new ApiError(403, "Only a travel admin or super admin can confirm bookings.");
    }

    const trip = await db.tripRequest.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (
      trip.status !== "booking_links_generated" &&
      trip.status !== "booking_pending_confirmation"
    ) {
      throw new ApiError(
        409,
        "Bookings can only be confirmed after booking links are generated and before cancellation.",
        { code: "INVALID_STATE" },
      );
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid booking confirmation", {
        details: parsed.error.flatten(),
      });
    }
    const { bookingId, reference } = parsed.data;

    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.tripRequestId !== trip.id) {
      throw new ApiError(404, "Booking not found on this trip.");
    }
    const bookingState = normalizeBookingState(booking.status);
    if (bookingState === "not_required") {
      throw new ApiError(409, "This booking leg is marked as not required.");
    }
    if (isBookedBooking(booking.status)) {
      throw new ApiError(409, "This booking is already confirmed.");
    }
    if (isCancelledBooking(booking.status)) {
      throw new ApiError(409, "This booking was cancelled and cannot be confirmed.");
    }
    if (isFailedBooking(booking.status)) {
      throw new ApiError(409, "This booking leg failed and cannot be confirmed.");
    }
    if (!isPendingBooking(booking.status)) {
      throw new ApiError(409, "This booking leg is not awaiting confirmation.");
    }

    // A manual confirmation from an authorized travel admin is the ONLY
    // place a candidate's classifications may be promoted to the verified
    // variants. Patch the candidate blob stored in Booking.details so the
    // audit trail keeps the search-time snippet alongside the verified state.
    let verifiedDetails: string | null = booking.details;
    if (booking.details) {
      try {
        const parsedDetails = JSON.parse(booking.details) as Record<string, unknown>;
        parsedDetails.priceType = "verified";
        parsedDetails.availabilityStatus = "available_verified";
        parsedDetails.verifiedAt = new Date().toISOString();
        parsedDetails.verifiedBy = user.id;
        parsedDetails.verifiedReference = reference;
        verifiedDetails = JSON.stringify(parsedDetails);
      } catch {
        // Malformed legacy row — leave as-is rather than discard provenance.
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, tripRequestId: trip.id, status: { in: ["pending", "link_only"] } },
        data: {
          status: "booked",
          reference,
          confirmedAt: new Date(),
          confirmedById: user.id,
          ...(verifiedDetails !== booking.details ? { details: verifiedDetails } : {}),
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This booking changed before the confirmation was saved. Refresh and try again.",
        );
      }

      // A trip becomes "booked" only when every required leg is resolved
      // successfully (booked with a real provider reference). Not-required legs
      // are exempt; pending or failed required legs keep the trip in
      // "booking_pending_confirmation".
      const bookings = await tx.booking.findMany({
        where: { tripRequestId: trip.id },
      });
      const resolved = allRequiredLegsResolved(bookings);
      const nextStatus = resolved ? "booked" : "booking_pending_confirmation";

      await tx.tripRequest.update({
        where: { id: trip.id },
        data: {
          status: nextStatus,
          ...(nextStatus === "booked" ? { bookedAt: new Date() } : {}),
        },
      });

      await recordAudit(tx, {
        actorId: user.id,
        action: "booking.confirmed",
        entityType: "Booking",
        entityId: bookingId,
        summary: `${booking.kind} booking confirmed for ${trip.destination}`,
        metadata: { tripRequestId: trip.id, reference, allConfirmed: resolved },
      });
      await notify(tx, {
        userId: trip.requesterId,
        type: "booking_confirmed",
        title: resolved ? "Trip booked" : "Booking leg confirmed",
        body: resolved
          ? `All required bookings for ${trip.destination} are confirmed.`
          : `A ${booking.kind} booking for ${trip.destination} was confirmed.`,
        link: `/trips/${trip.id}`,
        entityType: "Booking",
        entityId: booking.id,
      });

      return tx.tripRequest.findUnique({
        where: { id: trip.id },
        include: { bookings: true },
      });
    });

    kickOutboxProcessor();
    return NextResponse.json(updated);
  },
);
