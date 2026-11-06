import { describe, it, expect } from "vitest";
import {
  convertCurrency,
  normalizeMoney,
  isDomesticIndia,
  looksIndian,
  tripCurrency,
  tripCostOrUnknown,
  formatTripCost,
  UNKNOWN_COST_MESSAGE,
  formatMoney,
} from "@/lib/currency";

describe("currency.isDomesticIndia / tripCurrency", () => {
  it("recognises major Indian cities", () => {
    expect(looksIndian("Mumbai")).toBe(true);
    expect(looksIndian("Bengaluru")).toBe(true);
    expect(looksIndian("BLR")).toBe(true);
  });

  it("falls back to USD for non-domestic trips", () => {
    expect(isDomesticIndia("Mumbai", "London")).toBe(false);
    expect(tripCurrency("Mumbai", "London")).toBe("USD");
  });

  it("uses INR for domestic India trips", () => {
    expect(isDomesticIndia("Mumbai", "Bengaluru")).toBe(true);
    expect(tripCurrency("Mumbai", "Bengaluru")).toBe("INR");
  });
});

describe("currency.convertCurrency", () => {
  it("returns the same amount when the currencies match", () => {
    expect(convertCurrency(100, "INR", "INR")).toBe(100);
  });

  it("returns null for an unknown currency (no silent fabrication)", () => {
    expect(convertCurrency(100, "XYZ", "USD")).toBeNull();
  });
});

describe("currency.normalizeMoney", () => {
  it("passes null amounts through untouched", () => {
    expect(normalizeMoney(null, "USD", "INR")).toEqual({
      amount: null,
      currency: null,
      converted: false,
    });
  });

  it("marks same-currency money as not-converted", () => {
    expect(normalizeMoney(100, "INR", "INR")).toEqual({
      amount: 100,
      currency: "INR",
      converted: false,
    });
  });

  it("preserves the original currency when FX is unavailable", () => {
    // Without live FX the call returns the ORIGINAL amount (never fabricates).
    const n = normalizeMoney(100, "XYZ", "INR");
    expect(n.converted).toBe(false);
    expect(n.currency).toBe("XYZ");
    expect(n.amount).toBe(100);
  });
});

describe("currency.tripCostOrUnknown / formatTripCost", () => {
  it("returns null when the estimate is marked incomplete", () => {
    expect(
      tripCostOrUnknown({ estimatedCost: 100, estimateIsComplete: false }),
    ).toBeNull();
  });

  it("returns null when the stored value is null", () => {
    expect(
      tripCostOrUnknown({ estimatedCost: null, estimateIsComplete: true }),
    ).toBeNull();
  });

  it("preserves a real zero when the estimate is complete", () => {
    expect(tripCostOrUnknown({ estimatedCost: 0, estimateIsComplete: true })).toBe(0);
  });

  it("formatTripCost surfaces the standard message when unknown", () => {
    expect(
      formatTripCost({ estimatedCost: null, estimateIsComplete: false, currency: "INR" }),
    ).toBe(UNKNOWN_COST_MESSAGE);
  });

  it("formatTripCost renders money when known", () => {
    const text = formatTripCost({
      estimatedCost: 1234,
      estimateIsComplete: true,
      currency: "INR",
    });
    expect(text).toMatch(/1,234/);
  });

  it("formatMoney handles USD + INR", () => {
    expect(formatMoney(1000, "USD")).toMatch(/\$\s?1,000/);
    expect(formatMoney(1000, "INR")).toMatch(/₹|1,000/);
  });
});
