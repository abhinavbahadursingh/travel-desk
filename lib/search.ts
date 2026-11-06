// Real-time travel search over the public web.
//
// v2.c: Tavily is the primary search provider. Google Maps Routes API is an
// optional second provider for cabs (distance + duration only — never a
// fabricated fare). The previous DuckDuckGo HTML endpoint has been removed.
//
// STRICT DATA POLICY:
//   - No mock inventory, no fabricated prices, no simulated availability.
//   - Every candidate carries its source hostname and retrieval timestamp.
//   - Prices are only reported when parsed from the source snippet; otherwise
//     `price` is null and `priceType` is "unavailable" — never guessed.
//   - If a provider is unreachable or returns no usable results, the function
//     returns { status: "unavailable" } with the reason so the caller can
//     surface it. No fallback to mock data.
//
// To swap Tavily for Brave/Bing/SerpAPI later, implement another `*Search`
// function and route it in `runWebSearch`. The exported shapes are the contract.

import { ensureFx, isDomesticIndia, looksIndian, normalizeMoney } from "./currency";
import { rankCategory, type RankedResult } from "./ranking";
import { extract, looksLikeDestinationGuide, type Structured } from "./extraction";

export type Category = "flight" | "hotel" | "train" | "cab";

// Price classifications (Issue 6a):
//   listed      — price appeared in a search listing / snippet
//   indicative  — source explicitly calls the price indicative ("from", "starting at",
//                 "approx", "average"), or the price was converted into the trip
//                 currency from another currency (the amount is now a display
//                 estimate, not the source quote)
//   verified    — independently confirmed by an authorised provider
//                 (a travel-admin confirmation reference, never from Tavily)
//   unavailable — no reliable price
export type PriceType = "listed" | "indicative" | "verified" | "unavailable";

// Availability classifications (Issue 6b):
//   unverified           — status from a search listing; not a provider confirmation
//   available_verified   — confirmed available by an authorised provider
//   unavailable_verified — confirmed unavailable by an authorised provider
export type AvailabilityStatus =
  | "unverified"
  | "available_verified"
  | "unavailable_verified";

// Legacy price/availability vocabulary that may still exist inside stored
// itinerary JSON blobs. These are mapped to the current vocabulary at read
// time (see normalizePriceType / normalizeAvailabilityStatus); no row is ever
// rewritten.
const LEGACY_PRICE_TYPES: Record<string, PriceType> = {
  listed: "listed",
  estimate: "indicative", // "estimate" was the old name for a converted price
  quote: "indicative",
  indicative: "indicative",
  verified: "verified",
  unavailable: "unavailable",
};
const LEGACY_AVAILABILITY: Record<string, AvailabilityStatus> = {
  listed: "unverified",
  unverified: "unverified",
  unavailable: "unavailable_verified",
  available_verified: "available_verified",
  unavailable_verified: "unavailable_verified",
};
export function normalizePriceType(value: string | null | undefined): PriceType {
  if (!value) return "unavailable";
  return LEGACY_PRICE_TYPES[value] ?? "unavailable";
}
export function normalizeAvailabilityStatus(
  value: string | null | undefined,
): AvailabilityStatus {
  if (!value) return "unverified";
  return LEGACY_AVAILABILITY[value] ?? "unverified";
}

export type Candidate = {
  // v2.c canonical shape
  title: string;
  category: Category;
  source: string;
  sourceUrl: string;
  sourceHostname: string;
  description: string;
  price: number | null;
  currency: string | null;
  priceType: PriceType;
  retrievedAt: string;
  availabilityStatus: AvailabilityStatus;

  // Set when a price was converted into the trip currency. Kept so the UI can
  // disclose that the amount is a display estimate rather than the source quote.
  originalPrice?: number | null;
  originalCurrency?: string | null;

  // True when the parsed price looks suspicious for the currency (e.g.
  // a ₹70,903 one-leg domestic fare where the typical range is ₹5k–₹30k).
  // The UI badges this instead of silently discarding the number.
  priceSuspicious?: boolean;

  // Structured fields parsed from the source title/snippet. Present on every
  // Tavily-derived candidate (the Google Maps cab path leaves it undefined).
  // The field is purely additive — older itinerary JSON blobs without it
  // continue to render.
  structured?: Structured;

  // Signal to the ranker that this hit clearly doesn't belong (e.g. it's a
  // destination guide, not a bookable option). Rejected candidates are
  // dropped from the final output but the reason is surfaced in the summary.
  prefilterReject?: "destination_guide" | "empty_snippet";

  // backward-compatibility aliases: downstream (book route, UI, Slack) still
  // reads these names. Keep them in lock-step with the canonical fields.
  kind: Category;
  url: string;
  provider: string;
  snippet: string;
  estimatedPrice: number | null;
  confidence: "estimate";
};

