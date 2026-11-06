// Phase 7 — Interactive Travel Selection Wizard regression suite.
//
// Pins the budget calculator and selection validator used by the wizard
// and its API routes:
//   - URLs must refer to candidates already in the trip itinerary.
//   - Totals recompute from live prices; stale picks fall back to the
//     price captured at selection time.
//   - Missing prices never become 0; grandTotal stays null and
//     isComplete=false.
//   - Hotel price is per-night, multiplied by nights.
//   - Skipped hotel / cab never contribute to the total.
//   - canConfirm refuses "none" transport mode or a pick whose URL no
//     longer exists in the itinerary.

import { describe, it, expect } from "vitest";
import {
  applyDraft,
  buildPickFromItinerary,
  canConfirm,
  computeBudget,
  emptySelections,
  parseStoredSelections,
  splitFlightsByEligibility,
  type TripSelections,
} from "@/lib/selections";
import type { Candidate } from "@/lib/search";
import type { FlightStructured } from "@/lib/extraction";

const itineraryJson = JSON.stringify({
  flights: {
    candidates: [
      {
        title: "IndiGo DEL → BOM",
        provider: "goindigo.in",
        url: "https://goindigo.in/a",
        price: 6500,
        currency: "INR",
        priceType: "listed",
      },
      {
        title: "Air India DEL → BOM",
        provider: "airindia.com",
        url: "https://airindia.com/b",
        price: null,
        currency: null,
        priceType: "unavailable",
      },
    ],
  },
  trains: {
    candidates: [
      {
        title: "12951 Rajdhani Express",
        provider: "irctc.co.in",
        url: "https://irctc.co.in/t/12951",
        price: 2500,
        currency: "INR",
        priceType: "listed",
      },
    ],
  },
  hotels: {
    candidates: [
      {
        title: "Taj Lands End",
        provider: "booking.com",
        url: "https://booking.com/taj",
        price: 8500,
        currency: "INR",
        priceType: "listed",
      },
    ],
  },
  cabs: {
    candidates: [
      {
        title: "Uber",
        provider: "uber.com",
        url: "https://uber.com/ride",
        price: 600,
        currency: "INR",
        priceType: "listed",
      },
    ],
  },
});

describe("applyDraft", () => {
  it("accepts picks that exist in the itinerary", () => {
    const { selections, invalid } = applyDraft(
      emptySelections(),
      {
        transportMode: "flight",
        flightUrl: "https://goindigo.in/a",
        hotelUrl: "https://booking.com/taj",
      },
      itineraryJson,
    );
    expect(invalid).toEqual([]);
    expect(selections.transportMode).toBe("flight");
    expect(selections.flightPick?.url).toBe("https://goindigo.in/a");
    expect(selections.hotelPick?.priceAtSelection).toBe(8500);
  });

  it("rejects a URL not present in the itinerary", () => {
    const { invalid } = applyDraft(
      emptySelections(),
      {
        transportMode: "flight",
        flightUrl: "https://example.com/not-in-itin",
      },
      itineraryJson,
    );
    expect(invalid.length).toBeGreaterThan(0);
  });

  it("accepts null URLs (clearing a prior pick)", () => {
    const prev: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://goindigo.in/a",
        title: "IndiGo DEL → BOM",
        provider: "goindigo.in",
        priceAtSelection: 6500,
        currencyAtSelection: "INR",
      },
    };
    const { selections, invalid } = applyDraft(
      prev,
      { transportMode: "flight", flightUrl: null },
      itineraryJson,
    );
    expect(invalid).toEqual([]);
    expect(selections.flightPick).toBeNull();
  });

  it("preserves extras array on partial updates", () => {
    const prev: TripSelections = {
      ...emptySelections("flight"),
      extras: [{ id: "x1", label: "lunch", category: "meals", amount: 400 }],
    };
    const { selections } = applyDraft(
      prev,
      { transportMode: "flight" },
      itineraryJson,
    );
    expect(selections.extras).toHaveLength(1);
  });
});

