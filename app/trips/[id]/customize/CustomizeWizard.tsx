"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Candidate } from "@/lib/search";
import type { RankedCandidate } from "@/lib/ranking";
import type {
  CabStructured,
  FlightStructured,
  HotelStructured,
  TrainStructured,
} from "@/lib/extraction";
import {
  normalizeCandidateTitle,
  type BudgetBreakdown,
  type BudgetLine,
  type ExtraExpense,
  type TripSelections,
  type TransportMode,
} from "@/lib/selections";
import { formatMoney } from "@/lib/currency";

type MaybeRanked = Candidate & Partial<RankedCandidate>;

type NearbyAirport = {
  iata: string;
  name: string;
  city: string;
  country: string;
  distanceKm: number | null;
};

type Props = {
  tripId: string;
  tripSummary: {
    origin: string;
    destination: string;
    originIata?: string | null;
    destinationIata?: string | null;
    departDate: string;
    returnDate: string | null;
    currency: string;
    nights: number;
    itineraryRetrievedAt?: string | null;
  };
  itinerary: {
    flights: Candidate[];
    // Flights the extractor couldn't resolve into a selectable option.
    // Kept so the UI can disclose the raw source listings without letting
    // the user pick a row that is not a real flight option.
    flightsSourceOnly?: Candidate[];
    // Commercial airports near the trip's origin / destination, offered as
    // alternatives in the empty state. Never auto-applied — the user has to
    // explicitly change the trip to use one.
    flightNearbyAlternatives?: {
      origin: NearbyAirport[];
      destination: NearbyAirport[];
    };
    trains: Candidate[];
    hotels: Candidate[];
    cabs: Candidate[];
  };
  initialSelections: TripSelections;
  initialBudget: BudgetBreakdown;
};

type Step = 0 | 1 | 2 | 3 | 4 | 5;

const STEP_META: Record<Step, { title: string; subtitle: string }> = {
  0: { title: "Transportation", subtitle: "Flight or train — compare the trade-offs" },
  1: {
    title: "Pick your transport",
    subtitle: "Compare classes, then choose a specific option",
  },
  2: { title: "Hotel", subtitle: `Where you stay (optional)` },
  3: { title: "Cab", subtitle: "Airport / local transfer (optional)" },
  4: { title: "Additional expenses", subtitle: "Meals, parking, misc. (optional)" },
  5: { title: "Review & confirm", subtitle: "Final cost breakdown" },
};

// ───────────────────────────── helpers ───────────────────────────────────

