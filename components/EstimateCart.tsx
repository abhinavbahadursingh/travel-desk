"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/currency";

type MinimalCandidate = {
  title: string;
  provider: string;
  url: string;
  estimatedPrice: number | null;
  currency: string | null;
};

type MinimalItinerary = {
  flights?: { candidates?: MinimalCandidate[] };
  trains?: { candidates?: MinimalCandidate[] };
  hotels?: { candidates?: MinimalCandidate[] };
  cabs?: { candidates?: MinimalCandidate[] };
  featured?: {
    flight?: MinimalCandidate | null;
    train?: MinimalCandidate | null;
    hotel?: MinimalCandidate | null;
    cab?: MinimalCandidate | null;
  };
} | null;

type Props = {
  tripId: string;
  currency: string;
  nights: number;
  fallbackTotal: number | null;
  itineraryJson: string | null;
  variant?: "compact" | "card";
  oneWay?: boolean;
};

type TransportMode = "flight" | "train" | "none";

function pickDefaultIndex(
  candidates: MinimalCandidate[],
  featured: MinimalCandidate | null | undefined,
): number {
  if (!candidates.length) return -1;
  if (featured) {
    const i = candidates.findIndex(
      (c) => c.url === featured.url && c.provider === featured.provider,
    );
    if (i >= 0) return i;
  }
  const firstPriced = candidates.findIndex(
    (c) => typeof c.estimatedPrice === "number" && c.estimatedPrice > 0,
  );
  return firstPriced >= 0 ? firstPriced : 0;
}