describe("computeBudget", () => {
  it("sums flight + hotel*nights + cab + extras", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://goindigo.in/a",
        title: "IndiGo",
        provider: "goindigo.in",
        priceAtSelection: 6500,
        currencyAtSelection: "INR",
      },
      hotelPick: {
        url: "https://booking.com/taj",
        title: "Taj Lands End",
        provider: "booking.com",
        priceAtSelection: 8500,
        currencyAtSelection: "INR",
      },
      cabPick: {
        url: "https://uber.com/ride",
        title: "Uber",
        provider: "uber.com",
        priceAtSelection: 600,
        currencyAtSelection: "INR",
      },
      extras: [{ id: "x1", label: "lunch", category: "meals", amount: 400 }],
    };
    const budget = computeBudget(s, itineraryJson, { currency: "INR", nights: 2 });
    // 6500 + 8500*2 + 600 + 400 = 24,500
    expect(budget.grandTotal).toBe(24_500);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines).toHaveLength(4);
  });

  it("keeps grandTotal null and isComplete=false when any selected line lacks a price", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://airindia.com/b",
        title: "Air India",
        provider: "airindia.com",
        priceAtSelection: null,
        currencyAtSelection: null,
      },
      hotelPick: {
        url: "https://booking.com/taj",
        title: "Taj",
        provider: "booking.com",
        priceAtSelection: 8500,
        currencyAtSelection: "INR",
      },
    };
    const budget = computeBudget(s, itineraryJson, { currency: "INR", nights: 2 });
    expect(budget.grandTotal).toBeNull();
    expect(budget.isComplete).toBe(false);
  });

  it("skipped hotel / cab contribute nothing", () => {
    const s: TripSelections = {
      ...emptySelections("train"),
      trainPick: {
        url: "https://irctc.co.in/t/12951",
        title: "Rajdhani",
        provider: "irctc.co.in",
        priceAtSelection: 2500,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const budget = computeBudget(s, itineraryJson, { currency: "INR", nights: 2 });
    expect(budget.grandTotal).toBe(2500);
    expect(budget.lines.every((l) => l.key !== "hotel" && l.key !== "cab")).toBe(true);
  });

  it("warns when a selected URL is no longer in the itinerary", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://stale.example/no-longer",
        title: "stale",
        provider: "stale.example",
        priceAtSelection: 5000,
        currencyAtSelection: "INR",
      },
    };
    const budget = computeBudget(s, itineraryJson, { currency: "INR", nights: 2 });
    expect(budget.warnings.length).toBeGreaterThan(0);
    // Falls back to priceAtSelection so the UI still shows something.
    expect(budget.lines[0].amount).toBe(5000);
  });
});

describe("canConfirm", () => {
  it("refuses when transport mode is 'none'", () => {
    const res = canConfirm(emptySelections(), itineraryJson);
    expect(res.ok).toBe(false);
  });

  it("refuses when transport mode is set but no pick was made", () => {
    const s: TripSelections = { ...emptySelections("flight") };
    const res = canConfirm(s, itineraryJson);
    expect(res.ok).toBe(false);
  });

  it("accepts a complete, valid selection", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://goindigo.in/a",
        title: "IndiGo",
        provider: "goindigo.in",
        priceAtSelection: 6500,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const res = canConfirm(s, itineraryJson);
    expect(res.ok).toBe(true);
  });
});

describe("parseStoredSelections", () => {
  it("round-trips a valid blob", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://goindigo.in/a",
        title: "IndiGo",
        provider: "goindigo.in",
        priceAtSelection: 6500,
        currencyAtSelection: "INR",
      },
    };
    const raw = JSON.stringify(s);
    const back = parseStoredSelections(raw);
    expect(back?.flightPick?.url).toBe("https://goindigo.in/a");
  });

  it("returns null for garbage", () => {
    expect(parseStoredSelections("not json")).toBeNull();
    expect(parseStoredSelections(null)).toBeNull();
  });
});

// ───────────────────────────── regression suite ─────────────────────────────

