import Link from "next/link";
import { getCurrentUser, canViewAudit } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entityType?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canViewAudit(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Super admin access only</p>
        <p className="mt-1 text-sm text-slate-500">
          The system activity log is restricted to super admins.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const entityType = params.entityType?.trim() ?? "";
  const logs = await db.auditLog.findMany({
    where: {
      ...(q ? { action: { startsWith: q } } : {}),
      ...(entityType ? { entityType } : {}),
    },
    include: { actor: { select: { name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Legacy exceptions: approvals where approver = requester. These are
  // preserved as historical records (never deleted, never deciding anything
  // new) and surfaced here for super admins to review.
  const legacyApprovals = await db.approval.findMany({
    where: { isLegacy: true },
    include: {
      approver: { select: { name: true, email: true } },
      tripRequest: {
        select: {
          id: true,
          destination: true,
          departDate: true,
          requester: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Administration</p>
        <h1 className="page-title mt-2">System activity</h1>
        <p className="page-subtitle mt-2">
          Immutable audit trail for account, role, policy, approval, booking and cancellation
          actions. Newest first, up to 200 entries.
        </p>
      </section>

      <section className="glass p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold tracking-tight">Legacy exceptions</h2>
          <span className="text-[11px] text-slate-500">
            Preserved historical records. Non-authoritative — cannot be re-decided.
          </span>
        </div>
        {legacyApprovals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No legacy exceptions recorded. Self-approvals are blocked server-side.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/60 text-sm">
            {legacyApprovals.map((approval) => (
              <li key={approval.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-ink">
                      <span className="font-medium">{approval.approver.name}</span>{" "}
                      self-approved own trip to{" "}
                      <span className="font-medium">
                        {approval.tripRequest.destination}
                      </span>{" "}
                      <span className="tag-link">legacy</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Approval {approval.id} · decision {approval.decision} ·
                      recorded{" "}
                      {approval.createdAt.toLocaleString("en-US", { timeZone: "UTC" })}{" "}
                      UTC
                    </p>
                  </div>
                  <Link
                    href={`/trips/${approval.tripRequest.id}`}
                    className="text-[11px] text-indigo-600 hover:underline"
                  >
                    Open trip →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4 sm:px-6">
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Filter by action prefix, e.g. user. or approval."
              className="input min-w-[220px] flex-1"
            />
            <select name="entityType" defaultValue={entityType} className="select w-auto">
              <option value="">All entities</option>
              <option value="User">User</option>
              <option value="TripRequest">TripRequest</option>
              <option value="Approval">Approval</option>
              <option value="Booking">Booking</option>
              <option value="CancellationRequest">CancellationRequest</option>
              <option value="TravelPolicy">TravelPolicy</option>
            </select>
            <button type="submit" className="btn-glass">
              Filter
            </button>
            {(q || entityType) && (
              <Link href="/admin/audit" className="btn-ghost text-xs">
                Clear
              </Link>
            )}
          </form>
        </div>

        {logs.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500">
            No audit entries match this filter.
          </p>
        ) : (
          <ul className="divide-y divide-white/60">
            {logs.map((entry) => (
              <li key={entry.id} className="px-5 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-ink">{entry.summary}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {entry.action} · {entry.entityType}
                      {entry.entityId ? ` ${entry.entityId}` : ""} ·{" "}
                      {entry.actor ? `${entry.actor.name} (${entry.actor.role})` : "System"}
                    </p>
                    {entry.metadata && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-slate-400">
                          metadata
                        </summary>
                        <pre className="mt-1 max-w-full overflow-x-auto rounded-lg bg-white/60 p-2 text-[10px] text-slate-600">
                          {entry.metadata}
                        </pre>
                      </details>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {entry.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
