import { getCurrentUser, canViewAudit } from "@/lib/auth";
import { buildSystemHealth } from "@/lib/health";

export default async function HealthPage() {
  const user = await getCurrentUser();
  if (!canViewAudit(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Super admin access only</p>
        <p className="mt-1 text-sm text-slate-500">System health is restricted to super admins.</p>
      </div>
    );
  }

  const health = await buildSystemHealth();
  const tone =
    health.status === "ok"
      ? "tag-confirmed"
      : health.status === "attention"
        ? "chip-warn"
        : "chip-priciest";

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Administration</p>
            <h1 className="page-title mt-2">System health</h1>
            <p className="page-subtitle mt-2">
              Configuration, integration and data-consistency checks for this deployment.
            </p>
          </div>
          <span className={tone}>{health.status}</span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Active approvers
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {health.metrics.activeApprovers}
          </div>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Pending approvals
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {health.metrics.pendingApprovals}
          </div>
          {health.metrics.stuckApprovals > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              {health.metrics.stuckApprovals} inconsistent
            </p>
          )}
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Awaiting confirmation
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {health.metrics.pendingConfirmations}
          </div>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Unread notifications
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {health.metrics.unreadNotifications}
          </div>
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4">
          <h2 className="font-semibold tracking-tight">Checks</h2>
        </div>
        <ul className="divide-y divide-white/60">
          {health.checks.map((check) => (
            <li key={check.name} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-ink">{check.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{check.detail}</p>
              </div>
              <span
                className={
                  check.status === "ok"
                    ? "tag-confirmed"
                    : check.status === "fail"
                      ? "chip-priciest"
                      : check.status === "warn"
                        ? "chip-warn"
                        : "chip-neutral"
                }
              >
                {check.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass p-5">
        <h2 className="font-semibold tracking-tight">Accounts by role</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {health.metrics.users.map((entry) => (
            <li key={`${entry.role}-${entry.active}`} className="glass-soft p-4 text-sm">
              <p className="font-medium text-ink">{entry.role.replaceAll("_", " ")}</p>
              <p className="text-xs text-slate-500">
                {entry.active ? "Active" : "Deactivated"} · {entry.count}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-slate-400">
          Generated {new Date(health.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC
        </p>
      </section>
    </div>
  );
}
