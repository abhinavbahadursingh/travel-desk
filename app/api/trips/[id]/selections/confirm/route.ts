import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import {
  DraftInput,
  applyDraft,
  canConfirm,
  computeBudget,
  emptySelections,
  parseStoredSelections,
} from "@/lib/selections";
import { tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";

// Confirm the current draft. Recomputes the budget on the backend and
// stores it on the trip so the Proposed Itinerary page shows the exact
// numbers the server computed — never a frontend-submitted total.
//
// An optional request body (same shape as PUT /selections) is applied to the
// draft before confirming. This makes save+confirm atomic — eliminating the
// race where a debounced autosave hadn't flushed before the user clicked
// Confirm, which previously left the server with transportMode="none" and
// surfaced "Choose a transport mode" even though the UI showed a picked
// flight.
export const POST = withApi(
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
        "Selections can only be confirmed while the trip is still a draft.",
        { code: "INVALID_STATE" },
      );
    }
    if (!trip.itinerary) {
      throw new ApiError(409, "Plan the trip first.", { code: "NO_ITINERARY" });
    }

    let draft = parseStoredSelections(trip.selections) ?? emptySelections();

    // Optional body — the wizard's Confirm button posts the latest client
    // state so save+confirm is one atomic call.
    const rawBody = await readJson(req).catch(() => null);
    if (rawBody && typeof rawBody === "object" && Object.keys(rawBody).length > 0) {
      const parsed = DraftInput.safeParse(rawBody);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid selection payload", {
          details: parsed.error.flatten(),
        });
      }
      const { selections, invalid } = applyDraft(
        draft,
        parsed.data,
        trip.itinerary,
      );
      if (invalid.length > 0) {
        throw new ApiError(400, invalid.join("; "), {
          code: "INVALID_SELECTION",
        });
      }
      draft = selections;
    }

    const { ok, reasons } = canConfirm(draft, trip.itinerary);
    if (!ok) {
      throw new ApiError(400, reasons.join(" "), { code: "INCOMPLETE_SELECTION" });
    }

    const currency = trip.currency || tripCurrency(trip.origin, trip.destination);
    const nights = tripNights(trip.departDate, trip.returnDate);
    const budget = computeBudget(draft, trip.itinerary, { currency, nights });

    const now = new Date();
    const confirmed = {
      ...draft,
      confirmed: true,
      confirmedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Store the selections AND update the trip-level totals so the Proposed
    // Itinerary page can read either path. estimatedCost stays null when
    // any selected line had an unknown price — honest "we don't know" over
    // pretending it's zero (same rule the planner applies).
    await db.tripRequest.update({
      where: { id },
      data: {
        selections: JSON.stringify(confirmed),
        selectionsUpdatedAt: now,
        estimatedCost: budget.grandTotal,
        estimateIsComplete: budget.isComplete,
        currency,
      },
    });

    await recordAudit(db, {
      actorId: user.id,
      action: "trip.selections_confirmed",
      entityType: "TripRequest",
      entityId: id,
      summary: `${user.name} confirmed travel selections`,
      metadata: {
        total: budget.grandTotal,
        currency,
        isComplete: budget.isComplete,
        transportMode: confirmed.transportMode,
      },
    });

    return NextResponse.json({ selections: confirmed, budget });
  },
);
