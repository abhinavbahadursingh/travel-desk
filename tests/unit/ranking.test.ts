import { describe, it, expect } from "vitest";
import { clampPrice, compareLine, rankCategory } from "@/lib/ranking";
import type { SearchResult, Candidate } from "@/lib/search";

function hotel(overrides: Partial<Candidate> = {}): Candidate {
  return {
    title: "Taj Hotel",
    category: "hotel",
    source: "booking.com",
    sourceUrl: "https://booking.com/taj",
    sourceHostname: "booking.com",
    description: "Luxury hotel. $200 per night",
    price: 200,
    currency: "USD",
    priceType: "listed",
    retrievedAt: new Date().toISOString(),
    availabilityStatus: "unverified",
    kind: "hotel",
    url: "https://booking.com/taj",
    provider: "booking.com",
    snippet: "Luxury hotel. $200 per night",
    estimatedPrice: 200,
    confidence: "estimate",
    ...overrides,
  };
}

describe("ranking.clampPrice", () => {
  it("rejects negatives / zero / NaN as implausible, nulling the price", () => {
    expect(clampPrice("flight", 0, "USD").rejected).toBe(true);
    expect(clampPrice("flight", -10, "USD").rejected).toBe(true);
    expect(clampPrice("flight", NaN, "USD").rejected).toBe(true);
  });

  it("preserves plausible prices within bounds", () => {
    expect(clampPrice("hotel", 150, "USD")).toEqual({
      price: 150,
      currency: "USD",
      rejected: false,
    });
  });

  it("rejects wildly out-of-range prices", () => {
    // A $1 "hotel" or a $9m "hotel" are both nonsense.
    expect(clampPrice("hotel", 1, "USD").rejected).toBe(true);
    expect(clampPrice("hotel", 9_000_000, "USD").rejected).toBe(true);
  });

  it("passes unknown currencies through without inventing bounds", () => {
    expect(clampPrice("hotel", 123, "ZWD")).toEqual({
      price: 123,
      currency: "ZWD",
      rejected: false,
    });
  });
});

describe("ranking.rankCategory", () => {
  it("dedupes candidates by title+hostname, keeping the priced one", () => {
    const priced = hotel({ price: 150, description: "Shortish" });
    const dup = hotel({
      price: null,
      estimatedPrice: null,
      currency: null,
      priceType: "unavailable",
      description:
        "A longer description that would otherwise win the dedupe tie but loses to the priced candidate",
    });
    const result: SearchResult = {
      status: "ok",
      candidates: [priced, dup],
      retrievedAt: new Date().toISOString(),
      provider: "tavily",
    };
    const ranked = rankCategory(result, {
      category: "hotel",
      priceCapForCurrency: null,
    });
    expect(ranked.status).toBe("ok");
    if (ranked.status === "ok") {
      expect(ranked.candidates).toHaveLength(1);
      expect(ranked.candidates[0].price).toBe(150);
    }
  });

  it("marks the cheapest and most expensive candidates", () => {
    const cheap = hotel({ price: 100, sourceUrl: "https://booking.com/a", url: "https://booking.com/a", title: "Cheap" });
    const mid = hotel({ price: 300, sourceUrl: "https://booking.com/b", url: "https://booking.com/b", title: "Mid" });
    const pricey = hotel({ price: 500, sourceUrl: "https://booking.com/c", url: "https://booking.com/c", title: "Pricey" });
    const result: SearchResult = {
      status: "ok",
      candidates: [mid, pricey, cheap],
      retrievedAt: new Date().toISOString(),
      provider: "tavily",
    };
    const ranked = rankCategory(result, { category: "hotel", priceCapForCurrency: null });
    if (ranked.status === "ok") {
      const summary = ranked.summary;
      expect(summary.cheapest?.price).toBe(100);
      expect(summary.mostExpensive?.price).toBe(500);
    }
  });

  it("returns the unavailable status through without transformation", () => {
    const r: SearchResult = {
      status: "unavailable",
      reason: "no results",
      retrievedAt: new Date().toISOString(),
      provider: "tavily",
    };
    const ranked = rankCategory(r, { category: "flight", priceCapForCurrency: null });
    expect(ranked.status).toBe("unavailable");
  });
});

describe("ranking.compareLine", () => {
  it("handles empty summaries", () => {
    expect(compareLine(undefined)).toBe("no results");
    expect(
      compareLine({
        totalCount: 0,
        pricedCount: 0,
        cheapest: null,
        mostExpensive: null,
        bestValue: null,
        recommended: null,
        staleCount: 0,
        rejectedCount: 0,
        rejectedReasons: {},
        partialCount: 0,
        highConfidenceCount: 0,
      }),
    ).toBe("no results");
  });
});
