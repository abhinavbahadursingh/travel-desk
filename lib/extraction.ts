// Structured extraction layer for raw Tavily search hits.
//
// This module takes a Hit (title + snippet + url) and attempts to parse out
// the per-category fields a user needs to compare options (airline, route,
// times, duration, stops; hotel name, area, star rating, guest rating; train
// number and class; cab provider and vehicle). Nothing is fabricated: every
// field that cannot be read from the source text stays `null` or `undefined`
// and the UI labels the gap explicitly.
//
// The structured object is the EVIDENCE for each surfaced field; the original
// title and description stay on the Candidate for traceability.

import type { Category } from "./search";
import { getByIata } from "./airports";

// ─────────────────────────── shared ────────────────────────────────────────

export type ExtractionEvidence = {
  // Which part of the input the field was read from (title | snippet | url).
  source: "title" | "snippet" | "url";
  // Exact substring the regex matched. Keep it short so it stays serialisable.
  matched: string;
};

// How confident we are that this record names a bookable travel option.
//
//   complete     — airline + flight number + route + depart time + (arrival
//                  time OR duration) + a listed price in the trip currency.
//                  The user can meaningfully compare and select it.
//   partial      — identifiable as a real flight on this route, but one or
//                  more comparison fields are missing. Shown for reference
//                  with a "partial" badge; still selectable.
//   insufficient — missing the minimal identity set (route AND airline AND
//                  flight number). Not safe to select; the UI disables the
//                  pick button.
export type Completeness = "complete" | "partial" | "insufficient";

// Signals whether the parsed price looks like a one-way fare, a round-trip
// fare, or we don't know. The budget calculator never multiplies by anything
// — this flag is a disclosure on the card so the user isn't surprised when
// a round-trip quote looks half-priced per leg. `null` keeps the rule from
// AGENTS.md: "never invent".
export type FlightTripType = "one-way" | "round-trip" | null;

export type FlightStructured = {
  category: "flight";
  airline: string | null;
  originIata: string | null;
  destinationIata: string | null;
  originCity: string | null;
  destinationCity: string | null;
  departureDate: string | null; // ISO yyyy-mm-dd when stated
  arrivalDate: string | null;
  departureTime: string | null; // "08:30" 24h or raw matched substring
  arrivalTime: string | null;
  durationMinutes: number | null;
  stops: number | null; // 0 = non-stop
  cabin: string | null; // only set when the source names an explicit class
  baggageAllowance: string | null; // "7 kg cabin + 15 kg check-in" etc.
  flightNumber: string | null;
  tripType: FlightTripType;
  completeness: Completeness;
  evidence: Record<string, ExtractionEvidence | null>;
};

export type HotelStructured = {
  category: "hotel";
  hotelName: string | null;
  area: string | null; // neighbourhood / district
  starRating: number | null; // 1..5 explicit stars
  guestRating: number | null; // 0..10 or 0..5 (normalised to source scale)
  guestRatingScale: 5 | 10 | null;
  reviewCount: number | null;
  roomType: string | null;
  amenities: string[]; // only amenities the snippet actually names
  evidence: Record<string, ExtractionEvidence | null>;
};

export type TrainStructured = {
  category: "train";
  trainName: string | null;
  trainNumber: string | null;
  originStation: string | null;
  destinationStation: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  travelClass: string | null;
  evidence: Record<string, ExtractionEvidence | null>;
};

export type CabStructured = {
  category: "cab";
  provider: string | null;
  vehicleClass: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  evidence: Record<string, ExtractionEvidence | null>;
};

export type Structured =
  | FlightStructured
  | HotelStructured
  | TrainStructured
  | CabStructured;

export type ExtractionInput = {
  title: string;
  description: string;
  url: string;
  sourceHostname: string;
};

// Known airlines, lowercased. Hit is a substring match — order matters
// (longer names first so "Air India Express" wins over "Air India").
const AIRLINES = [
  "Air India Express",
  "Air India",
  "IndiGo",
  "Vistara",
  "SpiceJet",
  "GoAir",
  "Go First",
  "Akasa Air",
  "AirAsia India",
  "AirAsia",
  "Alliance Air",
  "Jet Airways",
  "Emirates",
  "Etihad",
  "Qatar Airways",
  "Singapore Airlines",
  "Lufthansa",
  "British Airways",
  "Virgin Atlantic",
  "KLM",
  "Air France",
  "American Airlines",
  "Delta",
  "United Airlines",
  "United",
  "Southwest",
  "JetBlue",
  "Alaska Airlines",
  "ANA",
  "Japan Airlines",
  "Cathay Pacific",
  "Thai Airways",
  "Turkish Airlines",
  "Qantas",
  "Air Canada",
  "Saudia",
  "Finnair",
];

