import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { formatMoney } from "@/lib/currency";
import {
  isBookedBooking,
  isCancelledBooking,
  isFailedBooking,
  isNotRequiredBooking,
} from "@/lib/booking";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function MyBookingsPage() {
  const user = await getCurrentUser();
  const trips = await db.tripRequest.findMany({
    where: { requesterId: user.id, bookings: { some: {} } },
    orderBy: { createdAt: "desc" },
    include: { bookings: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Workspace</p>
        <h1 className="page-title mt-2">My bookings</h1>
        <p className="page-subtitle mt-2">
          Real provider links and confirmation references recorded by travel operations. Opening a
          link never changes a booking state.
        </p>
      </section>

      {trips.length === 0 ? (
        <section className="glass px-6 py-14 text-center">
          <p className="font-semibold">No booking links yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Once a request is approved, booking links can be generated. A travel admin records the
            real confirmation reference after the booking is made externally.
          </p>
          <Link href="/trips" className="btn-primary mt-4 inline-flex">
            View my trips
          </Link>
        </section>
      ) : (
        <div className="space-y-6">
          {trips.map((trip) => (
            <section key={trip.id} className="glass overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
                <div>
                  <Link
                    href={`/trips/${trip.id}`}
                    className="text-lg font-semibold tracking-tight text-ink hover:text-indigo-600"
                  >
                    {trip.origin} → {trip.destination}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(trip.departDate)} –{" "}
                    {trip.returnDate ? formatDate(trip.returnDate) : "One-way"} ·{" "}
                    {trip.currency} · {trip.bookings.length} booking row
                    {trip.bookings.length === 1 ? "" : "s"}
                  </p>
                </div>
                <StatusPill status={trip.status} />
              </div>

              <div className="divide-y divide-white/60">
                {trip.bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tag-link">{booking.kind}</span>
                        <span className="font-medium text-ink">{booking.vendor}</span>
                        <span
                          className={
                            isBookedBooking(booking.status)
                              ? "tag-confirmed"
                              : isCancelledBooking(booking.status)
                                ? "chip-warn"
                                : isNotRequiredBooking(booking.status)
                                  ? "tag-link"
                                  : isFailedBooking(booking.status)
                                    ? "chip-warn"
                                    : "tag-link"
                          }
                        >
                          {booking.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Source: {booking.source} · retrieved{" "}
                        {booking.retrievedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                        {booking.estimatedCost != null &&
                          ` · ${formatMoney(booking.estimatedCost, booking.currency ?? trip.currency)} listed`}
                      </p>
                      {booking.reference && (
                        <p className="mt-1 text-xs text-emerald-700">
                          Confirmation reference: <strong>{booking.reference}</strong>
                        </p>
                      )}
                      {booking.cancellationReference && (
                        <p className="mt-1 text-xs text-rose-700">
                          Cancellation reference: <strong>{booking.cancellationReference}</strong>
                        </p>
                      )}
                    </div>
                    <a
                      href={booking.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-glass text-xs"
                    >
                      Open provider ↗
                    </a>
                  </div>
                ))}
              </div>

              {trip.status === "booking_links_generated" && (
                <p className="border-t border-white/60 bg-sky-50/60 px-5 py-3 text-xs text-sky-800">
                  Links are ready. Book on the provider site; travel operations will record the real
                  confirmation reference.
                </p>
              )}
              {trip.status === "booking_pending_confirmation" && (
                <p className="border-t border-white/60 bg-amber-50/60 px-5 py-3 text-xs text-amber-800">
                  Some legs are confirmed and some are still awaiting a real provider reference.
                </p>
              )}
              {trip.status === "cancellation_requested" && (
                <p className="border-t border-white/60 bg-amber-50/60 px-5 py-3 text-xs text-amber-800">
                  Cancellation requested. Nothing is cancelled until travel operations verify it
                  with the provider.
                </p>
              )}
              {trip.status === "cancelled" && (
                <p className="border-t border-white/60 bg-rose-50/60 px-5 py-3 text-xs text-rose-800">
                  Cancellation verified. See the cancellation references above.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
