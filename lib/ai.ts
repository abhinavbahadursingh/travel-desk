import Groq from "groq-sdk";
import {
  searchFlights,
  searchHotels,
  searchTrains,
  searchCabs,
  normalizeSearchResult,
  type Candidate,
} from "./search";
import { ensureFx, formatMoney } from "./currency";
import {
  rankCategory,
  pickFeaturedRanked,
  type RankedCandidate,
  type RankedResult,
} from "./ranking";
import { hotelCheckOut } from "./dates";

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function client() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }
  return new Groq();
}

function textFromResponse(resp: Groq.Chat.Completions.ChatCompletion): string {
  return resp.choices[0]?.message?.content?.trim() ?? "";
}

export type PlanInput = {
  purpose: string;
  origin: string;
  destination: string;
  // Phase 6 — the IATA airport code when the trip record has one. Passed to
  // the ranker as the authoritative route identifier so a snippet that
  // extracts an IATA pair must agree with the trip, independent of any
  // free-text city name.
  originIata?: string | null;
  destinationIata?: string | null;
  departDate: Date;
  returnDate: Date | null; // null = one-way
  cabin?: string;
  // Per-mode class selection. `cabin` is kept in sync with flightClass for
  // older consumers; flights use flightClass, trains use trainClass.
  flightClass?: string;
  trainClass?: string;
  currency?: string;
  policySummary: string;
  // Optional per-category caps in the trip currency, used only for ranking
  // (scoring how strongly a candidate fits policy). Null = no cap for that
  // category — never guessed.
  priceCaps?: {
    flight: number | null;
    hotel: number | null;
    train: number | null;
    cab: number | null;
  };
};

export type PlannedTrip =
  | {
      status: "ok";
      retrievedAt: string;
      flights: RankedResult;
      hotels: RankedResult;
      trains: RankedResult;
      cabs: RankedResult;
      estimatedTotal: number | null; // null = at least one featured leg had no price
      rationale: string;
      featured: {
        flight: RankedCandidate | null;
        hotel: RankedCandidate | null;
        train: RankedCandidate | null;
        cab: RankedCandidate | null;
      };
    }
  | { status: "unavailable"; retrievedAt: string; reason: string };

