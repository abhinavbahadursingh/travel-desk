"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AirportCombobox,
  type AirportComboboxHandle,
  type AirportOption,
} from "@/components/AirportCombobox";

export function NewTripForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originAirport, setOriginAirport] = useState<AirportOption | null>(null);
  const [destAirport, setDestAirport] = useState<AirportOption | null>(null);
  const originRef = useRef<AirportComboboxHandle | null>(null);
  const destRef = useRef<AirportComboboxHandle | null>(null);

  function swap() {
    const a = originRef.current?.getValue() ?? null;
    const b = destRef.current?.getValue() ?? null;
    originRef.current?.setValue(b);
    destRef.current?.setValue(a);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (!originAirport || !destAirport) {
      setBusy(false);
      setError("Please pick a valid origin and destination airport from the suggestions.");
      return;
    }
    if (originAirport.iata === destAirport.iata) {
      setBusy(false);
      setError("Origin and destination must be different airports.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const message =
          typeof json?.error === "string"
            ? json.error
            : json?.error
              ? JSON.stringify(json.error)
              : "create failed";
        throw new Error(message);
      }
      const trip = await res.json();

      // Fire the planner; ignore errors so the user still lands on the detail page.
      await fetch(`/api/trips/${trip.id}/plan`, { method: "POST" }).catch(() => null);

      router.push(`/trips/${trip.id}`);
    } catch (err: any) {
      setError(err.message ?? "something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="step-number">01</span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Trip details</h2>
            <p className="text-xs text-slate-500">What is this trip for?</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="tripType">
            Trip type
          </label>
          <select
            id="tripType"
            name="tripType"
            className="select"
            defaultValue="official"
          >
            <option value="official">Official work</option>
            <option value="personal">Personal work</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Official work trips require approval before they can be booked.
            Personal work trips are auto-approved — no approver is needed.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="tripReason">
            Reason <span className="font-normal normal-case tracking-normal text-slate-400">optional</span>
          </label>
          <input
            id="tripReason"
            name="tripReason"
            placeholder="Why are you taking this trip?"
            className="input"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Optional. Describe the purpose of this trip in your own words.
          </p>
        </div>
      </div>

      <div className="soft-divider" />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="step-number">02</span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Route &amp; dates</h2>
            <p className="text-xs text-slate-500">Where are you going, and when?</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <AirportCombobox
            ref={originRef}
            id="origin"
            fieldPrefix="origin"
            label="Origin"
            placeholder="City, airport name or IATA code"
            required
            onChange={setOriginAirport}
            canSelect={(opt) => !destAirport || opt.iata !== destAirport.iata}
            blockedMessage="Already selected as destination."
          />
          <AirportCombobox
            ref={destRef}
            id="destination"
            fieldPrefix="destination"
            label="Destination"
            placeholder="City, airport name or IATA code"
            required
            onChange={setDestAirport}
            canSelect={(opt) => !originAirport || opt.iata !== originAirport.iata}
            blockedMessage="Already selected as origin."
          />
          <div className="sm:col-span-2 -mt-2">
            <button
              type="button"
              onClick={swap}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              aria-label="Swap origin and destination"
            >
              <span aria-hidden>⇅</span> Swap origin &amp; destination
            </button>
          </div>
          <div>
            <label className="label" htmlFor="departDate">
              Depart
            </label>
            <input id="departDate" name="departDate" required type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="returnDate">
              Return{" "}
              <span className="font-normal normal-case tracking-normal text-slate-400">
                optional
              </span>
            </label>
            <input id="returnDate" name="returnDate" type="date" className="input" />
            <p className="mt-1 text-[11px] text-slate-500">
              Leave blank for a one-way trip.
            </p>
          </div>
        </div>
      </div>

      <div className="soft-divider" />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="step-number">03</span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Preferences</h2>
            <p className="text-xs text-slate-500">Anything the planner should know?</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cabin">
            Cabin
          </label>
          <select id="cabin" name="cabin" className="select" defaultValue="economy">
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium economy</option>
            <option value="business">Business</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Flight class used for air travel.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="trainClass">
            Train class
          </label>
          <select
            id="trainClass"
            name="trainClass"
            className="select"
            defaultValue="economy"
          >
            <option value="economy">Economy / Sleeper</option>
            <option value="premium_economy">Premium / AC</option>
            <option value="business">Business / First class</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Train class used for rail travel.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="notes">
            Notes <span className="font-normal normal-case tracking-normal text-slate-400">optional</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="textarea"
            placeholder="Prefer morning departures, hotel near the office, dietary needs…"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-white/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Planning runs a live web search and may take a few seconds.
        </p>
        <button type="submit" disabled={busy} className="btn-primary sm:min-w-[11rem]">
          {busy ? (
            <>
              <span className="spinner" />
              Drafting…
            </>
          ) : (
            "Draft itinerary"
          )}
        </button>
      </div>
    </form>
  );
}
