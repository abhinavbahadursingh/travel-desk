import { describe, it, expect } from "vitest";
import {
  normalizeBookingState,
  isPendingBooking,
  isBookedBooking,
  isNotRequiredBooking,
  isCancelledBooking,
  requiredBookingLegs,
  allRequiredLegsResolved,
  firstUnresolvedLeg,
  nextTripBookingStatus,
} from "@/lib/booking";

describe("booking.normalizeBookingState", () => {
  it("maps canonical states", () => {
    expect(normalizeBookingState("pending")).toBe("pending");
    expect(normalizeBookingState("booked")).toBe("booked");
    expect(normalizeBookingState("not_required")).toBe("not_required");
    expect(normalizeBookingState("failed")).toBe("failed");
    expect(normalizeBookingState("cancelled")).toBe("cancelled");
  });

  it("maps legacy aliases through", () => {
    expect(normalizeBookingState("link_only")).toBe("pending");
    expect(normalizeBookingState("manually_confirmed")).toBe("booked");
  });

  it("returns null for unknown + empty values", () => {
    expect(normalizeBookingState("whatever")).toBeNull();
    expect(normalizeBookingState(null)).toBeNull();
    expect(normalizeBookingState(undefined)).toBeNull();
  });

  it("predicates line up with normalization", () => {
    expect(isPendingBooking("link_only")).toBe(true);
    expect(isBookedBooking("manually_confirmed")).toBe(true);
    expect(isNotRequiredBooking("not_required")).toBe(true);
    expect(isCancelledBooking("cancelled")).toBe(true);
  });
});

describe("booking.requiredBookingLegs / allRequiredLegsResolved", () => {
  it("drops not_required legs from the required set", () => {
    const legs = [
      { kind: "flight", status: "booked" },
      { kind: "hotel", status: "not_required" },
    ];
    expect(requiredBookingLegs(legs).map((l) => l.kind)).toEqual(["flight"]);
    expect(allRequiredLegsResolved(legs)).toBe(true);
  });

  it("is false while any required leg is still pending", () => {
    const legs = [
      { kind: "flight", status: "booked" },
      { kind: "hotel", status: "pending" },
    ];
    expect(allRequiredLegsResolved(legs)).toBe(false);
  });

  it("is vacuously true with no legs at all", () => {
    expect(allRequiredLegsResolved([])).toBe(true);
  });

  it("firstUnresolvedLeg names the first blocking leg", () => {
    const legs = [
      { kind: "flight", status: "booked" },
      { kind: "hotel", status: "pending" },
      { kind: "train", status: "pending" },
    ];
    expect(firstUnresolvedLeg(legs)).toEqual({ kind: "hotel", state: "pending" });
  });

  it("firstUnresolvedLeg returns null when all are resolved", () => {
    expect(firstUnresolvedLeg([{ kind: "flight", status: "booked" }])).toBeNull();
  });
});

describe("booking.nextTripBookingStatus", () => {
  it("keeps terminal states untouched", () => {
    expect(nextTripBookingStatus("booked", [])).toBe("booked");
    expect(nextTripBookingStatus("cancelled", [])).toBe("cancelled");
    expect(nextTripBookingStatus("cancellation_requested", [])).toBe("cancellation_requested");
  });

  it("promotes booking_links_generated to booked once every required leg is resolved", () => {
    expect(
      nextTripBookingStatus("booking_links_generated", [
        { kind: "flight", status: "booked" },
        { kind: "hotel", status: "booked" },
      ]),
    ).toBe("booked");
  });

  it("holds at booking_pending_confirmation while anything is pending", () => {
    expect(
      nextTripBookingStatus("booking_links_generated", [
        { kind: "flight", status: "booked" },
        { kind: "hotel", status: "pending" },
      ]),
    ).toBe("booking_pending_confirmation");
  });

  it("does not move pre-booking statuses forward", () => {
    expect(nextTripBookingStatus("approved", [{ kind: "flight", status: "booked" }])).toBe(
      "approved",
    );
    expect(nextTripBookingStatus("draft", [])).toBe("draft");
  });
});