function formatDuration(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function priceLabel(c: Candidate | null | undefined, currency: string) {
  if (!c || c.price == null) return "price not listed";
  return formatMoney(c.price, c.currency ?? currency);
}

// Deep-compare the content of two selection states. Used to decide whether
// the server's response actually says something new — object identity always
// differs after JSON round-trip, so comparing references would loop forever.
function pickDiffer(
  a: TripSelections["flightPick"],
  b: TripSelections["flightPick"],
): boolean {
  if ((a?.url ?? null) !== (b?.url ?? null)) return true;
  if ((a?.title ?? null) !== (b?.title ?? null)) return true;
  if ((a?.displayTitle ?? null) !== (b?.displayTitle ?? null)) return true;
  if ((a?.provider ?? null) !== (b?.provider ?? null)) return true;
  if ((a?.priceAtSelection ?? null) !== (b?.priceAtSelection ?? null)) return true;
  if ((a?.currencyAtSelection ?? null) !== (b?.currencyAtSelection ?? null)) return true;
  return false;
}

function selectionsDiffer(a: TripSelections, b: TripSelections): boolean {
  if (a.transportMode !== b.transportMode) return true;
  if (pickDiffer(a.flightPick, b.flightPick)) return true;
  if (pickDiffer(a.trainPick, b.trainPick)) return true;
  if (pickDiffer(a.hotelPick, b.hotelPick)) return true;
  if (pickDiffer(a.cabPick, b.cabPick)) return true;
  if (a.hotelSkipped !== b.hotelSkipped) return true;
  if (a.cabSkipped !== b.cabSkipped) return true;
  if (a.confirmed !== b.confirmed) return true;
  if (a.extras.length !== b.extras.length) return true;
  return a.extras.some(
    (e, i) =>
      e.id !== b.extras[i].id ||
      e.label !== b.extras[i].label ||
      e.category !== b.extras[i].category ||
      e.amount !== b.extras[i].amount,
  );
}

// Lower is better; priced beats unpriced. Used by the sort dropdown.
function sortByPrice(a: Candidate, b: Candidate): number {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return a.price - b.price;
}

// Prefer the structured cab provider ("Uber") over the hostname ("uber.com")
// so the review page shows the vendor name the user recognises.
function pickProvider(c: Candidate): string {
  if (c.structured?.category === "cab") {
    const cab = c.structured as CabStructured;
    if (cab.provider) return cab.provider;
  }
  return c.provider ?? c.sourceHostname ?? "";
}

function buildPickRef(c: Candidate) {
  const normalized = normalizeCandidateTitle(c);
  return {
    url: c.url,
    title: normalized,
    displayTitle: normalized,
    provider: pickProvider(c),
    priceAtSelection: c.price ?? null,
    currencyAtSelection: c.currency ?? null,
  };
}

function sortByDuration(a: MaybeRanked, b: MaybeRanked): number {
  const ad = a.durationMinutes ?? Infinity;
  const bd = b.durationMinutes ?? Infinity;
  return ad - bd;
}

// ───────────────────────────── main ──────────────────────────────────────

export function CustomizeWizard({
  tripId,
  tripSummary,
  itinerary,
  initialSelections,
  initialBudget,
}: Props) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(() => {
    // Resume where the user left off.
    if (initialSelections.transportMode === "none") return 0;
    const pickDone =
      initialSelections.transportMode === "flight"
        ? !!initialSelections.flightPick
        : !!initialSelections.trainPick;
    if (!pickDone) return 1;
    if (!initialSelections.hotelPick && !initialSelections.hotelSkipped) return 2;
    if (!initialSelections.cabPick && !initialSelections.cabSkipped) return 3;
    return 5;
  });
  const [selections, setSelections] = useState<TripSelections>(initialSelections);
  const [budget, setBudget] = useState<BudgetBreakdown>(initialBudget);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Autosave on selection change. Two flows share the same work:
  //   - debounced (~450ms) for ambient changes
  //   - saveNow() awaitable, called before Confirm so the server has the
  //     latest draft before we POST /confirm.
  // The server recomputes the budget and sends it back; we take the number
  // it returns rather than trusting the client. We only adopt the server's
  // `selections` when its CONTENT differs from ours (e.g. it normalized a
  // title) — adopting a structurally-equal-but-new object every save would
  // re-trigger the [selections] effect below and autosave in an infinite
  // loop. We also skip adoption when the user clicked again mid-flight,
  // because the client's state is then the newer truth.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true); // skip the initial render
  const selectionsRef = useRef<TripSelections>(selections);
  useEffect(() => {
    selectionsRef.current = selections;
  }, [selections]);

  function buildDraftBody(current: TripSelections) {
    return {
      transportMode: current.transportMode,
      flightUrl: current.flightPick?.url ?? null,
      trainUrl: current.trainPick?.url ?? null,
      hotelUrl: current.hotelPick?.url ?? null,
      hotelSkipped: current.hotelSkipped,
      cabUrl: current.cabPick?.url ?? null,
      cabSkipped: current.cabSkipped,
      extras: current.extras,
    };
  }

  async function saveNow(): Promise<BudgetBreakdown | null> {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = selectionsRef.current;
    setSaving(true);
    try {
      const body = buildDraftBody(current);
      const res = await fetch(`/api/trips/${tripId}/selections`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(
          data?.error ?? `Could not save selections (HTTP ${res.status})`,
        );
        return null;
      }
      setSaveError(null);
      const data = (await res.json()) as {
        selections: TripSelections;
        budget: BudgetBreakdown;
      };
      setBudget(data.budget);
      // Adopt the server's normalized copy ONLY when (a) the user hasn't
      // made a newer change since this request started (compare by URL
      // triplet + skip flags) and (b) its content actually differs from
      // local state. Writing a fresh-but-equal object back into `selections`
      // would change its identity, re-run the autosave effect below, and
      // PUT again forever — the loop that caused ERR_CONNECTION_RESET.
      const latest = selectionsRef.current;
      const sameShape =
        latest.transportMode === data.selections.transportMode &&
        (latest.flightPick?.url ?? null) === (data.selections.flightPick?.url ?? null) &&
        (latest.trainPick?.url ?? null) === (data.selections.trainPick?.url ?? null) &&
        (latest.hotelPick?.url ?? null) === (data.selections.hotelPick?.url ?? null) &&
        latest.hotelSkipped === data.selections.hotelSkipped &&
        (latest.cabPick?.url ?? null) === (data.selections.cabPick?.url ?? null) &&
        latest.cabSkipped === data.selections.cabSkipped &&
        latest.extras.length === data.selections.extras.length;
      if (sameShape && selectionsDiffer(latest, data.selections)) {
        setSelections(data.selections);
      }
      return data.budget;
    } catch (err) {
      // Network / parse failures must not surface as unhandled rejections
      // (the autosave calls `void saveNow()`). Show the standard save error.
      setSaveError(
        err instanceof Error && err.message
          ? `Could not save selections (${err.message})`
          : "Could not save selections (network error)",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveNow();
    }, 450);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, tripId]);

  // ───────────── navigation ─────────────
  const goPrev = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : 0));
  const goNext = () => setStep((s) => (s < 5 ? ((s + 1) as Step) : 5));

  const canAdvance: Record<Step, boolean> = {
    0: selections.transportMode !== "none",
    1:
      (selections.transportMode === "flight" && !!selections.flightPick) ||
      (selections.transportMode === "train" && !!selections.trainPick),
    2: true,
    3: true,
    4: true,
    5: false,
  };

  // ───────────── confirm ─────────────
  async function onConfirm() {
    setConfirmError(null);
    setConfirming(true);
    try {
      // Cancel the debounced autosave — the confirm endpoint accepts the
      // full draft body and applies it atomically, so save+confirm is one
      // call. This eliminates the race where the user clicked Confirm
      // within the 450ms debounce window and the server read a stale
      // "transportMode: none" from the database.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const body = buildDraftBody(selectionsRef.current);
      const res = await fetch(`/api/trips/${tripId}/selections/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setConfirmError(data?.error ?? `Confirm failed (HTTP ${res.status})`);
        return;
      }
      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  // ───────────── render ─────────────
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="space-y-6 lg:col-span-3">
        <section className="glass p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Customize my trip</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {tripSummary.origin} → {tripSummary.destination}
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(tripSummary.departDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}{" "}
                {tripSummary.returnDate
                  ? `– ${new Date(tripSummary.returnDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })} · ${tripSummary.nights} night${tripSummary.nights === 1 ? "" : "s"}`
                  : "· one-way"}
                {" · "}currency {tripSummary.currency}
              </p>
              {tripSummary.itineraryRetrievedAt && (
                <FreshnessBadge
                  retrievedAt={tripSummary.itineraryRetrievedAt}
                />
              )}
            </div>
            <div className="text-right text-[11px]">
              {saving ? (
                <span className="text-slate-500">Saving draft…</span>
              ) : saveError ? (
                <span className="font-semibold text-rose-600">
                  Draft save failed — {saveError}
                </span>
              ) : budget.warnings.length > 0 ? (
                <span className="text-slate-500">Draft saved · warnings</span>
              ) : (
                <span className="text-slate-500">Draft saved</span>
              )}
            </div>
          </div>

          <StepIndicator current={step} />
        </section>

        <section className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">{STEP_META[step].title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{STEP_META[step].subtitle}</p>
          </div>

          {step === 0 && (
            <TransportCompare
              flights={itinerary.flights}
              trains={itinerary.trains}
              currency={tripSummary.currency}
              mode={selections.transportMode}
              onPick={(mode) =>
                setSelections((s) => ({ ...s, transportMode: mode }))
              }
              origin={tripSummary.origin}
              destination={tripSummary.destination}
            />
          )}
          {step === 1 && (
            <TransportPick
              mode={selections.transportMode}
              flights={itinerary.flights}
              flightsSourceOnly={itinerary.flightsSourceOnly ?? []}
              flightNearbyAlternatives={
                itinerary.flightNearbyAlternatives ?? { origin: [], destination: [] }
              }
              trains={itinerary.trains}
              currency={tripSummary.currency}
              tripOrigin={tripSummary.origin}
              tripDestination={tripSummary.destination}
              tripOriginIata={tripSummary.originIata ?? null}
              tripDestinationIata={tripSummary.destinationIata ?? null}
              currentFlight={selections.flightPick?.url ?? null}
              currentTrain={selections.trainPick?.url ?? null}
              onPickFlight={(c) =>
                setSelections((s) => ({
                  ...s,
                  transportMode: "flight",
                  flightPick: c ? buildPickRef(c) : null,
                }))
              }
              onPickTrain={(c) =>
                setSelections((s) => ({
                  ...s,
                  transportMode: "train",
                  trainPick: c ? buildPickRef(c) : null,
                }))
              }
              onRetrySearch={async () => {
                try {
                  await fetch(`/api/trips/${tripId}/plan`, { method: "POST" });
                } finally {
                  router.refresh();
                }
              }}
              onPickTrainMode={() =>
                setSelections((s) => ({ ...s, transportMode: "train" }))
              }
            />
          )}
          {step === 2 && (
            <HotelPick
              hotels={itinerary.hotels}
              currency={tripSummary.currency}
              nights={tripSummary.nights}
              currentUrl={selections.hotelPick?.url ?? null}
              skipped={selections.hotelSkipped}
              onPick={(c) =>
                setSelections((s) => ({
                  ...s,
                  hotelSkipped: false,
                  hotelPick: c ? buildPickRef(c) : null,
                }))
              }
              onSkip={() =>
                setSelections((s) => ({ ...s, hotelSkipped: true, hotelPick: null }))
              }
            />
          )}
          {step === 3 && (
            <CabPick
              cabs={itinerary.cabs}
              currency={tripSummary.currency}
              currentUrl={selections.cabPick?.url ?? null}
              skipped={selections.cabSkipped}
              onPick={(c) =>
                setSelections((s) => ({
                  ...s,
                  cabSkipped: false,
                  cabPick: c ? buildPickRef(c) : null,
                }))
              }
              onSkip={() =>
                setSelections((s) => ({ ...s, cabSkipped: true, cabPick: null }))
              }
            />
          )}
          {step === 4 && (
            <ExtrasEditor
              extras={selections.extras}
              currency={tripSummary.currency}
              onChange={(extras) => setSelections((s) => ({ ...s, extras }))}
            />
          )}
          {step === 5 && (
            <ReviewStep
              selections={selections}
              budget={budget}
              tripSummary={tripSummary}
              onEditStep={setStep}
              confirmError={confirmError}
              confirming={confirming}
              onConfirm={onConfirm}
            />
          )}

          <WizardNav
            step={step}
            canAdvance={canAdvance[step]}
            onPrev={goPrev}
            onNext={goNext}
          />
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <BudgetSidebar budget={budget} currency={tripSummary.currency} />
      </aside>
    </div>
  );
}

// ───────────────────────────── step indicator ────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: Step[] = [0, 1, 2, 3, 4, 5];
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
      {steps.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={
              s === current
                ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white"
                : s < current
                  ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white"
                  : "inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-white/50 text-[11px] font-semibold text-slate-500"
            }
          >
            {s + 1}
          </span>
          <span className={s === current ? "font-semibold text-ink" : "text-slate-500"}>
            {STEP_META[s].title}
          </span>
          {s < 5 && <span className="text-slate-300">·</span>}
        </li>
      ))}
    </ol>
  );
}

// ───────────────────────────── budget sidebar ────────────────────────────

function BudgetSidebar({
  budget,
  currency,
}: {
  budget: BudgetBreakdown;
  currency: string;
}) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold tracking-tight">Live budget</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Recomputed on the server after every change.
      </p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {budget.lines.length === 0 ? (
          <li className="text-xs text-slate-400">No selections yet.</li>
        ) : (
          budget.lines.map((line) => <BudgetRow key={line.key} line={line} currency={currency} />)
        )}
      </ul>
      <div className="mt-4 border-t border-white/60 pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-semibold">
            {budget.grandTotal != null
              ? formatMoney(budget.grandTotal, currency)
              : "—"}
          </span>
        </div>
        {!budget.isComplete && (
          <p className="mt-1.5 text-[11px] text-amber-700">
            Estimate incomplete — at least one selected item had no listed price.
          </p>
        )}
      </div>
      {budget.warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 text-[11px] text-amber-800">
          {budget.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetRow({ line, currency }: { line: BudgetLine; currency: string }) {
  return (
    <li className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[13px] text-slate-700">{line.label}</div>
        {line.note && <div className="text-[10px] text-slate-400">{line.note}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-ink">
          {line.amount != null ? formatMoney(line.amount, currency) : <span className="text-slate-400">—</span>}
        </div>
        {line.indicative && <div className="text-[9px] text-amber-700">indicative</div>}
      </div>
    </li>
  );
}

// ───────────────────────────── navigation footer ─────────────────────────

function WizardNav({
  step,
  canAdvance,
  onPrev,
  onNext,
}: {
  step: Step;
  canAdvance: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-white/60 pt-4">
      <button
        type="button"
        onClick={onPrev}
        disabled={step === 0}
        className="rounded-full border border-white/70 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Previous
      </button>
      {step < 5 && (
        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className="rounded-full bg-indigo-600 px-5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue →
        </button>
      )}
    </div>
  );
}

// ───────────────────────────── step bodies ───────────────────────────────

function TransportCompare({
  flights,
  trains,
  currency,
  mode,
  onPick,
  origin,
  destination,
}: {
  flights: Candidate[];
  trains: Candidate[];
  currency: string;
  mode: TransportMode;
  onPick: (m: TransportMode) => void;
  origin: string;
  destination: string;
}) {
  const bestFlight = flights.find((c) => c.price != null) ?? flights[0] ?? null;
  const bestTrain = trains.find((c) => c.price != null) ?? trains[0] ?? null;

  // Extract route + time info from the first candidate that has structured data.
  function flightRoute(c: Candidate | null) {
    const s = c?.structured?.category === "flight" ? (c.structured as FlightStructured) : null;
    return {
      from: s?.originCity ?? s?.originIata ?? origin,
      to: s?.destinationCity ?? s?.destinationIata ?? destination,
      depart: s?.departureTime ?? null,
      arrive: s?.arrivalTime ?? null,
    };
  }
  function trainRoute(c: Candidate | null) {
    const s = c?.structured?.category === "train" ? (c.structured as TrainStructured) : null;
    return {
      from: s?.originStation ?? origin,
      to: s?.destinationStation ?? destination,
      depart: s?.departureTime ?? null,
      arrive: s?.arrivalTime ?? null,
    };
  }

  const fRoute = flightRoute(bestFlight);
  const tRoute = trainRoute(bestTrain);
  const fDuration = formatDuration((bestFlight as MaybeRanked)?.durationMinutes ?? null);
  const tDuration = formatDuration((bestTrain as MaybeRanked)?.durationMinutes ?? null);
  const fStops =
    bestFlight?.structured?.category === "flight"
      ? (bestFlight.structured as FlightStructured).stops
      : null;
  const tClass =
    bestTrain?.structured?.category === "train"
      ? (bestTrain.structured as TrainStructured).travelClass
      : null;

  const Card = ({
    kind,
    label,
    sublabel,
    route,
    depart,
    arrive,
    duration,
    stops,
    travelClass,
    count,
    selected,
    onClick,
    price,
    convenience,
  }: {
    kind: "flight" | "train";
    label: string;
    sublabel: string;
    route: { from: string; to: string };
    depart: string | null;
    arrive: string | null;
    duration: string | null;
    stops: number | null;
    travelClass: string | null;
    count: number;
    selected: boolean;
    onClick: () => void;
    price: string;
    convenience: string;
  }) => {
    const stopsLabel =
      stops === 0 ? "Non-stop" : stops != null ? `${stops} stop${stops === 1 ? "" : "s"}` : null;
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={count === 0}
        className={
          (selected
            ? "border-indigo-400 bg-indigo-50/60 shadow-[0_18px_50px_-30px_rgba(79,70,229,0.5)]"
            : "border-white/70 bg-white/40") +
          " flex min-h-[200px] flex-1 flex-col items-start rounded-2xl border p-5 text-left transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <div className="flex w-full items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {label}
            </div>
            <div className="mt-0.5 text-lg font-semibold">{sublabel}</div>
          </div>
          {selected && <span className="tag-ai">Selected</span>}
        </div>

        {/* Route: origin → destination */}
        <div className="mt-3 w-full">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{route.from}</span>
            <span className="text-slate-400">→</span>
            <span className="truncate">{route.to}</span>
          </div>
          {(depart || arrive) && (
            <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-600">
              {depart && <span>Dep {depart}</span>}
              {depart && arrive && <span className="text-slate-300">·</span>}
              {arrive && <span>Arr {arrive}</span>}
            </div>
          )}
        </div>

        <div className="mt-3 w-full space-y-1 text-[12px] text-slate-600">
          <Row label="Starting from" value={price} strong />
          <Row label="Duration" value={duration ?? "—"} />
          {kind === "flight" && stopsLabel && <Row label="Stops" value={stopsLabel} />}
          {kind === "train" && travelClass && <Row label="Class" value={travelClass} />}
          <Row label="Options available" value={`${count}`} />
          <Row label="Convenience" value={convenience} />
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <Card
        kind="flight"
        label="Fly"
        sublabel="Flight"
        route={{ from: fRoute.from, to: fRoute.to }}
        depart={fRoute.depart}
        arrive={fRoute.arrive}
        duration={fDuration}
        stops={fStops}
        travelClass={null}
        count={flights.length}
        selected={mode === "flight"}
        onClick={() => onPick("flight")}
        price={priceLabel(bestFlight, currency)}
        convenience="Fastest, airport transfers needed"
      />
      <Card
        kind="train"
        label="Train"
        sublabel="Train"
        route={{ from: tRoute.from, to: tRoute.to }}
        depart={tRoute.depart}
        arrive={tRoute.arrive}
        duration={tDuration}
        stops={null}
        travelClass={tClass}
        count={trains.length}
        selected={mode === "train"}
        onClick={() => onPick("train")}
        price={priceLabel(bestTrain, currency)}
        convenience="City-centre to city-centre, flexible schedule"
      />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className={strong ? "text-sm font-semibold text-ink" : ""}>{value}</span>
    </div>
  );
}

// Group a candidate into a comparable class label. Returns `null` when the
// structured extraction didn't see an explicit cabin class — those rows
// bucket under "Unspecified" and never bias the class price comparison.
// Never guess: an unspecified cabin NEVER gets classified as Economy or
// Business just because the search returned that candidate.
function flightClassOf(c: Candidate): string | null {
  if (c.structured?.category !== "flight") return null;
  const raw = (c.structured as FlightStructured).cabin;
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  // These matches only win when the extractor already satisfied the
  // "class / cabin / fare" context check in extractFlight — the raw value
  // here comes straight from that whitelist, so we just map the canonical
  // casing without re-inventing anything.
  if (v === "first" || /\bfirst\b/.test(v)) return "First";
  if (v === "business" || /\bbusiness\b/.test(v)) return "Business";
  if (v === "premium economy" || /\bpremium\b/.test(v)) return "Premium economy";
  if (v === "economy" || /\beconomy\b/.test(v)) return "Economy";
  return null; // unknown / malformed value → treat as unspecified
}

function trainClassOf(c: Candidate): string | null {
  if (c.structured?.category !== "train") return null;
  const raw = (c.structured as TrainStructured).travelClass;
  if (!raw) return null;
  return raw.trim().toUpperCase().slice(0, 20);
}

function classOf(mode: TransportMode, c: Candidate): string | null {
  return mode === "flight" ? flightClassOf(c) : trainClassOf(c);
}

// Flights typically ladder: Economy < Premium economy < Business < First.
// Trains in India order from least to most premium: SL/2S < 3AC/CC/EC <
// 2AC < 1AC. Anything we don't recognise sorts alphabetically at the end.
const FLIGHT_CLASS_ORDER = ["Economy", "Premium economy", "Business", "First"];
const TRAIN_CLASS_ORDER = ["SL", "2S", "3E", "3AC", "CC", "EC", "2AC", "1AC"];
function classOrderIndex(mode: TransportMode, cls: string): number {
  const list = mode === "flight" ? FLIGHT_CLASS_ORDER : TRAIN_CLASS_ORDER;
  const i = list.findIndex((x) => x.toLowerCase() === cls.toLowerCase());
  return i === -1 ? 999 : i;
}

// Per-class summary: cheapest listed price + option count. Used by the
// comparison strip so the user sees at a glance "Economy from ₹6,404 (4),
// Business from ₹18,200 (1)" without having to filter manually first.
type ClassSummary = {
  cls: string; // display label ("Economy") or "Unspecified"
  count: number;
  minPrice: number | null;
  currency: string | null;
};

function summarizeByClass(
  mode: TransportMode,
  items: Candidate[],
): ClassSummary[] {
  const map = new Map<string, ClassSummary>();
  for (const c of items) {
    const key = classOf(mode, c) ?? "Unspecified";
    const entry = map.get(key) ?? {
      cls: key,
      count: 0,
      minPrice: null,
      currency: null,
    };
    entry.count += 1;
    if (c.price != null && (entry.minPrice == null || c.price < entry.minPrice)) {
      entry.minPrice = c.price;
      entry.currency = c.currency ?? entry.currency;
    }
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.cls === "Unspecified") return 1;
    if (b.cls === "Unspecified") return -1;
    const da = classOrderIndex(mode, a.cls);
    const db = classOrderIndex(mode, b.cls);
    if (da !== db) return da - db;
    return a.cls.localeCompare(b.cls);
  });
}

function ClassCompareStrip({
  mode,
  summaries,
  activeClass,
  currency,
  onPick,
}: {
  mode: TransportMode;
  summaries: ClassSummary[];
  activeClass: string | null; // null = "All"
  currency: string;
  onPick: (cls: string | null) => void;
}) {
  if (summaries.length === 0) return null;
  const totalCount = summaries.reduce((acc, s) => acc + s.count, 0);
  const label = mode === "flight" ? "Cabin class" : "Travel class";
  return (
    <div className="mb-4 rounded-2xl border border-white/70 bg-white/45 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {label} · price comparison
        </div>
        <div className="text-[10px] text-slate-400">
          cheapest listed price per class
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ClassChip
          label="All classes"
          sub={`${totalCount} option${totalCount === 1 ? "" : "s"}`}
          price={null}
          currency={currency}
          selected={activeClass == null}
          onClick={() => onPick(null)}
        />
        {summaries.map((s) => (
          <ClassChip
            key={s.cls}
            label={s.cls}
            sub={`${s.count} option${s.count === 1 ? "" : "s"}`}
            price={s.minPrice}
            currency={s.currency ?? currency}
            selected={activeClass === s.cls}
            onClick={() => onPick(s.cls)}
          />
        ))}
      </div>
    </div>
  );
}

function ClassChip({
  label,
  sub,
  price,
  currency,
  selected,
  onClick,
}: {
  label: string;
  sub: string;
  price: number | null;
  currency: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        (selected
          ? "border-indigo-400 bg-indigo-50/70 text-indigo-900 shadow-[0_12px_30px_-24px_rgba(79,70,229,0.5)]"
          : "border-white/70 bg-white/60 text-slate-700 hover:bg-white") +
        " min-w-[120px] rounded-xl border px-3 py-2 text-left transition"
      }
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>
      <div className="mt-1 text-[12px] font-semibold text-ink">
        {price != null ? `from ${formatMoney(price, currency)}` : "price not listed"}
      </div>
    </button>
  );
}

function TransportPick({
  mode,
  flights,
  flightsSourceOnly,
  flightNearbyAlternatives,
  trains,
  currency,
  tripOrigin,
  tripDestination,
  tripOriginIata,
  tripDestinationIata,
  currentFlight,
  currentTrain,
  onPickFlight,
  onPickTrain,
  onRetrySearch,
  onPickTrainMode,
}: {
  mode: TransportMode;
  flights: Candidate[];
  flightsSourceOnly: Candidate[];
  flightNearbyAlternatives: {
    origin: NearbyAirport[];
    destination: NearbyAirport[];
  };
  trains: Candidate[];
  currency: string;
  tripOrigin: string;
  tripDestination: string;
  tripOriginIata: string | null;
  tripDestinationIata: string | null;
  currentFlight: string | null;
  currentTrain: string | null;
  onPickFlight: (c: Candidate | null) => void;
  onPickTrain: (c: Candidate | null) => void;
  onRetrySearch: () => void;
  onPickTrainMode: () => void;
}) {
  const [sort, setSort] = useState<"price" | "duration">("price");
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [showSourceOnly, setShowSourceOnly] = useState(false);
  // Reset the class filter + source disclosure when the mode flips so
  // leftover state from one mode doesn't bleed into the other.
  useEffect(() => {
    setActiveClass(null);
    setShowSourceOnly(false);
  }, [mode]);
  if (mode === "none") {
    return <p className="text-sm text-slate-500">Pick flight or train first.</p>;
  }
  const items = mode === "flight" ? flights : trains;
  const summaries = useMemo(() => summarizeByClass(mode, items), [mode, items]);
  const filtered = useMemo(() => {
    if (activeClass == null) return items;
    return items.filter(
      (c) => (classOf(mode, c) ?? "Unspecified") === activeClass,
    );
  }, [items, mode, activeClass]);
  const sorted = useMemo(() => {
    const copy = [...filtered] as MaybeRanked[];
    if (sort === "price") copy.sort(sortByPrice);
    else copy.sort(sortByDuration);
    return copy;
  }, [filtered, sort]);
  const currentUrl = mode === "flight" ? currentFlight : currentTrain;

  // Flight-specific empty state. Train / cab lists get the simple message.
  if (mode === "flight" && items.length === 0) {
    return (
      <FlightEmptyState
        tripOrigin={tripOrigin}
        tripDestination={tripDestination}
        tripOriginIata={tripOriginIata}
        tripDestinationIata={tripDestinationIata}
        sourceOnly={flightsSourceOnly}
        nearbyAlternatives={flightNearbyAlternatives}
        currency={currency}
        onRetrySearch={onRetrySearch}
        onPickTrainMode={onPickTrainMode}
      />
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No {mode} options available for this trip.</p>;
  }

  return (
    <div>
      <ClassCompareStrip
        mode={mode}
        summaries={summaries}
        activeClass={activeClass}
        currency={currency}
        onPick={setActiveClass}
      />
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {sorted.length} option{sorted.length === 1 ? "" : "s"} shown
          {activeClass && (
            <>
              {" "}· <span className="font-semibold text-slate-700">{activeClass}</span>
              <button
                type="button"
                onClick={() => setActiveClass(null)}
                className="ml-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
              >
                clear filter
              </button>
            </>
          )}
        </span>
        <label className="flex items-center gap-2 text-slate-500">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "price" | "duration")}
            className="rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs"
          >
            <option value="price">Price (low → high)</option>
            <option value="duration">Duration (short → long)</option>
          </select>
        </label>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500">
          No {mode} options in the {activeClass ?? "selected"} class. Pick
          another class above or clear the filter.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {sorted.map((c) => (
            <li key={c.url}>
              {mode === "flight" ? (
                <TransportListRowFlight
                  c={c}
                  currency={currency}
                  selected={c.url === currentUrl}
                  onClick={() => onPickFlight(c)}
                />
              ) : (
                <TransportListRowTrain
                  c={c}
                  currency={currency}
                  selected={c.url === currentUrl}
                  onClick={() => onPickTrain(c)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {mode === "flight" && flightsSourceOnly.length > 0 && (
        <SourceOnlyFlights
          rows={flightsSourceOnly}
          shown={showSourceOnly}
          onToggle={() => setShowSourceOnly((s) => !s)}
        />
      )}
    </div>
  );
}

function FlightEmptyState({
  tripOrigin,
  tripDestination,
  tripOriginIata,
  tripDestinationIata,
  sourceOnly,
  nearbyAlternatives,
  currency,
  onRetrySearch,
  onPickTrainMode,
}: {
  tripOrigin: string;
  tripDestination: string;
  tripOriginIata: string | null;
  tripDestinationIata: string | null;
  sourceOnly: Candidate[];
  nearbyAlternatives: {
    origin: NearbyAirport[];
    destination: NearbyAirport[];
  };
  currency: string;
  onRetrySearch: () => void;
  onPickTrainMode: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const routeLabel =
    tripOriginIata && tripDestinationIata
      ? `${tripOriginIata} → ${tripDestinationIata}`
      : `${tripOrigin} → ${tripDestination}`;
  const hasAlts =
    nearbyAlternatives.origin.length > 0 ||
    nearbyAlternatives.destination.length > 0;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-5">
        <h3 className="text-base font-semibold text-amber-900">
          No reliable flight options found for {routeLabel}.
        </h3>
        <p className="mt-1 text-sm text-amber-900/80">
          We found web listings, but they did not contain enough verified flight
          information to compare.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRetrySearch}
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Retry search
          </button>
          <button
            type="button"
            onClick={onPickTrainMode}
            className="rounded-full border border-white/70 bg-white/80 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
          >
            Explore train instead
          </button>
          {sourceOnly.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSource((s) => !s)}
              className="rounded-full border border-white/70 bg-white/80 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
            >
              {showSource ? "Hide" : "View"} {sourceOnly.length} source
              {sourceOnly.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {showSource && sourceOnly.length > 0 && (
          <SourceEvidenceList rows={sourceOnly} currency={currency} />
        )}
      </div>

      {hasAlts && (
        <NearbyAirportPanel
          tripOriginIata={tripOriginIata}
          tripDestinationIata={tripDestinationIata}
          alternatives={nearbyAlternatives}
        />
      )}
    </div>
  );
}

function NearbyAirportPanel({
  tripOriginIata,
  tripDestinationIata,
  alternatives,
}: {
  tripOriginIata: string | null;
  tripDestinationIata: string | null;
  alternatives: {
    origin: NearbyAirport[];
    destination: NearbyAirport[];
  };
}) {
  const Column = ({
    title,
    anchor,
    rows,
  }: {
    title: string;
    anchor: string | null;
    rows: NearbyAirport[];
  }) => {
    if (rows.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {title} {anchor ? `· anchor ${anchor}` : null}
        </div>
        <ul className="mt-2 space-y-1.5">
          {rows.map((a) => (
            <li
              key={a.iata}
              className="flex items-start justify-between gap-2 rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-[12px]"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-700">
                  {a.iata} · {a.city}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  {a.name} · {a.country}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-slate-500">
                {a.distanceKm != null
                  ? `${Math.round(a.distanceKm)} km`
                  : ""}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="rounded-2xl border border-white/70 bg-white/45 p-5">
      <h4 className="text-sm font-semibold">Explore nearby airports</h4>
      <p className="mt-1 text-[12px] text-slate-500">
        These are commercial airports near your trip&apos;s origin or
        destination. We never swap airports automatically — update the trip
        request if you want to try one.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Column
          title="Near origin"
          anchor={tripOriginIata}
          rows={alternatives.origin}
        />
        <Column
          title="Near destination"
          anchor={tripDestinationIata}
          rows={alternatives.destination}
        />
      </div>
    </div>
  );
}

function SourceOnlyFlights({
  rows,
  shown,
  onToggle,
}: {
  rows: Candidate[];
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-white/70 bg-white/35 p-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <div className="text-sm font-semibold">
            {rows.length} source listing{rows.length === 1 ? "" : "s"} without
            enough information to select
          </div>
          <div className="text-[11px] text-slate-500">
            Kept for transparency — not selectable as flight options.
          </div>
        </div>
        <span className="text-[11px] font-semibold text-indigo-600">
          {shown ? "Hide" : "Show"}
        </span>
      </button>
      {shown && <SourceEvidenceList rows={rows} />}
    </div>
  );
}

function SourceEvidenceList({
  rows,
  currency,
}: {
  rows: Candidate[];
  currency?: string;
}) {
  return (
    <ul className="mt-3 space-y-2 text-[12px]">
      {rows.map((c) => (
        <li
          key={c.url}
          className="rounded-xl border border-white/70 bg-white/55 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-700">
                {c.title || c.sourceHostname}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {c.sourceHostname}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-slate-500">
              {c.price != null
                ? formatMoney(c.price, c.currency ?? currency ?? "USD")
                : "price not listed"}
            </div>
          </div>
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
          >
            Open source ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

function TransportListRowFlight({
  c,
  currency,
  selected,
  onClick,
}: {
  c: MaybeRanked;
  currency: string;
  selected: boolean;
  onClick: () => void;
}) {
  const s = c.structured?.category === "flight"
    ? (c.structured as FlightStructured)
    : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  const stops = s?.stops === 0
    ? "Non-stop"
    : s?.stops != null
      ? `${s.stops} stop${s.stops === 1 ? "" : "s"}`
      : null;
  const route = s?.originIata && s.destinationIata ? `${s.originIata} → ${s.destinationIata}` : null;
  const cabinLabel = flightClassOf(c);
  const completeness = s?.completeness ?? "insufficient";
  const disabled = completeness === "insufficient";
  const tripType = s?.tripType ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={
        disabled
          ? "This listing does not provide enough information to pick as a specific flight."
          : undefined
      }
      className={
        (selected
          ? "border-indigo-400 bg-indigo-50/55"
          : disabled
            ? "cursor-not-allowed border-white/60 bg-white/30 opacity-70"
            : "border-white/70 bg-white/45 hover:shadow-md") +
        " flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition"
      }
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
          <span>{s?.airline ?? "Not provided"}</span>
          {s?.flightNumber && <span className="text-[11px] text-slate-500">#{s.flightNumber}</span>}
          {cabinLabel && (
            <span className="rounded-full border border-indigo-200/70 bg-indigo-50/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
              {cabinLabel}
            </span>
          )}
          <CompletenessBadge level={completeness} />
          {tripType === "round-trip" && (
            <span className="rounded-full border border-amber-200/70 bg-amber-50/70 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              round-trip fare
            </span>
          )}
          {c.priceSuspicious && c.price != null && (
            <span className="rounded-full border border-rose-200/70 bg-rose-50/70 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
              unusual fare
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">
          {route ?? <span className="text-slate-400">Route not provided</span>}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-4">
          <Field label="Depart" value={s?.departureTime ?? "Not provided"} />
          <Field label="Arrive" value={s?.arrivalTime ?? "Not provided"} />
          <Field label="Duration" value={duration ?? "Not provided"} />
          <Field label="Stops" value={stops ?? "Not provided"} />
        </div>
        {s?.baggageAllowance && (
          <div className="mt-1 text-[11px] text-slate-600">
            Baggage: {s.baggageAllowance}
          </div>
        )}
        <div className="mt-1 text-[10px] text-slate-400">
          {c.provider} · {c.sourceHostname} · {c.availabilityStatus === "available_verified" ? "available (verified)" : c.availabilityStatus === "unavailable_verified" ? "unavailable (verified)" : "source listing · not a booking confirmation"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-semibold">
          {c.price != null
            ? formatMoney(c.price, c.currency ?? currency)
            : <span className="text-slate-400">Not provided</span>}
        </div>
        {c.price != null && c.priceType === "indicative" && (
          <div className="mt-0.5 text-[10px] text-amber-700">indicative</div>
        )}
        {selected && <span className="tag-ai mt-1 inline-block">Selected</span>}
      </div>
    </button>
  );
}

// Render a human-readable age of the stored itinerary ("fetched 3h 12m ago")
// with a "stale" chip past 6h. Deterministic — computes from the server-
// provided ISO timestamp, not from a live Date.now() inside server HTML
// (would mismatch client hydration). Instead renders inside an effect-safe
// span and tolerates slight drift between server render and client paint.
function FreshnessBadge({ retrievedAt }: { retrievedAt: string }) {
  const [now, setNow] = useState<number>(() => Date.parse(retrievedAt));
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ts = Date.parse(retrievedAt);
  if (!Number.isFinite(ts)) return null;
  const ageMs = Math.max(0, now - ts);
  const stale = ageMs > 6 * 60 * 60 * 1000;
  const mins = Math.floor(ageMs / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const label =
    mins < 1
      ? "just now"
      : h === 0
        ? `${m}m ago`
        : `${h}h ${m}m ago`;
  return (
    <p className="mt-1 text-[10px] text-slate-500">
      <span>Last fetched {label}</span>
      {stale && (
        <span className="ml-2 rounded-full border border-amber-200/70 bg-amber-50/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
          stale
        </span>
      )}
    </p>
  );
}

function CompletenessBadge({ level }: { level: "complete" | "partial" | "insufficient" }) {
  const style =
    level === "complete"
      ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-700"
      : level === "partial"
        ? "border-amber-200/70 bg-amber-50/70 text-amber-800"
        : "border-rose-200/70 bg-rose-50/70 text-rose-700";
  const label =
    level === "complete" ? "Complete" : level === "partial" ? "Partial info" : "Insufficient";
  return (
    <span
      className={`${style} rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide`}
    >
      {label}
    </span>
  );
}

function TransportListRowTrain({
  c,
  currency,
  selected,
  onClick,
}: {
  c: MaybeRanked;
  currency: string;
  selected: boolean;
  onClick: () => void;
}) {
  const s = c.structured?.category === "train"
    ? (c.structured as TrainStructured)
    : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        (selected
          ? "border-indigo-400 bg-indigo-50/55"
          : "border-white/70 bg-white/45") +
        " flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition hover:shadow-md"
      }
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
          <span>{s?.trainName ?? c.title.split(/[\|•·—–-]/)[0]?.trim() ?? c.provider}</span>
          {s?.trainNumber && <span className="text-[11px] text-slate-500">#{s.trainNumber}</span>}
          {s?.travelClass && (
            <span className="rounded-full border border-indigo-200/70 bg-indigo-50/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
              {s.travelClass}
            </span>
          )}
        </div>
        {s?.originStation && s.destinationStation && (
          <div className="mt-0.5 text-[12px] text-slate-600">
            {s.originStation} → {s.destinationStation}
          </div>
        )}
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-4">
          <Field label="Depart" value={s?.departureTime ?? "—"} />
          <Field label="Arrive" value={s?.arrivalTime ?? "—"} />
          <Field label="Duration" value={duration ?? "—"} />
          <Field label="Class" value={s?.travelClass ?? "—"} />
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          {c.provider} · availability: {c.availabilityStatus}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-semibold">{priceLabel(c, currency)}</div>
        {selected && <span className="tag-ai mt-1 inline-block">Selected</span>}
      </div>
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
      <div>{value}</div>
    </div>
  );
}

// ───────────────────────────── hotel ─────────────────────────────────────

function HotelPick({
  hotels,
  currency,
  nights,
  currentUrl,
  skipped,
  onPick,
  onSkip,
}: {
  hotels: Candidate[];
  currency: string;
  nights: number;
  currentUrl: string | null;
  skipped: boolean;
  onPick: (c: Candidate | null) => void;
  onSkip: () => void;
}) {
  const [maxBudget, setMaxBudget] = useState<number | "">("");
  const [minStars, setMinStars] = useState<number>(0);
  const [area, setArea] = useState<string>("");

  const filtered = useMemo(() => {
    return hotels.filter((c) => {
      const s = (c as MaybeRanked).structured;
      const hotel = s?.category === "hotel" ? (s as HotelStructured) : null;
      if (typeof maxBudget === "number" && c.price != null && c.price > maxBudget) return false;
      if (minStars > 0 && (hotel?.starRating ?? 0) < minStars) return false;
      if (area && hotel?.area && !hotel.area.toLowerCase().includes(area.toLowerCase())) return false;
      return true;
    });
  }, [hotels, maxBudget, minStars, area]);

  if (hotels.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 p-4 text-sm text-amber-800">
        No hotels were returned in the search results.
        <button
          type="button"
          onClick={onSkip}
          className="ml-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-white"
        >
          Skip hotel
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1 text-slate-500">
          <span>Max / night</span>
          <input
            type="number"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="—"
            className="w-24 rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          <span>Min stars</span>
          <select
            value={minStars}
            onChange={(e) => setMinStars(Number(e.target.value))}
            className="rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs"
          >
            {[0, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any" : `${n}+`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          <span>Area</span>
          <input
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="any"
            className="w-28 rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={onSkip}
          className={
            (skipped
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-white/70 bg-white/60 text-slate-600") +
            " ml-auto rounded-full border px-3 py-1 text-xs font-semibold hover:bg-white"
          }
        >
          {skipped ? "Hotel skipped (click a hotel to pick one)" : "Skip hotel"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No hotels match the current filters.</p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((c) => (
            <li key={c.url}>
              <HotelRow
                c={c as MaybeRanked}
                currency={currency}
                nights={nights}
                selected={c.url === currentUrl}
                onClick={() => onPick(c)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HotelRow({
  c,
  currency,
  nights,
  selected,
  onClick,
}: {
  c: MaybeRanked;
  currency: string;
  nights: number;
  selected: boolean;
  onClick: () => void;
}) {
  const s = c.structured?.category === "hotel" ? (c.structured as HotelStructured) : null;
  const stars = s?.starRating != null ? "★".repeat(s.starRating) + "☆".repeat(5 - s.starRating) : null;
  const guest =
    s?.guestRating != null && s.guestRatingScale != null
      ? `${s.guestRating}/${s.guestRatingScale}`
      : null;
  const amenities = s?.amenities.slice(0, 3).join(" · ") ?? "";
  const totalStay = c.price != null && nights > 0 ? c.price * nights : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        (selected
          ? "border-indigo-400 bg-indigo-50/55"
          : "border-white/70 bg-white/45") +
        " flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition hover:shadow-md"
      }
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {s?.hotelName ?? c.title.split(/[\|•·—–-]/)[0]?.trim() ?? c.provider}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">{s?.area ?? "—"}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">
          {stars && <span className="text-amber-500">{stars}</span>}
          {guest && <span>{guest}</span>}
          {s?.reviewCount && <span>({s.reviewCount.toLocaleString()} reviews)</span>}
          {!stars && !guest && <span className="text-slate-400">Rating not listed</span>}
        </div>
        {s?.roomType && <div className="mt-1 text-[11px] text-slate-600">Room: {s.roomType}</div>}
        {amenities && <div className="mt-0.5 text-[11px] text-slate-500">{amenities}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-semibold">{priceLabel(c, currency)}<span className="text-[11px] font-normal text-slate-500"> / night</span></div>
        {totalStay != null && (
          <div className="text-[11px] text-slate-500">{formatMoney(totalStay, c.currency ?? currency)} total · {nights}n</div>
        )}
        {selected && <span className="tag-ai mt-1 inline-block">Selected</span>}
      </div>
    </button>
  );
}

// ───────────────────────────── cab ───────────────────────────────────────

function CabPick({
  cabs,
  currency,
  currentUrl,
  skipped,
  onPick,
  onSkip,
}: {
  cabs: Candidate[];
  currency: string;
  currentUrl: string | null;
  skipped: boolean;
  onPick: (c: Candidate | null) => void;
  onSkip: () => void;
}) {
  if (cabs.length === 0) {
    return (
      <div className="rounded-xl border border-white/70 bg-white/45 p-4 text-sm text-slate-600">
        No cab options were returned. If you don&apos;t need one, you can skip this step.
        <button
          type="button"
          onClick={onSkip}
          className={
            (skipped
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-white/70 bg-white/60 text-slate-600") +
            " ml-3 rounded-full border px-3 py-1 text-xs font-semibold hover:bg-white"
          }
        >
          {skipped ? "Skipped" : "Skip cab"}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-end text-xs">
        <button
          type="button"
          onClick={onSkip}
          className={
            (skipped
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-white/70 bg-white/60 text-slate-600") +
            " rounded-full border px-3 py-1 text-xs font-semibold hover:bg-white"
          }
        >
          {skipped ? "Cab skipped" : "Skip cab"}
        </button>
      </div>
      <ul className="space-y-2.5">
        {cabs.map((c) => (
          <li key={c.url}>
            <CabRow
              c={c as MaybeRanked}
              currency={currency}
              selected={c.url === currentUrl}
              onClick={() => onPick(c)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CabRow({
  c,
  currency,
  selected,
  onClick,
}: {
  c: MaybeRanked;
  currency: string;
  selected: boolean;
  onClick: () => void;
}) {
  const s = c.structured?.category === "cab" ? (c.structured as CabStructured) : null;
  const duration = formatDuration(s?.durationMinutes ?? c.durationMinutes);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        (selected
          ? "border-indigo-400 bg-indigo-50/55"
          : "border-white/70 bg-white/45") +
        " flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition hover:shadow-md"
      }
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold">{s?.provider ?? c.sourceHostname}</div>
        {s?.vehicleClass && (
          <div className="mt-0.5 text-[12px] text-slate-600">{s.vehicleClass}</div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-600">
          {s?.distanceKm != null && <span>{s.distanceKm} km</span>}
          {duration && <span>~{duration}</span>}
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          Fare is a ride-hailing estimate only — not a confirmed booking.
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-semibold">{priceLabel(c, currency)}</div>
        {selected && <span className="tag-ai mt-1 inline-block">Selected</span>}
      </div>
    </button>
  );
}

// ───────────────────────────── extras ────────────────────────────────────

function ExtrasEditor({
  extras,
  currency,
  onChange,
}: {
  extras: ExtraExpense[];
  currency: string;
  onChange: (next: ExtraExpense[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [category, setCategory] = useState<ExtraExpense["category"]>("meals");

  function add() {
    const trimmed = label.trim();
    if (!trimmed || typeof amount !== "number" || amount < 0) return;
    const next: ExtraExpense = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `x-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: trimmed.slice(0, 80),
      category,
      amount,
    };
    onChange([...extras, next]);
    setLabel("");
    setAmount("");
  }

  function remove(id: string) {
    onChange(extras.filter((e) => e.id !== id));
  }

  function updateAmount(id: string, next: number) {
    onChange(extras.map((e) => (e.id === id ? { ...e, amount: next } : e)));
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        Add out-of-pocket expenses you want reflected in the trip budget. These are
        <strong> manually entered estimates</strong>, not sourced prices.
      </p>
      <ul className="mb-4 space-y-2">
        {extras.length === 0 ? (
          <li className="text-xs text-slate-400">No additional expenses yet.</li>
        ) : (
          extras.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/70 bg-white/45 p-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{e.label}</div>
                <div className="text-[10px] text-slate-400">{e.category.replace("_", " ")}</div>
              </div>
              <input
                type="number"
                value={e.amount}
                min={0}
                onChange={(ev) => updateAmount(e.id, Number(ev.target.value) || 0)}
                className="w-24 rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => remove(e.id)}
                className="rounded-full border border-white/70 bg-white/60 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-white"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="rounded-xl border border-white/70 bg-white/45 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Add an expense</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. lunch Tuesday)"
            className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-sm"
          />
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
            min={0}
            placeholder={currency}
            className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExtraExpense["category"])}
            className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-sm"
          >
            <option value="meals">Meals</option>
            <option value="local_transport">Local transport</option>
            <option value="parking">Parking</option>
            <option value="misc">Misc</option>
          </select>
          <button
            type="button"
            onClick={add}
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── review ────────────────────────────────────

function ReviewStep({
  selections,
  budget,
  tripSummary,
  onEditStep,
  confirmError,
  confirming,
  onConfirm,
}: {
  selections: TripSelections;
  budget: BudgetBreakdown;
  tripSummary: Props["tripSummary"];
  onEditStep: (s: Step) => void;
  confirmError: string | null;
  confirming: boolean;
  onConfirm: () => void;
}) {
  // Prefer the structured-derived displayTitle; fall back to the stored
  // title (which is also normalized for new picks), then to the provider,
  // so the Option row never shows an empty string or a raw Tavily headline
  // like "Flight Option: Ghaziabad → Mumbai | ixigo.com".
  const pickLabel = (p: { displayTitle?: string | null; title: string; provider: string } | null) => {
    if (!p) return "";
    const v = (p.displayTitle ?? "").trim() || (p.title ?? "").trim() || p.provider;
    return v || "Selected option";
  };
  const transport =
    selections.transportMode === "flight"
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
    <div className="space-y-4">
      <ReviewSection
        title="Transportation"
        onEdit={() => onEditStep(1)}
        rows={
          transport
            ? [
                { label: "Mode", value: modeLabel },
                { label: "Option", value: pickLabel(transport) },
                { label: "Provider", value: transport.provider },
                {
                  label: "Price",
                  value:
                    transport.priceAtSelection != null
                      ? formatMoney(transport.priceAtSelection, transport.currencyAtSelection ?? tripSummary.currency)
                      : "price not listed",
                },
              ]
            : [{ label: "Not selected", value: "Pick flight or train before confirming" }]
        }
      />
      <ReviewSection
        title="Hotel"
        onEdit={() => onEditStep(2)}
        rows={
          selections.hotelPick
            ? [
                { label: "Hotel", value: pickLabel(selections.hotelPick) },
                { label: "Nights", value: `${tripSummary.nights}` },
                {
                  label: "Per night",
                  value:
                    selections.hotelPick.priceAtSelection != null
                      ? formatMoney(selections.hotelPick.priceAtSelection, selections.hotelPick.currencyAtSelection ?? tripSummary.currency)
                      : "price not listed",
                },
              ]
            : [{ label: selections.hotelSkipped ? "Skipped" : "Not selected", value: "" }]
        }
      />
      <ReviewSection
        title="Cab"
        onEdit={() => onEditStep(3)}
        rows={
          selections.cabPick
            ? [
                { label: "Provider", value: selections.cabPick.provider },
                { label: "Option", value: pickLabel(selections.cabPick) },
                {
                  label: "Fare",
                  value:
                    selections.cabPick.priceAtSelection != null
                      ? formatMoney(selections.cabPick.priceAtSelection, selections.cabPick.currencyAtSelection ?? tripSummary.currency)
                      : "price not listed",
                },
              ]
            : [{ label: selections.cabSkipped ? "Skipped" : "Not selected", value: "" }]
        }
      />
      <ReviewSection
        title={`Additional expenses (${selections.extras.length})`}
        onEdit={() => onEditStep(4)}
        rows={
          selections.extras.length === 0
            ? [{ label: "None", value: "" }]
            : selections.extras.map((e) => ({
                label: e.label,
                value: formatMoney(e.amount, tripSummary.currency),
              }))
        }
      />

      <div className="rounded-2xl border border-indigo-200/70 bg-indigo-50/55 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total estimated budget</span>
          <span className="text-xl font-semibold">
            {budget.grandTotal != null ? formatMoney(budget.grandTotal, tripSummary.currency) : "—"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Verification: {budget.isComplete ? "all selected lines have a listed price" : "estimate incomplete — at least one line had no listed price"}.
        </p>
        {budget.warnings.map((w) => (
          <p key={w} className="mt-1 text-[11px] text-amber-700">{w}</p>
        ))}
      </div>

      {confirmError && (
        <p className="rounded-xl border border-rose-200/70 bg-rose-50/70 p-3 text-xs text-rose-700">
          {confirmError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/60 pt-4">
        <button
          type="button"
          onClick={() => onEditStep(0)}
          className="rounded-full border border-white/70 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
        >
          Edit selections
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="rounded-full bg-indigo-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirming ? "Confirming…" : "Confirm selection"}
        </button>
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Edit
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <dt className="text-slate-500">{r.label}</dt>
            <dd className="text-right text-slate-700">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
