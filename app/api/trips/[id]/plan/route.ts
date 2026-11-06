import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { planTrip } from "@/lib/ai";
import { capsForCurrency, evaluate, policySummary } from "@/lib/policy";
import { tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";

export const POST = withApi(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to plan this trip.");
    }
    // Planning after submission would change what was approved. Changes must
    // go back through the approval flow.
    if (trip.status !== "draft") {
      throw new ApiError(
        409,
        "The itinerary can only change while the trip is a draft. Ask the approver to request changes, or start a new request.",
        { code: "INVALID_STATE" },
      );
    }

    const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
    if (!policy) {
      throw new ApiError(500, "No travel policy is configured.");
    }

    const currency = tripCurrency(trip.origin, trip.destination);
    const summary = policySummary(policy, currency);
    const caps = capsForCurrency(policy, currency);

    const planned = await planTrip({
      purpose: trip.purpose,
      origin: trip.origin,
      destination: trip.destination,
      originIata: trip.originAirportCode,
      destinationIata: trip.destinationAirportCode,
      departDate: trip.departDate,
      returnDate: trip.returnDate,
      cabin: trip.cabin,
      flightClass: trip.flightClass,
      trainClass: trip.trainClass,
      currency,
      policySummary: summary,
      priceCaps: {
        flight: caps.maxFlightEconomy,
        hotel: caps.maxHotelPerNight,
        train: caps.maxFlightEconomy,
        cab: null,
      },
    });

    if (planned.status === "unavailable") {
      return NextResponse.json(
        {
          status: "unavailable",
          reason: planned.reason,
          retrievedAt: planned.retrievedAt,
        },
        { status: 503 },
      );
    }

    const nights = tripNights(trip.departDate, trip.returnDate);
    const flightCost = planned.featured.flight?.estimatedPrice ?? null;
    const hotelPerNight = planned.featured.hotel?.estimatedPrice ?? null;
    const total =
      flightCost != null && hotelPerNight != null
        ? flightCost + hotelPerNight * nights
        : null;

    const evaluation = evaluate(
      { departDate: trip.departDate, cabin: trip.cabin },
      { flightCost, hotelPerNight, nights, total, cabin: trip.cabin },
      policy,
      currency,
    );

    const estimateIsComplete = flightCost != null && hotelPerNight != null;

    const updated = await db.tripRequest.update({
      where: { id },
      data: {
        itinerary: JSON.stringify({
          flights: planned.flights,
          hotels: planned.hotels,
          trains: planned.trains,
          cabs: planned.cabs,
          featured: planned.featured,
          estimatedTotal: total,
          rationale: planned.rationale,
          retrievedAt: planned.retrievedAt,
        }),
        itineraryRetrievedAt: new Date(planned.retrievedAt),
        // Unknown totals are stored as NULL — never 0 — so financial reports
        // don't treat "we don't know" as "zero spend".
        estimatedCost: total,
        currency,
        estimateIsComplete,
        policyFlags: JSON.stringify(evaluation.flags),
      },
    });

    await recordAudit(db, {
      actorId: user.id,
      action: "trip.planned",
      entityType: "TripRequest",
      entityId: id,
      summary: `${user.name} generated a real-search itinerary for ${trip.destination}`,
      metadata: {
        flags: evaluation.flags,
        retrievedAt: planned.retrievedAt,
        estimateIsComplete,
      },
    });

    return NextResponse.json({
      trip: updated,
      rationale: planned.rationale,
      requiresApproval: evaluation.requiresApproval,
      retrievedAt: planned.retrievedAt,
      featured: planned.featured,
    });
  },
);