const flightItinWithStructured = JSON.stringify({
  flights: {
    candidates: [
      {
        title: "Flight Option: Ghaziabad → Mumbai | ixigo.com",
        provider: "ixigo.com",
        url: "https://ixigo.com/flight/1",
        price: 6404,
        currency: "INR",
        priceType: "listed",
        structured: {
          category: "flight",
          airline: "IndiGo",
          flightNumber: "6E 123",
          originIata: "GZB",
          destinationIata: "BOM",
          departureTime: "08:30",
          arrivalTime: "11:15",
          durationMinutes: 165,
          stops: 0,
          cabin: "economy",
          evidence: {},
        },
      },
    ],
  },
  trains: {
    candidates: [],
  },
  hotels: {
    candidates: [
      {
        title: "Taj Lands End Mumbai",
        provider: "booking.com",
        url: "https://booking.com/taj",
        price: 8500,
        currency: "INR",
        priceType: "listed",
        structured: {
          category: "hotel",
          hotelName: "Taj Lands End",
          area: "Bandra Kurla Complex",
          starRating: 5,
          guestRating: 8.9,
          guestRatingScale: 10,
          reviewCount: 1200,
          roomType: "Deluxe King",
          amenities: ["Wi-Fi", "Pool", "Spa"],
          evidence: {},
        },
      },
    ],
  },
  cabs: {
    candidates: [
      {
        title: "Uber Sedan | Ghaziabad to Mumbai",
        provider: "uber.com",
        url: "https://uber.com/ride/1",
        price: 346,
        currency: "INR",
        priceType: "indicative",
        structured: {
          category: "cab",
          provider: "Uber",
          vehicleClass: "Sedan",
          distanceKm: 12,
          durationMinutes: 25,
          evidence: {},
        },
      },
    ],
  },
});

const trainItin = JSON.stringify({
  flights: {
    candidates: [],
  },
  trains: {
    candidates: [
      {
        title: "Train Option: New Delhi → Mumbai",
        provider: "irctc.co.in",
        url: "https://irctc.co.in/train/12951",
        price: 2500,
        currency: "INR",
        priceType: "listed",
        structured: {
          category: "train",
          trainName: "Rajdhani Express",
          trainNumber: "12951",
          originStation: "New Delhi",
          destinationStation: "Mumbai Central",
          departureTime: "16:55",
          arrivalTime: "08:35",
          durationMinutes: 940,
          travelClass: "1AC",
          evidence: {},
        },
      },
    ],
  },
  hotels: {
    candidates: [
      {
        title: "Taj Lands End Mumbai",
        provider: "booking.com",
        url: "https://booking.com/taj",
        price: 8500,
        currency: "INR",
        priceType: "listed",
        structured: {
          category: "hotel",
          hotelName: "Taj Lands End",
          area: "Bandra Kurla Complex",
          starRating: 5,
          guestRating: 8.9,
          guestRatingScale: 10,
          reviewCount: 1200,
          roomType: "Deluxe King",
          amenities: ["Wi-Fi", "Pool", "Spa"],
          evidence: {},
        },
      },
    ],
  },
  cabs: {
    candidates: [],
  },
});

const unpricedItin = JSON.stringify({
  flights: {
    candidates: [
      {
        title: "Air India DEL → BOM",
        provider: "airindia.com",
        url: "https://airindia.com/b",
        price: null,
        currency: null,
        priceType: "unavailable",
      },
    ],
  },
  trains: { candidates: [] },
  hotels: { candidates: [] },
  cabs: { candidates: [] },
});

describe("regression: buildPickFromItinerary normalized titles", () => {
  it("normalizes flight title from structured data (not raw headline)", () => {
    const p = buildPickFromItinerary(
      JSON.parse(flightItinWithStructured).flights.candidates,
      "https://ixigo.com/flight/1",
    );
    expect(p).not.toBeNull();
    expect(p!.title).toContain("IndiGo");
    expect(p!.title).toContain("6E 123");
    expect(p!.title).toContain("GZB");
    expect(p!.title).toContain("BOM");
    expect(p!.title).not.toBe("Flight Option: Ghaziabad → Mumbai | ixigo.com");
  });

  it("normalizes train title from structured data", () => {
    const p = buildPickFromItinerary(
      JSON.parse(trainItin).trains.candidates,
      "https://irctc.co.in/train/12951",
    );
    expect(p).not.toBeNull();
    expect(p!.title).toContain("Rajdhani Express");
    expect(p!.title).toContain("12951");
    expect(p!.title).toContain("New Delhi");
    expect(p!.title).toContain("Mumbai Central");
  });

  it("normalizes cab title with vehicle class", () => {
    const p = buildPickFromItinerary(
      JSON.parse(flightItinWithStructured).cabs.candidates,
      "https://uber.com/ride/1",
    );
    expect(p).not.toBeNull();
    expect(p!.title).toContain("Uber");
    expect(p!.title).toContain("Sedan");
  });
});

