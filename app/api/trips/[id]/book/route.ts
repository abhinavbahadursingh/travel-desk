import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { recordAudit, notify } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";
import type { Candidate, SearchResult } from "@/lib/search";

// This route NEVER performs a real booking. It materialises the top search
// candidates per category as `Booking` rows with status = "link_only" so the
// UI can surface outbound links to the real provider sites. A travel admin
// records the real confirmation later via /confirm-booking.
export const POST = withApi(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: { approvals: { select: { decision: true } }, bookings: true },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }

    // Idempotent: repeated clicks return the existing links.
    if (trip.status === "booking_links_generated" && trip.bookings.length > 0) {
      return NextResponse.json(trip);
    }
    if (trip.status !== "approved") {
      throw new ApiError(
        409,
        "Booking links can only be generated for an approved trip.",
        { code: "INVALID_STATE" },
      );
    }
    if (
      trip.approvals.length > 0 &&
      !trip.approvals.some((approval) => approval.decision === "approved")
    ) {
      throw new ApiError(409, "This trip has no approved decision.", {
        code: "APPROVAL_REQUIRED",
      });
    }
    if (!trip.itinerary) {
      throw new ApiError(409, "There is no itinerary to turn into booking links.");
    }

    let itin: {
      flights: SearchResult;
      hotels: SearchResult;
      trains: SearchResult;
      cabs: SearchResult;
      featured: Record<"flight" | "hotel" | "train" | "cab", Candidate | null>;
    };
    try {
      itin = JSON.parse(trip.itinerary);
    } catch {
      throw new ApiError(409, "The stored itinerary is unreadable. Re-plan the trip.");
    }

    // Resolve not-required markers BEFORE the push helper is called —
    // reading a const that hasn't been initialised yet throws (temporal dead
    // zone) and would silently break the not_required exemption.
    const notRequiredKinds = new Set(
      (
        await db.booking.findMany({
          where: { tripRequestId: trip.id, status: "not_required" },
          select: { kind: true },
        })
      ).map((row) => row.kind),
    );

    const rows: Array<{
      tripRequestId: string;
      kind: Candidate["kind"];
      vendor: string;
      url: string;
      source: string;
      estimatedCost: number | null;
      currency: string | null;
      retrievedAt: Date;
      status: "pending";
      details: string;
    }> = [];

    const push = (c: Candidate | null | undefined) => {
      if (!c) return;
      if (notRequiredKinds.has(c.kind)) return;
      rows.push({
        tripRequestId: trip.id,
        kind: c.kind,
        vendor: c.provider,
        url: c.url,
        source: c.provider,
        estimatedCost: c.estimatedPrice,
        currency: c.currency,
        retrievedAt: new Date(c.retrievedAt),
        status: "pending",
        details: JSON.stringify(c),
      });
    };

    push(itin.featured.flight);
    push(itin.featured.hotel);
    push(itin.featured.train);
    push(itin.featured.cab);

    const addAlternates = (r: SearchResult, featuredUrl: string | undefined) => {
      if (!r || r.status !== "ok") return;
      const alts = r.candidates.filter((c) => c.url !== featuredUrl).slice(0, 2);
      for (const c of alts) push(c);
    };
    addAlternates(itin.flights, itin.featured.flight?.url);
    addAlternates(itin.hotels, itin.featured.hotel?.url);
    addAlternates(itin.trains, itin.featured.train?.url);
    addAlternates(itin.cabs, itin.featured.cab?.url);

    if (rows.length === 0) {
      throw new ApiError(
        409,
        "No booking links are available from the stored search results. Re-plan the trip.",
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.tripRequest.updateMany({
        where: { id, status: "approved" },
        data: { status: "booking_links_generated" },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          409,
          "This trip changed while links were being generated. Refresh and try again.",
        );
      }
      // Only replace unresolved links. Confirmed, cancelled and not-required
      // rows are historical records and are never deleted.
      await tx.booking.deleteMany({
        where: { tripRequestId: id, status: { in: ["pending", "link_only"] } },
      });
      await tx.booking.createMany({ data: rows });
      await recordAudit(tx, {
        actorId: user.id,
        action: "booking.links_generated",
        entityType: "TripRequest",
        entityId: id,
        summary: `Booking links generated for ${trip.destination}`,
        metadata: { count: rows.length },
      });
      if (trip.requesterId !== user.id) {
        await notify(tx, {
          userId: trip.requesterId,
          type: "booking_links_ready",
          title: "Booking links are ready",
          body: `A travel admin generated booking links for your trip to ${trip.destination}.`,
          link: `/trips/${id}`,
          entityType: "TripRequest",
          entityId: id,
        });
      }
      return tx.tripRequest.findUnique({
        where: { id },
        include: { bookings: true },
      });
    });

    kickOutboxProcessor();
    return NextResponse.json(updated);
  },
);
