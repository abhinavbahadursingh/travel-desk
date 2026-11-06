import Link from "next/link";
import { getCurrentUser, isApprover, canApproveAny } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatusPill } from "@/components/StatusPill";
import { ApprovalCard } from "./ApprovalCard";
import { flagDescription, type PolicyFlag } from "@/lib/policy";
import { tripCostOrUnknown, formatMoney } from "@/lib/currency";

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

function itineraryRationale(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { rationale?: string };
    return parsed.rationale ?? null;
  } catch {
    return null;
  }
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; mine?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const scope = params.scope === "history" ? "history" : params.scope === "all" ? "all" : "pending";
  const mineOnly = params.mine === "1";
  const approver = isApprover(user);
  const admin = canApproveAny(user);

  const where = approver
    ? scope === "history"
      ? { ...(admin && !mineOnly ? {} : { approverId: user.id }), decision: { not: "pending" } }
      : scope === "all"
        ? admin && !mineOnly
          ? {}
          : { approverId: user.id }
        : { ...(admin && !mineOnly ? {} : { approverId: user.id }), decision: "pending" }
    : { tripRequest: { requesterId: user.id } };

  const [approvals, approvers] = await Promise.all([
    db.approval.findMany({
      where,
      include: {
        tripRequest: { include: { requester: true } },
        approver: true,
        assignedBy: true,
        events: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    approver
      ? db.user.findMany({
          where: {
            active: true,
            role: { in: ["manager", "travel_admin", "super_admin"] },
            id: { not: user.id },
          },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{approver ? "Approver workspace" : "Workspace"}</p>
            <h1 className="page-title mt-2">
              {approver
                ? scope === "history"
                  ? "Approval history"
                  : scope === "all"
                    ? "All approvals"
                    : "Approval inbox"
                : "Approval status"}
            </h1>
            <p className="page-subtitle mt-2">
              {approver && !admin
                ? "Requests assigned to you. You can only decide approvals routed to you."
                : approver
                  ? "Company-wide approval queue with reassignment controls."
                  : "The approval trail for your own requests."}
            </p>
          </div>
          {approver && (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/approvals"
                className={`glass-pill ${scope === "pending" ? "ring-2 ring-indigo-300" : ""}`}
              >
                Pending
              </Link>
              <Link
                href="/approvals?scope=history"
                className={`glass-pill ${scope === "history" ? "ring-2 ring-indigo-300" : ""}`}
              >
                History
              </Link>
              {admin && (
                <Link
                  href="/approvals?scope=all"
                  className={`glass-pill ${scope === "all" ? "ring-2 ring-indigo-300" : ""}`}
                >
                  All
                </Link>
              )}
              {admin && (
                <Link
                  href={`/approvals${scope === "pending" ? "" : `?scope=${scope}`}${scope === "pending" ? "?mine=1" : "&mine=1"}`}
                  className={`glass-pill ${mineOnly ? "ring-2 ring-indigo-300" : ""}`}
                >
                  Assigned to me
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {approvals.length === 0 ? (
        <section className="glass px-6 py-14 text-center">
          <p className="font-semibold">
            {approver ? "Nothing in this view" : "No approvals yet"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {approver
              ? "New requests routed to you will appear here with their full trip context."
              : "Once you submit a request, its approval trail will appear here."}
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {approvals.map((approval) => {
            const trip = approval.tripRequest;
            const flags = parseFlags(trip.policyFlags);
            const rationale = itineraryRationale(trip.itinerary);
            const requesterIsSelf = trip.requesterId === user.id;
            const canDecide =
              approver &&
              approval.decision === "pending" &&
              trip.status === "pending_approval" &&
              !requesterIsSelf &&
              (approval.approverId === user.id || admin);
            return (
              <section key={approval.id} className="glass overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/trips/${trip.id}`}
                        className="text-lg font-semibold tracking-tight text-ink hover:text-indigo-600"
                      >
                        {trip.origin} → {trip.destination}
                      </Link>
                      <StatusPill status={trip.status} />
                      <span
                        className={
                          approval.decision === "approved"
                            ? "tag-confirmed"
                            : approval.decision === "rejected"
                              ? "chip-warn"
                              : approval.decision === "changes_requested"
                                ? "chip-neutral"
                                : "tag-link"
                        }
                      >
                        {approval.decision.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {trip.requester.name} · {formatDate(trip.departDate)} –{" "}
                      {trip.returnDate ? formatDate(trip.returnDate) : "One-way"} ·{" "}
                      {(() => {
                        const known = tripCostOrUnknown(trip);
                        return known == null
                          ? "cost unavailable"
                          : `${formatMoney(known, trip.currency || "USD")} est.`;
                      })()}{" "}
                      · approver:{" "}
                      {approval.approver.name}
                      {approval.assignedBy && approval.assignedById !== approval.approverId
                        ? ` (assigned by ${approval.assignedBy.name})`
                        : ""}
                    </p>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">{trip.purpose}</p>
                    {flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {flags.map((flag) => (
                          <span key={flag} className="chip-warn" title={flagDescription(flag)}>
                            {flag.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}
                    {rationale && (
                      <p className="mt-2 max-w-3xl text-xs text-indigo-700">
                        AI recommendation: {rationale}
                      </p>
                    )}
                  </div>
                  <Link href={`/trips/${trip.id}`} className="btn-glass text-xs">
                    Full trip
                  </Link>
                </div>

                <div className="grid gap-6 px-5 py-4 sm:px-6 lg:grid-cols-[1fr_20rem]">
                  <div>
                    {approval.events.length === 0 ? (
                      <p className="text-xs text-slate-500">No approval history recorded.</p>
                    ) : (
                      <ol className="space-y-2 border-l border-white/70 pl-4">
                        {approval.events.map((event) => (
                          <li key={event.id} className="relative text-xs">
                            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-300" />
                            <p className="font-medium text-ink">
                              {event.type.replaceAll("_", " ")}
                              {event.actor ? ` · ${event.actor.name}` : ""}
                            </p>
                            {event.comment && (
                              <p className="mt-0.5 text-slate-600">{event.comment}</p>
                            )}
                            <p className="mt-0.5 text-[10px] text-slate-400">
                              {event.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {approval.rejectionReason && (
                      <p className="mt-3 rounded-xl border border-rose-200/60 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                        Rejection reason: {approval.rejectionReason}
                      </p>
                    )}
                    {approval.decision === "changes_requested" && approval.comment && (
                      <p className="mt-3 rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                        Changes requested: {approval.comment}
                      </p>
                    )}
                  </div>

                  <div>
                    {approver ? (
                      <ApprovalCard
                        approvalId={approval.id}
                        decision={approval.decision}
                        canDecide={canDecide}
                        canReassign={admin && approval.decision === "pending"}
                        approveOptions={approvers}
                        currentApproverId={approval.approverId}
                        requesterName={trip.requester.name}
                        requesterIsSelf={requesterIsSelf}
                      />
                    ) : (
                      <p className="text-xs text-slate-500">
                        Read-only. Your approver records decisions here.
                      </p>
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
