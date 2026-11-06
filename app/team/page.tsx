import Link from "next/link";
import { getCurrentUser, isApprover, canApproveAny } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { tripCostOrUnknown, formatMoney } from "@/lib/currency";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!isApprover(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Manager access only</p>
        <p className="mt-1 text-sm text-slate-500">
          This page lists reporting employees for managers and administrators.
        </p>
      </div>
    );
  }

  const admin = canApproveAny(user);
  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      department: true,
      managerId: true,
      manager: { select: { id: true, name: true } },
      _count: { select: { requests: true, reports: true, approvals: true } },
    },
    orderBy: { name: "asc" },
  });

  const visible = admin ? users : users.filter((u) => u.managerId === user.id);
  const visibleIds = visible.map((u) => u.id);
  const trips = await db.tripRequest.findMany({
    where: { requesterId: { in: visibleIds }, status: { not: "draft" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      requesterId: true,
      destination: true,
      origin: true,
      status: true,
      departDate: true,
      returnDate: true,
      estimatedCost: true,
      estimateIsComplete: true,
      currency: true,
    },
  });

  const tripsByUser = new Map<string, typeof trips>();
  for (const trip of trips) {
    const list = tripsByUser.get(trip.requesterId) ?? [];
    list.push(trip);
    tripsByUser.set(trip.requesterId, list);
  }

  const hierarchy = admin
    ? users
        .filter((u) => u._count.reports > 0)
        .map((manager) => ({
          manager,
          reports: users.filter((u) => u.managerId === manager.id),
        }))
    : [];

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">{admin ? "Administration" : "Manager workspace"}</p>
        <h1 className="page-title mt-2">{admin ? "Organisation directory" : "My employees"}</h1>
        <p className="page-subtitle mt-2">
          {admin
            ? "Reporting lines, roles and request activity across the company."
            : "Your direct reports and the requests they have submitted."}
        </p>
      </section>

      {visible.length === 0 ? (
        <section className="glass px-6 py-14 text-center">
          <p className="font-semibold">No employees assigned</p>
          <p className="mt-1 text-sm text-slate-500">
            A super admin can assign reporting managers from User management.
          </p>
        </section>
      ) : (
        <section className="glass overflow-hidden">
          <div className="border-b border-white/60 px-5 py-4 sm:px-6">
            <h2 className="font-semibold tracking-tight">
              {admin ? "All employees and managers" : "Direct reports"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {visible.length} account{visible.length === 1 ? "" : "s"} · non-draft requests only
            </p>
          </div>
          <ul className="divide-y divide-white/60">
            {visible.map((person) => {
              const personTrips = tripsByUser.get(person.id) ?? [];
              return (
                <li key={person.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{person.name}</p>
                        <span className="chip-neutral">{person.role.replaceAll("_", " ")}</span>
                        {!person.active && <span className="chip-warn">deactivated</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {person.email} · {person.department ?? "No department"} · manager:{" "}
                        {person.manager?.name ?? "Not assigned"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {person._count.requests} total requests · {person._count.reports} reports ·{" "}
                        {person._count.approvals} approvals
                      </p>
                    </div>
                  </div>
                  {personTrips.length > 0 && (
                    <div className="table-scroll mt-3">
                      <table className="table-glass min-w-[560px]">
                        <thead>
                          <tr>
                            <th>Route</th>
                            <th>Dates</th>
                            <th>Estimate</th>
                            <th>Status</th>
                            <th aria-label="Open" />
                          </tr>
                        </thead>
                        <tbody>
                          {personTrips.slice(0, 5).map((trip) => (
                            <tr key={trip.id}>
                              <td className="font-medium text-ink">
                                {trip.origin} → {trip.destination}
                              </td>
                              <td className="whitespace-nowrap text-slate-600">
                                {formatDate(trip.departDate)} –{" "}
                                {trip.returnDate ? formatDate(trip.returnDate) : "One-way"}
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
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {admin && hierarchy.length > 0 && (
        <section className="glass p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Reporting hierarchy</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {hierarchy.map(({ manager, reports }) => (
              <div key={manager.id} className="glass-soft p-5">
                <p className="font-medium text-ink">{manager.name}</p>
                <p className="text-[11px] text-slate-500">
                  {manager.role.replaceAll("_", " ")} · {manager.department ?? "No department"}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {reports.map((report) => (
                    <li key={report.id} className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-indigo-300" />
                      {report.name}
                      {!report.active && <span className="chip-warn">off</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
