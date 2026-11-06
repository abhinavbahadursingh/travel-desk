import Link from "next/link";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { tripCostOrUnknown } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import { EstimateCart } from "@/components/EstimateCart";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "booking_links_generated", label: "Booking links" },
  { value: "booking_pending_confirmation", label: "Confirming" },
  { value: "booked", label: "Booked" },
  { value: "cancellation_requested", label: "Cancelling" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; mine?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = params.status?.trim() || "";
  const q = params.q?.trim() || "";
  const mine = params.mine === "1";

  const roleScope = canViewAllTrips(user)
    ? mine
      ? { requesterId: user.id }
      : {}
    : user.role === "manager" && !mine
      ? {
          OR: [
            { requesterId: user.id },
            { approvals: { some: { approverId: user.id } } },
          ],
        }
      : { requesterId: user.id };

  const trips = await db.tripRequest.findMany({
    where: {
      AND: [
        roleScope,
        ...(status ? [{ status }] : []),
        ...(q
          ? [
              {
                OR: [
                  { destination: { contains: q } },
                  { origin: { contains: q } },
                  { purpose: { contains: q } },
                  { requester: { name: { contains: q } } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      requester: { select: { name: true } },
      approvals: {
        select: {
          decision: true,
          approver: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { bookings: true } },
    },
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{canViewAllTrips(user) ? "Travel operations" : "Workspace"}</p>
            <h1 className="page-title mt-2">
              {canViewAllTrips(user) ? "All trip requests" : mine ? "My trips" : "Trips"}
            </h1>
            <p className="page-subtitle mt-2">
              {canViewAllTrips(user)
                ? "Every request across the company, newest first."
                : user.role === "manager" && !mine
                  ? "Your own trips plus requests assigned to you for approval."
                  : "Drafts, approvals, bookings and cancellations in one place."}
            </p>
          </div>
          <Link href="/trips/new" className="btn-primary">
            + New request
          </Link>
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4 sm:px-6">
          <form method="get" className="flex flex-wrap items-center gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            {mine && <input type="hidden" name="mine" value="1" />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Search destination, origin, purpose or requester"
              className="input min-w-[240px] flex-1"
            />
            <button type="submit" className="btn-glass">
              Search
            </button>
            {(user.role === "manager" || canViewAllTrips(user)) && (
              <Link
                href={`/trips?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  ...(q ? { q } : {}),
                  ...(mine ? {} : { mine: "1" }),
                }).toString()}`}
                className="btn-ghost text-xs"
              >
                {mine ? "Include assigned requests" : "Only my trips"}
              </Link>
            )}
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => {
              const query = new URLSearchParams();
              if (filter.value) query.set("status", filter.value);
              if (q) query.set("q", q);
              if (mine) query.set("mine", "1");
              const href = `/trips${query.toString() ? `?${query.toString()}` : ""}`;
              const active = status === filter.value;
              return (
                <Link
                  key={filter.value || "all"}
                  href={href}
                  className={`glass-pill ${active ? "ring-2 ring-indigo-300" : ""}`}
                >
                  {filter.label}
                </Link>
              );
            })}
          </div>
        </div>

        {trips.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold">No trips match this view</p>
            <p className="mt-1 text-sm text-slate-500">
              Try clearing the filters, or start a new request.
            </p>
            <Link href="/trips/new" className="btn-primary mt-4 inline-flex">
              Plan a trip
            </Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[820px]">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Dates</th>
                  <th>Requester</th>
                  <th>Approver</th>
                  <th>Estimate</th>
                  <th>Bookings</th>
                  <th>Status</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <div className="font-semibold text-ink">
                        {trip.origin} <span className="text-slate-400">→</span>{" "}
                        {trip.destination}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {trip.cabin.replaceAll("_", " ")}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {formatDate(trip.departDate)} –{" "}
                      {trip.returnDate ? formatDate(trip.returnDate) : "One-way"}
                    </td>
                    <td className="text-slate-600">{trip.requester.name}</td>
                    <td className="text-slate-600">
                      {trip.approvals[0]?.approver.name ?? "—"}
                      {trip.approvals[0] && (
                        <span className="ml-1 text-[10px] text-slate-400">
                          {trip.approvals[0].decision}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <EstimateCart
                        tripId={trip.id}
                        currency={trip.currency || "USD"}
                        nights={tripNights(trip.departDate, trip.returnDate)}
                        fallbackTotal={tripCostOrUnknown(trip)}
                        itineraryJson={trip.itinerary}
                      />
                    </td>
                    <td className="text-slate-600">{trip._count.bookings}</td>
                    <td>
                      <StatusPill status={trip.status} />
                    </td>
                    <td className="text-right">
                      <Link href={`/trips/${trip.id}`} className="btn-glass text-xs">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