export type SearchResult =
  | {
      status: "ok";
      candidates: Candidate[];
      retrievedAt: string;
      provider: string;
    }
  | {
      status: "unavailable";
      reason: string;
      retrievedAt: string;
      provider: string;
    };

type Hit = {
  title: string;
  url: string;
  content: string;
};

const HTTP_TIMEOUT_MS = 10_000;
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const ROUTES_ENDPOINT =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// Simple heuristic for "indicative" language in a snippet: "from $X", "starting
// at X", "approx X", "average X", "prices from". When any of these words
// surround the parsed price, the price is classified as `indicative` instead
// of `listed`. Tavily never produces a `verified` price.
const INDICATIVE_HINT =
  /\b(?:from|starting(?:\s+at|\s+from)?|starts?\s+at|prices?\s+from|approx(?:\.|imately)?|about|around|avg|average|typically|up\s+to|as\s+low\s+as)\b/i;

function classifyPriceFromSnippet(text: string): "listed" | "indicative" {
  return INDICATIVE_HINT.test(text) ? "indicative" : "listed";
}

// Words that signal the number next to the currency symbol is a *discount* or
// *savings*, not the actual fare. Parsing stops on those so a snippet like
// "Save ₹500 on flights from ₹6,404" doesn't surface ₹500 as the price.
const PROMO_PRECEDES =
  /\b(?:save|discount|off|cashback|coupon|promo|offer|deal|up\s+to|flat)\s*(?:of|up\s+to)?\s*$/i;
const PROMO_FOLLOWS = /^\s*(?:off|discount|savings?|cashback|coupon)\b/i;

// Flags rare but possible: a "Business Class ₹1,20,000" that we still accept
// (just unusual). `null` keeps the rule: never invent or reject a listed
// number silently; surface it to the caller for disclosure.
function parsePrice(text: string): {
  price: number;
  currency: string;
  suspicious: boolean;
} | null {
  // Find ALL candidate prices in the text, then pick the first one that
  // isn't labelled as a promo / savings figure. This stops a leading
  // "Save ₹500 …" from overriding the real fare that appears later.
  const re =
    /(\$|€|£|¥|₹|USD|EUR|GBP|INR|JPY|AUD|CAD|Rs\.?)\s?([0-9][0-9,]{0,9}(?:\.\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[2].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) continue;
    // Skip prices that look like years ("1999" alone), phone numbers (too
    // many digits), or obvious promo deltas.
    if (n > 100_000_000) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (PROMO_PRECEDES.test(before) || PROMO_FOLLOWS.test(after)) continue;

    const symbol = m[1].toUpperCase();
    const currency =
      symbol === "$"
        ? "USD"
        : symbol === "€"
          ? "EUR"
          : symbol === "£"
            ? "GBP"
            : symbol === "¥"
              ? "JPY"
              : symbol === "₹" || symbol.startsWith("RS")
                ? "INR"
                : symbol;
    // Flag suspiciously high fares (10x the usual range in that currency) so
    // the UI can warn, without silently discarding them.
    const highThreshold =
      currency === "INR"
        ? 500_000 // ₹5 lakh = highest reasonable one-leg
        : currency === "JPY"
          ? 2_000_000
          : 10_000;
    return { price: n, currency, suspicious: n > highThreshold };
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Tavily call with one retry on network / 5xx.
async function tavilySearch(opts: {
  query: string;
  includeDomains?: string[];
  maxResults?: number;
}): Promise<Hit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");

  const body = JSON.stringify({
    api_key: key,
    query: opts.query,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
    max_results: opts.maxResults ?? 8,
    ...(opts.includeDomains?.length
      ? { include_domains: opts.includeDomains }
      : {}),
  });

  const attempt = async (): Promise<Response> =>
    fetchWithTimeout(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
    });

  let res: Response;
  try {
    res = await attempt();
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 400));
      res = await attempt();
    }
  } catch (e) {
    // Network / abort — retry once.
    await new Promise((r) => setTimeout(r, 400));
    res = await attempt();
    void e;
  }
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const results = Array.isArray(json.results) ? json.results : [];
  return results
    .filter((r) => typeof r.url === "string" && r.url.startsWith("http"))
    .map((r) => ({
      title: (r.title ?? "").trim(),
      url: r.url as string,
      content: (r.content ?? "").trim(),
    }));
}

