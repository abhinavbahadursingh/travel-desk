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

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
      <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
    </svg>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "indigo",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "indigo" | "amber" | "emerald" | "rose";
}) {
  const dot = {
    indigo: "bg-indigo-400",
    amber: "bg-amber-400",
    emerald: "bg-emerald-400",
    rose: "bg-rose-400",
  }[tone];
  return (
    <div className="glass-soft stat-tile">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default async function Home() {
  const user = await getCurrentUser();
  if (user.role === "manager") redirect("/manager");
  if (user.role === "travel_admin" || user.role === "super_admin") redirect("/admin");

  const [trips, unread, profile] = await Promise.all([
    db.tripRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        approvals: {
          include: { approver: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.user.findUnique({
      where: { id: user.id },
      select: {
        manager: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  const firstName = user.name.split(/\s+/)[0];
  const drafts = trips.filter((t) => t.status === "draft");
  const pending = trips.filter((t) => t.status === "pending_approval");
  const approved = trips.filter((t) => t.status === "approved");
  const booked = trips.filter((t) => t.status === "booked");
  const upcoming = trips.filter((t) =>
    ["approved", "booking_links_generated", "booking_pending_confirmation", "booked"].includes(
      t.status,
    ),
  );

  return (
    <div className="space-y-6">
      <section className="glass relative overflow-hidden p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(165,180,252,0.9), rgba(244,114,182,0.45) 55%, transparent 72%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">Employee workspace</p>
            <h1 className="page-title mt-2">Welcome back, {firstName}</h1>
            <p className="page-subtitle mt-2">
              Plan a trip, compare real options and track approval, booking and cancellation
              in one place.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="glass-pill">
                Reporting manager:{" "}
                <strong className="ml-1 text-ink">
                  {profile?.manager?.name ?? "Not assigned"}
                </strong>
              </span>
              <span className="glass-pill">{unread} unread notification{unread === 1 ? "" : "s"}</span>
            </div>
          </div>
          <Link href="/trips/new" className="btn-primary shrink-0">
            <span className="text-base leading-none">+</span>
            New request
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Drafts" value={drafts.length} hint="Plan, then submit" tone="indigo" />
        <Stat
          label="Pending approval"
          value={pending.length}
          hint={pending[0] ? `With ${pending[0].approvals[0]?.approver.name ?? "approver"}` : "Nothing waiting"}
          tone="amber"
        />
        <Stat
          label="Approved"
          value={approved.length}
          hint="Ready for booking links"
          tone="emerald"
        />
        <Stat label="Booked" value={booked.length} hint="Confirmed by travel ops" tone="emerald" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="glass overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Upcoming travel</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Approved, awaiting confirmation and booked trips.
              </p>
            </div>
            <Link href="/trips" className="btn-glass text-xs">
              All trips
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
              <span className="empty-icon">
                <PlaneIcon />
              </span>
              <div>
                <p className="font-semibold">No upcoming travel</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Start with a destination and dates. The planner searches the web for real
                  flights, hotels, trains and cabs.
                </p>
              </div>
              <Link href="/trips/new" className="btn-primary">
                Plan a trip
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-white/60">
              {upcoming.slice(0, 6).map((trip) => (
                <li key={trip.id}>
                  <Link
                    href={`/trips/${trip.id}`}
                    className="flex flex-wrap items-center gap-3 px-5 py-4 transition hover:bg-white/40 sm:px-6"
                  >
                    <span className="route-icon">
                      <PlaneIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">
                        {trip.origin} <span className="text-slate-400">→</span>{" "}
                        {trip.destination}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {formatDate(trip.departDate)} –{" "}
                        {trip.returnDate ? formatDate(trip.returnDate) : "One-way"} ·{" "}
                        {(() => {
                          const known = tripCostOrUnknown(trip);
                          return known == null
                            ? "cost unavailable"
                            : `${formatMoney(known, trip.currency || "USD")} est.`;
                        })()}
                      </span>
                    </span>
                    <StatusPill status={trip.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass p-5">
            <h2 className="font-semibold tracking-tight">Needs your action</h2>
            <div className="mt-3 space-y-2">
              {drafts.length === 0 && pending.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing waiting on you right now.</p>
              ) : (
                <>
                  {drafts.slice(0, 3).map((trip) => (
                    <Link
                      key={trip.id}
                      href={`/trips/${trip.id}`}
                      className="block rounded-xl border border-white/70 bg-white/50 px-3 py-2.5 text-sm transition hover:bg-white"
                    >
                      <span className="font-medium text-ink">{trip.destination}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {trip.itinerary ? "Ready to submit" : "Plan the itinerary"}
                      </span>
                    </Link>
                  ))}
                  {pending.slice(0, 3).map((trip) => (
                    <Link
                      key={trip.id}
                      href={`/trips/${trip.id}`}
                      className="block rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2.5 text-sm transition hover:bg-amber-50"
                    >
                      <span className="font-medium text-ink">{trip.destination}</span>
                      <span className="ml-2 text-xs text-amber-800">
                        Waiting on {trip.approvals[0]?.approver.name ?? "approver"}
                      </span>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="glass p-5">
            <h2 className="font-semibold tracking-tight">Shortcuts</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Link href="/trips" className="btn-glass justify-center">
                My trips
              </Link>
              <Link href="/bookings" className="btn-glass justify-center">
                My bookings
              </Link>
              <Link href="/history" className="btn-glass justify-center">
                Travel history
              </Link>
              <Link href="/notifications" className="btn-glass justify-center">
                Notifications
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
