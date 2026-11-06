import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { isPendingBooking } from "@/lib/booking";

// Mark a travel category as "not required" for a trip.
//
// Employees (the trip owner) use this to say a category — train, cab, extra
// hotel night — is unnecessary, so the trip no longer requires a booking leg
// for it. Admins (travel operations) may do the same for any trip. The mark is
// recorded as a Booking row with status "not_required" (a marker row is created
// when no booking row exists yet, e.g. while the trip is still a draft).
export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: { bookings: true },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }

    const ALLOWED_STATUSES = [
      "draft",
      "pending_approval",
      "approved",
      "booking_links_generated",
      "booking_pending_confirmation",
    ];
    if (!ALLOWED_STATUSES.includes(trip.status)) {
      throw new ApiError(
        409,
        "A booking leg can only be marked not required while the trip is still planning, submitting or awaiting booking confirmation.",
        { code: "INVALID_STATE" },
      );
    }

    const schema = z.object({
      kind: z.enum(["flight", "hotel", "train", "cab"]),
    });
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid booking requirement", {
        details: parsed.error.flatten(),
      });
    }
    const kind = parsed.data.kind;

    const existing = trip.bookings.find(
      (b) => b.kind === kind && isPendingBooking(b.status),
    );
    if (existing) {
      const updated = await db.booking.update({
        where: { id: existing.id },
        data: { status: "not_required" },
      });
      await recordAudit(db, {
        actorId: user.id,
        action: "booking.not_required",
        entityType: "Booking",
        entityId: existing.id,
        summary: `${user.name} marked the ${kind} booking for ${trip.destination} as not required`,
        metadata: { tripRequestId: trip.id, kind },
      });
      return NextResponse.json({ ok: true, booking: updated });
    }

    const created = await db.booking.create({
      data: {
        tripRequestId: id,
        kind,
        vendor: "",
        url: "",
        source: "",
        estimatedCost: null,
        currency: null,
        retrievedAt: new Date(),
        status: "not_required",
        details: null,
      },
    });
    await recordAudit(db, {
      actorId: user.id,
      action: "booking.not_required",
      entityType: "Booking",
      entityId: created.id,
      summary: `${user.name} marked the ${kind} booking for ${trip.destination} as not required`,
      metadata: { tripRequestId: id, kind },
    });
    return NextResponse.json({ ok: true, booking: created });
  },
);
