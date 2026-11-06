import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import {
  DraftInput,
  applyDraft,
  computeBudget,
  emptySelections,
  parseStoredSelections,
} from "@/lib/selections";
import { tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";

// Save a draft of the user's travel selections for the wizard.
// The transport mode and picks must come from the current itinerary;
// anything else is rejected with 400. The server never trusts the
// frontend's budget — it recomputes it here.
export const PUT = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }
    if (trip.status !== "draft") {
      throw new ApiError(
        409,
        "Selections can only change while the trip is still a draft.",
        { code: "INVALID_STATE" },
      );
    }
    if (!trip.itinerary) {
      throw new ApiError(
        409,
        "Plan the trip first — the itinerary is what selections pick from.",
        { code: "NO_ITINERARY" },
      );
    }

    const parsed = DraftInput.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid selection payload", {
        details: parsed.error.flatten(),
      });
    }

    const prev = parseStoredSelections(trip.selections) ?? emptySelections();
    const { selections, invalid } = applyDraft(prev, parsed.data, trip.itinerary);
    if (invalid.length > 0) {
      throw new ApiError(400, invalid.join("; "), { code: "INVALID_SELECTION" });
    }

    const currency = trip.currency || tripCurrency(trip.origin, trip.destination);
    const nights = tripNights(trip.departDate, trip.returnDate);
    const budget = computeBudget(selections, trip.itinerary, { currency, nights });

    await db.tripRequest.update({
      where: { id },
      data: {
        selections: JSON.stringify(selections),
        selectionsUpdatedAt: new Date(),
      },
    });

    return NextResponse.json({ selections, budget });
  },
);

// Read the current draft (used by the wizard page's client-side autosave
// recovery when the server component already shipped the data).
export const GET = withApi(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }
    const selections = parseStoredSelections(trip.selections);
    const currency = trip.currency || tripCurrency(trip.origin, trip.destination);
    const nights = tripNights(trip.departDate, trip.returnDate);
    const budget = selections
      ? computeBudget(selections, trip.itinerary, { currency, nights })
      : null;
    return NextResponse.json({ selections, budget });
  },
);
