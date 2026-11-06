"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CABINS } from "@/lib/policy";

type Policy = {
  id: string;
  currency: string;
  maxFlightEconomy: number;
  maxHotelPerNight: number;
  maxTotalPerTrip: number;
  requireApprovalAbove: number;
  advancePurchaseDays: number;
  allowedCabins: string;
  allowAutoApprovalForNonEmployees: boolean;
  requireBookingReference: boolean;
  cancellationRequiresAdminReview: boolean;
};

export function PolicyForm({ policy, canEdit }: { policy: Policy; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  let cabins: string[] = [];
  try {
    cabins = JSON.parse(policy.allowedCabins) as string[];
  } catch {
    cabins = ["economy", "premium_economy"];
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const body = {
      currency: String(data.get("currency") ?? policy.currency),
      maxFlightEconomy: number("maxFlightEconomy"),
      maxHotelPerNight: number("maxHotelPerNight"),
      maxTotalPerTrip: number("maxTotalPerTrip"),
      requireApprovalAbove: number("requireApprovalAbove"),
      advancePurchaseDays: Math.round(number("advancePurchaseDays")),
      allowedCabins: CABINS.filter((cabin) => data.get(`cabin-${cabin}`) === "on"),
      allowAutoApprovalForNonEmployees:
        data.get("allowAutoApprovalForNonEmployees") === "on",
      requireBookingReference: data.get("requireBookingReference") === "on",
      cancellationRequiresAdminReview:
        data.get("cancellationRequiresAdminReview") === "on",
    };
    try {
      const res = await fetch("/api/admin/policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not update the policy",
        );
      }
      setNotice("Policy updated and audited.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !canEdit || busy;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!canEdit && (
        <p className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
          Read-only. Only a super admin can change company travel policy.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-slate-600">
          Policy currency
          <select name="currency" defaultValue={policy.currency} className="select mt-1" disabled={disabled}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Max flight (economy)
          <input
            name="maxFlightEconomy"
            type="number"
            min={0}
            step="0.01"
            defaultValue={policy.maxFlightEconomy}
            className="input mt-1"
            disabled={disabled}
          />
        </label>
        <label className="text-xs text-slate-600">
          Max hotel per night
          <input
            name="maxHotelPerNight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={policy.maxHotelPerNight}
            className="input mt-1"
            disabled={disabled}
          />
        </label>
        <label className="text-xs text-slate-600">
          Max total per trip
          <input
            name="maxTotalPerTrip"
            type="number"
            min={0}
            step="0.01"
            defaultValue={policy.maxTotalPerTrip}
            className="input mt-1"
            disabled={disabled}
          />
        </label>
        <label className="text-xs text-slate-600">
          Approval required above
          <input
            name="requireApprovalAbove"
            type="number"
            min={0}
            step="0.01"
            defaultValue={policy.requireApprovalAbove}
            className="input mt-1"
            disabled={disabled}
          />
        </label>
        <label className="text-xs text-slate-600">
          Advance purchase days
          <input
            name="advancePurchaseDays"
            type="number"
            min={0}
            max={365}
            defaultValue={policy.advancePurchaseDays}
            className="input mt-1"
            disabled={disabled}
          />
        </label>
      </div>

      <fieldset disabled={disabled}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Allowed cabins
        </legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
          {CABINS.map((cabin) => (
            <label key={cabin} className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`cabin-${cabin}`}
                defaultChecked={cabins.includes(cabin)}
              />
              {cabin.replaceAll("_", " ")}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Booking and approval rules
        </legend>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="allowAutoApprovalForNonEmployees"
            defaultChecked={policy.allowAutoApprovalForNonEmployees}
          />
          Allow managers, travel admins and super admins to auto-approve within policy when the
          estimate is complete. Employees always need a human decision.
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="requireBookingReference"
            defaultChecked={policy.requireBookingReference}
          />
          Booking confirmations require a real provider reference.
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="cancellationRequiresAdminReview"
            defaultChecked={policy.cancellationRequiresAdminReview}
          />
          Cancellation requests require travel operations review before a trip is cancelled.
        </label>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary text-xs">
            {busy ? "Saving…" : "Save policy"}
          </button>
          {notice && <span className="text-xs text-emerald-700">{notice}</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      )}
    </form>
  );
}
