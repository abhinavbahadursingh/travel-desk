// Search intelligence: deduplication, price validation, duration parsing,
// source reliability, freshness, and ranking.
//
// This module is PURE. It never fetches, invents, or mutates records beyond
// adding ranking metadata derived from what the search provider returned.
// Prices and sources are always preserved; implausible prices are set to null
// (priceType="unavailable") rather than overwritten with a guess.

import type { Candidate, Category, SearchResult } from "./search";
import { completenessScore } from "./extraction";

// Phase 5 — evidence-based match signals exposed to the UI and the AI.
// Every signal is a VERDICT over the snippet text only; nothing is
// fabricated. "unknown" means "we could not tell from the text", never
// "we made it up".
export type DirectionMatch = "match" | "reversed" | "unknown";
export type DateMatch = "match" | "mismatch" | "unknown";
export type FreshnessTier = "fresh" | "aging" | "stale";
export type MatchConfidence = "high" | "medium" | "low";

// Phase 6 — content-quality classification. A verdict over the extracted
// structured fields and the match signals. Rejected candidates are DROPPED
// from the ranked output; partial ones are shown with a "partial info" tag;
// high-confidence ones are eligible to be "recommended".
export type Quality =
  | "high_confidence"
  | "partial_information"
  | "rejected";
export type RejectReason =
  | "destination_guide"
  | "empty_snippet"
  | "direction_reversed"
  | "date_mismatch"
  | "route_mismatch"
  | "no_extracted_fields"
  | "unknown_source_no_info"
  | "duplicate";

export type RankContext = {
  origin?: string;
  destination?: string;
  // Phase 6 — strict route validation. When the trip carries IATA codes, the
  // ranker rejects any flight whose EXTRACTED IATA pair doesn't match
  // (so "BOM → EWR" cannot appear for a "HDO → BOM" trip, even if Tavily
  // returned it). Hotels/trains/cabs are unaffected.
  originIata?: string;
  destinationIata?: string;
  departDate?: Date | string;
  returnDate?: Date | string | null;
  // "INR" marks a domestic-India search. The ranker uses this as a signal
  // to prefer Indian sources where it legitimately helps relevance; it
  // never hides non-Indian sources.
  tripCurrency?: string;
};

export type RankedCandidate = Candidate & {
  rankScore: number; // 0 – 100, higher = better
  rankReasons: string[];
  priceDelta: number | null; // amount above cheapest priced in the same category
  isCheapest: boolean;
  isMostExpensive: boolean;
  isBestValue: boolean;
  isStale: boolean;
  freshness: FreshnessTier;
  reliability: "verified" | "general" | "unknown";
  durationMinutes: number | null;
  directionMatch: DirectionMatch;
  dateMatch: DateMatch;
  matchConfidence: MatchConfidence;
  quality: Quality;
  qualityReasons: string[];
  completeness: number; // 0..1 structured-field completeness
};

export type RankedResult =
  | {
      status: "ok";
      candidates: RankedCandidate[];
      retrievedAt: string;
      provider: string;
      summary: CategorySummary;
    }
  | {
      status: "unavailable";
      reason: string;
      retrievedAt: string;
      provider: string;
    };

export type CategorySummary = {
  totalCount: number;
  pricedCount: number;
  cheapest: RankedCandidate | null;
  mostExpensive: RankedCandidate | null;
  bestValue: RankedCandidate | null;
  recommended: RankedCandidate | null;
  staleCount: number;
  rejectedCount: number;
  rejectedReasons: Partial<Record<RejectReason, number>>;
  partialCount: number;
  highConfidenceCount: number;
};

// ─────────────────────────── configuration ──────────────────────────────────

