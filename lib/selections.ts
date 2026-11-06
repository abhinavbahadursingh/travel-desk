// Phase 7 — Interactive Travel Selection Wizard.
//
// Server-side source of truth for trip selections. The wizard page writes
// drafts here; the final confirmation re-runs the calculator on this module
// so the stored totals are always what the backend computed (never a
// frontend-submitted number).
//
// Nothing in here fetches from the web. All candidates must already live
// inside the trip's itinerary JSON — that is the real-search snapshot the
// planner stored and the wizard picks from.

import { z } from "zod";
import type { Candidate } from "./search";
import type { RankedCandidate } from "./ranking";
import type {
  CabStructured,
  FlightStructured,
  HotelStructured,
  TrainStructured,
} from "./extraction";

// ───────────────────────────── shape ──────────────────────────────────────

// Transport mode: flight or train. "none" means the user has not yet picked
// a mode; the final confirmation refuses "none".
export const TransportMode = z.enum(["flight", "train", "none"]);
export type TransportMode = z.infer<typeof TransportMode>;

export const ExtraExpense = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  category: z.enum(["meals", "local_transport", "parking", "misc"]),
  amount: z.number().nonnegative().max(10_000_000),
});
export type ExtraExpense = z.infer<typeof ExtraExpense>;

// Each pick stores the candidate's URL (the stable identifier inside the
// itinerary) plus just enough display context so the UI can render even if
// the itinerary changes later (e.g. a re-plan replaces the list). The
// priceAtSelection is the amount we used in the budget; recomputing against
// a newer itinerary will refresh it but never fabricate one when missing.
// displayTitle is a normalized option name (airline + flight number + route
// for flights, train name/number + stations for trains) computed from the
// structured extraction data rather than the raw web-search headline.
export const PickRef = z.object({
  url: z.string().url(),
  title: z.string().max(200),
  displayTitle: z.string().max(200).optional(),
  provider: z.string().max(80),
  priceAtSelection: z.number().nullable(),
  currencyAtSelection: z.string().nullable(),
});
export type PickRef = z.infer<typeof PickRef>;

export const TripSelections = z.object({
  version: z.literal(1),
  // "flight" or "train". The transport pick lives in one of the two slots
  // below depending on this mode.
  transportMode: TransportMode,
  flightPick: PickRef.nullable(),
  trainPick: PickRef.nullable(),
  // Hotel and cab are optional — users can skip them.
  hotelPick: PickRef.nullable(),
  hotelSkipped: z.boolean(),
  cabPick: PickRef.nullable(),
  cabSkipped: z.boolean(),
  extras: z.array(ExtraExpense).max(20),
  confirmed: z.boolean(),
  confirmedAt: z.string().nullable(), // ISO timestamp
  updatedAt: z.string(), // ISO timestamp
});
export type TripSelections = z.infer<typeof TripSelections>;

export function emptySelections(mode: TransportMode = "none"): TripSelections {
  const now = new Date().toISOString();
  return {
    version: 1,
    transportMode: mode,
    flightPick: null,
    trainPick: null,
    hotelPick: null,
    hotelSkipped: false,
    cabPick: null,
    cabSkipped: false,
    extras: [],
    confirmed: false,
    confirmedAt: null,
    updatedAt: now,
  };
}

// ───────────────────────────── itinerary access ───────────────────────────

type Itin = {
  flights?: { candidates?: Candidate[] };
  trains?: { candidates?: Candidate[] };
  hotels?: { candidates?: Candidate[] };
  cabs?: { candidates?: Candidate[] };
};

function readItin(raw: string | null): Itin | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Itin;
  } catch {
    return null;
  }
}

function findByUrl(
  cands: Candidate[] | undefined,
  url: string | undefined,
): Candidate | null {
  if (!cands || !url) return null;
  return cands.find((c) => c.url === url) ?? null;
}

