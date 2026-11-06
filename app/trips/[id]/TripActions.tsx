"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  trip: { id: string; status: string; hasItinerary: boolean };
  isOwner: boolean;
  isAdmin: boolean;
  hasPendingCancellation: boolean;
  categories?: Array<{ kind: string; markedNotRequired: boolean }>;
};

const MARKABLE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "booking_links_generated",
  "booking_pending_confirmation",
];

export function TripActions({ trip, isOwner, isAdmin, hasPendingCancellation, categories }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(path: string, label: string, body?: unknown) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        if (j?.status === "unavailable") {
          throw new Error(
            `Search unavailable (${j.reason}). No itinerary generated — try again.`,
          );
        }
        const message =
          typeof j?.error === "string"
            ? j.error
            : j?.error
              ? JSON.stringify(j.error)
              : `${label} failed`;
        throw new Error(message);
      }
      if (j?.autoApproved) setMsg("Auto-approved (within policy).");
      else if (j?.idempotent) setMsg("Already submitted — showing the current approval.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const isDraft = trip.status === "draft";
  const canMarkNotRequired =
    (isOwner || isAdmin) && (categories?.length ?? 0) > 0 && MARKABLE_STATUSES.includes(trip.status);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold tracking-tight">Actions</h2>
        <span className="glass-pill">Next step</span>
      </div>

      {isOwner && isDraft && (
        <button
          onClick={() => act(`/api/trips/${trip.id}/plan`, "plan")}
          disabled={!!busy}
          className="btn-glass w-full"
        >
          {busy === "plan" ? (
            <>
              <span className="spinner spinner-dark" />
              Planning…
            </>
          ) : trip.hasItinerary ? (
            "Re-plan with AI"
          ) : (
            "Plan with AI"
          )}
        </button>
      )}

      {isOwner && isDraft && trip.hasItinerary && (
        <button
          onClick={() => act(`/api/trips/${trip.id}/submit`, "submit")}
          disabled={!!busy}
          className="btn-primary w-full"
        >
          {busy === "submit" ? "Submitting…" : "Submit for approval"}
        </button>
      )}

      {trip.status === "approved" && (isOwner || isAdmin) && (
        <button
          onClick={() => act(`/api/trips/${trip.id}/book`, "book")}
          disabled={!!busy}
          className="btn-primary w-full"
        >
          {busy === "book" ? "Generating…" : "Get booking links"}
        </button>
      )}

      {canMarkNotRequired && categories && categories.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-white/70 bg-white/55 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Booking requirements
          </p>
          {categories
            .filter((c) => !c.markedNotRequired)
            .map((c) => (
              <button
                key={c.kind}
                onClick={() => act(`/api/trips/${trip.id}/requirements`, `mark-${c.kind}`, { kind: c.kind })}
                disabled={!!busy}
                className="btn-glass w-full text-xs"
              >
                {busy === `mark-${c.kind}` ? "Saving…" : `Mark ${c.kind} not required`}
              </button>
            ))}
        </div>
      )}

      {trip.status === "draft" && !isOwner && (
        <p className="rounded-2xl border border-white/70 bg-white/55 px-3 py-2.5 text-sm text-slate-600">
          This draft belongs to {isAdmin ? "the requester" : "another employee"}. Only the
          requester can edit or submit it.
        </p>
      )}
      {trip.status === "pending_approval" && (
        <p className="rounded-2xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-800">
          Waiting for an approval decision. Comments and history are in the approval trail.
        </p>
      )}
      {trip.status === "rejected" && (
        <p className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-3 py-2.5 text-sm text-rose-700">
          This request was rejected. The reason is recorded in the approval trail.
        </p>
      )}
      {trip.status === "booking_links_generated" && (
        <p className="rounded-2xl border border-sky-200/60 bg-sky-50/70 px-3 py-2.5 text-sm text-sky-800">
          Booking links generated. Book on the provider&apos;s site; a travel admin records the
          real confirmation.
        </p>
      )}
      {trip.status === "booking_pending_confirmation" && (
        <p className="rounded-2xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-800">
          Some legs are confirmed. A travel admin is recording the remaining provider references.
        </p>
      )}
      {trip.status === "booked" && (
        <p className="rounded-2xl border border-emerald-200/60 bg-emerald-50/70 px-3 py-2.5 text-sm text-emerald-800">
          All legs confirmed. See references below.
        </p>
      )}
      {trip.status === "cancellation_requested" && (
        <p className="rounded-2xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-800">
          Cancellation requested. Nothing is cancelled until travel operations verify it with the
          provider.
        </p>
      )}
      {trip.status === "cancelled" && (
        <p className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-3 py-2.5 text-sm text-rose-700">
          Cancellation verified. Booking rows now carry the provider cancellation reference.
        </p>
      )}
      {hasPendingCancellation && trip.status !== "cancellation_requested" && (
        <p className="rounded-2xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-800">
          A cancellation request is pending review.
        </p>
      )}
      {msg && (
        <p className="rounded-2xl border border-white/70 bg-white/55 px-3 py-2.5 text-sm text-slate-600">
          {msg}
        </p>
      )}
    </div>
  );
}