export async function planTrip(input: PlanInput): Promise<PlannedTrip> {
  const retrievedAt = new Date().toISOString();
  const currency = input.currency ?? "USD";
  // When the trip has IATA codes we include them in the free-text passed to
  // the search provider. This produces notably better flight/train snippets
  // (Tavily keys off codes when they are present), though the authoritative
  // filtering still happens in rankCategory against the structured extract.
  const originWithIata = input.originIata
    ? `${input.origin} (${input.originIata})`
    : input.origin;
  const destWithIata = input.destinationIata
    ? `${input.destination} (${input.destinationIata})`
    : input.destination;
  const [rawFlights, rawHotels, rawTrains, rawCabs] = await Promise.all([
    searchFlights({
      origin: originWithIata,
      destination: destWithIata,
      departDate: input.departDate,
      returnDate: input.returnDate,
      cabin: input.flightClass ?? input.cabin,
    }),
    searchHotels({
      destination: input.destination,
      checkIn: input.departDate,
      // One-way trips assume a single night; the UI discloses this.
      checkOut: hotelCheckOut(input.departDate, input.returnDate),
    }),
    searchTrains({
      origin: input.origin,
      destination: input.destination,
      departDate: input.departDate,
      returnDate: input.returnDate,
      cabin: input.trainClass ?? input.cabin,
    }),
    searchCabs({ location: input.destination }),
  ]);

  // Warm the live FX cache before converting candidate prices. If this fails
  // and no sufficiently-fresh prior snapshot exists, convertCurrency will
  // return null downstream and candidates keep their original currency — the
  // UI then discloses that the conversion is unavailable rather than inventing
  // a rate.
  await ensureFx().catch(() => null);

  // One currency for the whole itinerary. A domestic India trip is always INR;
  // other trips are USD. Sources quoting another currency are converted.
  const normFlights = normalizeSearchResult(rawFlights, currency);
  const normHotels = normalizeSearchResult(rawHotels, currency);
  const normTrains = normalizeSearchResult(rawTrains, currency);
  const normCabs = normalizeSearchResult(rawCabs, currency);

  // Rank each category: dedup, validate prices, score by price/duration/policy/
  // reliability/freshness. The ranked candidates keep every original field, so
  // older readers of the itinerary JSON keep working.
  const caps = input.priceCaps ?? {
    flight: null,
    hotel: null,
    train: null,
    cab: null,
  };
  const rankContext = {
    origin: input.origin,
    destination: input.destination,
    originIata: input.originIata ?? undefined,
    destinationIata: input.destinationIata ?? undefined,
    departDate: input.departDate,
    returnDate: input.returnDate,
    tripCurrency: currency,
  };
  const flights = rankCategory(normFlights, {
    category: "flight",
    priceCapForCurrency: caps.flight,
    context: rankContext,
  });
  const hotels = rankCategory(normHotels, {
    category: "hotel",
    priceCapForCurrency: caps.hotel,
    context: rankContext,
  });
  const trains = rankCategory(normTrains, {
    category: "train",
    priceCapForCurrency: caps.train,
    context: rankContext,
  });
  const cabs = rankCategory(normCabs, {
    category: "cab",
    priceCapForCurrency: caps.cab,
    context: rankContext,
  });

  // Strict policy: if every category failed, this is a hard unavailable.
  // Fabricating anything here is forbidden.
  const anyOk = [flights, hotels, trains, cabs].some((r) => r.status === "ok");
  if (!anyOk) {
    const reasons = [flights, hotels, trains, cabs]
      .map((r) => (r.status === "unavailable" ? r.reason : null))
      .filter(Boolean)
      .join(" | ");
    return {
      status: "unavailable",
      retrievedAt,
      reason: reasons || "all search sources returned no results",
    };
  }

  // Phase 5: featured = top-ranked candidate whose direction is not
  // reversed, preferring confirmed origin→destination matches, then
  // priced candidates, then first-ranked. pickFeaturedRanked lives in
  // lib/ranking.ts so the same contract is reused by consumers.
  const featured = {
    flight: pickFeaturedRanked(flights),
    hotel: pickFeaturedRanked(hotels),
    train: pickFeaturedRanked(trains),
    cab: pickFeaturedRanked(cabs),
  };
  const sumFeatured = (
    legs: Array<RankedCandidate | null>,
  ): number | null => {
    let total = 0;
    let anyPriced = false;
    for (const leg of legs) {
      if (!leg) continue;
      if (leg.price == null) return null;
      total += leg.price;
      anyPriced = true;
    }
    return anyPriced ? total : null;
  };
  const estimatedTotal = sumFeatured([featured.flight, featured.hotel]);

  // The LLM rationale is best-effort: real search data already succeeded, so
  // an LLM outage must not discard those real results. We never synthesise
  // a rationale ourselves — if Groq fails we simply return an empty string.
  let rationale = "";
  try {
    rationale = await rationalize(input, featured, estimatedTotal, currency);
  } catch (e) {
    rationale = `(AI rationale unavailable: ${e instanceof Error ? e.message : String(e)})`;
  }
  return {
    status: "ok",
    retrievedAt,
    flights,
    hotels,
    trains,
    cabs,
    estimatedTotal,
    rationale,
    featured,
  };
}

