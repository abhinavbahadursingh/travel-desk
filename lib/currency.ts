// Currency rules for the travel agent.
//
// Domestic India trips are always priced in INR. Every other trip is priced
// in USD. Search results may come back in a different currency (a global site
// quoting USD for an Indian route, for example), so prices are converted to
// the trip currency for display and policy checks.
//
// The conversion rate is a display estimate, not a live FX quote. Override it
// with INR_PER_USD if needed. Converted candidates keep their original amount
// and currency so the UI can disclose the conversion.

export type Currency = "INR" | "USD";

const INDIA_CITY_HINTS = [
  "india",
  "mumbai",
  "bombay",
  "delhi",
  "new delhi",
  "bengaluru",
  "bangalore",
  "chennai",
  "madras",
  "kolkata",
  "calcutta",
  "hyderabad",
  "pune",
  "ahmedabad",
  "jaipur",
  "kochi",
  "cochin",
  "goa",
  "lucknow",
  "surat",
  "kanpur",
  "nagpur",
  "indore",
  "patna",
  "bhopal",
  "visakhapatnam",
  "vijayawada",
  "chandigarh",
  "mysore",
  "mysuru",
  "coimbatore",
  "trivandrum",
  "thiruvananthapuram",
  "guwahati",
  "noida",
  "gurugram",
  "gurgaon",
  "faridabad",
  "ghaziabad",
  "agra",
  "varanasi",
  "amritsar",
  "jodhpur",
  "udaipur",
  "dehradun",
  "ranchi",
  "raipur",
  "bhubaneswar",
  "madurai",
  "tiruchirappalli",
  "trichy",
  "salem",
  "mangalore",
  "mangaluru",
  "hubli",
  "belgaum",
  "nashik",
  "aurangabad",
  "kolhapur",
  "srinagar",
  "jammu",
  "leh",
  "shimla",
  "manali",
  "darjeeling",
  "gangtok",
  "shillong",
  "imphal",
  "aizawl",
  "kohima",
  "itanagar",
  "agartala",
  "silchar",
  "dibrugarh",
  "jamshedpur",
  "dhanbad",
  "bokaro",
  "gwalior",
  "jabalpur",
  "ujjain",
  "ajmer",
  "bikaner",
  "alwar",
  "haridwar",
  "rishikesh",
  "nainital",
  "puducherry",
  "pondicherry",
  "warangal",
  "tirupati",
];

// IATA codes for Indian airports. Matched as whole tokens, never substrings.
const INDIA_AIRPORT_CODES = new Set([
  "DEL",
  "BOM",
  "BLR",
  "MAA",
  "HYD",
  "CCU",
  "COK",
  "GOI",
  "AMD",
  "PNQ",
  "JAI",
  "LKO",
  "IXC",
  "TRV",
  "GAU",
  "PAT",
  "BBI",
  "IDR",
  "NAG",
  "VNS",
  "SXR",
  "IXB",
  "IXR",
  "RPR",
  "UDR",
  "JDH",
  "KNU",
  "ATQ",
  "CJB",
  "TRZ",
  "IXM",
  "VTZ",
  "TIR",
  "HBX",
  "KLH",
  "SAG",
  "NDC",
  "PNY",
  "RJA",
  "TCR",
  "AGX",
  "AGY",
  "IXA",
  "IXD",
  "IXE",
  "IXG",
  "IXH",
  "IXJ",
  "IXK",
  "IXL",
  "IXN",
  "IXP",
  "IXQ",
  "IXS",
  "IXT",
  "IXU",
  "IXW",
  "IXY",
  "IXZ",
  "JGB",
  "JLR",
  "JRH",
  "KBK",
  "KJB",
  "KKB",
  "KQH",
  "KUU",
  "LDA",
  "LDH",
  "LTU",
  "MOH",
  "MYQ",
  "NMB",
  "OMN",
  "PAB",
  "PBD",
  "PGH",
  "PUT",
  "PYB",
  "RJI",
  "RRK",
  "RTC",
  "SXV",
  "TEZ",
  "TJV",
  "TNI",
  "VGA",
  "WGC",
  "ZER",
]);

function normalizePlace(place: string): string {
  return place
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function looksIndian(place: string): boolean {
  const text = normalizePlace(place);
  if (!text) return false;
  if (INDIA_CITY_HINTS.some((hint) => new RegExp(`\\b${hint}\\b`).test(text))) {
    return true;
  }
  const tokens = place
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => INDIA_AIRPORT_CODES.has(token));
}

export function isDomesticIndia(origin: string, destination: string): boolean {
  return looksIndian(origin) && looksIndian(destination);
}

export function tripCurrency(origin: string, destination: string): Currency {
  return isDomesticIndia(origin, destination) ? "INR" : "USD";
}

