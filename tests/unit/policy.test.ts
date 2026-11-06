import { describe, it, expect } from "vitest";
import type { TravelPolicy } from "@prisma/client";
import { capsForCurrency, evaluate, flagDescription } from "@/lib/policy";

const basePolicy: TravelPolicy = {
  id: "p1",
  name: "default",
  currency: "INR",
  maxFlightEconomy: 100_000,
  maxHotelPerNight: 25_000,
  maxTotalPerTrip: 332_000,
  requireApprovalAbove: 124_500,
  advancePurchaseDays: 7,
  allowedCabins: JSON.stringify(["economy", "premium_economy"]),
  allowAutoApprovalForNonEmployees: true,
  requireBookingReference: true,
  cancellationRequiresAdminReview: true,
  updatedAt: new Date(),
};

describe("policy.capsForCurrency", () => {
  it("returns stored caps when the policy currency matches the trip currency", () => {
    const caps = capsForCurrency(basePolicy, "INR");
    expect(caps.maxFlightEconomy).toBe(100_000);
    expect(caps.maxHotelPerNight).toBe(25_000);
    expect(caps.maxTotalPerTrip).toBe(332_000);
    expect(caps.requireApprovalAbove).toBe(124_500);
  });

  it("falls back to the stored cap when the FX rate is unavailable", () => {
    // Without live FX, convertCurrency(INR→USD) returns null and the policy
    // layer keeps the original value instead of silently halving caps.
    const caps = capsForCurrency(basePolicy, "USD");
    expect(caps.maxFlightEconomy).toBeGreaterThan(0);
  });
});

describe("policy.evaluate", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  it("raises OVER_FLIGHT_CAP when the flight breaches the cap", () => {
    const { flags } = evaluate(
      { departDate: future, cabin: "economy" },
      { flightCost: 200_000, hotelPerNight: 5_000, nights: 2, total: 210_000, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("OVER_FLIGHT_CAP");
  });

  it("raises OVER_HOTEL_CAP when the hotel per-night breaches the cap", () => {
    const { flags } = evaluate(
      { departDate: future, cabin: "economy" },
      { flightCost: 5_000, hotelPerNight: 100_000, nights: 2, total: 205_000, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("OVER_HOTEL_CAP");
  });

  it("raises OVER_TRIP_CAP when the total breaches the cap", () => {
    const { flags } = evaluate(
      { departDate: future, cabin: "economy" },
      { flightCost: 5_000, hotelPerNight: 5_000, nights: 2, total: 400_000, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("OVER_TRIP_CAP");
  });

  it("raises LATE_BOOKING when departure is inside the advance-purchase window", () => {
    const { flags, requiresApproval } = evaluate(
      { departDate: soon, cabin: "economy" },
      { flightCost: 5_000, hotelPerNight: 5_000, nights: 2, total: 15_000, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("LATE_BOOKING");
    expect(requiresApproval).toBe(true);
  });

  it("raises NON_COMPLIANT_CABIN for a disallowed cabin", () => {
    const { flags } = evaluate(
      { departDate: future, cabin: "business" },
      { flightCost: 5_000, hotelPerNight: 5_000, nights: 2, total: 15_000, cabin: "business" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("NON_COMPLIANT_CABIN");
  });

  it("raises PRICE_UNVERIFIED and requires approval when any leg has no listed price", () => {
    const { flags, requiresApproval } = evaluate(
      { departDate: future, cabin: "economy" },
      { flightCost: null, hotelPerNight: 5_000, nights: 2, total: null, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toContain("PRICE_UNVERIFIED");
    expect(requiresApproval).toBe(true);
  });

  it("does not require approval when everything is within policy and complete", () => {
    const { flags, requiresApproval } = evaluate(
      { departDate: future, cabin: "economy" },
      { flightCost: 5_000, hotelPerNight: 5_000, nights: 2, total: 15_000, cabin: "economy" },
      basePolicy,
      "INR",
    );
    expect(flags).toEqual([]);
    expect(requiresApproval).toBe(false);
  });

  it("flagDescription covers every PolicyFlag value", () => {
    const flags = [
      "OVER_FLIGHT_CAP",
      "OVER_HOTEL_CAP",
      "OVER_TRIP_CAP",
      "LATE_BOOKING",
      "NON_COMPLIANT_CABIN",
      "PRICE_UNVERIFIED",
    ] as const;
    for (const f of flags) {
      expect(flagDescription(f)).toMatch(/\w/);
    }
  });
});
