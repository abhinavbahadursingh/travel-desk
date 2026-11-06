"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NotificationActions({
  unread,
  ids,
}: {
  unread: number;
  ids: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mark(body: { all?: boolean; ids?: string[] }, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.toString() ?? "Could not update notifications");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unread > 0 && (
        <button
          type="button"
          onClick={() => mark({ all: true }, "all")}
          disabled={busy !== null}
          className="btn-glass text-xs"
        >
          {busy === "all" ? "Marking…" : `Mark all ${unread} read`}
        </button>
      )}
      {unread > 0 && ids.length > 0 && (
        <button
          type="button"
          onClick={() => mark({ ids }, "page")}
          disabled={busy !== null}
          className="btn-ghost text-xs"
        >
          {busy === "page" ? "Marking…" : "Mark this page read"}
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
