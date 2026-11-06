import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
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

export default async function AdminDashboard() {
  const user = await getCurrentUser();
  if (user.role !== "travel_admin" && user.role !== "super_admin") {
    redirect("/");
  }

  const [
    statusGroups,
    pendingApprovals,
    pendingCancellations,
    pendingConfirmations,
    incompleteEstimates,
    recentTrips,
    recentAudit,
    userCount,
  ] = await Promise.all([
    db.tripRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    db.approval.count({ where: { decision: "pending" } }),
    db.cancellationRequest.count({ where: { status: "pending" } }),
    db.booking.count({ where: { status: { in: ["pending", "link_only"] } } }),
    db.tripRequest.count({ where: { estimateIsComplete: false, status: { not: "draft" } } }),
    db.tripRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { requester: { select: { name: true } } },
    }),
    user.role === "super_admin"
      ? db.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 6,
          include: { actor: { select: { name: true } } },
        })
      : Promise.resolve([]),
    db.user.count({ where: { active: true } }),
  ]);

  const counts = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  ) as Record<string, number>;
  const totalTrips = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  const awaitingBooking =
    (counts.approved ?? 0) + (counts.booking_links_generated ?? 0) + (counts.booking_pending_confirmation ?? 0);

  return (
    <div className="space-y-6">
      <section className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">
              {user.role === "super_admin" ? "Super admin" : "Travel operations"}
            </p>
            <h1 className="page-title mt-2">Operations dashboard</h1>
            <p className="page-subtitle mt-2">
              Company-wide trips, booking confirmations, cancellations and operational queues.
              Every count below comes from live records.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/bookings" className="btn-primary">
              Booking operations
            </Link>
            <Link href="/admin/reports" className="btn-glass">
              Reports
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            All trips
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{totalTrips}</div>
          <p className="mt-1 text-[11px] text-slate-500">{userCount} active accounts</p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Pending approvals
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{pendingApprovals}</div>
          <p className="mt-1 text-[11px] text-slate-500">Across all approvers</p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Booking queue
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{awaitingBooking}</div>
          <p className="mt-1 text-[11px] text-slate-500">
            {pendingConfirmations} pending booking rows awaiting confirmation
          </p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Cancellations
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{pendingCancellations}</div>
          <p className="mt-1 text-[11px] text-slate-500">
            {incompleteEstimates} incomplete estimates
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="glass overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Recent requests</h2>
              <p className="mt-0.5 text-xs text-slate-500">Newest company trips first.</p>
            </div>
            <Link href="/admin/trips" className="btn-glass text-xs">
              All trips
            </Link>
          </div>
          {recentTrips.length === 0 ? (
            <p className="px-6 py-14 text-center text-sm text-slate-500">
              No trip requests exist yet.
            </p>
          ) : (
            <ul className="space-y-3 px-5 py-5 sm:px-6">
              {recentTrips.map((trip) => (
                <li
                  key={trip.id}
                  className="relative overflow-hidden rounded-[2rem] border border-white/75 bg-gradient-to-br from-white/30 to-white/10 p-5 shadow-[0_24px_50px_-24px_rgba(30,41,59,0.35),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-24px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-6"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-blue-200/35 blur-3xl"
                  />
                  <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold leading-tight text-ink">
                        {trip.origin} → {trip.destination}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {trip.requester.name} · {formatDate(trip.departDate)} –{" "}
                        {trip.returnDate ? formatDate(trip.returnDate) : "One-way"}
                      </p>
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="whitespace-nowrap text-base font-semibold text-ink">
                        {(() => {
                          const known = tripCostOrUnknown(trip);
                          return known == null ? (
                            <span
                              className="text-sm text-amber-700"
                              title="Total cost unavailable — some prices are missing."
                            >
                              cost unavailable
                            </span>
                          ) : (
                            <>
                              {formatMoney(known, trip.currency || "USD")}
                              <span className="ml-1 text-[10px] font-medium text-slate-400">
                                est.
                              </span>
                            </>
                          );
                        })()}
                      </p>
                      <div className="mt-1.5">
                        <StatusPill status={trip.status} />
                      </div>
                    </div>
                    <Link
                      href={`/trips/${trip.id}`}
                      className="btn-provider shrink-0"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass p-5">
            <h2 className="font-semibold tracking-tight">Operational queues</h2>
            <div className="mt-3 space-y-2 text-sm">
              <Link href="/admin/bookings" className="flex items-center justify-between rounded-xl border border-white/70 bg-white/50 px-3 py-2.5 hover:bg-white">
                <span>Confirm bookings</span>
                <span className="text-xs text-slate-500">{pendingConfirmations} links</span>
              </Link>
              <Link href="/admin/cancellations" className="flex items-center justify-between rounded-xl border border-white/70 bg-white/50 px-3 py-2.5 hover:bg-white">
                <span>Cancellation requests</span>
                <span className="text-xs text-slate-500">{pendingCancellations} pending</span>
              </Link>
              <Link href="/admin/approvals" className="flex items-center justify-between rounded-xl border border-white/70 bg-white/50 px-3 py-2.5 hover:bg-white">
                <span>Approval overview</span>
                <span className="text-xs text-slate-500">{pendingApprovals} pending</span>
              </Link>
              <Link href="/admin/employees" className="flex items-center justify-between rounded-xl border border-white/70 bg-white/50 px-3 py-2.5 hover:bg-white">
                <span>Employee directory</span>
                <span className="text-xs text-slate-500">{userCount} active</span>
              </Link>
            </div>
          </div>

          {user.role === "super_admin" && (
            <div className="glass p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold tracking-tight">Administration</h2>
                <Link href="/admin/users" className="text-xs font-medium text-indigo-600 hover:underline">
                  Manage
                </Link>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <Link href="/admin/users" className="btn-glass justify-center">
                  User management
                </Link>
                <Link href="/admin/policy" className="btn-glass justify-center">
                  Policy configuration
                </Link>
                <Link href="/admin/audit" className="btn-glass justify-center">
                  System activity
                </Link>
                <Link href="/admin/health" className="btn-glass justify-center">
                  System health
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {user.role === "super_admin" && (
        <section className="glass overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/60 px-5 py-4">
            <div>
              <h2 className="font-semibold tracking-tight">Recent system activity</h2>
              <p className="mt-0.5 text-xs text-slate-500">Audited super-admin and workflow actions.</p>
            </div>
            <Link href="/admin/audit" className="text-xs font-medium text-indigo-600 hover:underline">
              Full log
            </Link>
          </div>
          {recentAudit.length === 0 ? (
            <p className="px-6 py-10 text-sm text-slate-500">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-white/60">
              {recentAudit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm text-ink">{entry.summary}</p>
                    <p className="text-[11px] text-slate-500">
                      {entry.actor?.name ?? "System"} · {entry.action}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {entry.createdAt.toLocaleString("en-US", { timeZone: "UTC" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