const COMMON_AMENITIES = [
  "Wi-Fi",
  "Wifi",
  "WiFi",
  "Free WiFi",
  "Breakfast",
  "Swimming Pool",
  "Pool",
  "Gym",
  "Fitness Center",
  "Spa",
  "Parking",
  "Air Conditioning",
  "Restaurant",
  "Bar",
  "Room Service",
  "Pet Friendly",
  "Business Center",
  "Airport Shuttle",
];

const CABINS = [
  "economy",
  "premium economy",
  "business",
  "first",
];

const TRAIN_CLASSES = [
  "1A",
  "2A",
  "3A",
  "SL",
  "CC",
  "EC",
  "2S",
  "First AC",
  "Second AC",
  "Third AC",
  "Sleeper",
  "Chair Car",
  "Executive Chair Car",
];

const CAB_VEHICLE_CLASSES = [
  "UberX",
  "UberXL",
  "Uber Black",
  "Uber Premier",
  "Uber Go",
  "Uber Auto",
  "Ola Mini",
  "Ola Micro",
  "Ola Prime",
  "Ola Prime Sedan",
  "Ola Prime SUV",
  "Ola Auto",
  "Sedan",
  "SUV",
  "Hatchback",
  "Mini",
  "Premier",
  "Luxury",
];

const CAB_PROVIDERS = [
  "Uber",
  "Lyft",
  "Ola",
  "Bolt",
  "Grab",
  "Didi",
  "FreeNow",
  "Free Now",
  "Rapido",
  "Meru",
];

// ─────────────────────────── helpers ───────────────────────────────────────

function firstMatch(
  input: ExtractionInput,
  re: RegExp,
): { value: string; evidence: ExtractionEvidence } | null {
  for (const src of ["title", "snippet", "url"] as const) {
    const text =
      src === "title"
        ? input.title
        : src === "snippet"
          ? input.description
          : input.url;
    if (!text) continue;
    const m = text.match(re);
    if (m) {
      return {
        value: m[1] ?? m[0],
        evidence: { source: src, matched: m[0].slice(0, 80) },
      };
    }
  }
  return null;
}

