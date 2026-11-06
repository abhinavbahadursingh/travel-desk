import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { canViewTrip } from "@/lib/approvals";
import { compare } from "@/lib/ai";
import { policySummary } from "@/lib/policy";
import { formatMoney, tripCostOrUnknown, UNKNOWN_COST_MESSAGE } from "@/lib/currency";
import { compareLine, type RankedCandidate, type RankedResult } from "@/lib/ranking";

// POST /api/trips/[id]/compare  { question: string }
//
// The travel decision engine. Compares the FEATURED options already found by
// real web search and answers questions like "train or flight?", "cheapest?",
// "best fits policy?". The LLM only sees the compact per-candidate summary —
// never a stored invention of listings, prices or availability.

const schema = z.object({
  question: z.string().min(2).max(500),
});

type ItineraryBlob = {
  featured?: Partial<
    Record<"flight" | "hotel" | "train" | "cab", RankedCandidate | null>
  >;
  flights?: RankedResult;
  hotels?: RankedResult;
  trains?: RankedResult;
  cabs?: RankedResult;
  estimatedTotal?: number | null;
  rationale?: string;
  retrievedAt?: string;
};

export const POST = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: { approvals: { select: { id: true, approverId: true, decision: true } } },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (!canViewTrip(user, trip)) {
      throw new ApiError(403, "You do not have access to this trip.");
    }
    if (!trip.itinerary) {
      throw new ApiError(409, "Plan the trip first — there are no retrieved options to compare.");
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid comparison question", {
        details: parsed.error.flatten(),
      });
    }

    let itinerary: ItineraryBlob | null = null;
    try {
      itinerary = JSON.parse(trip.itinerary) as ItineraryBlob;
    } catch {
      throw new ApiError(409, "The stored itinerary is malformed. Re-plan the trip.");
    }

    const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
    if (!policy) throw new ApiError(500, "No travel policy is configured.");

    const departDay = trip.departDate.toISOString().slice(0, 10);
    const dates = trip.returnDate
      ? `${departDay} to ${trip.returnDate.toISOString().slice(0, 10)}`
      : `${departDay} (one-way)`;
    const tripContext =
      `Trip: ${trip.purpose}\n` +
      `Route: ${trip.origin} → ${trip.destination}\n` +
      `Dates: ${dates}\n` +
      `Cabin: ${trip.cabin}\n` +
      `Trip currency: ${trip.currency}\n` +
      `Estimated total: ${(() => {
        const known = tripCostOrUnknown(trip);
        return known == null
          ? UNKNOWN_COST_MESSAGE
          : formatMoney(known, trip.currency || "USD");
      })()}`;

    const summaryLineFor = (r: RankedResult | undefined) => {
      if (!r || r.status !== "ok") return { line: "no results" };
      return { line: compareLine(r.summary) };
    };

    try {
      const answer = await compare({
        question: parsed.data.question,
        tripContext,
        featured: {
          flight: itinerary.featured?.flight ?? null,
          hotel: itinerary.featured?.hotel ?? null,
          train: itinerary.featured?.train ?? null,
          cab: itinerary.featured?.cab ?? null,
        },
        summaries: {
          flight: summaryLineFor(itinerary.flights),
          hotel: summaryLineFor(itinerary.hotels),
          train: summaryLineFor(itinerary.trains),
          cab: summaryLineFor(itinerary.cabs),
        },
        policySummary: policySummary(policy, trip.currency),
      });
      return NextResponse.json({ answer, retrievedAt: itinerary.retrievedAt });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const short = msg.length > 240 ? msg.slice(0, 240) + "…" : msg;
      throw new ApiError(502, `Decision engine unavailable: ${short}`);
    }
  },
);
