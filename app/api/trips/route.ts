import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { tripCreateSchema } from "@/lib/validators";
import { tripCurrency } from "@/lib/currency";
import { recordAudit } from "@/lib/audit";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();
  const mine = url.searchParams.get("mine") === "1";

  const roleScope = canViewAllTrips(user)
    ? {}
    : user.role === "manager" && !mine
      ? {
          OR: [
            { requesterId: user.id },
            { approvals: { some: { approverId: user.id } } },
          ],
        }
      : { requesterId: user.id };

  const searchScope = q
    ? {
        OR: [
          { destination: { contains: q } },
          { origin: { contains: q } },
          { purpose: { contains: q } },
          { requester: { name: { contains: q } } },
        ],
      }
    : {};

  const trips = await db.tripRequest.findMany({
    where: {
      AND: [roleScope, searchScope, ...(status ? [{ status }] : [])],
    },
    orderBy: { createdAt: "desc" },
    include: {
      requester: {
        select: { id: true, name: true, email: true, role: true, department: true },
      },
      approvals: {
        select: {
          id: true,
          approverId: true,
          decision: true,
          approver: { select: { id: true, name: true } },
        },
      },
      _count: { select: { bookings: true } },
    },
  });
  return NextResponse.json(trips);
});

export const POST = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const parsed = tripCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Invalid trip request", {
      details: parsed.error.flatten(),
    });
  }
  const t = parsed.data;
  // Prefer the structured city/country pair for currency detection when the
  // user picked a real airport, so "DEL" selections go to INR without relying
  // on the free-text label.
  const originForCurrency = t.originCity && t.originCountry
    ? `${t.originCity}, ${t.originCountry}`
    : t.origin;
  const destinationForCurrency = t.destinationCity && t.destinationCountry
    ? `${t.destinationCity}, ${t.destinationCountry}`
    : t.destination;
  const currency = tripCurrency(originForCurrency, destinationForCurrency);
  const trip = await db.tripRequest.create({
    data: {
      requesterId: user.id,
      purpose: t.purpose ?? "",
      tripType: t.tripType,
      tripReason: t.tripReason || null,
      origin: t.origin,
      destination: t.destination,
      departDate: new Date(t.departDate),
      returnDate: t.returnDate ? new Date(t.returnDate) : null,
      cabin: t.flightClass ?? "economy",
      notes: t.notes || null,
      currency,
      originAirportCode: t.originAirportCode,
      originAirportName: t.originAirportName,
      originCity: t.originCity,
      originCountry: t.originCountry,
      originLatitude: t.originLatitude,
      originLongitude: t.originLongitude,
      destinationAirportCode: t.destinationAirportCode,
      destinationAirportName: t.destinationAirportName,
      destinationCity: t.destinationCity,
      destinationCountry: t.destinationCountry,
      destinationLatitude: t.destinationLatitude,
      destinationLongitude: t.destinationLongitude,
      flightClass: t.flightClass ?? "economy",
      trainClass: t.trainClass ?? "economy",
    },
  });

  await recordAudit(db, {
    actorId: user.id,
    action: "trip.created",
    entityType: "TripRequest",
    entityId: trip.id,
    summary: `${user.name} created a draft trip to ${trip.destination}`,
    metadata: { origin: trip.origin, destination: trip.destination },
  });

  return NextResponse.json(trip, { status: 201 });
});
