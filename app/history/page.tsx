import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { tripCostOrUnknown, formatMoney } from "@/lib/currency";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function TravelHistoryPage() {
  const user = await getCurrentUser();
  const trips = await db.tripRequest.findMany({
    where: {
      requesterId: user.id,
      status: { in: ["booked", "cancelled", "rejected"] },
    },
    orderBy: { departDate: "desc" },
    include: {
      approvals: {
        select: { decision: true, rejectionReason: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { bookings: true } },
    },
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Workspace</p>
        <h1 className="page-title mt-2">Travel history</h1>
        <p className="page-subtitle mt-2">
          Completed, cancelled and rejected requests. Drafts and active approvals stay in My trips.
        </p>
      </section>

      <section className="glass overflow-hidden">
        {trips.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold">No travel history yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Booked, cancelled and rejected requests will appear here.
            </p>
            <Link href="/trips" className="btn-primary mt-4 inline-flex">
              View my trips
            </Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[760px]">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Dates</th>
                  <th>Purpose</th>
                  <th>Estimate</th>
                  <th>Bookings</th>
                  <th>Status</th>
                  <th>Outcome</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id}>
                    <td className="font-semibold text-ink">
                      {trip.origin} → {trip.destination}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {formatDate(trip.departDate)} –{" "}
                      {trip.returnDate ? formatDate(trip.returnDate) : "One-way"}
                    </td>
                    <td className="max-w-[16rem]">
                      <span className="block truncate text-slate-600">{trip.purpose}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      {(() => {
                        const known = tripCostOrUnknown(trip);
                        return known == null ? (
                          <span
                            className="text-amber-700"
                            title="Total cost unavailable — some prices are missing."
                          >
                            cost unavailable
                          </span>
                        ) : (
                          formatMoney(known, trip.currency || "USD")
                        );
                      })()}
                    </td>
                    <td className="text-slate-600">{trip._count.bookings}</td>
                    <td>
                      <StatusPill status={trip.status} />
                    </td>
                    <td className="max-w-[16rem] text-xs text-slate-500">
                      {trip.status === "rejected"
                        ? trip.approvals[0]?.rejectionReason ?? "Rejected"
                        : trip.status === "cancelled"
                          ? "Cancellation verified"
                          : "Booked"}
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