export function EstimateCart({
  tripId,
  currency,
  nights,
  fallbackTotal,
  itineraryJson,
  variant = "compact",
  oneWay = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const itinerary = useMemo<MinimalItinerary>(() => {
    if (!itineraryJson) return null;
    try {
      return JSON.parse(itineraryJson) as MinimalItinerary;
    } catch {
      return null;
    }
  }, [itineraryJson]);

  const flights = itinerary?.flights?.candidates ?? [];
  const trains = itinerary?.trains?.candidates ?? [];
  const hotels = itinerary?.hotels?.candidates ?? [];
  const cabs = itinerary?.cabs?.candidates ?? [];

  const hasFlights = flights.length > 0;
  const hasTrains = trains.length > 0;

  // Default picks reflect the featured legs the planner already chose.
  const [mode, setMode] = useState<TransportMode>(() =>
    hasFlights ? "flight" : hasTrains ? "train" : "none",
  );
  const [flightIdx, setFlightIdx] = useState<number>(() =>
    pickDefaultIndex(flights, itinerary?.featured?.flight),
  );
  const [trainIdx, setTrainIdx] = useState<number>(() =>
    pickDefaultIndex(trains, itinerary?.featured?.train),
  );
  const [hotelOn, setHotelOn] = useState<boolean>(hotels.length > 0 && nights > 0);
  const [hotelIdx, setHotelIdx] = useState<number>(() =>
    pickDefaultIndex(hotels, itinerary?.featured?.hotel),
  );
  const [cabOn, setCabOn] = useState<boolean>(cabs.length > 0);
  const [cabIdx, setCabIdx] = useState<number>(() =>
    pickDefaultIndex(cabs, itinerary?.featured?.cab),
  );

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const transportLine = useMemo(() => {
    if (mode === "flight") {
      const c = flights[flightIdx];
      return c
        ? { label: c.title, price: c.estimatedPrice, note: c.provider }
        : null;
    }
    if (mode === "train") {
      const c = trains[trainIdx];
      return c
        ? { label: c.title, price: c.estimatedPrice, note: c.provider }
        : null;
    }
    return null;
  }, [mode, flightIdx, trainIdx, flights, trains]);

  const hotelLine = useMemo(() => {
    if (!hotelOn) return null;
    const c = hotels[hotelIdx];
    if (!c) return null;
    const perNight = typeof c.estimatedPrice === "number" ? c.estimatedPrice : null;
    const subtotal = perNight != null && nights > 0 ? perNight * nights : null;
    return {
      label: c.title,
      note: `${c.provider} · ${nights} night${nights === 1 ? "" : "s"}`,
      price: subtotal,
      perNight,
    };
  }, [hotelOn, hotels, hotelIdx, nights]);

  const cabLine = useMemo(() => {
    if (!cabOn) return null;
    const c = cabs[cabIdx];
    if (!c) return null;
    return { label: c.title, note: c.provider, price: c.estimatedPrice };
  }, [cabOn, cabs, cabIdx]);

  const lines = useMemo(() => {
    const out: Array<{
      key: string;
      label: string;
      note?: string;
      price: number | null;
    }> = [];
    if (transportLine) {
      out.push({
        key: "transport",
        label: transportLine.label,
        note: transportLine.note,
        price: transportLine.price,
      });
    }
    if (hotelLine) {
      out.push({
        key: "hotel",
        label: hotelLine.label,
        note: hotelLine.note,
        price: hotelLine.price,
      });
    }
    if (cabLine) {
      out.push({
        key: "cab",
        label: cabLine.label,
        note: cabLine.note,
        price: cabLine.price,
      });
    }
    return out;
  }, [transportLine, hotelLine, cabLine]);

  const total = useMemo(() => {
    let sum = 0;
    let anyMissing = false;
    for (const l of lines) {
      if (typeof l.price !== "number" || !Number.isFinite(l.price)) {
        anyMissing = true;
        continue;
      }
      sum += l.price;
    }
    return { sum: lines.length ? sum : null, anyMissing, lineCount: lines.length };
  }, [lines]);

  const buttonLabel = useMemo(() => {
    if (fallbackTotal == null) return null;
    return formatMoney(fallbackTotal, currency);
  }, [fallbackTotal, currency]);

  // Nothing to interact with if we have no itinerary data at all.
  const noItinerary = !itinerary || (!hasFlights && !hasTrains && !hotels.length && !cabs.length);

  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => !noItinerary && setOpen(true)}
          disabled={noItinerary}
          aria-label={
            noItinerary
              ? "Estimate"
              : "Open expense breakdown for this trip"
          }
          title={
            noItinerary
              ? "Plan the trip to see a breakdown"
              : "Click for expense breakdown"
          }
          className={`group rounded-2xl border border-white/70 bg-white/50 px-4 py-2.5 text-right transition ${
            noItinerary
              ? "cursor-default"
              : "hover:border-indigo-300/70 hover:bg-indigo-50/60 hover:shadow-[0_8px_30px_-12px_rgba(99,102,241,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          }`}
        >
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Flight + hotel estimate
          </div>
          <div className="flex items-baseline justify-end gap-1.5">
            <div className="text-xl font-semibold tracking-tight">
              {buttonLabel ?? "Unavailable"}
            </div>
            {!noItinerary && (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 text-slate-400 group-hover:text-indigo-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="text-[10px] text-slate-400">
            {nights} night{nights === 1 ? "" : "s"}
            {oneWay && " (one-way assumed)"}
          </div>
          {fallbackTotal == null && (
            <div className="mt-1 text-[11px] font-medium text-amber-700">
              Total cost unavailable — some prices are missing.
            </div>
          )}
          {!noItinerary && (
            <div className="mt-1 text-[10px] font-medium text-indigo-500/80">
              Click to customize →
            </div>
          )}
        </button>
      ) : fallbackTotal == null ? (
        <span
          className="text-amber-700"
          title="Total cost unavailable — some prices are missing."
        >
          cost unavailable
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={noItinerary}
          className={`group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition ${
            noItinerary
              ? "cursor-default text-slate-700"
              : "hover:bg-indigo-50/60 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          }`}
          aria-label={
            noItinerary
              ? "Estimate"
              : "Open expense breakdown for this trip"
          }
          title={
            noItinerary
              ? "Plan the trip to see a breakdown"
              : "Click for expense breakdown"
          }
        >
          <span>{buttonLabel}</span>
          <span className="text-[10px] text-slate-400">est.</span>
          {!noItinerary && (
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3 text-slate-400 group-hover:text-indigo-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      )}

      {open && (
        <EstimateCartModal
          onClose={() => setOpen(false)}
          currency={currency}
          nights={nights}
          hasFlights={hasFlights}
          hasTrains={hasTrains}
          flights={flights}
          trains={trains}
          hotels={hotels}
          cabs={cabs}
          mode={mode}
          setMode={setMode}
          flightIdx={flightIdx}
          setFlightIdx={setFlightIdx}
          trainIdx={trainIdx}
          setTrainIdx={setTrainIdx}
          hotelOn={hotelOn}
          setHotelOn={setHotelOn}
          hotelIdx={hotelIdx}
          setHotelIdx={setHotelIdx}
          cabOn={cabOn}
          setCabOn={setCabOn}
          cabIdx={cabIdx}
          setCabIdx={setCabIdx}
          lines={lines}
          total={total}
          tripId={tripId}
        />
      )}
    </>
  );
}

function priceLabel(
  price: number | null | undefined,
  currency: string,
  suffix?: string,
): string {
  if (typeof price !== "number" || !Number.isFinite(price)) return "price not listed";
  return `${formatMoney(price, currency)}${suffix ?? ""}`;
}

type ModalProps = {
  onClose: () => void;
  currency: string;
  nights: number;
  hasFlights: boolean;
  hasTrains: boolean;
  flights: MinimalCandidate[];
  trains: MinimalCandidate[];
  hotels: MinimalCandidate[];
  cabs: MinimalCandidate[];
  mode: TransportMode;
  setMode: (m: TransportMode) => void;
  flightIdx: number;
  setFlightIdx: (i: number) => void;
  trainIdx: number;
  setTrainIdx: (i: number) => void;
  hotelOn: boolean;
  setHotelOn: (b: boolean) => void;
  hotelIdx: number;
  setHotelIdx: (i: number) => void;
  cabOn: boolean;
  setCabOn: (b: boolean) => void;
  cabIdx: number;
  setCabIdx: (i: number) => void;
  lines: Array<{ key: string; label: string; note?: string; price: number | null }>;
  total: { sum: number | null; anyMissing: boolean; lineCount: number };
  tripId: string;
};

function EstimateCartModal(props: ModalProps) {
  const {
    onClose, currency, nights,
    hasFlights, hasTrains,
    flights, trains, hotels, cabs,
    mode, setMode,
    flightIdx, setFlightIdx,
    trainIdx, setTrainIdx,
    hotelOn, setHotelOn, hotelIdx, setHotelIdx,
    cabOn, setCabOn, cabIdx, setCabIdx,
    lines, total, tripId,
  } = props;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="estimate-cart-title"
    >
      {/* Backdrop — strong blur + dimmer so the page reads as glass. */}
      <button
        type="button"
        aria-label="Close breakdown"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{
          backdropFilter: "blur(16px) saturate(140%)",
          WebkitBackdropFilter: "blur(16px) saturate(140%)",
          background:
            "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(900px 500px at 80% 90%, rgba(236,72,153,0.14), transparent 60%), rgba(15,23,42,0.35)",
        }}
      />

      {/* Liquid-glass panel */}
      <div
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/60 shadow-[0_40px_120px_-30px_rgba(15,23,42,0.6)]"
        style={{
          background: "linear-gradient(140deg, rgba(255,255,255,0.86) 0%, rgba(255,255,255,0.68) 55%, rgba(255,255,255,0.78) 100%)",
          backdropFilter: "blur(30px) saturate(190%)",
          WebkitBackdropFilter: "blur(30px) saturate(190%)",
        }}
      >
        {/* Accent gloss */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-16 h-32"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, rgba(165,180,252,0.45), transparent 70%)",
          }}
        />

        <header className="relative flex items-start justify-between border-b border-white/70 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500/80">
              Expense breakdown
            </p>
            <h2 id="estimate-cart-title" className="mt-1 text-lg font-semibold text-ink">
              Your trip cart
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Mix and match — totals update live. Nothing here is booked yet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/70 bg-white/60 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
          >
            Close
          </button>
        </header>

        <div className="relative max-h-[70vh] overflow-y-auto px-6 py-5">
          {/* Transport */}
          <Section
            title="Transport"
            subtitle="Pick flight or train for the main leg."
            right={
              <div className="flex items-center gap-1 rounded-full border border-white/70 bg-white/70 p-1 text-xs">
                <SegBtn
                  active={mode === "flight"}
                  disabled={!hasFlights}
                  onClick={() => setMode("flight")}
                >
                  ✈ Flight
                </SegBtn>
                <SegBtn
                  active={mode === "train"}
                  disabled={!hasTrains}
                  onClick={() => setMode("train")}
                >
                  🚆 Train
                </SegBtn>
                <SegBtn active={mode === "none"} onClick={() => setMode("none")}>
                  Skip
                </SegBtn>
              </div>
            }
          >
            {mode === "flight" && (
              <CandidateList
                items={flights}
                selected={flightIdx}
                onSelect={setFlightIdx}
                currency={currency}
              />
            )}
            {mode === "train" && (
              <CandidateList
                items={trains}
                selected={trainIdx}
                onSelect={setTrainIdx}
                currency={currency}
              />
            )}
            {mode === "none" && (
              <p className="rounded-xl border border-dashed border-white/80 bg-white/40 px-4 py-3 text-xs text-slate-500">
                Transport excluded from the estimate.
              </p>
            )}
          </Section>

          <Section
            title="Hotel"
            subtitle={nights > 0 ? `Priced per night × ${nights} night${nights === 1 ? "" : "s"}.` : "One-way trip — hotel optional."}
            right={
              <Toggle
                label="Include"
                checked={hotelOn}
                onChange={setHotelOn}
                disabled={hotels.length === 0}
              />
            }
          >
            {hotelOn && hotels.length > 0 ? (
              <CandidateList
                items={hotels}
                selected={hotelIdx}
                onSelect={setHotelIdx}
                currency={currency}
                perSuffix={nights > 0 ? " / night" : ""}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/80 bg-white/40 px-4 py-3 text-xs text-slate-500">
                {hotels.length === 0
                  ? "No hotel options were returned by the planner."
                  : "Hotel excluded from the estimate."}
              </p>
            )}
          </Section>

          <Section
            title="Cab"
            subtitle="Airport transfer or local rides."
            right={
              <Toggle
                label="Include"
                checked={cabOn}
                onChange={setCabOn}
                disabled={cabs.length === 0}
              />
            }
          >
            {cabOn && cabs.length > 0 ? (
              <CandidateList
                items={cabs}
                selected={cabIdx}
                onSelect={setCabIdx}
                currency={currency}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/80 bg-white/40 px-4 py-3 text-xs text-slate-500">
                {cabs.length === 0
                  ? "No cab options were returned by the planner."
                  : "Cab excluded from the estimate."}
              </p>
            )}
          </Section>
        </div>

        {/* Footer / running total */}
        <footer
          className="relative border-t border-white/70 px-6 py-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(238,242,255,0.6) 100%)",
          }}
        >
          <ul className="mb-3 space-y-1.5 text-sm">
            {lines.length === 0 && (
              <li className="text-xs text-slate-500">
                Nothing selected yet — pick a transport mode or toggle hotel/cab.
              </li>
            )}
            {lines.map((l) => (
              <li
                key={l.key}
                className="flex items-start justify-between gap-3 text-slate-700"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{l.label}</span>
                  {l.note && (
                    <span className="ml-2 text-[11px] text-slate-400">{l.note}</span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums">
                  {priceLabel(l.price, currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Estimated total
              </p>
              <p className="text-2xl font-semibold tracking-tight text-ink">
                {total.sum != null ? formatMoney(total.sum, currency) : "—"}
              </p>
              {total.anyMissing && total.lineCount > 0 && (
                <p className="mt-0.5 text-[11px] text-amber-600">
                  Some items had no listed price; total covers only priced items.
                </p>
              )}
            </div>
            <a
              href={`/trips/${tripId}`}
              className="btn-primary text-xs"
            >
              Open trip details
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function SegBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 font-medium transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : disabled
            ? "text-slate-300"
            : "text-slate-600 hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 text-xs ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <span className="text-slate-600">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full border transition ${
          checked ? "bg-indigo-500 border-indigo-500" : "bg-white/80 border-slate-300"
        } ${disabled ? "cursor-not-allowed" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function CandidateList({
  items,
  selected,
  onSelect,
  currency,
  perSuffix,
}: {
  items: MinimalCandidate[];
  selected: number;
  onSelect: (i: number) => void;
  currency: string;
  perSuffix?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/80 bg-white/40 px-4 py-3 text-xs text-slate-500">
        No options returned by the planner.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const active = i === selected;
        return (
          <li key={`${item.url}-${i}`}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active
                  ? "border-indigo-300 bg-indigo-50/70 ring-1 ring-indigo-200"
                  : "border-white/70 bg-white/60 hover:bg-white"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {item.title}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {item.provider}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums">
                {priceLabel(item.estimatedPrice, item.currency ?? currency, perSuffix)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