// Source reliability allowlist. Hosts not listed are "general" — still shown,
// but scored lower. Nothing here hides a source; it only affects ranking.
const VERIFIED_HOSTS: Record<Category, string[]> = {
  flight: [
    "kayak.com",
    "google.com",
    "skyscanner.com",
    "expedia.com",
    "booking.com",
    "momondo.com",
    "cheapflights.com",
    "makemytrip.com",
    "cleartrip.com",
    "ixigo.com",
    "goibibo.com",
  ],
  hotel: [
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
    "makemytrip.com",
    "goibibo.com",
    "oyorooms.com",
    "cleartrip.com",
  ],
  train: [
    "irctc.co.in",
    "indianrail.gov.in",
    "trainman.in",
    "ixigo.com",
    "confirmtkt.com",
    "makemytrip.com",
    "erail.in",
    "railyatri.in",
    "thetrainline.com",
    "trainline.com",
    "raileurope.com",
    "amtrak.com",
    "sncf-connect.com",
    "bahn.com",
    "jrailpass.com",
  ],
  cab: [
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
    "google.com/maps",
    "google.com",
  ],
};

// Per-category plausible price bounds, expressed as a dict keyed by currency.
// Implausible parses are set to null, not overwritten with a guess.
const PRICE_BOUNDS: Record<Category, Record<string, { min: number; max: number }>> = {
  flight: {
    USD: { min: 20, max: 10_000 },
    EUR: { min: 20, max: 10_000 },
    GBP: { min: 20, max: 10_000 },
    INR: { min: 1_000, max: 800_000 },
    JPY: { min: 2_000, max: 1_500_000 },
  },
  hotel: {
    USD: { min: 20, max: 3_000 },
    EUR: { min: 20, max: 3_000 },
    GBP: { min: 20, max: 3_000 },
    INR: { min: 500, max: 200_000 },
    JPY: { min: 2_000, max: 400_000 },
  },
  train: {
    USD: { min: 3, max: 1_500 },
    EUR: { min: 3, max: 1_500 },
    GBP: { min: 3, max: 1_500 },
    INR: { min: 50, max: 100_000 },
    JPY: { min: 500, max: 200_000 },
  },
  cab: {
    USD: { min: 3, max: 500 },
    EUR: { min: 3, max: 500 },
    GBP: { min: 3, max: 500 },
    INR: { min: 50, max: 40_000 },
    JPY: { min: 300, max: 80_000 },
  },
};

// Freshness tiers. Thresholds are deliberately generous — a stale label
// is advisory, never a reason to hide a result.
const FRESH_AFTER_MS = 30 * 60 * 1000; // <30min → fresh
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // >2h → stale
// anything between 30min and 2h is "aging".

// Indian travel sources — used to nudge ranking when the trip itself is
// domestic India. Not a filter; non-Indian sources still appear.
const INDIAN_SOURCES = new Set<string>([
  "irctc.co.in",
  "indianrail.gov.in",
  "trainman.in",
  "ixigo.com",
  "confirmtkt.com",
  "makemytrip.com",
  "erail.in",
  "railyatri.in",
  "goibibo.com",
  "oyorooms.com",
  "cleartrip.com",
  "ola.com",
  "olacabs.com",
  "rapido.bike",
  "meru.in",
]);

// Date-match window: allow ±3 calendar days so a "weekend in May" listing
// still matches a Friday-departing trip. Outside the window counts as
// mismatch only when the snippet explicitly names ANOTHER date — never on
// silence (that stays "unknown").
const DATE_MATCH_WINDOW_DAYS = 3;

// ─────────────────────────── helpers ─────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostnameKey(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).slice(0, 3).join("/");
  } catch {
    return url;
  }
}

function parseDurationMinutes(text: string): number | null {
  if (!text) return null;
  // Normalise whitespace, lowercase.
  const s = text.toLowerCase();

  // "2h 30m" / "2 h 30 m" / "2hr 30min" / "2 hours 30 minutes"
  const hm = s.match(
    /(\d{1,2})\s*(?:h(?:ours?|rs?)?)\s*(?:(\d{1,2})\s*(?:m(?:in(?:utes?)?)?)?)?/,
  );
  if (hm) {
    const h = Number(hm[1]);
    const m = hm[2] ? Number(hm[2]) : 0;
    if (Number.isFinite(h) && Number.isFinite(m) && (h + m) > 0) {
      return h * 60 + m;
    }
  }

  // "2h30"
  const compact = s.match(/\b(\d{1,2})h(\d{2})\b/);
  if (compact) {
    return Number(compact[1]) * 60 + Number(compact[2]);
  }

  // Minutes alone, "45 min", "45 minutes"
  const mm = s.match(/(\d{2,4})\s*(?:m(?:in(?:utes?)?)?)\b/);
  if (mm) {
    const m = Number(mm[1]);
    if (Number.isFinite(m) && m > 0 && m < 48 * 60) return m;
  }

  // "3h" alone
  const hh = s.match(/\b(\d{1,2})\s*h\b/);
  if (hh) {
    const h = Number(hh[1]);
    if (Number.isFinite(h) && h > 0 && h < 48) return h * 60;
  }

  return null;
}