// Clean up noisy Tavily headlines like "Flight Option: X | ixigo.com" so the
// fallback (used only when the structured extraction didn't produce enough
// fields to form a normalized name) still reads like a real option name
// rather than a raw search result.
function cleanRawTitle(raw: string): string {
  let t = (raw ?? "").trim();
  // Strip trailing site suffixes: " | ixigo.com", " - booking.com", etc.
  t = t.replace(
    /\s*[|·•—–-]\s*[\w-]+(?:\.[\w-]+){1,3}\s*$/i,
    "",
  );
  // Strip generic category prefixes that Tavily commonly prepends.
  t = t.replace(
    /^\s*(?:cheap(?:est)?\s+)?(?:flight|train|hotel|cab|taxi)\s+(?:option|deal|offer|special|booking|tickets?)\s*[:\-|—–]\s*/i,
    "",
  );
  return t.trim();
}

// Normalize a candidate's title using the structured extraction data. Falls
// back to a cleaned raw title, then to the provider, and finally to a safe
// placeholder — never returns an empty string.
export function normalizeCandidateTitle(c: Candidate): string {
  const s = c.structured;
  const fallback = () =>
    (cleanRawTitle(c.title ?? "") ||
      c.provider ||
      c.sourceHostname ||
      "Selected option").slice(0, 200);

  if (s?.category === "flight") {
    const f = s as FlightStructured;
    const airline = f.airline ?? c.provider ?? "";
    const num = f.flightNumber ? ` ${f.flightNumber}` : "";
    const route =
      f.originIata && f.destinationIata
        ? ` — ${f.originIata} → ${f.destinationIata}`
        : "";
    const normalized = `${airline}${num}${route}`.trim();
    if (normalized) return normalized.slice(0, 200);
  } else if (s?.category === "train") {
    const t = s as TrainStructured;
    const name = t.trainName ?? t.trainNumber ?? "";
    const num =
      t.trainNumber && !name.includes(t.trainNumber)
        ? ` #${t.trainNumber}`
        : "";
    const route =
      t.originStation && t.destinationStation
        ? ` — ${t.originStation} → ${t.destinationStation}`
        : "";
    const normalized = `${name}${num}${route}`.trim();
    if (normalized) return normalized.slice(0, 200);
  } else if (s?.category === "hotel") {
    const h = s as HotelStructured;
    const name = h.hotelName ?? "";
    const area = h.area ? ` — ${h.area}` : "";
    const normalized = `${name}${area}`.trim();
    if (normalized) return normalized.slice(0, 200);
  } else if (s?.category === "cab") {
    const cab = s as CabStructured;
    // Prefer the structured provider ("Uber") over c.provider ("uber.com").
    const provider = cab.provider ?? c.provider ?? "";
    const vehicleClass = cab.vehicleClass ?? "";
    // Avoid "Uber Uber Go" when vehicle class already carries the provider —
    // in that case the vehicle class alone is the fuller name.
    const normalized =
      provider &&
      vehicleClass &&
      vehicleClass.toLowerCase().startsWith(provider.toLowerCase())
        ? vehicleClass
        : `${provider}${vehicleClass ? ` ${vehicleClass}` : ""}`.trim();
    if (normalized) return normalized.slice(0, 200);
  }
  return fallback();
}

