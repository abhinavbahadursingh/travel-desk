import Link from "next/link";
import { getCurrentUser, canHandleBookings } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReviewCancellation } from "@/app/trips/[id]/CancellationPanel";

export default async function CancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canHandleBookings(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Travel operations access only</p>
        <p className="mt-1 text-sm text-slate-500">
          Cancellation review is restricted to travel admins and super admins.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const scope = params.scope === "all" ? "all" : "pending";
  const requests = await db.cancellationRequest.findMany({
    where: scope === "all" ? {} : { status: "pending" },
    include: {
      tripRequest: {
        include: {
          requester: { select: { name: true, email: true } },
          bookings: { select: { id: true, kind: true, vendor: true, status: true, reference: true } },
        },
      },
      requestedBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Travel operations</p>
            <h1 className="page-title mt-2">Cancellation requests</h1>
            <p className="page-subtitle mt-2">
              A request never cancels a booking. Verify with the provider and record the real
              cancellation reference to complete it.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/cancellations"
              className={`glass-pill ${scope === "pending" ? "ring-2 ring-indigo-300" : ""}`}
            >
              Pending
            </Link>
            <Link
              href="/admin/cancellations?scope=all"
              className={`glass-pill ${scope === "all" ? "ring-2 ring-indigo-300" : ""}`}
            >
              All
            </Link>
          </div>
        </div>
      </section>

      {requests.length === 0 ? (
        <section className="glass px-6 py-14 text-center">
          <p className="font-semibold">No cancellation requests in this view</p>
          <p className="mt-1 text-sm text-slate-500">
            Requests appear here when a booked trip&apos;s requester asks to cancel.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {requests.map((request) => {
            const trip = request.tripRequest;
            return (
              <section key={request.id} className="glass overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
                  <div>
                    <Link
                      href={`/trips/${trip.id}`}
                      className="text-lg font-semibold tracking-tight text-ink hover:text-indigo-600"
                    >
                      {trip.origin} → {trip.destination}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {trip.requester.name} · {trip.requester.email} · requested by{" "}
                      {request.requestedBy.name} on{" "}
                      {request.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                    </p>
                  </div>
                  <span
                    className={
                      request.status === "completed"
                        ? "chip-warn"
                        : request.status === "rejected"
                          ? "tag-confirmed"
                          : "tag-link"
                    }
                  >
                    {request.status}
                  </span>
                </div>

                <div className="grid gap-6 px-5 py-4 sm:px-6 lg:grid-cols-[1fr_22rem]">
                  <div className="space-y-3 text-sm">
                    <p className="text-slate-700">Reason: {request.reason}</p>
                    {request.reviewNote && (
                      <p className="text-slate-600">Review note: {request.reviewNote}</p>
                    )}
                    {request.cancellationReference && (
                      <p className="text-rose-700">
                        Provider cancellation reference:{" "}
                        <strong>{request.cancellationReference}</strong>
                      </p>
                    )}
                    {request.reviewedBy && (
                      <p className="text-xs text-slate-500">
                        Reviewed by {request.reviewedBy.name}
                        {request.reviewedAt
                          ? ` on ${request.reviewedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`
                          : ""}
                      </p>
                    )}
                    <div className="rounded-xl border border-white/70 bg-white/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Booking rows
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {trip.bookings.map((booking) => (
                          <li key={booking.id} className="flex flex-wrap items-center gap-2">
                            <span className="tag-link">{booking.kind}</span>
                            <span>{booking.vendor}</span>
                            <span className="text-slate-400">
                              {booking.status.replaceAll("_", " ")}
                              {booking.reference ? ` · ${booking.reference}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div>
                    {request.status === "pending" ? (
                      <ReviewCancellation cancellationId={request.id} />
                    ) : (
                      <p className="text-xs text-slate-500">Reviewed. No further action.</p>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
