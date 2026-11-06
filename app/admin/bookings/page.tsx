import Link from "next/link";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmBookingForm } from "@/app/trips/[id]/ConfirmBookingForm";
import { formatMoney } from "@/lib/currency";
import { isBookedBooking, isCancelledBooking, isFailedBooking, isNotRequiredBooking, isPendingBooking } from "@/lib/booking";

function fmt(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export default async function BookingOperationsPage() {
  const user = await getCurrentUser();
  if (!canHandleBookings(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Travel operations access only</p>
        <p className="mt-1 text-sm text-slate-500">
          Booking confirmations are recorded by travel admins and super admins.
        </p>
      </div>
    );
  }

  const trips = await db.tripRequest.findMany({
    where: {
      status: {
        in: ["booking_links_generated", "booking_pending_confirmation", "booked", "cancellation_requested"],
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      requester: { select: { name: true, email: true } },
      bookings: { orderBy: { createdAt: "asc" }, include: { confirmedBy: { select: { name: true } } } },
    },
  });

  const queue = trips.filter((trip) =>
    ["booking_links_generated", "booking_pending_confirmation"].includes(trip.status),
  );
  const completed = trips.filter((trip) =>
    ["booked", "cancellation_requested"].includes(trip.status),
  );

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Travel operations</p>
        <h1 className="page-title mt-2">Booking operations</h1>
        <p className="page-subtitle mt-2">
          Record real provider confirmation references. This app never performs a booking and never
          invents a reference; a booking only becomes confirmed when a travel admin saves one.
        </p>
      </section>

      <section className="glass overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Awaiting confirmation</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {queue.length} trip{queue.length === 1 ? "" : "s"} with provider links to record.
            </p>
          </div>
        </div>
        {queue.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500">
            Nothing is awaiting confirmation right now.
          </p>
        ) : (
          <ul className="divide-y divide-white/60">
            {queue.map((trip) => (
              <li key={trip.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/trips/${trip.id}`}
                      className="text-lg font-semibold tracking-tight text-ink hover:text-indigo-600"
                    >
                      {trip.origin} → {trip.destination}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {trip.requester.name} · {trip.requester.email} ·{" "}
                      {trip.bookings.filter((b) => b.status === "pending" || b.status === "link_only").length} link-only row(s)
                    </p>
                  </div>
                  <StatusPill status={trip.status} />
                </div>

                <div className="mt-3 space-y-2">
                  {trip.bookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/40 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
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
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {booking.estimatedCost != null
                            ? `${formatMoney(booking.estimatedCost, booking.currency ?? trip.currency)} listed`
                            : "price not listed"}{" "}
                          · {booking.source} · retrieved {fmt(booking.retrievedAt)}
                          {booking.reference && ` · ref ${booking.reference}`}
                          {booking.confirmedBy && ` · by ${booking.confirmedBy.name}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={booking.url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-glass text-xs"
                        >
                          Provider ↗
                        </a>
                        {isPendingBooking(booking.status) &&
                          ["booking_links_generated", "booking_pending_confirmation"].includes(
                            trip.status,
                          ) && (
                            <ConfirmBookingForm tripId={trip.id} bookingId={booking.id} />
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Recently booked / cancelling</h2>
          <p className="mt-0.5 text-xs text-slate-500">Reference history for completed legs.</p>
        </div>
        {completed.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No confirmed bookings yet.
          </p>
        ) : (
          <ul className="divide-y divide-white/60">
            {completed.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                <div>
                  <Link
                    href={`/trips/${trip.id}`}
                    className="font-semibold text-ink hover:text-indigo-600"
                  >
                    {trip.origin} → {trip.destination}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {trip.requester.name} ·{" "}
                    {trip.bookings.filter((b) => isBookedBooking(b.status)).length} confirmed
                    · {trip.bookings.filter((b) => isCancelledBooking(b.status)).length} cancelled
                  </p>
                </div>
                <StatusPill status={trip.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
