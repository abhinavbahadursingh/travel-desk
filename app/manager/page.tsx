import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { tripCostOrUnknown, formatMoney } from "@/lib/currency";
import { flagDescription, type PolicyFlag } from "@/lib/policy";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function parseFlags(raw: string): PolicyFlag[] {
  try {
    const flags = JSON.parse(raw) as PolicyFlag[];
    return Array.isArray(flags) ? flags : [];
  } catch {
    return [];
  }
}

export default async function ManagerDashboard() {
  const user = await getCurrentUser();
  if (user.role !== "manager") {
    redirect(user.role === "travel_admin" || user.role === "super_admin" ? "/admin" : "/");
  }

  const [pending, decided, reports] = await Promise.all([
    db.approval.findMany({
      where: { approverId: user.id, decision: "pending" },
      include: {
        tripRequest: { include: { requester: true } },
        approver: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.approval.findMany({
      where: { approverId: user.id, decision: { not: "pending" } },
      include: { tripRequest: { include: { requester: true } } },
      orderBy: { decidedAt: "desc" },
      take: 10,
    }),
    db.user.findMany({
      where: { managerId: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        department: true,
        _count: { select: { requests: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const approved = decided.filter((a) => a.decision === "approved").length;
  const rejected = decided.filter((a) => a.decision === "rejected").length;
  const changes = decided.filter((a) => a.decision === "changes_requested").length;

  return (
    <div className="space-y-6">
      <section className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">Manager workspace</p>
            <h1 className="page-title mt-2">Approval dashboard</h1>
            <p className="page-subtitle mt-2">
              Review the requests routed to you, inspect policy flags and retrieved options, and
              record a decision with a clear audit trail.
            </p>
          </div>
          <Link href="/approvals" className="btn-primary shrink-0">
            Open approval inbox
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Pending decisions
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{pending.length}</div>
          <p className="mt-1 text-[11px] text-slate-500">Assigned to you</p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Approved
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{approved}</div>
          <p className="mt-1 text-[11px] text-slate-500">Recent decisions</p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Rejected / changes
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {rejected} / {changes}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">With recorded reasons</p>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Reporting employees
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{reports.length}</div>
          <p className="mt-1 text-[11px] text-slate-500">Direct reports</p>
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Pending decisions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Only requests assigned to you are shown here.
            </p>
          </div>
          <span className="glass-pill">{pending.length} waiting</span>
        </div>
        {pending.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold">Your inbox is clear</p>
            <p className="mt-1 text-sm text-slate-500">
              New requests routed to you will appear here and in your notifications.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/60">
            {pending.map((approval) => {
              const trip = approval.tripRequest;
              const flags = parseFlags(trip.policyFlags);
              return (
                <li key={approval.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/trips/${trip.id}`}
                          className="font-semibold text-ink hover:text-indigo-600"
                        >
                          {trip.origin} → {trip.destination}
                        </Link>
                        <StatusPill status={trip.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {trip.requester.name} · {formatDate(trip.departDate)} –{" "}
                        {trip.returnDate ? formatDate(trip.returnDate) : "One-way"} ·{" "}
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
                            `${formatMoney(known, trip.currency || "USD")} est.`
                          );
                        })()}
                      </p>
                      <p className="mt-1 max-w-2xl text-xs text-slate-600">{trip.purpose}</p>
                      {flags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {flags.map((flag) => (
                            <span
                              key={flag}
                              className="chip-warn"
                              title={flagDescription(flag)}
                            >
                              {flag.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Link href={`/trips/${trip.id}`} className="btn-glass text-xs">
                      Review request
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass overflow-hidden">
          <div className="border-b border-white/60 px-5 py-4">
            <h2 className="font-semibold tracking-tight">My employees</h2>
            <p className="mt-0.5 text-xs text-slate-500">Direct reports and their trip counts.</p>
          </div>
          {reports.length === 0 ? (
            <p className="px-6 py-10 text-sm text-slate-500">
              No direct reports are assigned to you yet. A super admin can assign employees.
            </p>
          ) : (
            <ul className="divide-y divide-white/60">
              {reports.map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{report.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {report.email} · {report.department ?? "No department"} ·{" "}
                      {report.role.replaceAll("_", " ")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>{report._count.requests} trips</p>
                    <p>{report.active ? "Active" : "Deactivated"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-white/60 px-5 py-3">
            <Link href="/team" className="text-xs font-medium text-indigo-600 hover:underline">
              View team details →
            </Link>
          </div>
        </div>

        <div className="glass overflow-hidden">
          <div className="border-b border-white/60 px-5 py-4">
            <h2 className="font-semibold tracking-tight">Recent decisions</h2>
            <p className="mt-0.5 text-xs text-slate-500">Your approval history.</p>
          </div>
          {decided.length === 0 ? (
            <p className="px-6 py-10 text-sm text-slate-500">No decisions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-white/60">
              {decided.slice(0, 6).map((approval) => (
                <li key={approval.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/trips/${approval.tripRequest.id}`}
                      className="text-sm font-medium text-ink hover:text-indigo-600"
                    >
                      {approval.tripRequest.destination}
                    </Link>
                    <span className="text-[11px] text-slate-500">
                      {approval.decision.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {approval.tripRequest.requester.name} ·{" "}
                    {approval.decidedAt ? formatDate(approval.decidedAt) : "—"}
                  </p>
                  {approval.rejectionReason && (
                    <p className="mt-1 text-[11px] text-rose-600">
                      Reason: {approval.rejectionReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-white/60 px-5 py-3">
            <Link href="/approvals?scope=history" className="text-xs font-medium text-indigo-600 hover:underline">
              View approval history →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
