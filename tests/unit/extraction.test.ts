// Phase 6 — structured extraction regression suite.
//
// Pins the invariants of the deterministic extraction layer that sits
// between raw Tavily snippets and the UI:
//   - Per-category structured fields are parsed from title/snippet when
//     stated, and stay null otherwise. Nothing is invented.
//   - completenessScore reflects how many fields were filled in.
//   - looksLikeDestinationGuide catches the obvious listicle noise so the
//     ranking layer can drop it.

import { describe, it, expect } from "vitest";
import {
  extract,
  extractFlight,
  extractHotel,
  extractTrain,
  extractCab,
  looksLikeDestinationGuide,
  completenessScore,
  parseFlightDuration,
} from "@/lib/extraction";

const flightHit = {
  title: "IndiGo DEL → BOM Non-stop 08:30 - 10:45 Economy",
  description: "Depart 2027-02-01, duration 2h 15m, from ₹4,850",
  url: "https://www.goindigo.in/flight/DEL-BOM",
  sourceHostname: "goindigo.in",
};

describe("extractFlight", () => {
  it("parses airline, IATA pair, times, duration, stops, cabin", () => {
    const s = extractFlight(flightHit);
    expect(s.airline).toBe("IndiGo");
    expect(s.originIata).toBe("DEL");
    expect(s.destinationIata).toBe("BOM");
    expect(s.departureTime).toBe("08:30");
    expect(s.arrivalTime).toBe("10:45");
    expect(s.durationMinutes).toBe(135);
    expect(s.stops).toBe(0);
    expect(s.cabin).toBe("economy");
    expect(s.evidence.airline).toBeTruthy();
    expect(s.evidence.originIata).toBeTruthy();
  });

  it("marks stops as 1 when '1 stop' appears", () => {
    const s = extractFlight({
      title: "Air India Mumbai to Bengaluru 1 stop",
      description: "duration 4h",
      url: "https://airindia.com/x",
      sourceHostname: "airindia.com",
    });
    expect(s.stops).toBe(1);
  });

  it("stays null when no airline / no times / no IATA pair", () => {
    const s = extractFlight({
      title: "Cheap fares on sale",
      description: "book now",
      url: "https://example.com/x",
      sourceHostname: "example.com",
    });
    expect(s.airline).toBeNull();
    expect(s.originIata).toBeNull();
    expect(s.destinationIata).toBeNull();
    expect(s.departureTime).toBeNull();
    expect(s.arrivalTime).toBeNull();
    expect(s.stops).toBeNull();
    expect(s.completeness).toBe("insufficient");
  });

  it("flight number regex ignores bare prices (₹6404 is not 6E6404)", () => {
    // Real-world bug: /[A-Z0-9]{2}\s*\d{2,4}/ matched "6404" as "64"+"04"
    // because [A-Z0-9] allows pure digits. flightNumber must require a
    // LETTER in the airline-code half.
    const s = extractFlight({
      title: "IndiGo flights HDO → BOM | from ₹6,404 | book cheap tickets",
      description: "Lowest fare ₹6404. Compare 50+ airlines.",
      url: "https://www.ixigo.com/cheap-flights/ghaziabad-mumbai-hdo-bom",
      sourceHostname: "ixigo.com",
    });
    expect(s.flightNumber).toBeNull();
  });

  it("flight number regex accepts real codes: 6E 234, AI-101, UK 955", () => {
    const a = extractFlight({
      title: "IndiGo 6E 234 DEL → BOM",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(a.flightNumber).toBe("6E234");
    const b = extractFlight({
      title: "Air India AI-101 EWR → DEL",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(b.flightNumber).toBe("AI101");
    const c = extractFlight({
      title: "Vistara UK 955 DEL → BOM",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(c.flightNumber).toBe("UK955");
  });

  it("cabin stays null when no class/cabin/fare context (no end-of-title either)", () => {
    const s = extractFlight({
      title: "IndiGo offers business lounge access on every DEL → BOM flight",
      description: "Book Mumbai tickets today.",
      url: "https://example.com",
      sourceHostname: "example.com",
    });
    // "business" appears but as "business lounge" — not a cabin claim.
    expect(s.cabin).toBeNull();
  });

  it("cabin accepts 'Economy class' and 'Business cabin'", () => {
    const a = extractFlight({
      title: "IndiGo DEL BOM",
      description: "Economy class fare from ₹4,850.",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(a.cabin).toBe("economy");
    const b = extractFlight({
      title: "Lufthansa DEL → FRA",
      description: "Business cabin, lie-flat seat.",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(b.cabin).toBe("business");
  });

  it("completeness tier: complete when identity + route + times + duration", () => {
    const s = extractFlight({
      title: "IndiGo 6E 234 DEL → BOM Non-stop 08:30 - 10:45 Economy",
      description: "duration 2h 15m",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(s.completeness).toBe("complete");
  });

  it("completeness tier: partial when route known but times missing", () => {
    const s = extractFlight({
      title: "IndiGo HDO → BOM — book cheap tickets",
      description: "lowest fare",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(s.completeness).toBe("partial");
  });

  it("completeness tier: insufficient when no identity and no route", () => {
    const s = extractFlight({
      title: "Flights from the north — compare prices",
      description: "book now",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(s.completeness).toBe("insufficient");
  });

  it("baggage allowance is read when the snippet states it", () => {
    const s = extractFlight({
      title: "IndiGo 6E 234 DEL → BOM",
      description: "Includes 7 kg cabin + 15 kg check-in baggage.",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(s.baggageAllowance).toMatch(/7\s*kg.*15\s*kg/i);
  });

  it("trip type: detects round-trip and one-way, stays null otherwise", () => {
    const r = extractFlight({
      title: "Cheap round-trip flights DEL ⇄ BOM",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(r.tripType).toBe("round-trip");
    const o = extractFlight({
      title: "IndiGo 6E 234 DEL → BOM one-way fare",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(o.tripType).toBe("one-way");
    const u = extractFlight({
      title: "IndiGo DEL → BOM",
      description: "",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(u.tripType).toBeNull();
  });

  it("departure date extracted for ISO / 'DD Mon YYYY' / 'Mon DD, YYYY'", () => {
    expect(
      extractFlight({
        title: "IndiGo 6E 234 DEL → BOM on 2027-02-01",
        description: "",
        url: "https://x",
        sourceHostname: "x",
      }).departureDate,
    ).toBe("2027-02-01");
    expect(
      extractFlight({
        title: "IndiGo 6E 234 DEL → BOM 12 Jan 2027",
        description: "",
        url: "https://x",
        sourceHostname: "x",
      }).departureDate,
    ).toBe("2027-01-12");
    expect(
      extractFlight({
        title: "IndiGo 6E 234 DEL → BOM January 12, 2027",
        description: "",
        url: "https://x",
        sourceHostname: "x",
      }).departureDate,
    ).toBe("2027-01-12");
  });
});

describe("parseFlightDuration (24h cap + keyword anchor)", () => {
  it("accepts a reasonable keyword-anchored duration", () => {
    expect(parseFlightDuration("duration 2h 15m from Delhi")).toBe(135);
    expect(parseFlightDuration("flight time: 4 hr 10 min")).toBe(250);
    expect(parseFlightDuration("total travel time 6h")).toBe(360);
  });

  it("rejects an implausible 92-hour match (likely 'updated 92 hours ago')", () => {
    expect(
      parseFlightDuration("Flight tracker · last updated 92 hours ago"),
    ).toBeNull();
    expect(parseFlightDuration("25 hours of noise")).toBeNull();
  });

  it("accepts tight 'Xh Ym' format even without an anchor", () => {
    expect(parseFlightDuration("DEL BOM 2h 15m non-stop")).toBe(135);
  });

  it("extractFlight never sets durationMinutes above 24h", () => {
    const s = extractFlight({
      title: "IndiGo 6E 234 DEL → BOM",
      description: "Last updated 92 hours ago on flight tracker.",
      url: "https://x",
      sourceHostname: "x",
    });
    expect(s.durationMinutes).toBeNull();
  });
});

describe("extractHotel", () => {
  it("parses name, area, star rating, guest rating, review count, amenities", () => {
    const s = extractHotel({
      title: "Taj Lands End, Mumbai - Luxury Hotel in Bandra | Booking.com",
      description:
        "5-star hotel in Bandra West. Rated 4.6/5 (2,450 reviews). Free WiFi, Breakfast, Swimming Pool.",
      url: "https://booking.com/hotel/in/taj-lands-end.html",
      sourceHostname: "booking.com",
    });
    expect(s.hotelName).toBe("Taj Lands End");
    expect(s.starRating).toBe(5);
    expect(s.guestRating).toBe(4.6);
    expect(s.guestRatingScale).toBe(5);
    expect(s.reviewCount).toBe(2450);
    expect(s.amenities).toContain("Wi-Fi");
    expect(s.amenities).toContain("Breakfast");
    expect(s.amenities).toContain("Swimming Pool");
  });

  it("does not fabricate a rating when none is stated", () => {
    const s = extractHotel({
      title: "Hotel Marine Plaza",
      description: "Hotel near Marine Drive",
      url: "https://marineplaza.example/",
      sourceHostname: "marineplaza.example",
    });
    expect(s.starRating).toBeNull();
    expect(s.guestRating).toBeNull();
    expect(s.reviewCount).toBeNull();
    expect(s.amenities).toEqual([]);
  });
});

describe("extractTrain", () => {
  it("parses train number, name, class", () => {
    const s = extractTrain({
      title: "12951 Mumbai Rajdhani Express - Mumbai to Delhi",
      description: "Departs 16:35, 2A / 3A available, 15h 45m journey",
      url: "https://irctc.co.in/t/12951",
      sourceHostname: "irctc.co.in",
    });
    expect(s.trainNumber).toBe("12951");
    expect(s.trainName).toContain("Rajdhani");
    expect(s.travelClass).toBe("2A");
    expect(s.durationMinutes).toBe(15 * 60 + 45);
  });

  it("rejects a 4-digit year as a train number", () => {
    const s = extractTrain({
      title: "Train deals in 2026",
      description: "book now",
      url: "https://example.com/x",
      sourceHostname: "example.com",
    });
    expect(s.trainNumber).toBeNull();
  });
});

describe("extractCab", () => {
  it("picks provider from hostname and reads distance/duration", () => {
    const s = extractCab({
      title: "Uber ride — Airport to city centre",
      description: "Approx 12.5 km, ~35 min, UberX available",
      url: "https://uber.com/ride",
      sourceHostname: "uber.com",
    });
    expect(s.provider).toBe("Uber");
    expect(s.vehicleClass).toBe("UberX");
    expect(s.distanceKm).toBe(12.5);
    expect(s.durationMinutes).toBe(35);
  });
});

describe("completenessScore", () => {
  it("rises as more fields are filled in", () => {
    const sparse = extractFlight({
      title: "cheap flights",
      description: "book",
      url: "x",
      sourceHostname: "x",
    });
    const rich = extractFlight(flightHit);
    expect(completenessScore(rich)).toBeGreaterThan(completenessScore(sparse));
  });
});

describe("looksLikeDestinationGuide", () => {
  it("flags 'things to do' / 'travel guide' noise", () => {
    expect(
      looksLikeDestinationGuide({
        title: "Top 10 things to do in Mumbai",
        description: "destination guide",
        url: "https://example.com/guide",
        sourceHostname: "example.com",
      }),
    ).toBe(true);
  });

  it("does not flag a real flight listing", () => {
    expect(looksLikeDestinationGuide(flightHit)).toBe(false);
  });
});

describe("extract dispatcher", () => {
  it("routes to the correct category", () => {
    expect(extract("flight", flightHit).category).toBe("flight");
    expect(
      extract("hotel", {
        title: "Hotel X",
        description: "",
        url: "https://x",
        sourceHostname: "x",
      }).category,
    ).toBe("hotel");
  });
});
