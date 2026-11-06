"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConfirmBookingForm({
  tripId,
  bookingId,
}: {
  tripId: string;
  bookingId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reference.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/confirm-booking`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId, reference: reference.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof j?.error === "string"
            ? j.error
            : j?.error
              ? JSON.stringify(j.error)
              : "confirm failed";
        throw new Error(message);
      }
      setOpen(false);
      setReference("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-glass text-xs">
        Record provider reference
      </button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        className="input !w-48 !py-1.5 text-xs"
        placeholder="Real provider reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        disabled={busy}
      />
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="btn-glass text-xs"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="btn-primary text-xs"
          disabled={busy || !reference.trim()}
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
      {err && <div className="max-w-48 text-[10px] text-rose-600">{err}</div>}
    </div>
  );
}
