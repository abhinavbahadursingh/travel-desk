// Phase 5 — search intelligence regression suite.
//
// These tests pin the invariants the planner uses to turn raw Tavily
// snippets into a defensible featured recommendation:
//
//   - Direction detection (origin/destination order in the snippet).
//   - Date relevance (snippet date is in / outside the trip window).
//   - Freshness tiers (fresh / aging / stale).
//   - Match confidence derived from the three signals above + reliability.
//   - Featured selection prefers direction-matching candidates and
//     never surfaces a "reversed" result when a non-reversed alternative
//     exists.
//   - Indian-source ranking boost applies only to domestic India trips.
//   - Dedupe does NOT collapse listings across different hostnames even
//     when titles rhyme — keeps provider attribution intact.
//   - No signal fabricates a value: missing prices stay null, missing
//     direction/date stays "unknown", unknown stays "unknown".

import { describe, it, expect } from "vitest";
import {
  detectDirection,
  detectDateMatch,
  freshnessTier,
  pickFeaturedRanked,
  rankCategory,
} from "@/lib/ranking";
import { pickFeatured, type Candidate, type SearchResult } from "@/lib/search";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    title: "Air India Mumbai to Bengaluru 2027-02-01",
    category: "flight",
    source: "airindia.com",
    sourceUrl: "https://airindia.com/ai567",
    sourceHostname: "airindia.com",
    description: "flight on 2027-02-01 price INR 6,500 economy",
    price: 6500,
    currency: "INR",
    priceType: "listed",
    retrievedAt: new Date().toISOString(),
    availabilityStatus: "unverified",
    kind: "flight",
    url: "https://airindia.com/ai567",
    provider: "airindia.com",
    snippet: "flight on 2027-02-01 price INR 6,500 economy",
    estimatedPrice: 6500,
    confidence: "estimate",
  };
  return { ...base, ...overrides };
}

function okResult(cands: Candidate[]): SearchResult {
  return {
    status: "ok",
    candidates: cands,
    retrievedAt: new Date().toISOString(),
    provider: "tavily",
  };
}

describe("detectDirection", () => {
  it("matches origin → destination in order", () => {
    expect(detectDirection("Mumbai to Bengaluru nonstop", "Mumbai", "Bengaluru")).toBe("match");
  });
  it("flags the reversed direction", () => {
    expect(detectDirection("Bengaluru to Mumbai nonstop", "Mumbai", "Bengaluru")).toBe("reversed");
  });
  it("stays unknown when only one side is mentioned", () => {
    expect(detectDirection("flight to Bengaluru nonstop", "Mumbai", "Bengaluru")).toBe("unknown");
    expect(detectDirection("hotels in Bengaluru", undefined, "Bengaluru")).toBe("unknown");
  });
  it("stays unknown when neither side is mentioned", () => {
    expect(detectDirection("cheapest fares — book now", "Mumbai", "Bengaluru")).toBe("unknown");
  });
});

describe("detectDateMatch", () => {
  const target = new Date("2027-02-01T00:00:00Z");
  it("matches an ISO date inside the window", () => {
    expect(detectDateMatch("depart 2027-02-02 nonstop", target)).toBe("match");
  });
  it("flags an ISO date outside the window", () => {
    expect(detectDateMatch("depart 2027-05-02 nonstop", target)).toBe("mismatch");
  });
  it("matches 'D Month YYYY' and 'Month D, YYYY'", () => {
    expect(detectDateMatch("depart 1 Feb 2027", target)).toBe("match");
    expect(detectDateMatch("depart Feb 1, 2027", target)).toBe("match");
  });
  it("stays unknown when the snippet names no date", () => {
    expect(detectDateMatch("cheap flights nonstop", target)).toBe("unknown");
  });
  it("stays unknown when the target is undefined", () => {
    expect(detectDateMatch("depart 2027-02-01", undefined)).toBe("unknown");
  });
});