export function inrPerUsd(): number {
  const raw = Number(process.env.INR_PER_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 83;
}

// ───────────────── live FX (open.er-api.com) with cache ─────────────────────
//
// Live rates only. The previous hardcoded fallback table was removed: a static
// fallback is a stealth fabrication, because the UI would show a converted
// amount with no way for the caller to know the rate is weeks out of date. If
// the live fetch fails AND we have no sufficiently-fresh prior cache, every
// consumer is told conversion is unavailable, and the original currency is
// preserved end to end. Nothing is fabricated; `normalizeMoney` carries the
// `converted` flag and a retrieval timestamp so the UI can disclose when and
// from where a rate came.

const LIVE_FX_ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6h — "fresh" window
// Hard staleness ceiling: we refuse a cache older than this even when a live
// fetch fails. Prevents "silent stale rates" after the server has been running
// for a long time without a successful refresh.
const FX_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const FX_TIMEOUT_MS = 4_000;

export type FxSnapshot = {
  ratesPerUsd: Record<string, number>; // units per 1 USD
  fetchedAt: number;
  source: "live";
};

let fxCache: FxSnapshot | null = null;
let fxInflight: Promise<FxSnapshot | null> | null = null;

async function fetchLiveFx(): Promise<FxSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
  try {
    const res = await fetch(LIVE_FX_ENDPOINT, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
    };
    if (json.result !== "success" || json.base_code !== "USD" || !json.rates) {
      throw new Error("FX payload malformed");
    }
    const ratesPerUsd: Record<string, number> = {};
    for (const [code, rate] of Object.entries(json.rates)) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        ratesPerUsd[code] = rate;
      }
    }
    return { ratesPerUsd, fetchedAt: Date.now(), source: "live" };
  } finally {
    clearTimeout(timer);
  }
}

// Returns a fresh cache, or a cache up to FX_MAX_AGE_MS old if the live call
// fails. Returns null when there is no usable snapshot at all — callers must
// treat conversion as unavailable (preserve the original currency, flag the UI).
export async function ensureFx(): Promise<FxSnapshot | null> {
  const freshEnough =
    fxCache && Date.now() - fxCache.fetchedAt < FX_TTL_MS ? fxCache : null;
  if (freshEnough) return freshEnough;
  if (fxInflight) return fxInflight;
  fxInflight = (async () => {
    try {
      const live = await fetchLiveFx();
      fxCache = live;
      return live;
    } catch {
      // No live rate. Serve a prior cache only while it is still within the
      // hard staleness ceiling; otherwise return null so the caller can tell
      // the user the rate is unavailable instead of silently using stale data.
      if (fxCache && Date.now() - fxCache.fetchedAt < FX_MAX_AGE_MS) return fxCache;
      return null;
    } finally {
      fxInflight = null;
    }
  })();
  return fxInflight;
}

// Synchronous reader used by convertCurrency / normalizeMoney. Returns the
// cached rates only while within the hard staleness ceiling, else null.
function currentFx(): FxSnapshot | null {
  if (!fxCache) return null;
  if (Date.now() - fxCache.fetchedAt >= FX_MAX_AGE_MS) return null;
  return fxCache;
}

function rateToUsd(currency: string): number | null {
  const code = (currency ?? "USD").toUpperCase();
  if (code === "USD") return 1;
  const fx = currentFx();
  if (!fx) return null;
  const perUsd = fx.ratesPerUsd[code];
  if (!perUsd || !Number.isFinite(perUsd) || perUsd <= 0) return null;
  return 1 / perUsd;
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
): number | null {
  if (!Number.isFinite(amount)) return null;
  const f = (from ?? "USD").toUpperCase();
  const t = (to ?? "USD").toUpperCase();
  if (f === t) return amount;
  const fromRate = rateToUsd(f);
  const toRate = rateToUsd(t);
  if (fromRate == null || toRate == null) return null;
  return Math.round((amount * fromRate) / toRate);
}

export type NormalizedMoney = {
  amount: number | null;
  currency: string | null;
  converted: boolean;
  // Only "live" now. Kept in the shape for backward compatibility with stored
  // itinerary JSON blobs that may still mention "fallback".
  rateSource?: "live";
  fetchedAt?: string;
};

export function normalizeMoney(
  amount: number | null,
  from: string | null,
  to: string,
): NormalizedMoney {
  if (amount == null) return { amount: null, currency: null, converted: false };
  const source = (from ?? to).toUpperCase();
  const target = to.toUpperCase();
  if (source === target) return { amount, currency: target, converted: false };
  const converted = convertCurrency(amount, source, target);
  if (converted == null) {
    // No usable live rate — preserve the original amount and currency rather
    // than inventing a conversion. The UI surfaces the original currency.
    return { amount, currency: source, converted: false };
  }
  const fx = currentFx();
  // fx is non-null here: convertCurrency returned a number, which requires a
  // usable rate. Still guard so the types line up and a race cannot deref null.
  if (!fx) return { amount, currency: source, converted: false };
  return {
    amount: converted,
    currency: target,
    converted: true,
    rateSource: fx.source,
    fetchedAt: new Date(fx.fetchedAt).toISOString(),
  };
}

// Standard message used everywhere a trip's total is unknown, so the UI never
// renders a fabricated zero. See AGENTS.md "No mock data".
export const UNKNOWN_COST_MESSAGE =
  "Total cost unavailable — some prices are missing.";

// Decide whether a trip's stored estimate is actually known. Returns the
// numeric amount only when the estimate is marked complete AND the stored
// value is a finite, non-null number. Historical rows that stored 0 while
// `estimateIsComplete` was false are treated as unknown.
export function tripCostOrUnknown(
  trip: { estimatedCost: number | null; estimateIsComplete: boolean | null },
): number | null {
  if (!trip.estimateIsComplete) return null;
  if (trip.estimatedCost == null) return null;
  if (!Number.isFinite(trip.estimatedCost)) return null;
  return trip.estimatedCost;
}

// Render a trip's estimated cost or the standard unavailable message.
export function formatTripCost(
  trip: { estimatedCost: number | null; estimateIsComplete: boolean | null; currency: string | null },
): string {
  const known = tripCostOrUnknown(trip);
  if (known == null) return UNKNOWN_COST_MESSAGE;
  return formatMoney(known, trip.currency || "USD");
}

export function formatMoney(amount: number, currency: string = "USD"): string {
  const code = currency || "USD";
  const locale = code === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${code} ${Math.round(amount).toLocaleString(locale)}`;
  }
}