function findAnyCaseInsensitive(
  input: ExtractionInput,
  candidates: string[],
): { value: string; evidence: ExtractionEvidence } | null {
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const title = input.title;
  const snippet = input.description;
  for (const needle of sorted) {
    const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, "i");
    if (re.test(title)) {
      return { value: needle, evidence: { source: "title", matched: needle } };
    }
    if (re.test(snippet)) {
      return { value: needle, evidence: { source: "snippet", matched: needle } };
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTime(s: string): string | null {
  // Accept "08:30", "8:30 AM", "08.30", "20:15". Normalise to HH:MM 24h.
  const m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (mm > 59) return null;
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

function parseDurationMinutesLocal(text: string): number | null {
  const s = text.toLowerCase();
  const hm = s.match(
    /(\d{1,2})\s*(?:h(?:ours?|rs?)?)\s*(?:(\d{1,2})\s*(?:m(?:in(?:utes?)?)?)?)?/,
  );
  if (hm) {
    const h = Number(hm[1]);
    const m = hm[2] ? Number(hm[2]) : 0;
    if (Number.isFinite(h) && Number.isFinite(m) && h + m > 0) return h * 60 + m;
  }
  const compact = s.match(/\b(\d{1,2})h(\d{2})\b/);
  if (compact) return Number(compact[1]) * 60 + Number(compact[2]);
  const mm = s.match(/\b(\d{2,3})\s*(?:m(?:in(?:utes?)?)?)\b/);
  if (mm) {
    const m = Number(mm[1]);
    if (m > 0 && m < 48 * 60) return m;
  }
  return null;
}

// Longest plausible flight itinerary (incl. multi-leg + layovers). Anything
// over this almost always means we read "last updated 92 hours ago" or a
// customer-support SLA from the page, not the flight.
const MAX_FLIGHT_DURATION_MIN = 24 * 60;

// Flight-aware duration parser. Prefers matches anchored to one of the
// comparison keywords; falls back to the generic parser; always rejects
// implausibly long results. Returns null when nothing clean can be read —
// never a guess.
export function parseFlightDuration(text: string): number | null {
  const s = text.toLowerCase();

  // Anchored pattern: "duration 2h 15m", "flight time: 4 hr 10 min",
  // "total travel 6h", "layover 1h". The anchor keyword must appear just
  // before (within 24 chars) a `Xh (Ym)?` or `X hr (Y min)?` or `N min`.
  const anchored =
    /\b(?:duration|flight\s+time|flight\s+duration|total\s+(?:travel\s+)?time|travel\s+time|travels?\s+in|layover|journey\s+time|elapsed)\b[\s:–—-]*((?:\d{1,2}\s*h(?:ours?|rs?)?\s*\d{0,2}\s*(?:m(?:in(?:utes?)?)?)?)|(?:\d{2,3}\s*m(?:in(?:utes?)?)?))/i;
  const am = s.match(anchored);
  if (am && am[1]) {
    const inner = parseDurationMinutesLocal(am[1]);
    if (inner != null && inner <= MAX_FLIGHT_DURATION_MIN) return inner;
  }

  // Tight pattern: "2h15m", "02h 15m" — strongly formatted, rarely noise.
  const tight = s.match(/\b(\d{1,2})\s*h\s*(\d{1,2})\s*m(?!in)/i);
  if (tight) {
    const h = Number(tight[1]);
    const m = Number(tight[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const total = h * 60 + m;
      if (total > 0 && total <= MAX_FLIGHT_DURATION_MIN) return total;
    }
  }

  // Fallback: generic parser. Still enforces the 24h flight cap.
  const generic = parseDurationMinutesLocal(s);
  if (generic != null && generic <= MAX_FLIGHT_DURATION_MIN) return generic;
  return null;
}

// ─────────────────────────── flight ────────────────────────────────────────

export function extractFlight(input: ExtractionInput): FlightStructured {
  const evidence: FlightStructured["evidence"] = {};

  const airline = findAnyCaseInsensitive(input, AIRLINES);
  if (airline) evidence.airline = airline.evidence;

  // IATA pair extraction. Three strategies, tightest first:
  //   (a) "DEL → BOM" / "DEL to BOM" / "DEL-BOM" — codes adjacent to the arrow.
  //   (b) "Mumbai (BOM) → Newark (EWR)" — codes inside parentheses.
  //   (c) Pull every all-caps 3-letter token from title+snippet, keep the ones
  //       the airports dataset recognises, and if exactly two distinct real
  //       IATAs appear in text order, use them (origin, destination).
  // Only (c) depends on the airports dataset, so junk like NON, NEW, OUR
  // cannot become a false IATA — they won't resolve via getByIata.
  let originIata: string | null = null;
  let destinationIata: string | null = null;
  let iataEvidenceSource: "title" | "snippet" | "url" = "title";
  let iataEvidenceMatched = "";

  // (a)
  const tight = /\b([A-Z]{3})\s*(?:[→\-–—]|->|to)\s*([A-Z]{3})\b/;
  for (const src of ["title", "snippet", "url"] as const) {
    const text =
      src === "title" ? input.title : src === "snippet" ? input.description : input.url;
    const m = text.match(tight);
    if (m) {
      originIata = m[1];
      destinationIata = m[2];
      iataEvidenceSource = src;
      iataEvidenceMatched = m[0];
      break;
    }
  }
  // (b)
  if (!originIata || !destinationIata) {
    const paren = /\(([A-Z]{3})\)\s*(?:[→\-–—]|->|to)\s*\S*\s*\(([A-Z]{3})\)/;
    for (const src of ["title", "snippet"] as const) {
      const text = src === "title" ? input.title : input.description;
      const m = text.match(paren);
      if (m) {
        originIata = m[1];
        destinationIata = m[2];
        iataEvidenceSource = src;
        iataEvidenceMatched = m[0];
        break;
      }
    }
  }
  // (c)
  if (!originIata || !destinationIata) {
    const combined = `${input.title} ${input.description}`;
    const tokens: Array<{ code: string; index: number }> = [];
    const re = /\b([A-Z]{3})\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(combined)) !== null) {
      const code = match[1];
      if (getByIata(code)) {
        if (!tokens.some((t) => t.code === code)) {
          tokens.push({ code, index: match.index });
        }
      }
    }
    if (tokens.length === 2) {
      tokens.sort((a, b) => a.index - b.index);
      originIata = tokens[0].code;
      destinationIata = tokens[1].code;
      iataEvidenceSource = "snippet";
      iataEvidenceMatched = `${tokens[0].code}, ${tokens[1].code}`;
    }
  }
  if (originIata && destinationIata) {
    evidence.originIata = { source: iataEvidenceSource, matched: iataEvidenceMatched };
    evidence.destinationIata = { source: iataEvidenceSource, matched: iataEvidenceMatched };
  }

  // Departure / arrival time pair. Pattern: "Dep 08:30 Arr 10:45" or
  // "08:30 - 10:45" or "08:30 → 10:45".
  let departureTime: string | null = null;
  let arrivalTime: string | null = null;
  const pair =
    firstMatch(
      input,
      /\b(\d{1,2}[:.]\d{2}(?:\s*[AaPp][Mm])?)\s*(?:-|–|→|to)\s*(\d{1,2}[:.]\d{2}(?:\s*[AaPp][Mm])?)\b/,
    );
  if (pair) {
    const src =
      pair.evidence.source === "title"
        ? input.title
        : pair.evidence.source === "snippet"
          ? input.description
          : input.url;
    const m = src.match(
      /\b(\d{1,2}[:.]\d{2}(?:\s*[AaPp][Mm])?)\s*(?:-|–|→|to)\s*(\d{1,2}[:.]\d{2}(?:\s*[AaPp][Mm])?)\b/,
    );
    if (m) {
      departureTime = parseTime(m[1]);
      arrivalTime = parseTime(m[2]);
      if (departureTime) evidence.departureTime = { source: pair.evidence.source, matched: m[1] };
      if (arrivalTime) evidence.arrivalTime = { source: pair.evidence.source, matched: m[2] };
    }
  }

  // Duration — accept "2h 15m", "2h15", "135 min". Flight-specific rules:
  //   - Cap at 24h because no single flight leg (incl. layovers) exceeds a
  //     day in practice; a "92h" match almost always comes from unrelated
  //     page text (e.g. "last updated 92 hours ago" on a flight-tracker
  //     page). The generic parser can't tell those apart.
  //   - Prefer a match that sits next to a "duration / flight time / travel
  //     time / layover" keyword, so when the snippet contains both a real
  //     duration and noise, the real one wins.
  const combined = `${input.title} ${input.description}`;
  const durationMinutes = parseFlightDuration(combined);
  if (durationMinutes != null) {
    const src = /\d+\s*h/i.test(input.title) ? "title" : "snippet";
    evidence.durationMinutes = { source: src, matched: `${durationMinutes}m` };
  }

  // Stops — "non-stop", "nonstop", "direct", "1 stop", "2 stops"
  let stops: number | null = null;
  if (/\b(non[- ]?stop|nonstop|direct)\b/i.test(combined)) {
    stops = 0;
    evidence.stops = { source: "snippet", matched: "non-stop" };
  } else {
    const sm = combined.match(/\b(\d)\s*stops?\b/i);
    if (sm) {
      const n = Number(sm[1]);
      if (n >= 0 && n <= 5) {
        stops = n;
        evidence.stops = { source: "snippet", matched: sm[0] };
      }
    }
  }

  // Cabin class — accept the match only when the source actually names a
  // class, not when "economy" or "business" just happens to appear in
  // marketing prose ("business lounge access", "economy on all routes").
  //
  // Three allowed contexts:
  //   (a) adjacent to one of {class, cabin, seat, fare, ticket} — e.g.
  //       "economy class", "class: Business", "premium economy fare".
  //   (b) right after a route / flight-row cue — digits, IATA pair, route
  //       arrow — e.g. "DEL → BOM Economy", "08:30 - 10:45 Economy".
  //   (c) end of the title, which airlines commonly use as the fare family
  //       marker ("IndiGo 6E 204 — Economy").
  // Rule (a) and (c) are enough on their own; (b) requires the token to be
  // the last thing before the field boundary too, so prose like "cheap
  // 10:30 economy-of-scale pricing" doesn't sneak through.
  let cabinValue: string | null = null;
  const cabinEvidence = findAnyCaseInsensitive(input, CABINS);
  if (cabinEvidence) {
    const probe = `${input.title}\n${input.description}`;
    const word = escapeRegex(cabinEvidence.value);
    const explicitContext = new RegExp(
      `\\b${word}\\b\\s+(?:class|cabin|seat|fare|fares|ticket|tickets)\\b|\\b(?:class|cabin|fare|fares|seat|cabin\\s+class)\\s*[:=-]?\\s*\\b${word}\\b`,
      "i",
    );
    const endOfLine = new RegExp(`\\b${word}\\b\\s*$`, "im");
    const afterRouteCue = new RegExp(
      `(?:[→\\-–—]|\\bto\\b|\\d{1,2}[:.]\\d{2}(?:\\s*[AaPp][Mm])?|\\b[A-Z]{3}\\b)\\s+\\b${word}\\b(?=\\s|$|[,.;:])`,
      "i",
    );
    if (
      explicitContext.test(probe) ||
      endOfLine.test(probe) ||
      afterRouteCue.test(probe)
    ) {
      cabinValue = cabinEvidence.value.toLowerCase();
      evidence.cabin = cabinEvidence.evidence;
    }
  }

  // Flight number — "6E 234", "AI101", "UA 23". Require at least one LETTER
  // in the carrier code (else a bare price like "6404" would match
  // `[A-Z0-9]{2}\d{2,4}` as "64" + "04" and masquerade as a flight number).
  // Prefer matches directly adjacent to or just after an airline name so
  // generic 2–3 letter uppercase tokens in the snippet don't win.
  let flightNumber: string | null = null;
  const flightNoRe =
    /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*(\d{2,4})\b(?!\s*(?:kg|km|mins?|hrs?|%))/;
  const flightNo = firstMatch(input, flightNoRe);
  if (flightNo) {
    const full = flightNo.evidence.matched.replace(/\s+/g, "").replace(/-/g, "");
    // Belt-and-suspenders: must contain a letter and a digit, and not be
    // nestled inside the parsed price (e.g. the IATA "BOM" directly abuts
    // 6,404 → "M 6404" won't survive the \b carrier check above, but if a
    // future source adds a stray ":6404" we want to drop it here too).
    if (/[A-Z]/.test(full) && /\d/.test(full) && full.length <= 7) {
      flightNumber = full;
      evidence.flightNumber = flightNo.evidence;
    }
  }

  // Departure / arrival dates — "Dep: 12 Jan 2026", "on 12 Jan", "12/01/2026".
  // Only emit when the source has an unambiguous date; never invent today.
  const combinedText = `${input.title} ${input.description}`;
  const departureDate = parseDateLoose(combinedText);
  const arrivalDate = departureDate; // overnight redeyes are rare in snippets
  if (departureDate) {
    evidence.departureDate = { source: "snippet", matched: departureDate };
  }

  // Baggage — "7 kg cabin + 15 kg check-in", "15kg checked", "2 bags".
  let baggageAllowance: string | null = null;
  const bagMatch = combinedText.match(
    /\b(\d{1,2}\s*(?:kg|lb|bag|bags)(?:\s*(?:cabin|check(?:-|\s)?in|checked|carry[- ]on))?(?:\s*\+\s*\d{1,2}\s*(?:kg|lb|bag|bags)(?:\s*(?:cabin|check(?:-|\s)?in|checked|carry[- ]on))?)?)\b/i,
  );
  if (bagMatch) {
    baggageAllowance = bagMatch[0].slice(0, 80);
    evidence.baggageAllowance = { source: "snippet", matched: bagMatch[0] };
  }

  // One-way vs round-trip disclosure. Preserve when stated; never guess.
  let tripType: FlightTripType = null;
  if (/\b(round[- ]?trip|return\s+fare|RT\s+fare|RT:|both\s+ways?)\b/i.test(combinedText)) {
    tripType = "round-trip";
    evidence.tripType = { source: "snippet", matched: "round-trip" };
  } else if (/\b(one[- ]?way|OW\s+fare|single\s+fare)\b/i.test(combinedText)) {
    tripType = "one-way";
    evidence.tripType = { source: "snippet", matched: "one-way" };
  }

  // Completeness — computed from what we actually extracted. The caller
  // writes the fare completeness check (needs the Candidate's price), so
  // we start with a baseline here and let computeFlightCompleteness upgrade
  // / downgrade once price is known.
  const hasRoute = !!(originIata && destinationIata);
  const hasIdentity = !!(airline?.value || flightNumber);
  let completeness: Completeness;
  if (!hasRoute && !hasIdentity) {
    completeness = "insufficient";
  } else if (hasRoute && hasIdentity && departureTime && (arrivalTime || durationMinutes != null)) {
    completeness = "complete";
  } else {
    completeness = "partial";
  }

  return {
    category: "flight",
    airline: airline?.value ?? null,
    originIata,
    destinationIata,
    originCity: null,
    destinationCity: null,
    departureDate,
    arrivalDate,
    departureTime,
    arrivalTime,
    durationMinutes,
    stops,
    cabin: cabinValue,
    baggageAllowance,
    flightNumber,
    tripType,
    completeness,
    evidence,
  };
}

// Read an unambiguous date out of free text. ISO (2026-01-12), "12 Jan 2026",
// "January 12, 2026" and "12/01/2026". Returns null when ambiguous (dd/mm vs
// mm/dd without a yyyy anchor) — we never invent a date.
function parseDateLoose(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const MONTHS = [
    "jan","feb","mar","apr","may","jun",
    "jul","aug","sep","oct","nov","dec",
  ];
  const full = text.match(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i,
  );
  if (full) {
    const day = full[1].padStart(2, "0");
    const month = String(
      MONTHS.indexOf(full[2].toLowerCase().slice(0, 3)) + 1,
    ).padStart(2, "0");
    return `${full[3]}-${month}-${day}`;
  }
  const monthFirst = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (monthFirst) {
    const day = monthFirst[2].padStart(2, "0");
    const month = String(
      MONTHS.indexOf(monthFirst[1].toLowerCase().slice(0, 3)) + 1,
    ).padStart(2, "0");
    return `${monthFirst[3]}-${month}-${day}`;
  }
  const yyyyFirst = text.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (yyyyFirst) {
    const month = yyyyFirst[2].padStart(2, "0");
    const day = yyyyFirst[3].padStart(2, "0");
    return `${yyyyFirst[1]}-${month}-${day}`;
  }
  return null;
}

// ─────────────────────────── hotel ─────────────────────────────────────────

const HOTEL_NAME_SUFFIXES = [
  "Hotel",
  "Hotels",
  "Resort",
  "Resorts",
  "Suites",
  "Inn",
  "Palace",
  "Residency",
  "Grand",
  "Lodge",
  "Villas",
  "Boutique",
];

export function extractHotel(input: ExtractionInput): HotelStructured {
  const evidence: HotelStructured["evidence"] = {};

  // Hotel name — try the leading portion of the title, split on common separators.
  // Example titles:
  //   "Taj Lands End, Mumbai - Luxury Hotel in Bandra | Booking.com"
  //   "ITC Grand Chola Chennai (Updated 2026 Prices) - Hotels.com"
  //   "Hotel Marine Plaza - Marine Drive, Mumbai"
  let hotelName: string | null = null;
  const titleHead = input.title.split(/[\|•·—]|–|-\s/).shift()?.trim() ?? "";
  if (titleHead && titleHead.length <= 80) {
    // Strip trailing noise like "(Updated 2026 Prices)" / "- 2025 Rates"
    // and drop anything after the first comma (that's the city, captured as `area`).
    const cleaned = titleHead
      .replace(/\([^)]*\)\s*$/g, "")
      .split(",")[0]
      .replace(/\s{2,}/g, " ")
      .trim();
    // Must contain either a hotel-name suffix OR be short enough that it is
    // obviously the hotel name (<=6 words). Prevents using a sentence as a name.
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    const hasSuffix = HOTEL_NAME_SUFFIXES.some((w) =>
      new RegExp(`\\b${w}\\b`, "i").test(cleaned),
    );
    if (cleaned && (hasSuffix || wordCount <= 6)) {
      hotelName = cleaned;
      evidence.hotelName = { source: "title", matched: cleaned.slice(0, 80) };
    }
  }

  // Star rating — "★★★★★", "5-star", "5 star hotel"
  let starRating: number | null = null;
  const stars1 = (input.title + " " + input.description).match(/★+/);
  if (stars1 && stars1[0].length <= 5) {
    starRating = stars1[0].length;
    evidence.starRating = { source: "title", matched: stars1[0] };
  } else {
    const stars2 = (input.title + " " + input.description).match(
      /\b([1-5])[- ]?star\b/i,
    );
    if (stars2) {
      starRating = Number(stars2[1]);
      evidence.starRating = { source: "snippet", matched: stars2[0] };
    }
  }

  // Guest rating — "4.6/5", "8.4/10", "rated 4.6"
  let guestRating: number | null = null;
  let guestRatingScale: 5 | 10 | null = null;
  const combined = `${input.title} ${input.description}`;
  const rm = combined.match(/\b(\d(?:\.\d{1,2})?)\s*\/\s*(5|10)\b/);
  if (rm) {
    const val = Number(rm[1]);
    const scale = Number(rm[2]) as 5 | 10;
    if (val > 0 && val <= scale) {
      guestRating = val;
      guestRatingScale = scale;
      evidence.guestRating = { source: "snippet", matched: rm[0] };
    }
  }

  // Review count — "(2,450 reviews)" / "based on 2450 reviews"
  let reviewCount: number | null = null;
  const revMatch = combined.match(
    /\(?\s*([0-9]{1,3}(?:[,.]\d{3})+|\d{2,})\s*(?:guest\s+)?reviews?\)?/i,
  );
  if (revMatch) {
    const n = Number(revMatch[1].replace(/[,.]/g, ""));
    if (Number.isFinite(n) && n >= 1) {
      reviewCount = n;
      evidence.reviewCount = { source: "snippet", matched: revMatch[0] };
    }
  }

  // Room type — "Deluxe King", "Standard Double", etc. Conservative: only pick
  // when preceded by "Room:" or "room type" so we don't guess.
  let roomType: string | null = null;
  const rt = combined.match(
    /room(?:\s+type)?[:\s]+([A-Z][A-Za-z ]{2,30}?)(?:[\.,|]|$)/i,
  );
  if (rt) {
    roomType = rt[1].trim();
    evidence.roomType = { source: "snippet", matched: rt[0].slice(0, 80) };
  }

  // Amenities — only the ones actually named.
  const amenities: string[] = [];
  for (const a of COMMON_AMENITIES) {
    if (new RegExp(`\\b${escapeRegex(a)}\\b`, "i").test(combined)) {
      // normalize Wi-Fi variants
      const norm = /wi.?fi/i.test(a) ? "Wi-Fi" : a;
      if (!amenities.includes(norm)) amenities.push(norm);
    }
  }
  if (amenities.length > 0) {
    evidence.amenities = { source: "snippet", matched: amenities.slice(0, 5).join(",") };
  }

  // Area — look after a comma in title: "Taj Lands End, Mumbai" → "Mumbai",
  // then prefer a known neighbourhood if named ("Bandra West, Mumbai").
  let area: string | null = null;
  const areaMatch = combined.match(/\bin\s+([A-Z][a-zA-Z ]{2,30}?)(?:[\.,|-]|$)/);
  if (areaMatch) {
    area = areaMatch[1].trim();
    evidence.area = { source: "snippet", matched: areaMatch[0].slice(0, 80) };
  } else if (input.title.includes(",")) {
    const afterComma = input.title.split(",")[1]?.split(/[-|]/)[0]?.trim();
    if (afterComma && afterComma.length <= 40 && /^[A-Z]/.test(afterComma)) {
      area = afterComma;
      evidence.area = { source: "title", matched: afterComma };
    }
  }

  return {
    category: "hotel",
    hotelName,
    area,
    starRating,
    guestRating,
    guestRatingScale,
    reviewCount,
    roomType,
    amenities,
    evidence,
  };
}

// ─────────────────────────── train ─────────────────────────────────────────

export function extractTrain(input: ExtractionInput): TrainStructured {
  const evidence: TrainStructured["evidence"] = {};
  const combined = `${input.title} ${input.description}`;

  // Train number — "12951", "22691" (Indian train numbers: 4–5 digits).
  let trainNumber: string | null = null;
  const numMatch = combined.match(/\b(\d{4,5})\b(?=\s|$|[-,])/);
  if (numMatch) {
    const n = numMatch[1];
    // Sanity: not a year or price.
    if (!/^(19|20)\d{2}$/.test(n)) {
      trainNumber = n;
      evidence.trainNumber = { source: "snippet", matched: numMatch[0] };
    }
  }

  // Train name — things like "Rajdhani Express", "Shatabdi Express", "Vande Bharat".
  let trainName: string | null = null;
  const nameMatch = combined.match(
    /\b((?:[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})\s+(?:Express|SF|Superfast|Rajdhani|Shatabdi|Vande Bharat|Duronto|Garib Rath|Tejas|Humsafar))\b/,
  );
  if (nameMatch) {
    trainName = nameMatch[1].trim();
    evidence.trainName = { source: "snippet", matched: nameMatch[0].slice(0, 80) };
  }

  // Station pair "Mumbai Central → New Delhi" / "Mumbai to Delhi"
  const stations = combined.match(
    /\b([A-Z][a-zA-Z ]{2,30})\s*(?:→|->|to|-)\s*([A-Z][a-zA-Z ]{2,30})\b/,
  );
  if (stations) {
    evidence.originStation = { source: "snippet", matched: stations[1] };
    evidence.destinationStation = { source: "snippet", matched: stations[2] };
  }

  // Times
  let departureTime: string | null = null;
  let arrivalTime: string | null = null;
  const pair = combined.match(
    /\b(\d{1,2}[:.]\d{2})\s*(?:-|–|→|to)\s*(\d{1,2}[:.]\d{2})\b/,
  );
  if (pair) {
    departureTime = parseTime(pair[1]);
    arrivalTime = parseTime(pair[2]);
    if (departureTime) evidence.departureTime = { source: "snippet", matched: pair[1] };
    if (arrivalTime) evidence.arrivalTime = { source: "snippet", matched: pair[2] };
  }

  const durationMinutes = parseDurationMinutesLocal(combined);
  if (durationMinutes != null) evidence.durationMinutes = { source: "snippet", matched: `${durationMinutes}m` };

  const cls = findAnyCaseInsensitive(input, TRAIN_CLASSES);
  const travelClass = cls?.value ?? null;
  if (cls) evidence.travelClass = cls.evidence;

  return {
    category: "train",
    trainName,
    trainNumber,
    originStation: stations ? stations[1].trim() : null,
    destinationStation: stations ? stations[2].trim() : null,
    departureTime,
    arrivalTime,
    durationMinutes,
    travelClass,
    evidence,
  };
}

// ─────────────────────────── cab ───────────────────────────────────────────

export function extractCab(input: ExtractionInput): CabStructured {
  const evidence: CabStructured["evidence"] = {};
  const combined = `${input.title} ${input.description}`;

  // Provider — prefer the sourceHostname when it names a cab company.
  let provider: string | null = null;
  const hostProvider = CAB_PROVIDERS.find((p) =>
    input.sourceHostname.toLowerCase().includes(p.toLowerCase().replace(/\s+/g, "")),
  );
  if (hostProvider) {
    provider = hostProvider;
    evidence.provider = { source: "url", matched: input.sourceHostname };
  } else {
    const found = findAnyCaseInsensitive(input, CAB_PROVIDERS);
    if (found) {
      provider = found.value;
      evidence.provider = found.evidence;
    }
  }

  const vehicle = findAnyCaseInsensitive(input, CAB_VEHICLE_CLASSES);
  const vehicleClass = vehicle?.value ?? null;
  if (vehicle) evidence.vehicleClass = vehicle.evidence;

  // Distance "12.5 km", "~8 km"
  let distanceKm: number | null = null;
  const dm = combined.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s*km\b/i);
  if (dm) {
    const n = Number(dm[1]);
    if (Number.isFinite(n) && n > 0 && n < 2000) {
      distanceKm = n;
      evidence.distanceKm = { source: "snippet", matched: dm[0] };
    }
  }

  const durationMinutes = parseDurationMinutesLocal(combined);
  if (durationMinutes != null) evidence.durationMinutes = { source: "snippet", matched: `${durationMinutes}m` };

  return {
    category: "cab",
    provider,
    vehicleClass,
    distanceKm,
    durationMinutes,
    evidence,
  };
}