// Split flight candidates into the ones that identify a real, selectable
// flight option versus the ones that only remain for source transparency
// (incomplete snippets, route mismatches, obviously wrong listings). The
// UI uses the first list for the Flight Selection step and offers the
// second behind a "view source listings" disclosure so the user can see
// everything the search surfaced without being pushed to pick junk.
//
// Rules to qualify as selectable:
//   - structured.completeness !== "insufficient"
//   - at least one of (airline, flightNumber) is present
//   - a route IATA pair is extracted
//   - if the trip's own IATAs are known, at least one end matches
//     (handles single-airport hubs where only one side is labelled)
export function splitFlightsByEligibility(
  flights: Candidate[],
  tripOriginIata: string | null,
  tripDestinationIata: string | null,
  opts: { isRoundTrip?: boolean } = {},
): { selectable: Candidate[]; sourceOnly: Candidate[] } {
  const selectable: Candidate[] = [];
  const sourceOnly: Candidate[] = [];
  const origin = tripOriginIata?.toUpperCase() ?? null;
  const destination = tripDestinationIata?.toUpperCase() ?? null;
  const isRoundTrip = !!opts.isRoundTrip;
  for (const c of flights) {
    const s = c.structured?.category === "flight" ? (c.structured as FlightStructured) : null;
    if (!s) {
      sourceOnly.push(c);
      continue;
    }
    if (s.completeness === "insufficient") {
      sourceOnly.push(c);
      continue;
    }
    const hasIdentity = !!(s.airline || s.flightNumber);
    const hasRoute = !!(s.originIata && s.destinationIata);
    if (!hasIdentity || !hasRoute) {
      sourceOnly.push(c);
      continue;
    }
    // Direction validation.
    //   - When both trip IATAs are known AND this is a one-way trip, the
    //     result must match the trip's direction exactly. A BOM → DEL hit
    //     on a DEL → BOM trip is a different flight, not the same leg.
    //   - A round-trip trip is allowed to accept the reverse leg too, since
    //     the return leg legitimately flies the other way.
    //   - When only one end of the trip is known (unusual), fall back to the
    //     original "at least one end touches" rule so partial trips still
    //     show candidates.
    if (origin && destination) {
      const o = s.originIata?.toUpperCase();
      const d = s.destinationIata?.toUpperCase();
      const matchesForward = o === origin && d === destination;
      const matchesReverse = o === destination && d === origin;
      const matches = isRoundTrip
        ? matchesForward || matchesReverse
        : matchesForward;
      if (!matches) {
        sourceOnly.push(c);
        continue;
      }
    } else if (origin || destination) {
      const o = s.originIata?.toUpperCase();
      const d = s.destinationIata?.toUpperCase();
      const anchor = origin ?? destination;
      if (o !== anchor && d !== anchor) {
        sourceOnly.push(c);
        continue;
      }
    }
    selectable.push(c);
  }
  return { selectable, sourceOnly };
}

// Build a PickRef from an itinerary candidate. Returns null when the
// candidate doesn't exist in the itinerary — the caller should treat this
// as a validation error.
export function buildPickFromItinerary(
  cands: Candidate[] | undefined,
  url: string | undefined,
): PickRef | null {
  const c = findByUrl(cands, url);
  if (!c) return null;
  const displayTitle = normalizeCandidateTitle(c);
  // Prefer the structured cab provider ("Uber") over the hostname
  // ("uber.com") when storing the PickRef, so later display stays normalized
  // even if it falls back to .provider.
  let provider = (c.provider ?? "").slice(0, 80);
  if (c.structured?.category === "cab") {
    const cab = c.structured as CabStructured;
    if (cab.provider) provider = cab.provider.slice(0, 80);
  }
  return {
    url: c.url,
    title: displayTitle,
    displayTitle,
    provider,
    priceAtSelection: c.price ?? null,
    currencyAtSelection: c.currency ?? null,
  };
}

// ───────────────────────────── budget ─────────────────────────────────────

export type BudgetLine = {
  key: "transport" | "hotel" | "cab" | "extras";
  label: string;
  amount: number | null;
  note?: string;
  // True when the line uses a converted / "from" price (indicative), as
  // opposed to a listed one. Surfaced in the UI as "indicative".
  indicative?: boolean;
};

export type BudgetBreakdown = {
  currency: string;
  nights: number;
  lines: BudgetLine[];
  // null when any line that WAS selected has an unknown price. The UI must
  // then show "estimate incomplete" and the planner must not treat it as
  // zero.
  grandTotal: number | null;
  isComplete: boolean;
  // Non-null when a selected pick's URL no longer exists in the current
  // itinerary (a re-plan replaced the candidates). The wizard shows this
  // as a warning and asks the user to reselect.
  warnings: string[];
};