// Exported for the dedup + price regression tests. Not part of the public
// surface the app relies on; keep the private semantics.
export { parsePrice as __parsePriceForTests, dedupeFlights as __dedupeFlightsForTests };

// Dedupe key for a parsed flight candidate. We never collapse two flights
// just because they share airline+route — different flight numbers, different
// departure times, and absent identity all stay separate so the user doesn't
// accidentally pick an aggregated row that isn't a real option.
function flightDedupKey(c: Candidate): string | null {
  if (c.category !== "flight" || c.structured?.category !== "flight") return null;
  const s = c.structured;
  const airline = (s.airline ?? "").toLowerCase();
  if (s.flightNumber && airline) {
    return `fn:${airline}:${s.flightNumber.toLowerCase()}`;
  }
  // No flight number — identity needs airline + route + a departure stamp.
  if (airline && s.originIata && s.destinationIata) {
    const stamp = s.departureTime ?? s.departureDate ?? "any";
    return `rt:${airline}:${s.originIata}:${s.destinationIata}:${stamp}`;
  }
  return null; // ambiguous — keep the row by itself
}

// Count how many optional comparison fields a flight candidate actually
// resolved. Used to pick the richer of two duplicates and to keep the
// lower price once the identity confirms they are the same leg.
function flightInfoScore(c: Candidate): number {
  if (c.structured?.category !== "flight") return 0;
  const s = c.structured;
  let score = 0;
  if (s.airline) score += 1;
  if (s.flightNumber) score += 2;
  if (s.originIata) score += 1;
  if (s.destinationIata) score += 1;
  if (s.departureTime) score += 1;
  if (s.arrivalTime) score += 1;
  if (s.durationMinutes != null) score += 1;
  if (s.stops != null) score += 1;
  if (s.cabin) score += 1;
  if (s.baggageAllowance) score += 1;
  if (c.price != null) score += 2;
  return score;
}

function dedupeFlights(candidates: Candidate[]): Candidate[] {
  const bucket = new Map<string, Candidate>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = flightDedupKey(c);
    if (!key) {
      out.push(c);
      continue;
    }
    const prior = bucket.get(key);
    if (!prior) {
      bucket.set(key, c);
      continue;
    }
    const priorScore = flightInfoScore(prior);
    const score = flightInfoScore(c);
    const richer = score > priorScore ? c : prior;
    // Always keep the lower listed price if both have one, so dedup never
    // hides a cheaper fare behind a richer-but-dearer twin.
    const price =
      prior.price != null && c.price != null
        ? Math.min(prior.price, c.price)
        : prior.price ?? c.price ?? null;
    bucket.set(key, { ...richer, price, estimatedPrice: price });
  }
  return [...bucket.values(), ...out];
}

function toCandidates(category: Category, hits: Hit[]): Candidate[] {
  const retrievedAt = new Date().toISOString();
  const list: Candidate[] = hits.map((h) => {
    const snippet = `${h.title} ${h.content}`;
    const p = parsePrice(snippet);
    const host = hostnameOf(h.url);
    const price = p?.price ?? null;
    const currency = p?.currency ?? null;
    // Tavily snippets never carry provider-verified data, so priceType stays
    // in {listed, indicative, unavailable}. `verified` is only ever set by a
    // travel-admin confirmation downstream (never from search results).
    const priceType: PriceType =
      price != null ? classifyPriceFromSnippet(snippet) : "unavailable";
    const availabilityStatus: AvailabilityStatus = "unverified";
    const extractionInput = {
      title: h.title,
      description: h.content,
      url: h.url,
      sourceHostname: host,
    };
    const structured = extract(category, extractionInput);
    let prefilterReject: Candidate["prefilterReject"];
    if (!h.title && !h.content) {
      prefilterReject = "empty_snippet";
    } else if (looksLikeDestinationGuide(extractionInput)) {
      prefilterReject = "destination_guide";
    }
    return {
      // canonical
      title: h.title || host,
      category,
      source: host,
      sourceUrl: h.url,
      sourceHostname: host,
      description: h.content,
      price,
      currency,
      priceType,
      retrievedAt,
      availabilityStatus,
      structured,
      prefilterReject,
      priceSuspicious: p?.suspicious ?? false,
      // compat aliases
      kind: category,
      url: h.url,
      provider: host,
      snippet: h.content,
      estimatedPrice: price,
      confidence: "estimate",
    };
  });
  // Flights come from several aggregators (ixigo, kayak, makemytrip…) that
  // often list the same leg. Collapse them by (airline, flight number) or
  // (airline, route, departure time) so the Flight Selection step doesn't
  // show "IndiGo HDO → BOM" four times with slightly different prices.
  // Hotels, trains and cabs keep the stable Tavily ordering.
  return category === "flight" ? dedupeFlights(list) : list;
}