function describeFeatured(c: Candidate | RankedCandidate | null): string {
  if (!c) return "(no result)";
  const price =
    c.price != null
      ? `${formatMoney(c.price, c.currency ?? "USD")} (priceType=${c.priceType})${
          c.originalCurrency && c.originalPrice != null
            ? `, converted from ${c.originalCurrency} ${c.originalPrice}`
            : ""
        }`
      : "price not listed (priceType=unavailable)";
  const ranked = c as Partial<RankedCandidate>;
  const extras: string[] = [];
  if (typeof ranked.rankScore === "number") {
    extras.push(`rank=${ranked.rankScore}`);
  }
  if (ranked.matchConfidence) extras.push(`confidence=${ranked.matchConfidence}`);
  if (ranked.directionMatch) extras.push(`direction=${ranked.directionMatch}`);
  if (ranked.dateMatch) extras.push(`date=${ranked.dateMatch}`);
  if (ranked.reliability) extras.push(`reliability=${ranked.reliability}`);
  if (ranked.freshness) extras.push(`freshness=${ranked.freshness}`);
  if (ranked.durationMinutes != null) {
    extras.push(`durationMin=${ranked.durationMinutes}`);
  }
  const extrasLine = extras.length ? ` — ${extras.join(", ")}` : "";
  return `${c.title} — source: ${c.sourceHostname} — ${price} — availability: ${c.availabilityStatus}${extrasLine} — ${c.sourceUrl}`;
}

async function rationalize(
  input: PlanInput,
  featured: {
    flight: Candidate | null;
    hotel: Candidate | null;
    train: Candidate | null;
    cab: Candidate | null;
  },
  total: number | null,
  currency: string,
): Promise<string> {
  const groq = client();
  const resp = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You are a corporate travel assistant. You are given REAL search results from the public web " +
          "for a corporate trip. Compare the featured options and write a short rationale (<= 110 words). " +
          "Rules: (1) Every claim must be traceable to a source hostname in the input — name the source. " +
          "(2) Never invent prices, flight numbers, hotel names, train numbers or availability. " +
          "If a price is 'price not listed' / priceType=unavailable, say so plainly. " +
          "If availabilityStatus is 'unverified', note it is a search listing, not a confirmed seat. " +
          "(3) Match signals: when `confidence=low`, call out why — `direction=reversed` means the " +
          "snippet reads destination→origin and the result may describe the return leg; " +
          "`date=mismatch` means the snippet names a date outside the trip window. " +
          "If a signal is `unknown`, say the evidence does not confirm it, not that it is wrong. " +
          "(4) Mention any policy concerns the user should know about. (5) No emoji.",
      },
      {
        role: "user",
        content:
          `Trip: ${input.purpose}\n` +
          `Route: ${input.origin} → ${input.destination}\n` +
          `Dates: ${input.departDate.toISOString().slice(0, 10)}${
            input.returnDate
              ? ` to ${input.returnDate.toISOString().slice(0, 10)}`
              : " (one-way, no return date)"
          }\n` +
          `Cabin: ${input.cabin ?? "economy"}\n` +
          `Policy: ${input.policySummary}\n\n` +
          `Featured candidates (from web search):\n` +
          `- Flight: ${describeFeatured(featured.flight)}\n` +
          `- Hotel:  ${describeFeatured(featured.hotel)}\n` +
          `- Train:  ${describeFeatured(featured.train)}\n` +
          `- Cab:    ${describeFeatured(featured.cab)}\n` +
          `Combined estimated total (flight + hotel): ${
            total != null
              ? formatMoney(total, currency)
              : "unavailable (at least one leg had no listed price)"
          }\n`,
      },
    ],
  });
  return textFromResponse(resp);
}

// ─────────────────────── decision engine (compare) ──────────────────────────

export type CompareInput = {
  question: string;
  tripContext: string; // short natural-language trip description
  featured: {
    flight: RankedCandidate | null;
    hotel: RankedCandidate | null;
    train: RankedCandidate | null;
    cab: RankedCandidate | null;
  };
  // Optional per-category summaries for cheapest / most-expensive grounding.
  summaries?: Partial<
    Record<"flight" | "hotel" | "train" | "cab", { line: string }>
  >;
  policySummary: string;
};

