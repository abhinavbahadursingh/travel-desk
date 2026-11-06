// Phase 6 — content-quality classification + reject filter regression.
//
// Pins the invariants of rankCategory's new filter pass:
//   - destination_guide prefilter rejects listicle-style hits.
//   - direction=reversed stays visible as partial_information if nothing
//     better exists in the pool; otherwise it should NOT be the recommended.
//   - date=mismatch is partial_information, not auto-rejected.
//   - CategorySummary exposes rejectedCount, partialCount, highConfidenceCount
//     and a recommended pick that is never a reversed listing.

import { describe, it, expect } from "vitest";
import { rankCategory } from "@/lib/ranking";
import { extract } from "@/lib/extraction";
import type { Candidate, SearchResult } from "@/lib/search";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    title: "IndiGo DEL → BOM Non-stop 08:30 - 10:45 Economy",
    category: "flight",
    source: "goindigo.in",
    sourceUrl: "https://goindigo.in/a",
    sourceHostname: "goindigo.in",
    description: "Depart 2027-02-01, 2h 15m, from ₹4,850",
    price: 4850,
    currency: "INR",
    priceType: "listed",
    retrievedAt: new Date().toISOString(),
    availabilityStatus: "unverified",
    kind: "flight",
    url: "https://goindigo.in/a",
    provider: "goindigo.in",
    snippet: "Depart 2027-02-01, 2h 15m, from ₹4,850",
    estimatedPrice: 4850,
    confidence: "estimate",
  };
  const merged = { ...base, ...overrides };
  merged.structured = extract(merged.category, {
    title: merged.title,
    description: merged.description,
    url: merged.sourceUrl,
    sourceHostname: merged.sourceHostname,
  });
  return merged;
}

function okResult(cands: Candidate[]): SearchResult {
  return {
    status: "ok",
    candidates: cands,
    retrievedAt: new Date().toISOString(),
    provider: "tavily",
  };
}

const context = {
  origin: "DEL",
  destination: "BOM",
  departDate: new Date("2027-02-01T00:00:00Z"),
  tripCurrency: "INR",
};