// Pure: recompute the grand total from the itinerary + the user's picks.
// Never trusts a frontend-submitted total.
export function computeBudget(
  selections: TripSelections,
  itineraryRaw: string | null,
  ctx: { currency: string; nights: number },
): BudgetBreakdown {
  const itin = readItin(itineraryRaw);
  const warnings: string[] = [];
  const lines: BudgetLine[] = [];
  let total = 0;
  let complete = true;

  // Transport line.
  const transportLine = ((): BudgetLine | null => {
    if (selections.transportMode === "flight") {
      const pick = selections.flightPick;
      if (!pick) return { key: "transport", label: "Flight (not selected)", amount: null };
      const live = findByUrl(itin?.flights?.candidates, pick.url);
      if (!live) warnings.push("Selected flight is no longer in the itinerary — please reselect.");
      const amount = live?.price ?? pick.priceAtSelection ?? null;
      const indicative =
        (live && (live as RankedCandidate).priceType === "indicative") ||
        live?.originalCurrency != null;
      return {
        key: "transport",
        label: "Flight",
        amount,
        note: pick.provider,
        indicative: !!indicative,
      };
    }
    if (selections.transportMode === "train") {
      const pick = selections.trainPick;
      if (!pick) return { key: "transport", label: "Train (not selected)", amount: null };
      const live = findByUrl(itin?.trains?.candidates, pick.url);
      if (!live) warnings.push("Selected train is no longer in the itinerary — please reselect.");
      const amount = live?.price ?? pick.priceAtSelection ?? null;
      return { key: "transport", label: "Train", amount, note: pick.provider };
    }
    return null;
  })();
  if (transportLine) {
    lines.push(transportLine);
    if (transportLine.amount == null) complete = false;
    else total += transportLine.amount;
  }

  // Hotel line.
  if (!selections.hotelSkipped) {
    const pick = selections.hotelPick;
    if (pick) {
      const live = findByUrl(itin?.hotels?.candidates, pick.url);
      if (!live) warnings.push("Selected hotel is no longer in the itinerary — please reselect.");
      const perNight = live?.price ?? pick.priceAtSelection ?? null;
      const hotelTotal =
        perNight != null && ctx.nights > 0 ? perNight * ctx.nights : null;
      lines.push({
        key: "hotel",
        label: `Hotel · ${ctx.nights} night${ctx.nights === 1 ? "" : "s"}`,
        amount: hotelTotal,
        note: pick.provider,
      });
      if (hotelTotal == null) complete = false;
      else total += hotelTotal;
    }
  }

  // Cab line.
  if (!selections.cabSkipped) {
    const pick = selections.cabPick;
    if (pick) {
      const live = findByUrl(itin?.cabs?.candidates, pick.url);
      if (!live) warnings.push("Selected cab is no longer in the itinerary — please reselect.");
      const amount = live?.price ?? pick.priceAtSelection ?? null;
      lines.push({
        key: "cab",
        label: "Cab",
        amount,
        note: pick.provider,
        indicative: true, // cab fares are always ride-hailing estimates
      });
      if (amount == null) complete = false;
      else total += amount;
    }
  }

  // Extras.
  if (selections.extras.length > 0) {
    const extrasTotal = selections.extras.reduce((acc, e) => acc + e.amount, 0);
    lines.push({
      key: "extras",
      label: "Additional expenses",
      amount: extrasTotal,
      note: `${selections.extras.length} item${selections.extras.length === 1 ? "" : "s"}`,
    });
    total += extrasTotal;
  }

  return {
    currency: ctx.currency,
    nights: ctx.nights,
    lines,
    // grandTotal is null when any selected line lacks a price (honest
    // "we don't know" over pretending it's zero). When nothing is selected
    // at all the total is 0.
    grandTotal: lines.length === 0 ? 0 : complete ? total : null,
    isComplete: complete,
    warnings,
  };
}

// ───────────────────────────── validation ─────────────────────────────────