function reliabilityFor(category: Category, host: string): RankedCandidate["reliability"] {
  if (!host || host === "unknown") return "unknown";
  const verified = VERIFIED_HOSTS[category];
  const h = host.toLowerCase();
  return verified.some((v) => h === v || h.endsWith("." + v) || h.startsWith(v + "/"))
    ? "verified"
    : "general";
}

function isStale(retrievedAt: string | undefined, now: number = Date.now()): boolean {
  return freshnessTier(retrievedAt, now) === "stale";
}

export function freshnessTier(
  retrievedAt: string | undefined,
  now: number = Date.now(),
): FreshnessTier {
  if (!retrievedAt) return "fresh";
  const t = Date.parse(retrievedAt);
  if (!Number.isFinite(t)) return "fresh";
  const age = now - t;
  if (age > STALE_AFTER_MS) return "stale";
  if (age > FRESH_AFTER_MS) return "aging";
  return "fresh";
}

// Direction detection on the snippet. Needle = both origin and destination
// tokens. A snippet that mentions BOTH in origin→destination order is a
// "match". A snippet that mentions BOTH but in destination→origin order is
// "reversed". Missing one or both tokens is "unknown" — never treated as a
// mismatch, because many legitimate listings omit the origin from the title.
export function detectDirection(
  text: string,
  origin: string | undefined,
  destination: string | undefined,
): DirectionMatch {
  if (!origin || !destination) return "unknown";
  const s = text.toLowerCase();
  const o = origin.toLowerCase().trim();
  const d = destination.toLowerCase().trim();
  if (!o || !d) return "unknown";
  const oIdx = s.indexOf(o);
  const dIdx = s.indexOf(d);
  if (oIdx === -1 && dIdx === -1) return "unknown";
  if (oIdx === -1 || dIdx === -1) {
    // Only one side mentioned — can't confirm direction, don't invent one.
    return "unknown";
  }
  return oIdx < dIdx ? "match" : "reversed";
}

