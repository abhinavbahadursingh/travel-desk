import { getCurrentUser, canViewReports } from "@/lib/auth";
import { buildOperationalReport, type CurrencySpend } from "@/lib/reports";
import { formatMoney } from "@/lib/currency";

// Render spend for a grouping that may carry multiple currencies. Each
// currency is rendered with its own formatter, never summed across currencies.
// Unknown costs are NOT in `spend`; they are reported separately as a count.
function formatSpend(spend: CurrencySpend, missing = 0): string {
  const entries = Object.entries(spend).filter(([, amount]) => amount > 0);
  const amount =
    entries.length === 0
      ? null
      : entries
          .sort((a, b) => b[1] - a[1])
          .map(([currency, amt]) => formatMoney(amt, currency))
          .join(" · ");
  if (amount == null && missing === 0) return "—";
  const pieces: string[] = [];
  if (amount) pieces.push(amount);
  if (missing > 0) pieces.push(`+ ${missing} missing`);
  return pieces.join(" · ");
}

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!canViewReports(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Travel operations access only</p>
        <p className="mt-1 text-sm text-slate-500">
          Operational reports are available to travel admins and super admins.
        </p>
      </div>
    );
  }

  const report = await buildOperationalReport();
  const statusEntries = Object.entries(report.statusCounts).sort((a, b) => b[1] - a[1]);
  const bookingEntries = Object.entries(report.bookingStatusCounts).sort((a, b) => b[1] - a[1]);
  const flagEntries = Object.entries(report.flagCounts).sort((a, b) => b[1] - a[1]);
  const currencies = Object.keys(report.spendByCurrency);
  const spendLabel =
    currencies.length === 0
      ? "—"
      : currencies.length === 1
        ? formatMoney(report.spendByCurrency[currencies[0]], currencies[0])
        : "Multiple currencies";

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Travel operations</p>
        <h1 className="page-title mt-2">Travel reports</h1>
        <p className="page-subtitle mt-2">
          Aggregated from live records. Spend figures are the stored estimates, not invoices.
          Generated {new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Requests
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{report.totals.trips}</div>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Estimated spend
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{spendLabel}</div>
          <p className="mt-1 text-[11px] text-slate-500">
            {Object.entries(report.spendByCurrency)
              .map(([cur, amount]) => `${formatMoney(amount, cur)} (${cur})`)
              .join(" · ") || "No spend recorded"}
          </p>
          {report.totals.missingCosts > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              {report.totals.missingCosts} trip
              {report.totals.missingCosts === 1 ? "" : "s"} excluded — cost
              unavailable
            </p>
          )}
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Pending approvals
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {report.totals.pendingApprovals}
          </div>
        </div>
        <div className="glass-soft stat-tile">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Data quality
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">
            {report.totals.incompleteEstimates}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Trips with unlisted prices</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass p-5">
          <h2 className="font-semibold tracking-tight">Requests by status</h2>
          {statusEntries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No requests recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {statusEntries.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between">
                  <span className="text-slate-600">{status.replaceAll("_", " ")}</span>
                  <span className="font-semibold text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass p-5">
          <h2 className="font-semibold tracking-tight">Booking rows by state</h2>
          {bookingEntries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No booking links generated yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {bookingEntries.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between">
                  <span className="text-slate-600">{status.replaceAll("_", " ")}</span>
                  <span className="font-semibold text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass p-5">
          <h2 className="font-semibold tracking-tight">Policy flags</h2>
          {flagEntries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No policy flags recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {flagEntries.map(([flag, count]) => (
                <li key={flag} className="flex items-center justify-between">
                  <span className="text-slate-600">{flag.replaceAll("_", " ")}</span>
                  <span className="font-semibold text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass p-5">
          <h2 className="font-semibold tracking-tight">Top destinations</h2>
          {report.destinations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No destinations recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {report.destinations.slice(0, 8).map((destination) => (
                <li
                  key={destination.destination}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="truncate text-slate-600">{destination.destination}</span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    <div>{destination.trips} trips</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {formatSpend(destination.spendByCurrency, destination.missingCosts)}
                    </div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4">
          <h2 className="font-semibold tracking-tight">Monthly travel volume</h2>
        </div>
        {report.months.length === 0 ? (
          <p className="px-6 py-10 text-sm text-slate-500">No dated requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[520px]">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Requests</th>
                  <th>Estimated spend</th>
                </tr>
              </thead>
              <tbody>
                {report.months.map((month) => (
                  <tr key={month.month}>
                    <td className="font-medium text-ink">{month.month}</td>
                    <td className="text-slate-600">{month.trips}</td>
                    <td className="text-slate-600">
                      {formatSpend(month.spendByCurrency, month.missingCosts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4">
          <h2 className="font-semibold tracking-tight">Travel by employee</h2>
        </div>
        {report.employees.length === 0 ? (
          <p className="px-6 py-10 text-sm text-slate-500">No employee requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[520px]">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Requests</th>
                  <th>Estimated spend</th>
                </tr>
              </thead>
              <tbody>
                {report.employees.map((employee) => (
                  <tr key={employee.name}>
                    <td className="font-medium text-ink">{employee.name}</td>
                    <td className="text-slate-600">{employee.trips}</td>
                    <td className="text-slate-600">
                      {formatSpend(employee.spendByCurrency, employee.missingCosts)}
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
