"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ReassignOption = { id: string; name: string; role: string };

export function ApprovalCard({
  approvalId,
  decision,
  canDecide,
  canReassign,
  approveOptions,
  currentApproverId,
  requesterName,
  requesterIsSelf,
}: {
  approvalId: string;
  decision: string;
  canDecide: boolean;
  canReassign: boolean;
  approveOptions: ReassignOption[];
  currentApproverId: string;
  requesterName: string;
  requesterIsSelf: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  async function post(path: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof json?.error === "string"
            ? json.error
            : json?.error
              ? JSON.stringify(json.error)
              : "Request failed";
        throw new Error(message);
      }
      setNotice("Saved.");
      setComment("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const isPending = decision === "pending";

  return (
    <div className="space-y-3">
      {canDecide && isPending && (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comment for the requester. Rejections need a reason of at least 5 characters; change requests need a description."
            className="textarea min-h-[84px]"
            maxLength={2000}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                post(`/api/approvals/${approvalId}`, { decision: "approved", comment: comment || undefined }, "approve")
              }
              className="btn-primary text-xs"
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                post(
                  `/api/approvals/${approvalId}`,
                  { decision: "changes_requested", comment },
                  "changes",
                )
              }
              className="btn-glass text-xs"
            >
              {busy === "changes" ? "Saving…" : "Request changes"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                post(
                  `/api/approvals/${approvalId}`,
                  { decision: "rejected", rejectionReason: comment },
                  "reject",
                )
              }
              className="btn-danger text-xs"
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      )}

      {!requesterIsSelf && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a clarification comment…"
            className="input min-w-[200px] flex-1 text-xs"
            maxLength={2000}
          />
          <button
            type="button"
            disabled={busy !== null || comment.trim().length === 0}
            onClick={() =>
              post(`/api/approvals/${approvalId}/comments`, { comment }, "comment")
            }
            className="btn-glass text-xs"
          >
            {busy === "comment" ? "Sending…" : "Comment"}
          </button>
        </div>
      )}

      {canReassign && isPending && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/70 bg-white/50 px-3 py-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Reassign
          </label>
          <select
            value={reassignTo}
            onChange={(e) => setReassignTo(e.target.value)}
            className="select flex-1 text-xs"
          >
            <option value="">Select an active approver…</option>
            {approveOptions
              .filter((option) => option.id !== currentApproverId)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.role.replaceAll("_", " ")})
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy !== null || !reassignTo}
            onClick={() =>
              post(`/api/approvals/${approvalId}/reassign`, { approverId: reassignTo }, "reassign")
            }
            className="btn-glass text-xs"
          >
            {busy === "reassign" ? "Reassigning…" : "Reassign"}
          </button>
        </div>
      )}

      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
      {error && !canDecide && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