// ─────────────────────────── entry point ───────────────────────────────────

export function extract(category: Category, input: ExtractionInput): Structured {
  switch (category) {
    case "flight":
      return extractFlight(input);
    case "hotel":
      return extractHotel(input);
    case "train":
      return extractTrain(input);
    case "cab":
      return extractCab(input);
  }
}

// How many of the "interesting" fields the structured object filled in.
// Used by the quality classifier.
export function completenessScore(s: Structured): number {
  switch (s.category) {
    case "flight": {
      const fields: Array<unknown> = [
        s.airline,
        s.originIata,
        s.destinationIata,
        s.departureTime,
        s.arrivalTime,
        s.durationMinutes,
        s.stops,
        s.cabin,
        s.flightNumber,
      ];
      return fields.filter((v) => v != null).length / fields.length;
    }
    case "hotel": {
      const fields: Array<unknown> = [
        s.hotelName,
        s.area,
        s.starRating ?? s.guestRating,
        s.reviewCount,
        s.roomType,
        s.amenities.length > 0 ? 1 : null,
      ];
      return fields.filter((v) => v != null).length / fields.length;
    }
    case "train": {
      const fields: Array<unknown> = [
        s.trainName,
        s.trainNumber,
        s.originStation,
        s.destinationStation,
        s.departureTime,
        s.arrivalTime,
        s.durationMinutes,
        s.travelClass,
      ];
      return fields.filter((v) => v != null).length / fields.length;
    }
    case "cab": {
      const fields: Array<unknown> = [
        s.provider,
        s.vehicleClass,
        s.distanceKm,
        s.durationMinutes,
      ];
      return fields.filter((v) => v != null).length / fields.length;
    }
  }
}

// Markers that a hit is a destination guide / listicle / generic article,
// NOT a bookable option. Used as a rejection signal.
const GUIDE_NOISE = [
  "things to do",
  "best places to visit",
  "travel guide",
  "destination guide",
  "top attractions",
  "where to stay",
  "best time to visit",
  "complete guide",
  "ultimate guide",
  "blog",
];

export function looksLikeDestinationGuide(input: ExtractionInput): boolean {
  const combined = `${input.title} ${input.description}`.toLowerCase();
  return GUIDE_NOISE.some((n) => combined.includes(n));
}
