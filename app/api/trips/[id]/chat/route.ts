import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { canViewTrip } from "@/lib/approvals";
import { chat } from "@/lib/ai";
import { chatSchema } from "@/lib/validators";
import { formatMoney, tripCostOrUnknown, UNKNOWN_COST_MESSAGE } from "@/lib/currency";
import type { Candidate, SearchResult } from "@/lib/search";
import { flagDescription, type PolicyFlag } from "@/lib/policy";

// Keep the Groq request well under the free-tier TPM limit. The raw itinerary
// blob can run tens of thousands of tokens because it includes four full
// SearchResult arrays with long Tavily snippets, so we build a compact summary
// here instead of pasting the JSON.
const MAX_SNIPPET_CHARS = 160;
const MAX_HISTORY_MESSAGES = 8;

function compactCandidate(c: Candidate | null | undefined, currency: string): string {
  if (!c) return "(no result)";
  const price =
    c.price != null
      ? `${formatMoney(c.price, c.currency ?? currency)} (${c.priceType})`
      : "price not listed";
  const snippet = c.description
    ? ` — ${c.description.replace(/\s+/g, " ").slice(0, MAX_SNIPPET_CHARS)}`
    : "";
  return `${c.title} [${c.sourceHostname}] — ${price} — avail:${c.availabilityStatus}${snippet}`;
}

type ItineraryBlob = {
  featured?: Partial<Record<"flight" | "hotel" | "train" | "cab", Candidate | null>>;
  flights?: SearchResult;
  hotels?: SearchResult;
  trains?: SearchResult;
  cabs?: SearchResult;
  estimatedTotal?: number | null;
  rationale?: string;
  retrievedAt?: string;
};

function buildItinerarySummary(
  itinerary: ItineraryBlob | null,
  currency: string,
): string {
  if (!itinerary) return "Itinerary: not planned yet.";
  const f = itinerary.featured ?? {};
  const unavailable = (r?: SearchResult) =>
    r?.status === "unavailable" ? ` (search unavailable: ${r.reason})` : "";
  const total =
    itinerary.estimatedTotal != null
      ? formatMoney(itinerary.estimatedTotal, currency)
      : "unavailable (at least one leg had no listed price)";
  const lines = [
    `Featured itinerary (every candidate is a real search listing; priceType and availability apply):`,
    `- Flight: ${compactCandidate(f.flight, currency)}${unavailable(itinerary.flights)}`,
    `- Hotel:  ${compactCandidate(f.hotel, currency)}${unavailable(itinerary.hotels)}`,
    `- Train:  ${compactCandidate(f.train, currency)}${unavailable(itinerary.trains)}`,
    `- Cab:    ${compactCandidate(f.cab, currency)}${unavailable(itinerary.cabs)}`,
    `Combined estimated total (flight + hotel): ${total}`,
  ];
  if (itinerary.retrievedAt) lines.push(`Retrieved: ${itinerary.retrievedAt}`);
  return lines.join("\n");
}

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

    const parsed = chatSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid chat request", {
        details: parsed.error.flatten(),
      });
    }

    const departDay = trip.departDate.toISOString().slice(0, 10);
    const dates = trip.returnDate
      ? `${departDay} to ${trip.returnDate.toISOString().slice(0, 10)}`
      : `${departDay} (one-way)`;

    let itinerary: ItineraryBlob | null = null;
    if (trip.itinerary) {
      try {
        itinerary = JSON.parse(trip.itinerary) as ItineraryBlob;
      } catch {
        itinerary = null;
      }
    }

    let flags: PolicyFlag[] = [];
    try {
      flags = JSON.parse(trip.policyFlags) as PolicyFlag[];
    } catch {
      flags = [];
    }
    const flagsLine =
      flags.length > 0
        ? `Policy flags: ${flags.map((f) => `${f} (${flagDescription(f)})`).join("; ")}\n`
        : "";

    const context =
      `Purpose: ${trip.purpose}\n` +
      `Route: ${trip.origin} → ${trip.destination}\n` +
      `Dates: ${dates}\n` +
      `Cabin: ${trip.cabin}\n` +
      `Status: ${trip.status}\n` +
      `Estimated cost: ${
        (() => {
          const known = tripCostOrUnknown(trip);
          return known == null
            ? UNKNOWN_COST_MESSAGE
            : formatMoney(known, trip.currency || "USD");
        })()
      }\n` +
      flagsLine +
      buildItinerarySummary(itinerary, trip.currency);

    const history = parsed.data.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));

    try {
      const reply = await chat(context, history);
      return NextResponse.json({ reply });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const short = msg.length > 240 ? msg.slice(0, 240) + "…" : msg;
      throw new ApiError(502, `AI chat unavailable: ${short}`);
    }
  },
);