export async function compare(input: CompareInput): Promise<string> {
  const groq = client();
  const resp = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are the travel decision engine. Compare the FEATURED options already found " +
          "by real web search. Answer the employee's question concisely (<= 140 words). " +
          "Rules: " +
          "(1) Reason ONLY over the candidates in this prompt — never invent other listings, " +
          "flight numbers, prices, durations or availability. " +
          "(2) When you cite a number or source, name the sourceHostname exactly as given. " +
          "(3) If priceType=unavailable, say 'price not listed' — do not guess. " +
          "(4) If durationMin is missing, say duration is not listed; do not estimate. " +
          "(5) If availabilityStatus=unverified, note the option is a search listing, not a " +
          "confirmed seat. " +
          "(6) Use confidence/direction/date signals: when `confidence=low` or " +
          "`direction=reversed` or `date=mismatch`, state the caveat before quoting the number. " +
          "If a signal is `unknown`, say the evidence is silent, never claim it is wrong. " +
          "(7) Flag any policy violation the user should know about. " +
          "(8) No emoji. End with a one-line bottom line.",
      },
      {
        role: "user",
        content:
          `Question: ${input.question}\n` +
          `${input.tripContext}\n` +
          `Policy: ${input.policySummary}\n\n` +
          `Featured candidates (ranked):\n` +
          `- Flight: ${describeFeatured(input.featured.flight)}\n` +
          `- Hotel:  ${describeFeatured(input.featured.hotel)}\n` +
          `- Train:  ${describeFeatured(input.featured.train)}\n` +
          `- Cab:    ${describeFeatured(input.featured.cab)}\n\n` +
          `Category summaries (cheapest, counts, stale):\n` +
          `- Flights: ${input.summaries?.flight?.line ?? "(not available)"}\n` +
          `- Hotels:  ${input.summaries?.hotel?.line ?? "(not available)"}\n` +
          `- Trains:  ${input.summaries?.train?.line ?? "(not available)"}\n` +
          `- Cabs:    ${input.summaries?.cab?.line ?? "(not available)"}\n`,
      },
    ],
  });
  return textFromResponse(resp);
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function chat(context: string, messages: ChatMessage[]): Promise<string> {
  const groq = client();
  const resp = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 800,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "You are a corporate travel assistant helping an employee refine a trip. " +
          "Only reason over information already in the trip context — never invent flight numbers, " +
          "hotel names, train numbers, prices or availability. If the user asks for specific numbers " +
          "that aren't in the context, say they'll need a fresh search. You can explain policy " +
          "violations in plain language and suggest changes to dates, route, or cabin. Keep answers " +
          "concise (<= 120 words). The current trip context is:\n" +
          context,
      },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });
  return textFromResponse(resp);
}

export type ExtractedTripFields = {
  purpose?: string;
  origin?: string;
  destination?: string;
  departDate?: string; // YYYY-MM-DD
  returnDate?: string;
};

export async function extractTripFields(
  freeform: string,
  defaultOrigin: string,
): Promise<ExtractedTripFields> {
  const groq = client();
  const today = new Date().toISOString().slice(0, 10);
  const resp = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0,
    tools: [
      {
        type: "function",
        function: {
          name: "set_trip_fields",
          description:
            "Record extracted trip fields. Use ISO YYYY-MM-DD for dates. If origin is not stated, use the given default.",
          parameters: {
            type: "object",
            required: ["destination", "departDate"],
            properties: {
              purpose: { type: "string" },
              origin: { type: "string" },
              destination: { type: "string" },
              departDate: { type: "string", description: "YYYY-MM-DD" },
              returnDate: {
                type: "string",
                description: "YYYY-MM-DD, or omit for a one-way trip",
              },
            },
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "set_trip_fields" } },
    messages: [
      {
        role: "system",
        content: `You extract corporate-travel fields from short employee messages. Today is ${today}. Default origin: ${defaultOrigin}.`,
      },
      { role: "user", content: freeform },
    ],
  });

  const toolCall = resp.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function?.name !== "set_trip_fields") return {};
  try {
    return JSON.parse(toolCall.function.arguments) as ExtractedTripFields;
  } catch {
    return {};
  }
}
