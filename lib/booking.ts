import type { Booking, TripRequest } from "@prisma/client";

// Booking leg states (Issue 1 — booking lifecycle redesign).
//
// Canonical states:
//   pending        — a booking link was generated and is awaiting an external
//                   action or a travel-admin confirmation.
//   booked         — the leg was booked on the real provider and a real
//                   confirmation reference was recorded (manual confirmation).
//   not_required   — the requester/travel ops marked the category unnecessary;
//                   the leg is exempt from the "every required leg resolved" rule.
//   failed         — a provider booking attempt was recorded as failed; the trip
//                   must not be booked while a required leg is failed.
//   cancelled      — the trip cancellation was verified; history is preserved.
//
// Legacy stored values are still accepted everywhere and normalised:
//   link_only        -> pending
//   manually_confirmed -> booked
// No historical rows are rewritten; the alias mapping keeps old records
// readable while new writes use the canonical vocabulary.

export const BOOKING_STATES = [
  "pending",
  "booked",
  "not_required",
  "failed",
  "cancelled",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

const BOOKING_STATE_VALUES: readonly string[] = BOOKING_STATES;

export const BOOKING_STATE_ALIASES: Record<string, BookingState> = {
  link_only: "pending",
  manually_confirmed: "booked",
};

export function normalizeBookingState(
  status: string | null | undefined,
): BookingState | null {
  if (!status) return null;
  const value = status.trim();
  const canonical = BOOKING_STATE_ALIASES[value] ?? value;
  return (BOOKING_STATE_VALUES as readonly string[]).includes(canonical)
    ? (canonical as BookingState)
    : null;
}

export function isPendingBooking(status: string | null | undefined): boolean {
  const state = normalizeBookingState(status);
  return state === "pending";
}

export function isBookedBooking(status: string | null | undefined): boolean {
  const state = normalizeBookingState(status);
  return state === "booked";
}

export function isNotRequiredBooking(status: string | null | undefined): boolean {
  return normalizeBookingState(status) === "not_required";
}

export function isFailedBooking(status: string | null | undefined): boolean {
  return normalizeBookingState(status) === "failed";
}

export function isCancelledBooking(status: string | null | undefined): boolean {
  return normalizeBookingState(status) === "cancelled";
}

/** Statuses that represent an unresolved (or legacy-unresolved) attempt. */
export const UNRESOLVED_BOOKING_STATUSES: readonly string[] = ["pending", "link_only"];

/** Statuses that represent a leg resolved successfully by a real provider. */
export const RESOLVED_BOOKING_STATUSES: readonly string[] = ["booked", "manually_confirmed"];

export type BookingLeg = {
  kind: string;
  status: string | null;
};

/**
 * Booking legs that the "trip booked" rule applies to. `not_required` legs are
 * exempt: the employee decided the category is unnecessary, so the trip can be
 * booked once every *required* leg is resolved successfully.
 */
export function requiredBookingLegs(bookings: BookingLeg[]): BookingLeg[] {
  return bookings.filter((b) => normalizeBookingState(b.status) !== "not_required");
}

/**
 * True when every required leg has been resolved successfully (booked with a
 * recorded real provider reference). An empty required set is vacuously resolved.
 */
export function allRequiredLegsResolved(bookings: BookingLeg[]): boolean {
  const required = requiredBookingLegs(bookings);
  if (required.length === 0) return true;
  return required.every((b) => isBookedBooking(b.status));
}

/** Kind + state of the first required leg that is pending or failed. */
export function firstUnresolvedLeg(bookings: BookingLeg[]): { kind: string; state: string } | null {
  const required = requiredBookingLegs(bookings);
  const blocked = required.find((b) => !isBookedBooking(b.status));
  if (!blocked) return null;
  const state = normalizeBookingState(blocked.status) ?? "pending";
  return { kind: blocked.kind, state };
}

/**
 * Recompute the trip-level booking phase from the current leg rows.
 * Returns the next trip status once a leg transition has been applied, or the
 * current status when nothing changed.
 */
export function nextTripBookingStatus(
  tripStatus: string,
  bookings: Array<Pick<Booking, "kind" | "status">>,
): TripRequest["status"] {
  if (tripStatus === "booked" || tripStatus === "cancelled" || tripStatus === "cancellation_requested") {
    return tripStatus;
  }
  if (tripStatus !== "booking_links_generated" && tripStatus !== "booking_pending_confirmation") {
    // Not in the booking phase yet — leave the phase alone.
    return tripStatus;
  }
  return allRequiredLegsResolved(bookings) ? "booked" : "booking_pending_confirmation";
}
