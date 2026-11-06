import type { TravelPolicy, TripRequest } from "@prisma/client";
import { convertCurrency, formatMoney } from "./currency";

export type PolicyFlag =
  | "OVER_FLIGHT_CAP"
  | "OVER_HOTEL_CAP"
  | "OVER_TRIP_CAP"
  | "LATE_BOOKING"
  | "NON_COMPLIANT_CABIN"
  | "PRICE_UNVERIFIED";

export type PolicyEvaluation = {
  flags: PolicyFlag[];
  requiresApproval: boolean;
};

export type PolicyCaps = {
  maxFlightEconomy: number;
  maxHotelPerNight: number;
  maxTotalPerTrip: number;
  requireApprovalAbove: number;
};

// Cabin / class options shared by the trip request form and the travel policy.
export const CABINS = ["economy", "premium_economy", "business"] as const;

export type Cabin = (typeof CABINS)[number];

// Policy thresholds are stored in the policy's own currency (INR by default).
// Convert them into the trip currency before comparing amounts.
export function capsForCurrency(policy: TravelPolicy, currency: string): PolicyCaps {
  const base = policy.currency || "USD";
  const convert = (value: number) => convertCurrency(value, base, currency) ?? value;
  return {
    maxFlightEconomy: convert(policy.maxFlightEconomy),
    maxHotelPerNight: convert(policy.maxHotelPerNight),
    maxTotalPerTrip: convert(policy.maxTotalPerTrip),
    requireApprovalAbove: convert(policy.requireApprovalAbove),
  };
}

export function policySummary(policy: TravelPolicy, currency: string): string {
  const caps = capsForCurrency(policy, currency);
  return (
    `max flight ${formatMoney(caps.maxFlightEconomy, currency)}, ` +
    `max hotel/night ${formatMoney(caps.maxHotelPerNight, currency)}, ` +
    `max total ${formatMoney(caps.maxTotalPerTrip, currency)}, ` +
    `advance purchase ${policy.advancePurchaseDays} days, ` +
    `allowed cabins ${policy.allowedCabins}`
  );
}

// Prices may be null when the source didn't list one. The evaluator never
// fabricates a number — null simply raises PRICE_UNVERIFIED.
export type ItinerarySummary = {
  flightCost: number | null;
  hotelPerNight: number | null;
  nights: number;
  total: number | null;
  cabin: string;
};

export function evaluate(
  trip: Pick<TripRequest, "departDate" | "cabin">,
  itinerary: ItinerarySummary,
  policy: TravelPolicy,
  currency: string = policy.currency || "USD",
): PolicyEvaluation {
  const flags: PolicyFlag[] = [];
  const caps = capsForCurrency(policy, currency);

  if (itinerary.flightCost != null && itinerary.flightCost > caps.maxFlightEconomy) {
    flags.push("OVER_FLIGHT_CAP");
  }
  if (itinerary.hotelPerNight != null && itinerary.hotelPerNight > caps.maxHotelPerNight) {
    flags.push("OVER_HOTEL_CAP");
  }
  if (itinerary.total != null && itinerary.total > caps.maxTotalPerTrip) {
    flags.push("OVER_TRIP_CAP");
  }

  const anyNull =
    itinerary.flightCost == null ||
    itinerary.hotelPerNight == null ||
    itinerary.total == null;
  if (anyNull) flags.push("PRICE_UNVERIFIED");

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOut = Math.floor((trip.departDate.getTime() - Date.now()) / msPerDay);
  if (daysOut < policy.advancePurchaseDays) flags.push("LATE_BOOKING");

  const allowed: string[] = JSON.parse(policy.allowedCabins);
  if (!allowed.includes(trip.cabin)) flags.push("NON_COMPLIANT_CABIN");

  const overThreshold =
    itinerary.total != null && itinerary.total > caps.requireApprovalAbove;
  const requiresApproval = overThreshold || flags.length > 0;
  return { flags, requiresApproval };
}

export function flagDescription(flag: PolicyFlag): string {
  switch (flag) {
    case "OVER_FLIGHT_CAP":
      return "Flight exceeds the economy price cap";
    case "OVER_HOTEL_CAP":
      return "Hotel exceeds the per-night cap";
    case "OVER_TRIP_CAP":
      return "Total trip cost exceeds the per-trip cap";
    case "LATE_BOOKING":
      return "Departure is sooner than the advance-purchase window";
    case "NON_COMPLIANT_CABIN":
      return "Requested cabin is not on the allow-list";
    case "PRICE_UNVERIFIED":
      return "At least one leg has no listed price — approver must verify";
  }
}