describe("regression: computeBudget totals", () => {
  it("flight + cab = 6750 (hotel skipped, no extras)", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://ixigo.com/flight/1",
        title: "IndiGo 6E 123 — GZB → BOM",
        displayTitle: "IndiGo 6E 123 — GZB → BOM",
        provider: "ixigo.com",
        priceAtSelection: 6404,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabPick: {
        url: "https://uber.com/ride/1",
        title: "Uber Sedan",
        displayTitle: "Uber Sedan",
        provider: "uber.com",
        priceAtSelection: 346,
        currencyAtSelection: "INR",
      },
      cabSkipped: false,
    };
    const budget = computeBudget(s, flightItinWithStructured, {
      currency: "INR",
      nights: 2,
    });
    expect(budget.grandTotal).toBe(6_750);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines.map((l) => l.key)).toEqual(["transport", "cab"]);
    // Hotel line must not appear when skipped.
    expect(budget.lines.some((l) => l.key === "hotel")).toBe(false);
  });

  it("flight + hotel (2 nights) + cab = correct total", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://ixigo.com/flight/1",
        title: "IndiGo 6E 123 — GZB → BOM",
        displayTitle: "IndiGo 6E 123 — GZB → BOM",
        provider: "ixigo.com",
        priceAtSelection: 6404,
        currencyAtSelection: "INR",
      },
      hotelPick: {
        url: "https://booking.com/taj",
        title: "Taj Lands End — BKC",
        displayTitle: "Taj Lands End — BKC",
        provider: "booking.com",
        priceAtSelection: 8500,
        currencyAtSelection: "INR",
      },
      cabPick: {
        url: "https://uber.com/ride/1",
        title: "Uber Sedan",
        displayTitle: "Uber Sedan",
        provider: "uber.com",
        priceAtSelection: 346,
        currencyAtSelection: "INR",
      },
      cabSkipped: false,
    };
    const budget = computeBudget(s, flightItinWithStructured, {
      currency: "INR",
      nights: 2,
    });
    // 6404 + 8500*2 + 346 = 23750
    expect(budget.grandTotal).toBe(23_750);
    expect(budget.isComplete).toBe(true);
  });

  it("train + hotel = correct total", () => {
    const s: TripSelections = {
      ...emptySelections("train"),
      trainPick: {
        url: "https://irctc.co.in/train/12951",
        title: "Rajdhani Express #12951 — New Delhi → Mumbai Central",
        displayTitle: "Rajdhani Express #12951 — New Delhi → Mumbai Central",
        provider: "irctc.co.in",
        priceAtSelection: 2500,
        currencyAtSelection: "INR",
      },
      hotelPick: {
        url: "https://booking.com/taj",
        title: "Taj Lands End",
        displayTitle: "Taj Lands End",
        provider: "booking.com",
        priceAtSelection: 8500,
        currencyAtSelection: "INR",
      },
      cabSkipped: true,
    };
    const budget = computeBudget(s, trainItin, {
      currency: "INR",
      nights: 1,
    });
    // 2500 + 8500*1 = 11000
    expect(budget.grandTotal).toBe(11_000);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines.some((l) => l.key === "cab")).toBe(false);
  });

  it("flight only = transport price only", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://ixigo.com/flight/1",
        title: "IndiGo 6E 123 — GZB → BOM",
        displayTitle: "IndiGo 6E 123 — GZB → BOM",
        provider: "ixigo.com",
        priceAtSelection: 6404,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const budget = computeBudget(s, flightItinWithStructured, {
      currency: "INR",
      nights: 2,
    });
    expect(budget.grandTotal).toBe(6404);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines).toHaveLength(1);
    expect(budget.lines[0].key).toBe("transport");
  });

  it("train only = transport price only", () => {
    const s: TripSelections = {
      ...emptySelections("train"),
      trainPick: {
        url: "https://irctc.co.in/train/12951",
        title: "Rajdhani Express #12951 — New Delhi → Mumbai Central",
        displayTitle: "Rajdhani Express #12951 — New Delhi → Mumbai Central",
        provider: "irctc.co.in",
        priceAtSelection: 2500,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const budget = computeBudget(s, trainItin, {
      currency: "INR",
      nights: 1,
    });
    expect(budget.grandTotal).toBe(2500);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines).toHaveLength(1);
    expect(budget.lines[0].key).toBe("transport");
  });

  it("transport with skipped hotel and cab = transport total only", () => {
    const s: TripSelections = {
      ...emptySelections("train"),
      trainPick: {
        url: "https://irctc.co.in/train/12951",
        title: "Rajdhani Express",
        displayTitle: "Rajdhani Express",
        provider: "irctc.co.in",
        priceAtSelection: 2500,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const budget = computeBudget(s, trainItin, { currency: "INR", nights: 3 });
    expect(budget.grandTotal).toBe(2500);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines).toHaveLength(1);
  });

  it("missing price → grandTotal null, isComplete false (never 0)", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://airindia.com/b",
        title: "Air India",
        displayTitle: "Air India",
        provider: "airindia.com",
        priceAtSelection: null,
        currencyAtSelection: null,
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const budget = computeBudget(s, unpricedItin, { currency: "INR", nights: 2 });
    expect(budget.grandTotal).toBeNull();
    expect(budget.isComplete).toBe(false);
  });

  it("no selections at all → grandTotal 0", () => {
    const budget = computeBudget(emptySelections(), flightItinWithStructured, {
      currency: "INR",
      nights: 2,
    });
    expect(budget.grandTotal).toBe(0);
    expect(budget.isComplete).toBe(true);
    expect(budget.lines).toHaveLength(0);
  });
});