// Phase 6 — HDO→BOM regression. The user reported that BOM→EWR and BOM→TRV
// were appearing as "matching" flights. Strict IATA validation should reject
// these with route_mismatch, regardless of price.
describe("rankCategory — strict IATA route validation (HDO → BOM bug)", () => {
  const routeCtx = {
    origin: "Ghaziabad",
    destination: "Mumbai",
    originIata: "HDO",
    destinationIata: "BOM",
    departDate: new Date("2026-11-16T00:00:00Z"),
    tripCurrency: "INR",
  };

  const bomToEwr = candidate({
    title: "Mumbai BOM → Newark EWR non-stop",
    description: "Air India AI191 depart 2026-11-16, duration 16h 00m",
    price: 55000,
    estimatedPrice: 55000,
    sourceUrl: "https://airindia.com/bom-ewr",
    url: "https://airindia.com/bom-ewr",
    sourceHostname: "airindia.com",
  });
  const bomToTrv = candidate({
    title: "IndiGo BOM → TRV flight 6E 123",
    description: "Mumbai to Thiruvananthapuram economy",
    price: 4500,
    estimatedPrice: 4500,
    sourceUrl: "https://goindigo.in/bom-trv",
    url: "https://goindigo.in/bom-trv",
    sourceHostname: "goindigo.in",
  });
  const delToBom = candidate({
    title: "Air India DEL → BOM non-stop 08:30 - 10:45",
    description: "Delhi to Mumbai, Economy, 2h 15m",
    price: 6500,
    estimatedPrice: 6500,
    sourceUrl: "https://airindia.com/del-bom",
    url: "https://airindia.com/del-bom",
    sourceHostname: "airindia.com",
  });
  const hdoToBom = candidate({
    title: "IndiGo HDO → BOM 10:00 - 12:15 Economy",
    description: "Ghaziabad to Mumbai, 2h 15m, non-stop, depart 2026-11-16",
    price: 7200,
    estimatedPrice: 7200,
    sourceUrl: "https://goindigo.in/hdo-bom",
    url: "https://goindigo.in/hdo-bom",
    sourceHostname: "goindigo.in",
  });
  const bomToHdoReturn = candidate({
    title: "IndiGo BOM → HDO 18:00 - 20:15 Economy",
    description: "return leg Mumbai to Ghaziabad 2026-11-18",
    price: 7200,
    estimatedPrice: 7200,
    sourceUrl: "https://goindigo.in/bom-hdo-ret",
    url: "https://goindigo.in/bom-hdo-ret",
    sourceHostname: "goindigo.in",
  });

  it("rejects BOM → EWR, BOM → TRV and DEL → BOM for a HDO → BOM trip", () => {
    const ranked = rankCategory(
      okResult([bomToEwr, bomToTrv, delToBom, hdoToBom]),
      {
        category: "flight",
        priceCapForCurrency: null,
        context: routeCtx,
      },
    );
    if (ranked.status !== "ok") throw new Error("expected ok");
    const visibleUrls = ranked.candidates.map((c) => c.url);
    expect(visibleUrls).toContain("https://goindigo.in/hdo-bom");
    expect(visibleUrls).not.toContain("https://airindia.com/bom-ewr");
    expect(visibleUrls).not.toContain("https://goindigo.in/bom-trv");
    expect(visibleUrls).not.toContain("https://airindia.com/del-bom");
    expect(ranked.summary.rejectedReasons.route_mismatch).toBeGreaterThanOrEqual(3);
  });

  it("accepts the return leg BOM → HDO as part of a genuine round-trip", () => {
    const ranked = rankCategory(okResult([hdoToBom, bomToHdoReturn]), {
      category: "flight",
      priceCapForCurrency: null,
      context: routeCtx,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.candidates).toHaveLength(2);
  });

  it("never features a rejected cheaper flight — recommended must be HDO → BOM", () => {
    const cheaperBadRoute = candidate({
      title: "BOM → EWR dirt cheap deal",
      description: "Mumbai to Newark 500 INR special",
      price: 500,
      estimatedPrice: 500,
      sourceUrl: "https://airindia.com/trap",
      url: "https://airindia.com/trap",
    });
    const ranked = rankCategory(okResult([cheaperBadRoute, hdoToBom]), {
      category: "flight",
      priceCapForCurrency: null,
      context: routeCtx,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.summary.recommended?.url).toBe("https://goindigo.in/hdo-bom");
    // The cheapest must be computed from the ACCEPTED pool only.
    expect(ranked.summary.cheapest?.url).toBe("https://goindigo.in/hdo-bom");
  });

  it("falls back to the city-based direction when no IATA pair was extracted", () => {
    const vague = candidate({
      title: "Cheap flights from Ghaziabad to Mumbai",
      description: "book now, prices from ₹5,800",
      price: 5800,
      estimatedPrice: 5800,
      sourceUrl: "https://aggregator.example/x",
      url: "https://aggregator.example/x",
      sourceHostname: "aggregator.example",
    });
    const ranked = rankCategory(okResult([vague]), {
      category: "flight",
      priceCapForCurrency: null,
      context: routeCtx,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    // Not auto-rejected because the snippet has no IATA pair to contradict.
    expect(ranked.candidates).toHaveLength(1);
  });
});

describe("rankCategory — quality classification", () => {
  it("drops destination-guide hits from the visible list but counts them", () => {
    const guide: Candidate = candidate({
      title: "Top 10 things to do in Mumbai",
      description: "destination guide and travel tips",
      sourceUrl: "https://listicle.example/mumbai",
      url: "https://listicle.example/mumbai",
      sourceHostname: "listicle.example",
      prefilterReject: "destination_guide",
    });
    const real = candidate();
    const ranked = rankCategory(okResult([guide, real]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.candidates).toHaveLength(1);
    expect(ranked.candidates[0].sourceHostname).toBe("goindigo.in");
    expect(ranked.summary.rejectedCount).toBe(1);
    expect(ranked.summary.rejectedReasons.destination_guide).toBe(1);
    expect(ranked.summary.recommended?.quality).toBe("high_confidence");
  });

  it("marks a reversed-direction non-flight listing as partial information", () => {
    // For flights, a reversed direction is now a hard reject (see HDO→BOM
    // regression). For trains/hotels/cabs it stays in the softer
    // partial_information lane.
    const forwardTrain = candidate({
      category: "train",
      kind: "train",
      sourceHostname: "irctc.co.in",
      title: "12951 Mumbai Rajdhani Mumbai to Delhi",
      description: "train Mumbai to Delhi depart 2027-02-01 2A",
      sourceUrl: "https://irctc.co.in/t/12951",
      url: "https://irctc.co.in/t/12951",
    });
    const reversed = candidate({
      category: "train",
      kind: "train",
      sourceHostname: "irctc.co.in",
      title: "12952 Delhi to Mumbai return leg",
      description: "return train Delhi to Mumbai 2027-02-01",
      sourceUrl: "https://irctc.co.in/t/12952",
      url: "https://irctc.co.in/t/12952",
    });
    const ranked = rankCategory(okResult([forwardTrain, reversed]), {
      category: "train",
      priceCapForCurrency: null,
      context: { ...context, origin: "Mumbai", destination: "Delhi" },
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    const back = ranked.candidates.find((c) => c.url === "https://irctc.co.in/t/12952");
    expect(back?.quality).toBe("partial_information");
    expect(ranked.summary.recommended?.directionMatch).not.toBe("reversed");
  });

  it("surfaces highConfidenceCount and partialCount on the summary", () => {
    const sparse = candidate({
      title: "cheap tickets",
      description: "book now",
      sourceUrl: "https://goindigo.in/c",
      url: "https://goindigo.in/c",
      price: null,
      estimatedPrice: null,
      priceType: "unavailable",
      currency: null,
    });
    const ranked = rankCategory(okResult([candidate(), sparse]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.summary.highConfidenceCount).toBeGreaterThanOrEqual(1);
    // Totals add up.
    expect(
      ranked.summary.highConfidenceCount + ranked.summary.partialCount,
    ).toBe(ranked.candidates.length);
  });

  it("picks a Best value only when a cheaper high-confidence option exists", () => {
    const expensive = candidate({
      title: "IndiGo DEL → BOM Non-stop 09:00 - 11:15 Economy",
      description: "depart 2027-02-01 2h 15m",
      sourceUrl: "https://goindigo.in/x",
      url: "https://goindigo.in/x",
      price: 12000,
      estimatedPrice: 12000,
    });
    const midValue = candidate({
      title: "IndiGo DEL → BOM Non-stop 10:00 - 12:15 Economy",
      description: "depart 2027-02-01 2h 15m",
      sourceUrl: "https://goindigo.in/m",
      url: "https://goindigo.in/m",
      price: 6500,
      estimatedPrice: 6500,
    });
    const cheap = candidate({
      sourceUrl: "https://goindigo.in/c1",
      url: "https://goindigo.in/c1",
      price: 3000,
      estimatedPrice: 3000,
    });
    const ranked = rankCategory(okResult([expensive, midValue, cheap]), {
      category: "flight",
      priceCapForCurrency: null,
      context,
    });
    if (ranked.status !== "ok") throw new Error("expected ok");
    expect(ranked.summary.cheapest?.price).toBe(3000);
    // Best-value, when set, is not the cheapest.
    if (ranked.summary.bestValue) {
      expect(ranked.summary.bestValue.price).not.toBe(ranked.summary.cheapest?.price);
      expect(ranked.summary.bestValue.isBestValue).toBe(true);
    }
  });
});
