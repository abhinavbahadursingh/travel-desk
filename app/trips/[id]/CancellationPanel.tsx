"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RequestCancellation({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/cancellation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not request cancellation",
        );
      }
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for cancelling (at least 5 characters)"
        className="textarea min-h-[70px]"
        maxLength={1000}
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || reason.trim().length < 5}
        className="btn-danger w-full text-xs"
      >
        {busy ? "Requesting…" : "Request cancellation"}
      </button>
      <p className="text-[11px] text-slate-500">
        Nothing is cancelled automatically. Travel operations verify the cancellation with the
        provider first.
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function ReviewCancellation({ cancellationId }: { cancellationId: string }) {
  const router = useRouter();
  const [action, setAction] = useState<"complete" | "reject">("complete");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cancellations/${cancellationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined, reference: reference || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not review cancellation",
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-white/70 bg-white/50 p-3">
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={`cancellation-${cancellationId}`}
            checked={action === "complete"}
            onChange={() => setAction("complete")}
          />
          Verified cancellation
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={`cancellation-${cancellationId}`}
            checked={action === "reject"}
            onChange={() => setAction("reject")}
          />
          Reject request
        </label>
      </div>
      {action === "complete" ? (
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Real provider cancellation reference (required)"
          className="input text-xs"
          maxLength={200}
        />
      ) : (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for rejecting the cancellation request (required)"
          className="input text-xs"
          maxLength={1000}
        />
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy || (action === "complete" ? reference.trim().length === 0 : note.trim().length === 0)}
        className={action === "complete" ? "btn-danger w-full text-xs" : "btn-glass w-full text-xs"}
      >
        {busy ? "Saving…" : action === "complete" ? "Mark trip cancelled" : "Reject cancellation"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