async function runWebSearch(
  category: Category,
  query: string,
  includeDomains?: string[],
): Promise<SearchResult> {
  const retrievedAt = new Date().toISOString();
  const providerName = "tavily";
  try {
    const hits = await tavilySearch({ query, includeDomains });
    if (hits.length === 0) {
      return {
        status: "unavailable",
        reason: "search returned zero results",
        retrievedAt,
        provider: providerName,
      };
    }
    return {
      status: "ok",
      candidates: toCandidates(category, hits),
      retrievedAt,
      provider: providerName,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "unavailable",
      reason: msg,
      retrievedAt,
      provider: providerName,
    };
  }
}

function isoDay(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

// Convert every priced candidate into the trip currency. This keeps the UI,
// totals and policy checks in one currency even when a source quotes another.
export function normalizeSearchResult(
  result: SearchResult,
  currency: string,
): SearchResult {
  if (result.status !== "ok") return result;
  return {
    ...result,
    candidates: result.candidates.map((c) => {
      if (c.price == null) return c;
      const money = normalizeMoney(c.price, c.currency, currency);
      if (!money.converted) {
        // Either the source already matched the trip currency, or the FX
        // lookup failed and we preserved the original currency. Either way,
        // keep priceType as-is (listed / indicative / unavailable).
        return { ...c, currency: money.currency ?? c.currency };
      }
      // Converted into the trip currency via live FX. The amount is now a
      // display estimate, not the source's own quote — tag it indicative so
      // the UI discloses the conversion. Preserve the ORIGINAL price and
      // currency so nothing is lost.
      return {
        ...c,
        price: money.amount,
        estimatedPrice: money.amount,
        currency: money.currency,
        priceType: "indicative",
        originalPrice: c.price,
        originalCurrency: c.currency,
      };
    }),
  };
}

// ─────────────────────────── Category entry points ───────────────────────────

export type FlightQuery = {
  origin: string;
  destination: string;
  departDate: Date | string;
  returnDate?: Date | string | null; // absent/null = one-way
  cabin?: string;
  // Phase 5: passenger count surfaced in the query so providers know this
  // is not a group trip. Defaults to 1 for the corporate traveller.
  passengers?: number;
};
export async function searchFlights(q: FlightQuery): Promise<SearchResult> {
  const cabin = q.cabin ? ` ${q.cabin.replace("_", " ")} cabin` : "";
  const currency = isDomesticIndia(q.origin, q.destination) ? "INR" : "USD";
  const tripType = q.returnDate ? "round-trip" : "one-way";
  const ret = q.returnDate ? ` returning ${isoDay(q.returnDate)}` : "";
  const pax = `${q.passengers ?? 1} adult`;
  const query =
    `cheapest ${tripType} flights from ${q.origin} to ${q.destination} ` +
    `departing ${isoDay(q.departDate)}${ret}${cabin} for ${pax} price in ${currency}`;
  const includeDomains = [
    "kayak.com",
    "google.com",
    "skyscanner.com",
    "expedia.com",
    "booking.com",
    "momondo.com",
    "cheapflights.com",
    ...(looksIndian(q.origin) || looksIndian(q.destination)
      ? ["makemytrip.com", "cleartrip.com", "ixigo.com", "goibibo.com"]
      : []),
  ];
  return runWebSearch("flight", query, includeDomains);
}

export type HotelQuery = {
  destination: string;
  checkIn: Date | string;
  checkOut: Date | string;
  guests?: number;
  rooms?: number;
};
export async function searchHotels(q: HotelQuery): Promise<SearchResult> {
  const currency = looksIndian(q.destination) ? "INR" : "USD";
  const guests = q.guests ?? 1;
  const rooms = q.rooms ?? 1;
  const query =
    `hotels in ${q.destination} check-in ${isoDay(q.checkIn)} ` +
    `check-out ${isoDay(q.checkOut)} ${guests} guest ${rooms} room ` +
    `price per night in ${currency} rating`;
  const includeDomains = [
    "booking.com",
    "hotels.com",
    "expedia.com",
    "tripadvisor.com",
    "agoda.com",
    "trivago.com",
    "marriott.com",
    "hilton.com",
    "ihg.com",
    "hyatt.com",
    ...(looksIndian(q.destination)
      ? ["makemytrip.com", "goibibo.com", "oyorooms.com", "cleartrip.com"]
      : []),
  ];
  return runWebSearch("hotel", query, includeDomains);
}

export type TrainQuery = {
  origin: string;
  destination: string;
  departDate: Date | string;
  returnDate?: Date | string | null; // absent/null = one-way
  cabin?: string;
};
export async function searchTrains(q: TrainQuery): Promise<SearchResult> {
  const cabin = q.cabin ? ` ${q.cabin.replace("_", " ")} class` : "";
  const ret = q.returnDate ? ` returning ${isoDay(q.returnDate)}` : "";
  const currency = isDomesticIndia(q.origin, q.destination) ? "INR" : "USD";
  const query =
    `trains from ${q.origin} to ${q.destination} ${isoDay(q.departDate)}${ret}${cabin} schedule train number fare in ${currency}`;
  // Prioritise Indian railway sources, then fall back to international rail sites.
  const indian = [
    "irctc.co.in",
    "indianrail.gov.in",
    "trainman.in",
    "ixigo.com",
    "confirmtkt.com",
    "makemytrip.com",
    "erail.in",
    "railyatri.in",
  ];
  const intl = [
    "thetrainline.com",
    "trainline.com",
    "raileurope.com",
    "amtrak.com",
    "sncf-connect.com",
    "bahn.com",
    "jrailpass.com",
  ];
  const includeDomains =
    looksIndian(q.origin) || looksIndian(q.destination)
      ? [...indian, ...intl]
      : [...intl, ...indian];
  return runWebSearch("train", query, includeDomains);
}

// Cabs — Google Maps Routes API for real distance + duration if a key is set.
// Otherwise fall back to Tavily on ride-hailing provider domains. We NEVER
// fabricate a fare.
export type CabQuery = {
  location: string;
  from?: string;
  to?: string;
};
export async function searchCabs(q: CabQuery): Promise<SearchResult> {
  const from = q.from ?? `${q.location} airport`;
  const to = q.to ?? `${q.location} city center`;
  const retrievedAt = new Date().toISOString();

  if (process.env.GOOGLE_MAPS_API_KEY) {
    const route = await fetchGoogleRoute(from, to).catch(
      (e: unknown) =>
        ({ status: "unavailable" as const, reason: e instanceof Error ? e.message : String(e) }) as const,
    );
    if (route.status === "ok") {
      const km = (route.distanceMeters / 1000).toFixed(1);
      const minutes = Math.round(route.durationSeconds / 60);
      const title = `${from} → ${to} · ${km} km · ~${minutes} min drive`;
      const mapsUrl =
        `https://www.google.com/maps/dir/?api=1` +
        `&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;
      const host = "google.com/maps";
      const c: Candidate = {
        title,
        category: "cab",
        source: host,
        sourceUrl: mapsUrl,
        sourceHostname: host,
        description:
          `Real route from Google Maps. Distance ${km} km, driving time ~${minutes} min. ` +
          `Fare is not fabricated — open Uber/Lyft/Ola to get a quote.`,
        price: null,
        currency: null,
        // Google Maps gives distance/duration, never a fare. Price stays
        // unavailable; availability is unverified for the same reason — the
        // route exists, but seat/ride availability is not confirmed.
        priceType: "unavailable",
        retrievedAt,
        availabilityStatus: "unverified",
        kind: "cab",
        url: mapsUrl,
        provider: host,
        snippet: title,
        estimatedPrice: null,
        confidence: "estimate",
      };
      return {
        status: "ok",
        candidates: [c],
        retrievedAt,
        provider: "google_maps_routes",
      };
    }
    // fall through to Tavily if Google Maps failed
  }

  const query =
    `ride-hailing or taxi from ${from} to ${to} pricing in ${
      looksIndian(q.location) ? "INR" : "USD"
    } book`;
  const includeDomains = [
    "uber.com",
    "lyft.com",
    "ola.com",
    "olacabs.com",
    "bolt.eu",
    "freenow.com",
    "grab.com",
    "didiglobal.com",
    "rapido.bike",
    "meru.in",
  ];
  const r = await runWebSearch("cab", query, includeDomains);
  // Post-process: cab snippets almost never have real fares; keep priceType
  // honest even if the regex glanced at some phone number.
  if (r.status === "ok") {
    r.candidates = r.candidates.map((c) => {
      if (c.price == null) return c;
      // Plausible fare magnitudes differ by currency. Never trust a phone
      // number or an annual salary that the regex happened to catch.
      const isInr = c.currency === "INR";
      const min = isInr ? 50 : 5;
      const max = isInr ? 50_000 : 500;
      return c.price < min || c.price > max
        ? {
            ...c,
            price: null,
            estimatedPrice: null,
            currency: null,
            priceType: "unavailable" as const,
          }
        : c;
    });
  }
  return r;
}

async function fetchGoogleRoute(
  from: string,
  to: string,
): Promise<
  | { status: "ok"; distanceMeters: number; durationSeconds: number }
  | { status: "unavailable"; reason: string }
> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { status: "unavailable", reason: "no GOOGLE_MAPS_API_KEY" };
  try {
    const res = await fetchWithTimeout(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { address: from },
        destination: { address: to },
        travelMode: "DRIVE",
      }),
    });
    if (!res.ok) {
      return { status: "unavailable", reason: `Google Maps HTTP ${res.status}` };
    }
    const j = (await res.json()) as {
      routes?: Array<{ distanceMeters?: number; duration?: string }>;
    };
    const r0 = j.routes?.[0];
    if (!r0?.distanceMeters || !r0?.duration) {
      return { status: "unavailable", reason: "no route found" };
    }
    // duration comes as "1234s"
    const seconds = Number(String(r0.duration).replace(/s$/, ""));
    if (!Number.isFinite(seconds)) {
      return { status: "unavailable", reason: "unparseable duration" };
    }
    return {
      status: "ok",
      distanceMeters: r0.distanceMeters,
      durationSeconds: seconds,
    };
  } catch (e) {
    return {
      status: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export function pickFeatured(
  result: SearchResult,
  preferMatching?: string,
  options?: { origin?: string; destination?: string },
): Candidate | null {
  if (result.status !== "ok" || result.candidates.length === 0) return null;
  const match = preferMatching?.toLowerCase().trim();
  const o = options?.origin?.toLowerCase().trim();
  const d = options?.destination?.toLowerCase().trim();
  const text = (c: Candidate) => `${c.title} ${c.description}`.toLowerCase();
  const mentions = (c: Candidate) => (match ? text(c).includes(match) : true);
  // Direction heuristic without pulling in the ranking module: both tokens
  // must appear and in origin→destination order.
  const directionOk = (c: Candidate): boolean => {
    if (!o || !d) return true; // no context → don't filter
    const s = text(c);
    const oi = s.indexOf(o);
    const di = s.indexOf(d);
    if (oi === -1 || di === -1) return true; // can't tell — include
    return oi < di;
  };
  // Priority: direction-ok + on-topic + priced, then direction-ok + on-topic,
  // then direction-ok + priced, then anything matching, then first result.
  return (
    result.candidates.find((c) => directionOk(c) && mentions(c) && c.price != null) ??
    result.candidates.find((c) => directionOk(c) && mentions(c)) ??
    result.candidates.find((c) => directionOk(c) && c.price != null) ??
    result.candidates.find((c) => directionOk(c)) ??
    result.candidates.find((c) => mentions(c)) ??
    result.candidates[0]
  );
}

export function sumFeaturedEstimates(results: SearchResult[]): number | null {
  // null when any featured leg lacks a price among the ok results — honest
  // "we don't know the total" instead of pretending it's zero.
  let total = 0;
  let anyPriced = false;
  for (const r of results) {
    if (r.status !== "ok") continue;
    const f = pickFeatured(r);
    if (!f) continue;
    if (f.price == null) return null;
    total += f.price;
    anyPriced = true;
  }
  return anyPriced ? total : null;
}