describe("freshnessTier", () => {
  it("returns 'fresh' when retrieved < 30 minutes ago", () => {
    const now = Date.now();
    const t = new Date(now - 10 * 60 * 1000).toISOString();
    expect(freshnessTier(t, now)).toBe("fresh");
  });
  it("returns 'aging' between 30 minutes and 2 hours", () => {
    const now = Date.now();
    const t = new Date(now - 60 * 60 * 1000).toISOString();
    expect(freshnessTier(t, now)).toBe("aging");
  });
  it("returns 'stale' after 2 hours", () => {
    const now = Date.now();
    const t = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    expect(freshnessTier(t, now)).toBe("stale");
  });
});

describe("rankCategory — direction + date signals", () => {
  const context = {
    origin: "Mumbai",
    destination: "Bengaluru",
    departDate: new Date("2027-02-01T00:00:00Z"),
    tripCurrency: "INR",
  };

  it("annotates direction + date + confidence on every candidate", () => {
    // Use a non-flight category so the stricter flight route rule doesn't
    // auto-reject the reversed listing — we still want to assert the signals
    // on both candidates.
    const matching = candidate({
      category: "train",
      kind: "train",
      sourceHostname: "irctc.co.in",
      title: "Train 12951 Mumbai to Bengaluru 2027-02-01",
      description: "train on 2027-02-01 price INR 6,500 2A",
    });
    const reversed = candidate({
      category: "train",
      kind: "train",
      sourceHostname: "irctc.co.in",
      title: "Train 12952 Bengaluru to Mumbai cheap fare 2027-02-01",
      description: "return leg 2027-02-01",
      sourceUrl: "https://irctc.co.in/t/12952",
      url: "https://irctc.co.in/t/12952",
    });
    const result = rankCategory(okResult([matching, reversed]), {
      category: "train",
      priceCapForCurrency: null,
      context,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const forward = result.candidates.find((c) => c.title.includes("Mumbai to Bengaluru"));
    const back = result.candidates.find((c) => c.title.includes("Bengaluru to Mumbai"));
    expect(forward?.directionMatch).toBe("match");
    expect(back?.directionMatch).toBe("reversed");
    expect(forward?.dateMatch).toBe("match");
    expect(forward?.matchConfidence).toBe("high");
    expect(back?.matchConfidence).toBe("low");
    // The reversed-direction candidate must rank below the matching one.
    expect(result.candidates[0].title).not.toContain("Bengaluru to Mumbai");
  });

  it("applies the Indian-source ranking boost only when the trip is INR", () => {
    const c1 = candidate({ sourceHostname: "ixigo.com", sourceUrl: "https://ixigo.com/a", url: "https://ixigo.com/a" });
    const c2 = candidate({ sourceHostname: "ixigo.com", sourceUrl: "https://ixigo.com/b", url: "https://ixigo.com/b" });
    const inr = rankCategory(okResult([c1, c2]), {
      category: "flight",
      priceCapForCurrency: null,
      context: { ...context, tripCurrency: "INR" },
    });
    const usd = rankCategory(okResult([c1, c2]), {
      category: "flight",
      priceCapForCurrency: null,
      context: { ...context, tripCurrency: "USD" },
    });
    if (inr.status !== "ok" || usd.status !== "ok") throw new Error("expected ok");
    const inrReasons = inr.candidates[0].rankReasons.join("; ");
    const usdReasons = usd.candidates[0].rankReasons.join("; ");
    expect(inrReasons).toContain("Indian source");
    expect(usdReasons).not.toContain("Indian source");
    // And the INR score for the same candidate must be at least the USD one.
    expect(inr.candidates[0].rankScore).toBeGreaterThanOrEqual(usd.candidates[0].rankScore);
  });

  it("preserves source attribution across different hostnames (no cross-source merge)", () => {
    const expedia = candidate({
      sourceHostname: "expedia.com",
      sourceUrl: "https://expedia.com/fl/ai567",
      url: "https://expedia.com/fl/ai567",
    });
    const kayak = candidate({
      sourceHostname: "kayak.com",
      sourceUrl: "https://kayak.com/fl/ai567",
      url: "https://kayak.com/fl/ai567",
    });
    const ranked = rankCategory(okResult([expedia, kayak]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.candidates).toHaveLength(2);
    const hosts = ranked.candidates.map((c) => c.sourceHostname).sort();
    expect(hosts).toEqual(["expedia.com", "kayak.com"]);
  });

  it("preserves null price + unknown signals; never fabricates", () => {
    const noPrice = candidate({
      price: null,
      estimatedPrice: null,
      currency: null,
      priceType: "unavailable",
      title: "mystery listing",
      description: "no price given, no date given",
      sourceUrl: "https://airindia.com/mystery",
      url: "https://airindia.com/mystery",
    });
    const ranked = rankCategory(okResult([noPrice]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    const c = ranked.candidates[0];
    expect(c.price).toBeNull();
    expect(c.directionMatch).toBe("unknown");
    expect(c.dateMatch).toBe("unknown");
    expect(c.rankReasons).toContain("price not listed");
  });

  it("flags stale freshness in rankReasons", () => {
    const stale = candidate({
      retrievedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });
    const ranked = rankCategory(okResult([stale]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.candidates[0].freshness).toBe("stale");
    expect(ranked.candidates[0].rankReasons.join(";")).toContain("over 2h old");
  });
});

describe("pickFeaturedRanked", () => {
  const context = {
    origin: "Mumbai",
    destination: "Bengaluru",
    departDate: new Date("2027-02-01T00:00:00Z"),
    tripCurrency: "INR",
  };

  it("prefers a direction-matching priced candidate over a reversed priced one", () => {
    const matching = candidate({ price: 7000 });
    const reversed = candidate({
      title: "Bengaluru to Mumbai cheap fare 2027-02-01",
      description: "return leg",
      price: 5000,
      sourceUrl: "https://airindia.com/ai568",
      url: "https://airindia.com/ai568",
    });
    const ranked = rankCategory(okResult([reversed, matching]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    const feat = pickFeaturedRanked(ranked);
    expect(feat?.title).toContain("Air India Mumbai to Bengaluru");
  });

  it("never features a reversed result when a non-reversed one exists", () => {
    const reversedPriced = candidate({
      title: "Bengaluru to Mumbai cheap fare 2027-02-01",
      description: "return leg",
      sourceUrl: "https://airindia.com/ai568",
      url: "https://airindia.com/ai568",
    });
    const unknownDir = candidate({
      title: "cheap Indian flights — book now",
      description: "price INR 7,500",
      sourceUrl: "https://airindia.com/ai569",
      url: "https://airindia.com/ai569",
    });
    const ranked = rankCategory(okResult([reversedPriced, unknownDir]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    const feat = pickFeaturedRanked(ranked);
    expect(feat?.directionMatch).not.toBe("reversed");
  });

  it("returns null for unavailable results and empty candidate lists", () => {
    const unavail = rankCategory(
      { status: "unavailable", reason: "no results", retrievedAt: new Date().toISOString(), provider: "tavily" },
      { category: "flight", priceCapForCurrency: null, context },
    );
    expect(pickFeaturedRanked(unavail)).toBeNull();
  });
});

describe("pickFeatured (plain-Candidate picker)", () => {
  it("preserves the direction preference when origin/destination are passed", () => {
    const matching = candidate({ title: "Mumbai to Bengaluru fare" });
    const reversed = candidate({
      title: "Bengaluru to Mumbai fare",
      sourceUrl: "https://airindia.com/ai568",
      url: "https://airindia.com/ai568",
    });
    const feat = pickFeatured(okResult([reversed, matching]), undefined, {
      origin: "Mumbai",
      destination: "Bengaluru",
    });
    expect(feat?.title).toContain("Mumbai to Bengaluru");
  });

  it("falls back to anything when direction cannot be told", () => {
    const only = candidate({ title: "cheap tickets" });
    const feat = pickFeatured(okResult([only]), undefined, {
      origin: "Mumbai",
      destination: "Bengaluru",
    });
    expect(feat?.title).toBe("cheap tickets");
  });
});