// Draft save: accept partial / optional picks. The URLs that ARE present
// must point at a candidate in the current itinerary.
export const DraftInput = z.object({
  transportMode: TransportMode,
  flightUrl: z.string().url().nullable().optional(),
  trainUrl: z.string().url().nullable().optional(),
  hotelUrl: z.string().url().nullable().optional(),
  hotelSkipped: z.boolean().optional(),
  cabUrl: z.string().url().nullable().optional(),
  cabSkipped: z.boolean().optional(),
  extras: z.array(ExtraExpense).max(20).optional(),
});
export type DraftInput = z.infer<typeof DraftInput>;

export function applyDraft(
  prev: TripSelections,
  input: DraftInput,
  itineraryRaw: string | null,
): { selections: TripSelections; invalid: string[] } {
  const itin = readItin(itineraryRaw);
  const invalid: string[] = [];
  const next: TripSelections = {
    ...prev,
    transportMode: input.transportMode,
    confirmed: false,
    confirmedAt: null,
    updatedAt: new Date().toISOString(),
  };

  // Flight / train picks must be set to a candidate that exists.
  if (input.flightUrl === null) {
    next.flightPick = null;
  } else if (input.flightUrl !== undefined) {
    const p = buildPickFromItinerary(itin?.flights?.candidates, input.flightUrl);
    if (!p) invalid.push("flightUrl is not a candidate in this trip's itinerary");
    else next.flightPick = p;
  }
  if (input.trainUrl === null) {
    next.trainPick = null;
  } else if (input.trainUrl !== undefined) {
    const p = buildPickFromItinerary(itin?.trains?.candidates, input.trainUrl);
    if (!p) invalid.push("trainUrl is not a candidate in this trip's itinerary");
    else next.trainPick = p;
  }
  if (input.hotelUrl === null) {
    next.hotelPick = null;
  } else if (input.hotelUrl !== undefined) {
    const p = buildPickFromItinerary(itin?.hotels?.candidates, input.hotelUrl);
    if (!p) invalid.push("hotelUrl is not a candidate in this trip's itinerary");
    else next.hotelPick = p;
  }
  if (input.hotelSkipped !== undefined) next.hotelSkipped = input.hotelSkipped;

  if (input.cabUrl === null) {
    next.cabPick = null;
  } else if (input.cabUrl !== undefined) {
    const p = buildPickFromItinerary(itin?.cabs?.candidates, input.cabUrl);
    if (!p) invalid.push("cabUrl is not a candidate in this trip's itinerary");
    else next.cabPick = p;
  }
  if (input.cabSkipped !== undefined) next.cabSkipped = input.cabSkipped;

  if (input.extras !== undefined) next.extras = input.extras;

  return { selections: next, invalid };
}

// Confirm: stricter — a transport mode must be chosen and either the
// matching pick exists OR the matching category had no candidates at all.
export function canConfirm(
  s: TripSelections,
  itineraryRaw: string | null,
): { ok: boolean; reasons: string[] } {
  const itin = readItin(itineraryRaw);
  const reasons: string[] = [];
  if (s.transportMode === "none") {
    reasons.push("Choose a transport mode (flight or train).");
  } else if (s.transportMode === "flight") {
    if (!s.flightPick) reasons.push("Pick a flight.");
    else if (!findByUrl(itin?.flights?.candidates, s.flightPick.url)) {
      reasons.push("Selected flight is no longer available — please reselect.");
    }
  } else if (s.transportMode === "train") {
    if (!s.trainPick) reasons.push("Pick a train.");
    else if (!findByUrl(itin?.trains?.candidates, s.trainPick.url)) {
      reasons.push("Selected train is no longer available — please reselect.");
    }
  }
  if (!s.hotelSkipped && s.hotelPick) {
    if (!findByUrl(itin?.hotels?.candidates, s.hotelPick.url)) {
      reasons.push("Selected hotel is no longer available — please reselect.");
    }
  }
  if (!s.cabSkipped && s.cabPick) {
    if (!findByUrl(itin?.cabs?.candidates, s.cabPick.url)) {
      reasons.push("Selected cab is no longer available — please reselect.");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function parseStoredSelections(raw: string | null): TripSelections | null {
  if (!raw) return null;
  try {
    const parsed = TripSelections.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