describe("regression: canConfirm validation", () => {
  it("refuses when transport mode is 'none'", () => {
    const res = canConfirm(emptySelections(), flightItinWithStructured);
    expect(res.ok).toBe(false);
    expect(res.reasons).toContain("Choose a transport mode (flight or train).");
  });

  it("refuses when flight mode set but no flight pick", () => {
    const res = canConfirm({ ...emptySelections("flight") }, flightItinWithStructured);
    expect(res.ok).toBe(false);
    expect(res.reasons).toContain("Pick a flight.");
  });

  it("refuses when train mode set but no train pick", () => {
    const res = canConfirm({ ...emptySelections("train") }, trainItin);
    expect(res.ok).toBe(false);
    expect(res.reasons).toContain("Pick a train.");
  });

  it("accepts flight + skipped hotel + skipped cab", () => {
    const s: TripSelections = {
      ...emptySelections("flight"),
      flightPick: {
        url: "https://ixigo.com/flight/1",
        title: "IndiGo 6E 123 — GZB → BOM",
        displayTitle: "IndiGo 6E 123 — GZB → BOM",
        provider: "ixigo.com",
        priceAtSelection: 6404,
        currencyAtSelection: "INR",
      },
      hotelSkipped: true,
      cabSkipped: true,
    };
    const res = canConfirm(s, flightItinWithStructured);
    expect(res.ok).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it("accepts train + hotel (no cab)", () => {
    const s: TripSelections = {
      ...emptySelections("train"),
      trainPick: {
        url: "https://irctc.co.in/train/12951",
        title: "Rajdhani Express",
        displayTitle: "Rajdhani Express",
        provider: "irctc.co.in",
        priceAtSelection: 2500,
        currencyAtSelection: "INR",
      },
      hotelPick: {
        url: "https://booking.com/taj",
        title: "Taj Lands End",
        displayTitle: "Taj Lands End",
        provider: "booking.com",
        priceAtSelection: 8500,
        currencyAtSelection: "INR",
      },
      cabSkipped: true,
    };
    const res = canConfirm(s, trainItin);
    expect(res.ok).toBe(true);
  });
});

// ───────────────────────────── splitFlightsByEligibility ──────────────────

function flightCand(
  url: string,
  structured: Partial<FlightStructured>,
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    title: "title",
    category: "flight",
    source: "x",
    sourceUrl: url,
    sourceHostname: "x",
    description: "",
    price: 6000,
    currency: "INR",
    priceType: "listed",
    retrievedAt: new Date().toISOString(),
    availabilityStatus: "unverified",
    kind: "flight",
    url,
    provider: "x",
    snippet: "",
    estimatedPrice: 6000,
    confidence: "estimate",
    structured: {
      category: "flight",
      airline: null,
      originIata: null,
      destinationIata: null,
      originCity: null,
      destinationCity: null,
      departureDate: null,
      arrivalDate: null,
      departureTime: null,
      arrivalTime: null,
      durationMinutes: null,
      stops: null,
      cabin: null,
      baggageAllowance: null,
      flightNumber: null,
      tripType: null,
      completeness: "partial",
      evidence: {},
      ...structured,
    } as FlightStructured,
    ...overrides,
  };
}

describe("splitFlightsByEligibility", () => {
  it("places complete+routed flights in selectable", () => {
    const good = flightCand("https://a", {
      airline: "IndiGo",
      flightNumber: "6E234",
      originIata: "DEL",
      destinationIata: "BOM",
      completeness: "complete",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility(
      [good],
      "DEL",
      "BOM",
    );
    expect(selectable).toHaveLength(1);
    expect(sourceOnly).toHaveLength(0);
  });

  it("buckets INSUFFICIENT as source-only", () => {
    const bad = flightCand("https://a", {
      airline: null,
      flightNumber: null,
      originIata: null,
      destinationIata: null,
      completeness: "insufficient",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility([bad], "DEL", "BOM");
    expect(selectable).toHaveLength(0);
    expect(sourceOnly).toHaveLength(1);
  });

  it("buckets route-mismatched flights as source-only", () => {
    const wrongRoute = flightCand("https://a", {
      airline: "IndiGo",
      originIata: "ORD",
      destinationIata: "ATL",
      completeness: "complete",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility([wrongRoute], "DEL", "BOM");
    expect(selectable).toHaveLength(0);
    expect(sourceOnly).toHaveLength(1);
  });

  it("buckets rows that lack an airline OR flight number as source-only", () => {
    const noIdentity = flightCand("https://a", {
      originIata: "DEL",
      destinationIata: "BOM",
      completeness: "partial",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility([noIdentity], "DEL", "BOM");
    expect(selectable).toHaveLength(0);
    expect(sourceOnly).toHaveLength(1);
  });

  it("keeps rows when trip IATAs are unknown (can't check route)", () => {
    const partial = flightCand("https://a", {
      airline: "IndiGo",
      originIata: "ORD",
      destinationIata: "ATL",
      completeness: "complete",
    });
    const { selectable } = splitFlightsByEligibility([partial], null, null);
    expect(selectable).toHaveLength(1);
  });

  it("one-way trip: rejects reverse-direction match (BOM → DEL for a DEL → BOM trip)", () => {
    const reverse = flightCand("https://a", {
      airline: "IndiGo",
      originIata: "BOM",
      destinationIata: "DEL",
      completeness: "complete",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility(
      [reverse],
      "DEL",
      "BOM",
      { isRoundTrip: false },
    );
    expect(selectable).toHaveLength(0);
    expect(sourceOnly).toHaveLength(1);
  });

  it("round-trip: accepts the reverse leg (BOM → DEL for a DEL ⇄ BOM trip)", () => {
    const reverse = flightCand("https://a", {
      airline: "IndiGo",
      originIata: "BOM",
      destinationIata: "DEL",
      completeness: "complete",
    });
    const { selectable } = splitFlightsByEligibility(
      [reverse],
      "DEL",
      "BOM",
      { isRoundTrip: true },
    );
    expect(selectable).toHaveLength(1);
  });

  it("rejects a route that only touches one end (DEL → HYD on a DEL → BOM trip)", () => {
    const halfMatch = flightCand("https://a", {
      airline: "IndiGo",
      originIata: "DEL",
      destinationIata: "HYD",
      completeness: "partial",
    });
    const { selectable, sourceOnly } = splitFlightsByEligibility(
      [halfMatch],
      "DEL",
      "BOM",
    );
    expect(selectable).toHaveLength(0);
    expect(sourceOnly).toHaveLength(1);
  });
});