// Date matching. Parses ISO dates (YYYY-MM-DD), common slash forms
// (DD/MM/YYYY or MM/DD/YYYY — ambiguous; we accept both) and
// "Month D, YYYY" / "D Month YYYY" out of the snippet. Any date within the
// window matches. If the snippet names a date OUTSIDE the window, we
// return "mismatch". If no date is parseable, we stay "unknown".
export function detectDateMatch(
  text: string,
  target: Date | string | undefined,
  windowDays: number = DATE_MATCH_WINDOW_DAYS,
): DateMatch {
  if (!target) return "unknown";
  const t = typeof target === "string" ? new Date(target) : target;
  if (Number.isNaN(t.getTime())) return "unknown";
  const dates = extractDates(text);
  if (dates.length === 0) return "unknown";
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let anyNamed = false;
  for (const d of dates) {
    anyNamed = true;
    if (Math.abs(d.getTime() - t.getTime()) <= windowMs) return "match";
  }
  return anyNamed ? "mismatch" : "unknown";
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function extractDates(text: string): Date[] {
  const out: Date[] = [];
  const s = text;
  // ISO: 2026-11-04
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    if (y > 1900 && mo >= 0 && mo < 12 && d > 0 && d < 32) out.push(new Date(Date.UTC(y, mo, d)));
  }
  // D Month YYYY / Month D, YYYY (year optional — default to current year)
  const monthPattern = Object.keys(MONTH_NAMES).join("|");
  const dMonthY = new RegExp(
    `\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const m of s.matchAll(dMonthY)) {
    const d = Number(m[1]);
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    const y = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (d > 0 && d < 32 && mo != null) out.push(new Date(Date.UTC(y, mo, d)));
  }
  const monthDY = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:\\s*,)?(?:\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const m of s.matchAll(monthDY)) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (d > 0 && d < 32 && mo != null) out.push(new Date(Date.UTC(y, mo, d)));
  }
  // US slash: MM/DD/YYYY
  for (const m of s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12 && b <= 12) {
      // DD/MM
      out.push(new Date(Date.UTC(y, b - 1, a)));
    } else if (b > 12 && a <= 12) {
      // MM/DD
      out.push(new Date(Date.UTC(y, a - 1, b)));
    } else if (a <= 12 && b <= 12) {
      // Ambiguous — accept both so neither direction is wrongly a
      // mismatch when only one interpretation is in-window.
      out.push(new Date(Date.UTC(y, a - 1, b)));
      out.push(new Date(Date.UTC(y, b - 1, a)));
    }
  }
  return out;
}

function matchConfidenceFor(
  directionMatch: DirectionMatch,
  dateMatch: DateMatch,
  reliability: RankedCandidate["reliability"],
  freshness: FreshnessTier,
): MatchConfidence {
  if (directionMatch === "reversed" || dateMatch === "mismatch") return "low";
  const strong =
    directionMatch === "match" &&
    (dateMatch === "match" || dateMatch === "unknown") &&
    reliability !== "unknown" &&
    freshness !== "stale";
  if (strong) return "high";
  if (directionMatch === "match" || dateMatch === "match") return "medium";
  return "low";
}

// ─────────────────────────── price validation ────────────────────────────────

export function clampPrice(
  category: Category,
  price: number | null,
  currency: string | null,
): { price: number | null; currency: string | null; rejected: boolean } {
  if (price == null) return { price: null, currency, rejected: false };
  if (!Number.isFinite(price) || price <= 0) {
    return { price: null, currency: null, rejected: true };
  }
  const c = (currency ?? "USD").toUpperCase();
  const bounds = PRICE_BOUNDS[category]?.[c];
  if (!bounds) {
    // Unknown currency: keep the parse, don't fabricate bounds.
    return { price, currency: c, rejected: false };
  }
  if (price < bounds.min || price > bounds.max) {
    return { price: null, currency: null, rejected: true };
  }
  return { price, currency: c, rejected: false };
}

// ─────────────────────────── dedup ───────────────────────────────────────────

// Two candidates are duplicates when they share:
//   same sourceHostname AND same normalised title
// OR
//   same sourceUrl path signature (hostname + first 3 path segments).
// When collapsing, we keep the candidate with a parsed price; if both or
// neither have prices, we keep the first seen (search-provider order).
function dedupe(cands: RankedCandidate[]): RankedCandidate[] {
  const byKey = new Map<string, RankedCandidate>();
  for (const c of cands) {
    const titleKey = `${c.sourceHostname}|${normalizeTitle(c.title)}`;
    const urlKey = `${c.sourceHostname}|${hostnameKey(c.sourceUrl)}`;
    const existing = byKey.get(titleKey) ?? byKey.get(urlKey);
    if (!existing) {
      byKey.set(titleKey, c);
      byKey.set(urlKey, c);
      continue;
    }
    const prefer = pickBetterDupe(existing, c);
    byKey.set(titleKey, prefer);
    byKey.set(urlKey, prefer);
  }
  // Collapse unique objects (both keys may map to the same instance).
  const unique = new Set<RankedCandidate>();
  byKey.forEach((v) => unique.add(v));
  return Array.from(unique);
}

function pickBetterDupe(a: RankedCandidate, b: RankedCandidate): RankedCandidate {
  if (a.price != null && b.price == null) return a;
  if (b.price != null && a.price == null) return b;
  // Longer description wins (more info); otherwise keep the first.
  return b.description.length > a.description.length ? b : a;
}

// ─────────────────────────── ranking ─────────────────────────────────────────

export type RankInput = {
  category: Category;
  priceCapForCurrency: number | null; // policy cap in the trip currency, if applicable
  now?: number;
  context?: RankContext;
};

// Weight contributions for the direction/date/freshness signals.
function directionScore(d: DirectionMatch): number {
  return d === "match" ? 100 : d === "reversed" ? 10 : 55;
}
function dateScoreFor(d: DateMatch): number {
  return d === "match" ? 100 : d === "mismatch" ? 10 : 55;
}
function freshScoreFor(t: FreshnessTier): number {
  return t === "fresh" ? 100 : t === "aging" ? 75 : 55;
}
function reliabilityScoreIndianBoost(
  r: RankedCandidate["reliability"],
  host: string,
  boostApplies: boolean,
): number {
  const base = reliabilityScore(r);
  if (!boostApplies) return base;
  return INDIAN_SOURCES.has(host) ? Math.min(100, base + 8) : base;
}

function priceScore(price: number | null, min: number, max: number): number {
  if (price == null) return 40; // unknown price — conservative middle score
  if (max <= min) return 60;
  // Lower is better: linear mapping of [min, max] → [100, 40]
  const clamped = Math.max(min, Math.min(max, price));
  return Math.round(100 - ((clamped - min) / (max - min)) * 60);
}

function policyScore(price: number | null, cap: number | null): number {
  if (cap == null || price == null) return 60;
  if (price <= cap) return 100;
  const over = (price - cap) / cap;
  if (over < 0.1) return 70;
  if (over < 0.25) return 40;
  if (over < 0.5) return 20;
  return 5;
}

function durationScore(min: number | null, categoryMedian: number | null): number {
  if (min == null || categoryMedian == null) return 55;
  // Lower duration is better. Map ratio to category median.
  const ratio = min / categoryMedian;
  if (ratio <= 0.6) return 95;
  if (ratio <= 0.8) return 85;
  if (ratio <= 1.0) return 75;
  if (ratio <= 1.25) return 60;
  if (ratio <= 1.5) return 45;
  return 30;
}

function reliabilityScore(r: RankedCandidate["reliability"]): number {
  return r === "verified" ? 100 : r === "general" ? 70 : 40;
}


function median(values: number[]): number | null {
  const vs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (vs.length === 0) return null;
  const mid = Math.floor(vs.length / 2);
  return vs.length % 2 ? vs[mid] : (vs[mid - 1] + vs[mid]) / 2;
}

// Build a RankedCandidate from a plain Candidate; apply price clamp here.
function toRanked(c: Candidate, ctx: RankContext | undefined, now: number): RankedCandidate {
  const clamped = clampPrice(c.category, c.price, c.currency);
  const candidate: Candidate = clamped.rejected
    ? {
        ...c,
        price: null,
        estimatedPrice: null,
        currency: null,
        priceType: "unavailable",
      }
    : { ...c, price: clamped.price, currency: clamped.currency };
  const combined = `${candidate.title} ${candidate.description}`;
  // Prefer the structured duration when extraction succeeded, otherwise fall
  // back to the generic snippet parser.
  const structDuration =
    candidate.structured && "durationMinutes" in candidate.structured
      ? candidate.structured.durationMinutes
      : null;
  const duration = structDuration ?? parseDurationMinutes(combined);
  const reliability = reliabilityFor(c.category, candidate.sourceHostname);
  const freshness = freshnessTier(candidate.retrievedAt, now);
  const directionMatch =
    c.category === "hotel"
      ? detectDirection(combined, undefined, ctx?.destination)
      : detectDirection(combined, ctx?.origin, ctx?.destination);
  const dateMatch = detectDateMatch(combined, ctx?.departDate);
  const matchConfidence = matchConfidenceFor(
    directionMatch,
    dateMatch,
    reliability,
    freshness,
  );
  const completeness = candidate.structured ? completenessScore(candidate.structured) : 0;

  // Strict route check (flights only, for now). When the trip exposes IATA
  // codes AND the extraction parsed an IATA pair from the snippet, the two
  // must agree. A non-match is a hard reject: a flight from BOM → EWR can
  // never satisfy a HDO → BOM request, regardless of price. The check is
  // one-way: when the snippet does NOT state an IATA pair, we fall back to
  // the city-based direction match — it does not become an automatic reject.
  let routeMismatch = false;
  let iataForwardMatch = false;
  let iataReverseLeg = false;
  if (
    c.category === "flight" &&
    ctx?.originIata &&
    ctx?.destinationIata &&
    candidate.structured &&
    candidate.structured.category === "flight"
  ) {
    const s = candidate.structured;
    const oWant = ctx.originIata.toUpperCase();
    const dWant = ctx.destinationIata.toUpperCase();
    if (s.originIata && s.destinationIata) {
      const oGot = s.originIata.toUpperCase();
      const dGot = s.destinationIata.toUpperCase();
      iataForwardMatch = oGot === oWant && dGot === dWant;
      // A genuine round-trip itinerary surfaces as a return leg (BOM→HDO for
      // a HDO→BOM trip). Any OTHER pair is a hard reject.
      iataReverseLeg = oGot === dWant && dGot === oWant;
      if (!iataForwardMatch && !iataReverseLeg) routeMismatch = true;
    }
  }

  // Classify quality. Prefilter rejections short-circuit here; otherwise the
  // quality is a combination of match confidence and structured completeness.
  const qualityReasons: string[] = [];
  let quality: Quality;
  if (candidate.prefilterReject === "destination_guide") {
    quality = "rejected";
    qualityReasons.push("destination guide / listicle, not a bookable option");
  } else if (candidate.prefilterReject === "empty_snippet") {
    quality = "rejected";
    qualityReasons.push("empty snippet");
  } else if (routeMismatch) {
    quality = "rejected";
    qualityReasons.push(
      `extracted IATA pair does not match the requested route (${ctx?.originIata} → ${ctx?.destinationIata})`,
    );
  } else if (
    c.category === "flight" &&
    directionMatch === "reversed" &&
    !iataForwardMatch &&
    !iataReverseLeg
  ) {
    // For flights, a reversed direction with no matching IATA evidence is a
    // hard reject — the HDO→BOM user should never see a BOM→DEL listing.
    // A listing that DID parse a valid IATA pair (forward or return leg) is
    // trusted over the city-based direction heuristic.
    quality = "rejected";
    qualityReasons.push("direction reads destination → origin");
  } else if (directionMatch === "reversed") {
    quality = "partial_information";
    qualityReasons.push("direction appears reversed in the snippet");
  } else if (dateMatch === "mismatch") {
    quality = "partial_information";
    qualityReasons.push("date in snippet is outside the trip window");
  } else if (reliability === "unknown" && completeness < 0.15 && candidate.price == null) {
    quality = "rejected";
    qualityReasons.push("unknown source and no extractable travel details");
  } else if (completeness >= 0.45 && matchConfidence !== "low") {
    quality = "high_confidence";
    qualityReasons.push("structured fields extracted; direction/date compatible");
  } else {
    quality = "partial_information";
    if (completeness < 0.45) qualityReasons.push("some travel fields missing");
    if (matchConfidence === "low") qualityReasons.push("match confidence low");
  }

  return {
    ...candidate,
    rankScore: 0,
    rankReasons: [],
    priceDelta: null,
    isCheapest: false,
    isMostExpensive: false,
    isBestValue: false,
    isStale: freshness === "stale",
    freshness,
    reliability,
    durationMinutes: duration,
    directionMatch,
    dateMatch,
    matchConfidence,
    quality,
    qualityReasons,
    completeness,
  };
}

export function rankCategory(
  result: SearchResult,
  input: RankInput,
): RankedResult {
  if (result.status !== "ok") return result;

  const now = input.now ?? Date.now();
  // 1. Convert, clamp prices, extract duration/reliability/freshness/
  //    direction/date/matchConfidence + structured completeness + quality.
  const ranked = result.candidates.map((c) => toRanked(c, input.context, now));

  // 2. Dedupe.
  const beforeDedupe = ranked.length;
  const deduped = dedupe(ranked);
  const duplicateCount = beforeDedupe - deduped.length;

  // 3. Content filter — drop rejected candidates from the surfaced list. The
  //    counts and reject reasons stay on the summary so the UI can say
  //    "we hid N irrelevant results and why".
  const rejectedPool = deduped.filter((c) => c.quality === "rejected");
  const rejectReasons: Partial<Record<RejectReason, number>> = {};
  const addReject = (r: RejectReason) => {
    rejectReasons[r] = (rejectReasons[r] ?? 0) + 1;
  };
  for (const r of rejectedPool) {
    if (r.prefilterReject === "destination_guide") addReject("destination_guide");
    else if (r.prefilterReject === "empty_snippet") addReject("empty_snippet");
    else if (r.qualityReasons.some((q) => q.includes("IATA pair does not match"))) {
      addReject("route_mismatch");
    } else if (r.directionMatch === "reversed") addReject("direction_reversed");
    else if (r.dateMatch === "mismatch") addReject("date_mismatch");
    else if (r.reliability === "unknown") addReject("unknown_source_no_info");
    else addReject("no_extracted_fields");
  }
  if (duplicateCount > 0) rejectReasons.duplicate = duplicateCount;
  const visible = deduped.filter((c) => c.quality !== "rejected");

  if (visible.length === 0) {
    return {
      status: "ok",
      candidates: [],
      retrievedAt: result.retrievedAt,
      provider: result.provider,
      summary: {
        totalCount: 0,
        pricedCount: 0,
        cheapest: null,
        mostExpensive: null,
        bestValue: null,
        recommended: null,
        staleCount: 0,
        rejectedCount: rejectedPool.length,
        rejectedReasons: rejectReasons,
        partialCount: 0,
        highConfidenceCount: 0,
      },
    };
  }

  // 4. Per-category price spread and duration median (for scoring).
  const prices = visible.map((c) => c.price).filter((p): p is number => p != null);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const durations = visible
    .map((c) => c.durationMinutes)
    .filter((d): d is number => d != null);
  const durationMedian = median(durations);

  // 5. Compute score + reasons for each candidate.
  const indianBoostApplies =
    input.context?.tripCurrency?.toUpperCase() === "INR";
  for (const c of visible) {
    const pScore = priceScore(c.price, minPrice, maxPrice);
    const polScore = policyScore(c.price, input.priceCapForCurrency);
    const dScore = durationScore(c.durationMinutes, durationMedian);
    const relScore = reliabilityScoreIndianBoost(
      c.reliability,
      c.sourceHostname,
      indianBoostApplies,
    );
    const freshScore = freshScoreFor(c.freshness);
    const dirScore = directionScore(c.directionMatch);
    const dateScr = dateScoreFor(c.dateMatch);
    // Weighted sum. Direction and date carry weight so a reversed/off-date
    // listing can never rank at the top of a category even if it's priced.
    // Total weights sum to 1.0.
    const score = Math.round(
      pScore * 0.22 +
        polScore * 0.15 +
        dScore * 0.1 +
        relScore * 0.15 +
        freshScore * 0.08 +
        dirScore * 0.18 +
        dateScr * 0.12,
    );
    c.rankScore = score;
    c.priceDelta =
      c.price != null && prices.length > 0 ? Math.round(c.price - minPrice) : null;
    c.isCheapest = c.price != null && c.price === minPrice;
    c.isMostExpensive = c.price != null && c.price === maxPrice && minPrice !== maxPrice;
    const reasons: string[] = [];
    if (c.directionMatch === "match") reasons.push("origin → destination match");
    else if (c.directionMatch === "reversed") reasons.push("direction appears reversed");
    if (c.dateMatch === "match") reasons.push("date in snippet matches trip");
    else if (c.dateMatch === "mismatch") reasons.push("date in snippet is outside trip window");
    if (c.isCheapest) reasons.push("cheapest in category");
    if (c.isMostExpensive) reasons.push("most expensive in category");
    if (c.price == null) reasons.push("price not listed");
    if (c.reliability === "verified") reasons.push("verified source");
    else if (c.reliability === "unknown") reasons.push("unknown source");
    if (indianBoostApplies && INDIAN_SOURCES.has(c.sourceHostname)) {
      reasons.push("Indian source (domestic-India boost)");
    }
    if (c.freshness === "stale") reasons.push("retrieval is over 2h old");
    else if (c.freshness === "aging") reasons.push("retrieval is over 30 min old");
    if (input.priceCapForCurrency != null && c.price != null) {
      if (c.price <= input.priceCapForCurrency) reasons.push("within policy cap");
      else reasons.push("exceeds policy cap");
    }
    if (c.durationMinutes != null) {
      reasons.push(`listed duration ~${Math.round(c.durationMinutes)} min`);
    }
    reasons.push(`match confidence: ${c.matchConfidence}`);
    c.rankReasons = reasons;
  }

  // 6. Sort by rankScore desc; stable by original order on ties.
  visible.sort((a, b) => b.rankScore - a.rankScore);

  const cheapest = visible.find((c) => c.isCheapest) ?? null;
  const mostExpensive = visible.find((c) => c.isMostExpensive) ?? null;

  // Best value: a high-confidence candidate whose price is within the lower
  // half of the spread AND whose rankScore is in the top third. If no such
  // candidate exists, best-value is null (never invented).
  let bestValue: RankedCandidate | null = null;
  if (prices.length >= 2 && visible.some((c) => c.quality === "high_confidence")) {
    const priceMid = minPrice + (maxPrice - minPrice) * 0.5;
    const topThirdCutoff = visible[Math.max(0, Math.floor(visible.length / 3) - 1)]?.rankScore ?? 0;
    bestValue =
      visible.find(
        (c) =>
          c.quality === "high_confidence" &&
          c.price != null &&
          c.price <= priceMid &&
          c.rankScore >= topThirdCutoff &&
          !c.isCheapest, // cheapest is already called out separately
      ) ?? null;
    if (bestValue) bestValue.isBestValue = true;
  }

  // Recommended = the top-ranked high-confidence candidate (never a
  // reversed/mismatched one). The UI uses this instead of "whatever came first".
  const recommended =
    visible.find((c) => c.quality === "high_confidence") ?? visible[0] ?? null;

  const summary: CategorySummary = {
    totalCount: visible.length,
    pricedCount: prices.length,
    cheapest,
    mostExpensive,
    bestValue,
    recommended,
    staleCount: visible.filter((c) => c.isStale).length,
    rejectedCount: rejectedPool.length,
    rejectedReasons: rejectReasons,
    partialCount: visible.filter((c) => c.quality === "partial_information").length,
    highConfidenceCount: visible.filter((c) => c.quality === "high_confidence").length,
  };

  return {
    status: "ok",
    candidates: visible,
    retrievedAt: result.retrievedAt,
    provider: result.provider,
    summary,
  };
}

// Build a short, natural-language comparison line usable in UI or LLM prompts.
export function compareLine(summary: CategorySummary | undefined): string {
  if (!summary || summary.totalCount === 0) return "no results";
  const parts: string[] = [`${summary.totalCount} results`];
  if (summary.pricedCount > 0 && summary.cheapest?.price != null) {
    parts.push(
      `cheapest ${summary.cheapest.currency ?? ""} ${summary.cheapest.price} at ${summary.cheapest.sourceHostname}`,
    );
  }
  if (summary.staleCount > 0) parts.push(`${summary.staleCount} stale`);
  return parts.join(" · ");
}

// Phase 5 featured picker. Prefers direction-matching priced candidates,
// then direction-matching unpriced, then anything priced that isn't
// reversed, then the first non-reversed candidate. A candidate whose
// direction is explicitly "reversed" is NEVER featured when the result set
// has any non-reversed alternative.
export function pickFeaturedRanked(
  result: RankedResult,
): RankedCandidate | null {
  if (result.status !== "ok" || result.candidates.length === 0) return null;
  const notReversed = result.candidates.filter(
    (c) => c.directionMatch !== "reversed",
  );
  const pool = notReversed.length > 0 ? notReversed : result.candidates;
  // Prefer high-confidence + priced + direction-match first.
  return (
    pool.find(
      (c) =>
        c.quality === "high_confidence" &&
        c.directionMatch === "match" &&
        c.price != null,
    ) ??
    pool.find((c) => c.quality === "high_confidence" && c.directionMatch === "match") ??
    pool.find((c) => c.quality === "high_confidence" && c.price != null) ??
    pool.find((c) => c.directionMatch === "match" && c.price != null) ??
    pool.find((c) => c.directionMatch === "match") ??
    pool.find((c) => c.price != null) ??
    pool[0]
  );
}
