import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { canEditTrip, canViewTrip } from "@/lib/approvals";
import { tripPatchSchema } from "@/lib/validators";
import { tripCurrency } from "@/lib/currency";
import { recordAudit } from "@/lib/audit";

export const GET = withApi(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            department: true,
            manager: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        approvals: {
          include: {
            approver: { select: { id: true, name: true, email: true, role: true } },
            assignedBy: { select: { id: true, name: true } },
            events: {
              include: { actor: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        bookings: { orderBy: { createdAt: "asc" } },
        cancellationRequests: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (!canViewTrip(user, trip)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }
    return NextResponse.json(trip);
  },
);

export const PATCH = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id) {
      throw new ApiError(403, "Only the requester can edit this trip.");
    }
    if (!canEditTrip(user, trip)) {
      throw new ApiError(409, "Only draft trips can be edited.");
    }

    const parsed = tripPatchSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid trip update", {
        details: parsed.error.flatten(),
      });
    }
    const p = parsed.data;
    const nextOrigin = p.origin ?? trip.origin;
    const nextDestination = p.destination ?? trip.destination;
    const nextDepartDate = p.departDate ? new Date(p.departDate) : trip.departDate;
    const nextReturnDate =
      p.returnDate === undefined
        ? undefined
        : p.returnDate === "" || p.returnDate === null
          ? null
          : new Date(p.returnDate);
    const effectiveReturnDate =
      nextReturnDate !== undefined ? nextReturnDate : trip.returnDate;
    if (
      effectiveReturnDate &&
      effectiveReturnDate.getTime() < nextDepartDate.getTime()
    ) {
      throw new ApiError(400, "Return date must be on or after the departure date.");
    }

    // Any change that affects search results invalidates the stored itinerary.
    // Keeping the old itinerary would let a user submit an approval for one
    // destination using options retrieved for another.
    const searchChanged =
      (p.origin !== undefined && p.origin !== trip.origin) ||
      (p.destination !== undefined && p.destination !== trip.destination) ||
      (p.departDate !== undefined &&
        nextDepartDate.getTime() !== trip.departDate.getTime()) ||
      (nextReturnDate !== undefined &&
        (nextReturnDate?.getTime() ?? null) !==
          (trip.returnDate?.getTime() ?? null)) ||
      (p.cabin !== undefined && p.cabin !== trip.cabin) ||
      (p.flightClass !== undefined && p.flightClass !== trip.flightClass) ||
      (p.trainClass !== undefined && p.trainClass !== trip.trainClass);

    const updated = await db.tripRequest.update({
      where: { id },
      data: {
        ...(p.purpose !== undefined && { purpose: p.purpose }),
        ...(p.tripType !== undefined && { tripType: p.tripType }),
        ...(p.tripReason !== undefined && { tripReason: p.tripReason }),
        ...(p.origin !== undefined && { origin: p.origin }),
        ...(p.destination !== undefined && { destination: p.destination }),
        ...(p.departDate !== undefined && { departDate: nextDepartDate }),
        ...(nextReturnDate !== undefined && { returnDate: nextReturnDate }),
        ...(p.cabin !== undefined && { cabin: p.cabin }),
        ...(p.flightClass !== undefined && { cabin: p.flightClass, flightClass: p.flightClass }),
        ...(p.trainClass !== undefined && { trainClass: p.trainClass }),
        ...(p.notes !== undefined && { notes: p.notes }),
        ...((p.origin !== undefined || p.destination !== undefined) && {
          currency: tripCurrency(nextOrigin, nextDestination),
        }),
        ...(searchChanged && {
          itinerary: null,
          itineraryRetrievedAt: null,
          estimatedCost: null,
          estimateIsComplete: false,
          policyFlags: "[]",
        }),
      },
    });

    await recordAudit(db, {
      actorId: user.id,
      action: "trip.updated",
      entityType: "TripRequest",
      entityId: id,
      summary: `${user.name} edited draft trip to ${updated.destination}`,
      metadata: { itineraryInvalidated: searchChanged },
    });

    return NextResponse.json(updated);
  },
);
