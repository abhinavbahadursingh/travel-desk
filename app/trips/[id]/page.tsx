import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, canHandleBookings, canApproveAny } from "@/lib/auth";
import { canViewTrip } from "@/lib/approvals";
import { StatusPill } from "@/components/StatusPill";
import { flagDescription, type PolicyFlag } from "@/lib/policy";
import {
  normalizePriceType,
  normalizeAvailabilityStatus,
  type Candidate,
  type PriceType,
  type AvailabilityStatus,
  type SearchResult,
} from "@/lib/search";
import type { CategorySummary, RankedCandidate } from "@/lib/ranking";
import type {
  CabStructured,
  FlightStructured,
  HotelStructured,
  TrainStructured,
} from "@/lib/extraction";
import { formatMoney, tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import {
  isBookedBooking,
  isCancelledBooking,
  isFailedBooking,
  isNotRequiredBooking,
  isPendingBooking,
} from "@/lib/booking";
import Link from "next/link";
import { TripActions } from "./TripActions";
import {
  computeBudget,
  parseStoredSelections,
  type TripSelections,
} from "@/lib/selections";
import { TripChat } from "./TripChat";
import { ConfirmBookingForm } from "./ConfirmBookingForm";
import { DecisionEngine } from "./DecisionEngine";
import { ApprovalCard } from "@/app/approvals/ApprovalCard";
import { RequestCancellation, ReviewCancellation } from "./CancellationPanel";
import { EstimateCart } from "@/components/EstimateCart";

type MaybeRanked = Candidate & Partial<RankedCandidate>;

// Classification badges shared across every category (flight/hotel/train/cab).
// Keeps the UI vocabulary identical to the server-side PriceType /
// AvailabilityStatus unions, and reads legacy values stored inside older
// itinerary JSON blobs through the two normalizers above.
const PRICE_BADGE: Record<
  PriceType,
  { className: string; label: string; title: string }
> = {
  listed: {
    className: "chip-price-listed",
    label: "Listed price",
    title: "Price appeared in a public search listing. Not a booking quote.",
  },
  indicative: {
    className: "chip-price-indicative",
    label: "Indicative price",
    title:
      "Indicative only. Either the source said 'from / starting at' or the amount was converted into the trip currency via a live FX rate.",
  },
  verified: {
    className: "chip-price-verified",
    label: "Verified price",
    title:
      "Confirmed by an authorised provider (recorded on a travel-admin booking confirmation).",
  },
  unavailable: {
    className: "chip-price-unavailable",
    label: "Price unavailable",
    title: "No reliable price available from the search listing.",
  },
};
const AVAILABILITY_BADGE: Record<
  AvailabilityStatus,
  { className: string; label: string; title: string }
> = {
  unverified: {
    className: "chip-avail-unverified",
    label: "Availability unverified",
    title:
      "Search listings are not a seat/room confirmation. Open the provider site to check live availability.",
  },
  available_verified: {
    className: "chip-avail-confirmed",
    label: "Availability confirmed",
    title: "Confirmed available by an authorised provider.",
  },
  unavailable_verified: {
    className: "chip-avail-unavailable",
    label: "Confirmed unavailable",
    title: "Confirmed unavailable by an authorised provider.",
  },
};

function ClassificationBadges({ candidate }: { candidate: Candidate }) {
  const priceType = normalizePriceType(candidate.priceType);
  const availability = normalizeAvailabilityStatus(candidate.availabilityStatus);
  const price = PRICE_BADGE[priceType];
  const avail = AVAILABILITY_BADGE[availability];
  return (
    <>
      <span className={price.className} title={price.title}>
        {price.label}
      </span>
      <span className={avail.className} title={avail.title}>
        {avail.label}
      </span>
    </>
  );
}

function formatDuration(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

type StoredResult =
  | (SearchResult & { summary?: CategorySummary })
  | SearchResult;

type Itinerary = {
  flights: StoredResult;
  hotels: StoredResult;
  trains: StoredResult;
  cabs: StoredResult;
  featured: Record<"flight" | "hotel" | "train" | "cab", Candidate | null>;
  estimatedTotal: number | null;
  rationale: string;
  retrievedAt: string;
};

type CategoryKey = "flight" | "hotel" | "train" | "cab";

const CATEGORY_META: Record<
  CategoryKey,
  { title: string; subtitle: string; icon: React.ReactNode }
> = {
  flight: {
    title: "Flights",
    subtitle: "Round-trip fares",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
        <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
      </svg>
    ),
  },
  hotel: {
    title: "Hotels",
    subtitle: "Per-night stays",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 20V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V20" />
        <path d="M8 9h3M8 13h3M8 17h3M15 9h1M15 13h1M15 17h1M2 20h20" />
      </svg>
    ),
  },
  train: {
    title: "Trains",
    subtitle: "Rail options",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="3.5" width="14" height="13" rx="3" />
        <path d="M5 10h14M9 20l-1.5 2M15 20l1.5 2M8 13.5h.01M16 13.5h.01" />
      </svg>
    ),
  },
  cab: {
    title: "Cabs",
    subtitle: "Airport transfers",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 16.5V12l2-5h12l2 5v4.5" />
        <path d="M3 16.5h18M6.5 16.5V19M17.5 16.5V19M7 12h10" />
      </svg>
    ),
  },
};

function fmtDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
}

function isAiRecommended(
  booking: { kind: string; url: string },
  itinerary: Itinerary | null,
): boolean {
  if (!itinerary?.featured) return false;
  return itinerary.featured[booking.kind as CategoryKey]?.url === booking.url;
}

export default async function TripDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const trip = await db.tripRequest.findUnique({
    where: { id },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          manager: { select: { id: true, name: true, email: true, role: true } },
        },
      },
      approvals: {
        include: {
          approver: { select: { id: true, name: true, email: true, role: true } },
          assignedBy: { select: { id: true, name: true } },
          events: {
            include: { actor: { select: { id: true, name: true, role: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      bookings: { include: { confirmedBy: true }, orderBy: { createdAt: "asc" } },
      cancellationRequests: {
        include: {
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!trip) return notFound();
  if (!canViewTrip(user, trip)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Forbidden</p>
        <p className="mt-1 text-sm text-slate-500">
          You don&apos;t have access to this trip request.
        </p>
      </div>
    );
  }

  const itinerary: Itinerary | null = trip.itinerary ? JSON.parse(trip.itinerary) : null;
  const flags: PolicyFlag[] = JSON.parse(trip.policyFlags);
  const storedSelections = parseStoredSelections(trip.selections);
  const isOwner = trip.requesterId === user.id;
  const isAdmin = canHandleBookings(user);
  const canDecideAny = canApproveAny(user);
  const isAssignedApprover = trip.approvals.some(
    (a) => a.approverId === user.id && a.decision === "pending",
  );
  const currency = trip.currency || tripCurrency(trip.origin, trip.destination);
  const pendingCancellation = trip.cancellationRequests.find((r) => r.status === "pending");
  const reassignOptions = (canDecideAny && trip.status === "pending_approval")
    ? await db.user.findMany({
        where: {
          active: true,
          role: { in: ["manager", "travel_admin", "super_admin"] },
          id: { not: trip.requesterId },
        },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      })
    : [];

  const nights = tripNights(trip.departDate, trip.returnDate);
  const selectionsBudget = storedSelections
    ? computeBudget(storedSelections, trip.itinerary, { currency, nights })
    : null;

  const categoryEntries: Array<{
    key: CategoryKey;
    result: StoredResult;
    featured: Candidate | null;
    summary: CategorySummary | undefined;
  }> = itinerary
    ? [
        {
          key: "flight",
          result: itinerary.flights,
          featured: itinerary.featured?.flight ?? null,
          summary: (itinerary.flights as { summary?: CategorySummary }).summary,
        },
        {
          key: "hotel",
          result: itinerary.hotels,
          featured: itinerary.featured?.hotel ?? null,
          summary: (itinerary.hotels as { summary?: CategorySummary }).summary,
        },
        {
          key: "train",
          result: itinerary.trains,
          featured: itinerary.featured?.train ?? null,
          summary: (itinerary.trains as { summary?: CategorySummary }).summary,
        },
        {
          key: "cab",
          result: itinerary.cabs,
          featured: itinerary.featured?.cab ?? null,
          summary: (itinerary.cabs as { summary?: CategorySummary }).summary,
        },
      ]
    : [];

  const sourceCount = new Set(
    categoryEntries.flatMap((entry) =>
      entry.result.status === "ok"
        ? entry.result.candidates.map((candidate) => candidate.sourceHostname)
        : [],
    ),
  ).size;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="glass relative overflow-hidden p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(circle at 30% 30%, rgba(165,180,252,0.9), rgba(244,114,182,0.4) 60%, transparent 72%)",
            }}
          />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="route-icon h-11 w-11 rounded-2xl">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
                  <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
                </svg>
              </span>
              <div>
                <p className="eyebrow">Trip request</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {trip.origin} <span className="text-slate-300">→</span> {trip.destination}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>
                    {fmtDate(trip.departDate)} –{" "}
                    {trip.returnDate ? fmtDate(trip.returnDate) : "One-way"}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="capitalize">{trip.flightClass.replaceAll("_", " ")} flight</span>
                  <span className="text-slate-300">·</span>
                  <span className="capitalize">{trip.trainClass.replaceAll("_", " ")} train</span>
                  <span className="text-slate-300">·</span>
                  <span>{trip.requester.name}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-indigo-600">{currency}</span>
                </div>
              </div>
            </div>
            <StatusPill status={trip.status} />
          </div>
        </section>

        <section className="card">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Purpose
          </div>
          <p className="mt-1.5 text-sm text-slate-700">{trip.purpose}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Trip type
              </div>
              <p className="mt-1.5 text-sm text-slate-700">
                {trip.tripType === "personal" ? "Personal work" : "Official work"}
              </p>
            </div>
            {trip.tripReason && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Reason
                </div>
                <p className="mt-1.5 text-sm text-slate-700">{trip.tripReason}</p>
              </div>
            )}
          </div>
          {trip.notes && (
            <>
              <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Notes
              </div>
              <p className="mt-1.5 text-sm text-slate-600">{trip.notes}</p>
            </>
          )}
        </section>

        {itinerary && storedSelections && selectionsBudget && (
          <SelectedOptionsPanel
            tripId={trip.id}
            canEdit={isOwner && trip.status === "draft"}
            selections={storedSelections}
            budget={selectionsBudget}
            currency={currency}
            nights={nights}
          />
        )}

        {/* Proposed itinerary section — temporarily hidden per request.
            Kept inline (not deleted) so it can be restored later. A minimal
            customize entry point is rendered below while the panel is off so
            the wizard workflow is still reachable. */}
        {false && itinerary ? (
          <section className="card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold tracking-tight">Proposed itinerary</h2>
                  <span className="glass-pill">Live web results</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Retrieved {shortTime(itinerary!.retrievedAt)} UTC · {sourceCount} sources ·
                  search listings, not booking confirmations
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {isOwner && trip!.status === "draft" && (
                  <Link
                    href={`/trips/${trip!.id}/customize`}
                    className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    {storedSelections?.confirmed
                      ? "Edit my selections"
                      : storedSelections
                        ? "Resume customization"
                        : "Customize my trip"}
                  </Link>
                )}
                <EstimateCart
                  tripId={trip!.id}
                  currency={currency}
                  nights={nights}
                  fallbackTotal={
                    itinerary!.estimatedTotal != null && trip!.estimateIsComplete
                      ? itinerary!.estimatedTotal
                      : null
                  }
                  itineraryJson={trip!.itinerary}
                  variant="card"
                  oneWay={!trip!.returnDate}
                />
              </div>
            </div>

            <div className="mt-5 w-full">
              <div className="grid gap-4 md:grid-cols-2">
                {categoryEntries.map(({ key, result, summary }) => (
                  <CategoryCard
                    key={key}
                    category={key}
                    result={result}
                    summary={summary}
                    currency={currency}
                    nights={nights}
                  />
                ))}
              </div>

              {itinerary!.rationale && (
                <div className="mt-4 rounded-2xl border border-indigo-200/60 bg-indigo-50/70 p-4 text-sm text-indigo-900">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                    AI rationale
                  </div>
                  {itinerary!.rationale}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* Minimal customize entry point while the Proposed itinerary panel
            is off — preserves the wizard workflow. Delete this block when
            restoring the section above. */}
        {itinerary && isOwner && trip.status === "draft" && !storedSelections && (
          <section className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold tracking-tight">Customize your trip</h2>
              <p className="mt-1 text-xs text-slate-500">
                Pick your flight / train, hotel and cab from the planner&apos;s
                real-web search results.
              </p>
            </div>
            <Link
              href={`/trips/${trip.id}/customize`}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Customize my trip
            </Link>
          </section>
        )}

        {flags.length > 0 && (
          <section className="card border-l-4 border-l-amber-400">
            <h2 className="font-semibold tracking-tight">Policy flags</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {flags.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {flagDescription(f)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold tracking-tight">Approvals &amp; decision trail</h2>
              <p className="mt-1 text-xs text-slate-500">
                {trip.requester.name}&apos;s reporting manager:{" "}
                {trip.requester.manager?.name ?? "not assigned"} · every decision is recorded with
                its approver.
              </p>
            </div>
            {trip.status === "pending_approval" && <StatusPill status="pending_approval" />}
          </div>

          {trip.approvals.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No approval has been requested yet. Submit the draft to route it to an approver.
            </p>
          ) : (
            <ul className="mt-4 space-y-5">
              {trip.approvals.map((approval) => {
                const canDecide =
                  trip.status === "pending_approval" &&
                  approval.decision === "pending" &&
                  !isOwner &&
                  (approval.approverId === user.id || canDecideAny);
                return (
                  <li
                    key={approval.id}
                    className="rounded-2xl border border-white/70 bg-white/40 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm">
                          <span className="font-medium">{approval.approver.name}</span>{" "}
                          <span className="text-slate-400">
                            ({approval.approver.role.replaceAll("_", " ")})
                          </span>
                          {approval.assignedBy && (
                            <span className="ml-2 text-[11px] text-slate-400">
                              assigned by {approval.assignedBy.name}
                            </span>
                          )}
                        </p>
                        {approval.rejectionReason && (
                          <p className="mt-1 rounded-xl border border-rose-200/60 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                            Rejection reason: {approval.rejectionReason}
                          </p>
                        )}
                        {approval.decision !== "rejected" && approval.comment && (
                          <p className="mt-1 text-xs text-slate-600">{approval.comment}</p>
                        )}
                        {approval.decidedAt && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            Decided{" "}
                            {approval.decidedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                          </p>
                        )}
                      </div>
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

                    {approval.events.length > 0 && (
                      <ol className="mt-3 space-y-2 border-l border-white/70 pl-4">
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

                    {(canDecide ||
                      (canDecideAny && approval.decision === "pending") ||
                      isOwner) &&
                      approval.decision === "pending" && (
                        <div className="mt-4">
                          <ApprovalCard
                            approvalId={approval.id}
                            decision={approval.decision}
                            canDecide={canDecide}
                            canReassign={canDecideAny && trip.status === "pending_approval"}
                            approveOptions={reassignOptions}
                            currentApproverId={approval.approverId}
                            requesterName={trip.requester.name}
                            requesterIsSelf={isOwner}
                          />
                        </div>
                      )}
                  </li>
                );
              })}
            </ul>
          )}

          {isOwner && trip.status === "draft" && (
            <p className="mt-4 text-xs text-slate-500">
              Need a change before submitting? Edit the draft from the actions panel, then re-plan
              so the retrieved options match the new route or dates.
            </p>
          )}
        </section>

        {trip.bookings.length > 0 && (
          <section className="card">
            <h2 className="font-semibold tracking-tight">Booking links</h2>
            <p className="mt-1 text-xs text-slate-500">
              This app does not perform bookings. Open the link and book on the provider&apos;s
              site. A travel admin records the real confirmation reference afterwards.
            </p>
            <ul className="mt-5 space-y-3">
              {trip.bookings.map((b) => (
                <li
                  key={b.id}
                  className="relative overflow-hidden rounded-[1.25rem] border border-white/75 bg-gradient-to-br from-white/30 to-white/10 p-4 shadow-[0_20px_50px_-30px_rgba(30,41,59,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 sm:p-5"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-blue-200/35 blur-3xl"
                  />
                  <div className="relative z-10 flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-indigo-200/80 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                          {b.kind}
                        </span>
                        <span className="text-sm font-semibold text-ink">{b.vendor}</span>
                        {isAiRecommended(b, itinerary) && (
                          <span
                            className="rounded-full border border-violet-200/80 bg-violet-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-700"
                            title="Top pick from this trip's AI itinerary"
                          >
                            AI recommended
                          </span>
                        )}
                        {isBookedBooking(b.status) ? (
                          <span className="rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                            confirmed
                          </span>
                        ) : isCancelledBooking(b.status) ? (
                          <span className="rounded-full border border-rose-200/80 bg-rose-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700">
                            cancelled
                          </span>
                        ) : isNotRequiredBooking(b.status) ? (
                          <span className="rounded-full border border-sky-200/80 bg-sky-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                            not required
                          </span>
                        ) : isFailedBooking(b.status) ? (
                          <span className="rounded-full border border-rose-200/80 bg-rose-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700">
                            failed
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                            link only
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-xs text-slate-500">
                        {b.estimatedCost != null
                          ? `${formatMoney(b.estimatedCost, b.currency ?? currency)} (estimate)`
                          : "price not listed"}
                        {" · "}retrieved {new Date(b.retrievedAt).toISOString().slice(0, 16)} UTC
                      </div>
                      {b.reference && (
                        <div className="mt-1 text-xs text-emerald-800">
                          Ref {b.reference}
                          {b.confirmedBy && ` · confirmed by ${b.confirmedBy.name}`}
                          {b.confirmedAt &&
                            ` on ${new Date(b.confirmedAt).toISOString().slice(0, 10)}`}
                        </div>
                      )}
                      {b.cancellationReference && (
                        <div className="mt-1 text-xs text-rose-800">
                          Cancellation ref {b.cancellationReference}
                          {b.cancelledAt &&
                            ` on ${new Date(b.cancelledAt).toISOString().slice(0, 10)}`}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-provider"
                      >
                        Open booking site ↗
                      </a>
                      {isAdmin &&
                        isPendingBooking(b.status) &&
                        (trip.status === "booking_links_generated" ||
                          trip.status === "booking_pending_confirmation") && (
                          <ConfirmBookingForm tripId={trip.id} bookingId={b.id} />
                        )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(trip.cancellationRequests.length > 0 ||
          trip.status === "booked" ||
          trip.status === "cancellation_requested") && (
          <section className="card">
            <h2 className="font-semibold tracking-tight">Cancellation</h2>
            <p className="mt-1 text-xs text-slate-500">
              A cancellation request never cancels a booking on its own. Travel operations verify
              the cancellation with the provider and record the real reference.
            </p>

            {trip.cancellationRequests.length > 0 && (
              <ul className="mt-4 space-y-3">
                {trip.cancellationRequests.map((request) => (
                  <li
                    key={request.id}
                    className="rounded-2xl border border-white/70 bg-white/40 p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink">
                        {request.status === "pending"
                          ? "Awaiting review"
                          : request.status === "completed"
                            ? "Cancellation verified"
                            : "Cancellation rejected"}
                      </p>
                      <span
                        className={
                          request.status === "completed"
                            ? "chip-warn"
                            : request.status === "rejected"
                              ? "tag-confirmed"
                              : "tag-link"
                        }
                      >
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Requested by {request.requestedBy.name} on{" "}
                      {request.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Reason: {request.reason}</p>
                    {request.reviewNote && (
                      <p className="mt-1 text-xs text-slate-600">Review note: {request.reviewNote}</p>
                    )}
                    {request.cancellationReference && (
                      <p className="mt-1 text-xs text-rose-700">
                        Provider cancellation reference:{" "}
                        <strong>{request.cancellationReference}</strong>
                      </p>
                    )}
                    {request.reviewedBy && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Reviewed by {request.reviewedBy.name}
                      </p>
                    )}
                    {isAdmin && request.status === "pending" && (
                      <div className="mt-3">
                        <ReviewCancellation cancellationId={request.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {isOwner && trip.status === "booked" && !pendingCancellation && (
              <div className="mt-4">
                <RequestCancellation tripId={trip.id} />
              </div>
            )}
          </section>
        )}
      </div>

      <div className="space-y-6">
        <TripActions
          trip={{ id: trip.id, status: trip.status, hasItinerary: !!itinerary }}
          isOwner={isOwner}
          isAdmin={isAdmin}
          hasPendingCancellation={!!pendingCancellation}
          categories={
            isOwner || isAdmin
              ? categoryEntries.map(({ key }) => ({
                  kind: key,
                  markedNotRequired: trip.bookings.some(
                    (b) => b.kind === key && b.status === "not_required",
                  ),
                }))
              : undefined
          }
        />
        {itinerary && (isOwner || isAdmin || isAssignedApprover) && (
          <DecisionEngine tripId={trip.id} />
        )}
        {(isOwner || isAdmin || isAssignedApprover) && <TripChat tripId={trip.id} />}
        {(isOwner || isAdmin) && (
          <div className="card text-xs text-slate-500">
            <h2 className="font-semibold tracking-tight text-ink">Requester &amp; manager</h2>
            <p className="mt-2">
              Requester: {trip.requester.name} (
              {trip.requester.role.replaceAll("_", " ")})
            </p>
            <p>Manager: {trip.requester.manager?.name ?? "Not assigned"}</p>
            <p>Department: {trip.requester.department ?? "—"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── structured cards ───────────────────────────
//
// Each category renders a dedicated card showing only the fields the
// extraction layer actually read from the snippet. Nothing is invented — a
// missing field appears as an em-dash with a tooltip explaining the gap.

const REJECT_LABEL: Record<string, string> = {
  destination_guide: "destination guides hidden",
  empty_snippet: "empty snippets hidden",
  direction_reversed: "wrong-direction results hidden",
  date_mismatch: "wrong-date results hidden",
  no_extracted_fields: "no travel detail — hidden",
  unknown_source_no_info: "unknown source, no info — hidden",
  duplicate: "duplicates merged",
};

function qualityChip(q: RankedCandidate["quality"] | undefined) {
  if (q === "high_confidence") return <span className="chip-verified">High confidence</span>;
  if (q === "partial_information") return <span className="chip-warn">Partial info</span>;
  return null;
}

function SourceFooter({ c }: { c: Candidate }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
      <div className="min-w-0 truncate">
        <span className="font-medium">{c.sourceHostname}</span>
        <span className="mx-1 text-slate-300">·</span>
        <span>retrieved {shortTime(c.retrievedAt)} UTC</span>
      </div>
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/65 px-2.5 py-1 text-[10px] font-semibold text-indigo-600 transition hover:bg-white"
      >
        Open source ↗
      </a>
    </div>
  );
}

function PriceBlock({
  c,
  currency,
  perNightOf,
  totalNights,
}: {
  c: MaybeRanked;
  currency: string;
  // When set, the listed price is treated as per-night and a total is
  // computed from totalNights. Otherwise the listed price is the total.
  perNightOf?: boolean;
  totalNights?: number;
}) {
  if (c.price == null) {
    return <div className="text-[11px] text-slate-400">price not listed</div>;
  }
  const code = c.currency ?? currency;
  const main = formatMoney(c.price, code);
  const total =
    perNightOf && totalNights && totalNights > 1
      ? formatMoney(c.price * totalNights, code)
      : null;
  return (
    <div className="text-right">
      <div className="text-base font-semibold text-ink">
        {main}
        {perNightOf ? <span className="text-xs font-normal text-slate-500"> / night</span> : null}
      </div>
      {total && (
        <div className="text-[11px] text-slate-500">{total} total · {totalNights}n</div>
      )}
      {c.priceDelta != null && c.priceDelta > 0 && (
        <div className="text-[10px] text-amber-700">+{formatMoney(c.priceDelta, code)} vs cheapest</div>
      )}
      {c.originalCurrency && c.originalPrice != null ? (
        <div className="text-[10px] text-slate-400">
          from {formatMoney(c.originalPrice, c.originalCurrency)}
        </div>
      ) : null}
    </div>
  );
}

function fieldOrDash(v: string | number | null | undefined, title?: string): React.ReactNode {
  if (v == null || v === "") {
    return (
      <span className="text-slate-400" title={title ?? "Not listed in the source"}>
        —
      </span>
    );
  }
  return v;
}

function CategoryCard({
  category,
  result,
  summary,
  currency,
  nights,
}: {
  category: CategoryKey;
  result: StoredResult;
  summary: CategorySummary | undefined;
  currency: string;
  nights: number;
}) {
  const meta = CATEGORY_META[category];

  return (
    <div
      id={`category-${category}`}
      className="flex min-w-0 flex-col rounded-2xl border border-white/70 bg-white/40 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="itinerary-icon">{meta.icon}</span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{meta.title}</h3>
            <p className="text-[10px] text-slate-400">{meta.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="glass-pill shrink-0">
            {result.status === "ok"
              ? `${result.candidates.length} shown`
              : "unavailable"}
          </span>
          {summary && summary.rejectedCount > 0 && (
            <span
              className="text-[9px] text-slate-400"
              title={Object.entries(summary.rejectedReasons)
                .map(([k, v]) => `${v} ${REJECT_LABEL[k] ?? k}`)
                .join(" · ")}
            >
              {summary.rejectedCount} filtered
            </span>
          )}
        </div>
      </div>

      {result.status === "unavailable" ? (
        <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 text-xs text-amber-800">
          Search unavailable: {result.reason}
        </div>
      ) : result.candidates.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          No matching options survived relevance filtering.
          {summary && summary.rejectedCount > 0
            ? ` ${summary.rejectedCount} raw results were rejected — see the counter above for reasons.`
            : ""}
        </p>
      ) : (
        <StructuredOptions
          category={category}
          candidates={result.candidates as MaybeRanked[]}
          summary={summary}
          currency={currency}
          nights={nights}
        />
      )}
    </div>
  );
}

function StructuredOptions({
  category,
  candidates,
  summary,
  currency,
  nights,
}: {
  category: CategoryKey;
  candidates: MaybeRanked[];
  summary: CategorySummary | undefined;
  currency: string;
  nights: number;
}) {
  // Identify the special picks for the "Recommended / Cheapest / Best value"
  // rail. The summary emits them; if summary is absent (legacy itinerary JSON)
  // we fall back to the first candidate as recommended.
  const recommendedId =
    (summary?.recommended?.url as string | undefined) ?? candidates[0]?.url;
  const cheapestId = summary?.cheapest?.url;
  const bestValueId = summary?.bestValue?.url;

  const specialIds = new Set<string>(
    [recommendedId, cheapestId, bestValueId].filter(Boolean) as string[],
  );
  const recommended = candidates.find((c) => c.url === recommendedId) ?? candidates[0];
  const cheapest =
    cheapestId && cheapestId !== recommendedId
      ? candidates.find((c) => c.url === cheapestId) ?? null
      : null;
  const bestValue =
    bestValueId && bestValueId !== recommendedId && bestValueId !== cheapestId
      ? candidates.find((c) => c.url === bestValueId) ?? null
      : null;
  const others = candidates.filter((c) => !specialIds.has(c.url));

  const renderRow = (
    c: MaybeRanked,
    emphasis: "recommended" | "cheapest" | "best_value" | "other",
  ) => (
    <StructuredRow
      key={c.url}
      candidate={c}
      category={category}
      emphasis={emphasis}
      currency={currency}
      nights={nights}
    />
  );

  return (
    <div className="mt-3 space-y-2.5">
      {renderRow(recommended, "recommended")}
      {cheapest && renderRow(cheapest, "cheapest")}
      {bestValue && renderRow(bestValue, "best_value")}
      {others.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-800 [&::-webkit-details-marker]:hidden">
            <span>
              {others.length} more option{others.length === 1 ? "" : "s"}
            </span>
            <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-2 space-y-2">
            {others.slice(0, 5).map((c) => renderRow(c, "other"))}
          </div>
        </details>
      )}
    </div>
  );
}

function EmphasisBadge({
  emphasis,
}: {
  emphasis: "recommended" | "cheapest" | "best_value" | "other";
}) {
  if (emphasis === "recommended") {
    return (
      <span className="tag-ai" title="Top pick by match confidence + completeness + price">
        Recommended
      </span>
    );
  }
  if (emphasis === "cheapest") {
    return <span className="chip-cheapest">Cheapest</span>;
  }
  if (emphasis === "best_value") {
    return (
      <span className="chip-verified" title="Lower-than-average price with high match confidence">
        Best value
      </span>
    );
  }
  return null;
}

function StructuredRow({
  candidate,
  category,
  emphasis,
  currency,
  nights,
}: {
  candidate: MaybeRanked;
  category: CategoryKey;
  emphasis: "recommended" | "cheapest" | "best_value" | "other";
  currency: string;
  nights: number;
}) {
  const containerClass =
    emphasis === "recommended"
      ? "rounded-xl border border-indigo-200/80 bg-indigo-50/55 p-3"
      : emphasis === "cheapest"
        ? "rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3"
        : emphasis === "best_value"
          ? "rounded-xl border border-violet-200/70 bg-violet-50/40 p-3"
          : "rounded-xl border border-white/70 bg-white/45 p-3";

  return (
    <div className={containerClass}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {category === "flight" && <FlightBody c={candidate} currency={currency} />}
          {category === "hotel" && (
            <HotelBody c={candidate} currency={currency} nights={nights} />
          )}
          {category === "train" && <TrainBody c={candidate} currency={currency} />}
          {category === "cab" && <CabBody c={candidate} currency={currency} />}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <EmphasisBadge emphasis={emphasis} />
          {qualityChip(candidate.quality)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <ClassificationBadges candidate={candidate} />
        {candidate.isStale && <span className="chip-warn">Stale &gt;2h</span>}
        {candidate.reliability === "unknown" && (
          <span className="chip-warn">Unknown source</span>
        )}
      </div>

      {emphasis === "recommended" && candidate.rankReasons && candidate.rankReasons.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-700">Why recommended: </span>
          {(candidate.rankReasons || [])
            .filter(
              (r) =>
                r.startsWith("origin") ||
                r === "within policy cap" ||
                r === "verified source" ||
                r.startsWith("date in snippet matches") ||
                r === "cheapest in category",
            )
            .slice(0, 3)
            .join(" · ") || "best balance of price, match and source reliability"}
        </p>
      )}

      <SourceFooter c={candidate} />
    </div>
  );
}

function FlightBody({ c, currency }: { c: MaybeRanked; currency: string }) {
  const s = c.structured?.category === "flight"
    ? (c.structured as FlightStructured)
    : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  const route =
    s?.originIata && s.destinationIata ? `${s.originIata} → ${s.destinationIata}` : null;
  const stopsLabel =
    s?.stops === 0
      ? "Non-stop"
      : s?.stops != null
        ? `${s.stops} stop${s.stops === 1 ? "" : "s"}`
        : null;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">
            {fieldOrDash(s?.airline, "Airline not named in the source")}
          </span>
          {s?.flightNumber && (
            <span className="text-[11px] text-slate-500">#{s.flightNumber}</span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">
          {route ?? <span className="text-slate-400">Route not stated with IATA codes</span>}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-4">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Depart</div>
            <div>{fieldOrDash(s?.departureTime)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Arrive</div>
            <div>{fieldOrDash(s?.arrivalTime)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Duration</div>
            <div>{fieldOrDash(duration)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Stops</div>
            <div>{fieldOrDash(stopsLabel)}</div>
          </div>
        </div>
        {s?.cabin && (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
            Cabin: <span className="text-slate-600">{s.cabin}</span>
          </div>
        )}
      </div>
      <PriceBlock c={c} currency={currency} />
    </div>
  );
}

function HotelBody({
  c,
  currency,
  nights,
}: {
  c: MaybeRanked;
  currency: string;
  nights: number;
}) {
  const s = c.structured?.category === "hotel"
    ? (c.structured as HotelStructured)
    : null;
  const stars =
    s?.starRating != null
      ? "★".repeat(s.starRating) + "☆".repeat(5 - s.starRating)
      : null;
  const guest =
    s?.guestRating != null && s.guestRatingScale != null
      ? `${s.guestRating}/${s.guestRatingScale}`
      : null;
  const amenities = s?.amenities.slice(0, 4).join(" · ") ?? "";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">
          {fieldOrDash(s?.hotelName ?? c.title.split(/[\|•·—–-]/)[0]?.trim())}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">
          {fieldOrDash(s?.area, "Area not stated in the source")}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
          {stars && <span className="text-amber-500" title={`${s?.starRating}-star`}>{stars}</span>}
          {guest && <span>{guest}{s?.reviewCount ? ` (${s.reviewCount.toLocaleString()} reviews)` : ""}</span>}
          {!stars && !guest && (
            <span className="text-slate-400" title="Neither stars nor a guest rating were listed in the source">
              Rating not listed
            </span>
          )}
        </div>
        {s?.roomType && (
          <div className="mt-1 text-[11px] text-slate-600">Room: {s.roomType}</div>
        )}
        {amenities && (
          <div className="mt-0.5 text-[11px] text-slate-500">{amenities}</div>
        )}
      </div>
      <PriceBlock c={c} currency={currency} perNightOf totalNights={nights} />
    </div>
  );
}

function TrainBody({ c, currency }: { c: MaybeRanked; currency: string }) {
  const s = c.structured?.category === "train"
    ? (c.structured as TrainStructured)
    : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">
            {fieldOrDash(s?.trainName, "Train name not stated in the source")}
          </span>
          {s?.trainNumber && (
            <span className="text-[11px] text-slate-500">#{s.trainNumber}</span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">
          {s?.originStation && s.destinationStation
            ? `${s.originStation} → ${s.destinationStation}`
            : <span className="text-slate-400">Station pair not stated</span>}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-4">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Depart</div>
            <div>{fieldOrDash(s?.departureTime)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Arrive</div>
            <div>{fieldOrDash(s?.arrivalTime)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Duration</div>
            <div>{fieldOrDash(duration)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">Class</div>
            <div>{fieldOrDash(s?.travelClass)}</div>
          </div>
        </div>
      </div>
      <PriceBlock c={c} currency={currency} />
    </div>
  );
}

function CabBody({ c, currency }: { c: MaybeRanked; currency: string }) {
  const s = c.structured?.category === "cab"
    ? (c.structured as CabStructured)
    : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">
          {fieldOrDash(s?.provider ?? c.sourceHostname)}
        </div>
        {s?.vehicleClass && (
          <div className="mt-0.5 text-[12px] text-slate-600">{s.vehicleClass}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-600">
          {s?.distanceKm != null && (
            <span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">Distance </span>
              {s.distanceKm} km
            </span>
          )}
          {duration && (
            <span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">ETA </span>
              {duration}
            </span>
          )}
          {!s?.distanceKm && !duration && (
            <span className="text-slate-400">Distance / ETA not listed</span>
          )}
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          Fare is a ride-hailing estimate only — open the provider for a live quote.
        </div>
      </div>
      <PriceBlock c={c} currency={currency} />
    </div>
  );
}

// ───────────────────────── Selected options panel ─────────────────────────
//
// Renders the user's chosen flight/train, hotel, cab and extras after they
// run through the customization wizard. The totals come from the server-side
// budget calculator — never a frontend-submitted number. When no selections
// exist, the panel is simply not rendered.

function SelectedOptionsPanel({
  tripId,
  canEdit,
  selections,
  budget,
  currency,
  nights,
}: {
  tripId: string;
  canEdit: boolean;
  selections: TripSelections;
  budget: ReturnType<typeof computeBudget>;
  currency: string;
  nights: number;
}) {
  const transport = selections.transportMode === "flight"
    ? selections.flightPick
    : selections.transportMode === "train"
      ? selections.trainPick
      : null;
  const modeLabel =
    selections.transportMode === "flight"
      ? "Flight"
      : selections.transportMode === "train"
        ? "Train"
        : "Not selected";
  return (
    <section className="card border-l-4 border-l-indigo-400">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold tracking-tight">Your selected options</h2>
            <span className={selections.confirmed ? "tag-ai" : "chip-warn"}>
              {selections.confirmed ? "Confirmed" : "Draft"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {selections.confirmed && selections.confirmedAt
              ? `Confirmed ${new Date(selections.confirmedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC`
              : "Draft in progress — not yet submitted for approval."}
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/trips/${tripId}/customize`}
            className="rounded-full border border-white/70 bg-white/60 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-white"
          >
            Edit my selections
          </Link>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectionTile
          title={modeLabel}
          primary={
            transport?.displayTitle ??
            transport?.title ??
            (selections.transportMode === "none" ? "Not selected" : "—")
          }
          secondary={transport?.provider ?? ""}
          price={
            transport && transport.priceAtSelection != null
              ? formatMoney(transport.priceAtSelection, transport.currencyAtSelection ?? currency)
              : null
          }
        />
        <SelectionTile
          title={`Hotel · ${nights}n`}
          primary={
            selections.hotelPick?.title ??
            (selections.hotelSkipped ? "Skipped" : "Not selected")
          }
          secondary={selections.hotelPick?.provider ?? ""}
          price={
            selections.hotelPick?.priceAtSelection != null
              ? `${formatMoney(selections.hotelPick.priceAtSelection, selections.hotelPick.currencyAtSelection ?? currency)} / night`
              : null
          }
        />
        <SelectionTile
          title="Cab"
          primary={
            selections.cabPick?.title ??
            (selections.cabSkipped ? "Skipped" : "Not selected")
          }
          secondary={selections.cabPick?.provider ?? ""}
          price={
            selections.cabPick?.priceAtSelection != null
              ? formatMoney(selections.cabPick.priceAtSelection, selections.cabPick.currencyAtSelection ?? currency)
              : null
          }
        />
        <SelectionTile
          title={`Additional (${selections.extras.length})`}
          primary={
            selections.extras.length === 0
              ? "None"
              : selections.extras.map((e) => e.label).join(", ")
          }
          secondary=""
          price={
            selections.extras.length === 0
              ? null
              : formatMoney(
                  selections.extras.reduce((a, e) => a + e.amount, 0),
                  currency,
                )
          }
        />
      </dl>

      <div className="mt-4 rounded-2xl border border-indigo-200/70 bg-indigo-50/55 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total estimated budget</span>
          <span className="text-xl font-semibold">
            {budget.grandTotal != null ? formatMoney(budget.grandTotal, currency) : "—"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Server-computed from your selected options. Verification:{" "}
          {budget.isComplete
            ? "all selected items have a listed price"
            : "estimate incomplete — at least one selected item had no listed price"}.
        </p>
        {budget.warnings.map((w) => (
          <p key={w} className="mt-1 text-[11px] text-amber-700">{w}</p>
        ))}
      </div>
    </section>
  );
}

function SelectionTile({
  title,
  primary,
  secondary,
  price,
}: {
  title: string;
  primary: string;
  secondary: string;
  price: string | null;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/45 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {title}
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-medium text-ink">{primary}</div>
      {secondary && <div className="text-[11px] text-slate-500">{secondary}</div>}
      <div className="mt-1.5 text-sm font-semibold">
        {price ?? <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}
