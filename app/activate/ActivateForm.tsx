"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ActivateForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || !password) return;
    if (password !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim(), password }),
      });
      const raw = await res.text();
      let payload: { user?: unknown; error?: string | Record<string, unknown> } | null =
        null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const detail =
        (typeof payload?.error === "string" && payload.error) ||
        (payload?.error && JSON.stringify(payload.error)) ||
        `HTTP ${res.status}`;
      setErr(String(detail));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass space-y-3 p-6">
      <label className="block text-sm">
        <span className="text-slate-500">Activation token</span>
        <input
          type="text"
          required
          className="input mt-1 font-mono text-xs"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input mt-1"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      {err && (
        <p className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !token.trim() || !password || !confirmPassword}
        className="btn-primary w-full"
      >
        {busy ? "Activating…" : "Activate and sign in"}
      </button>
    </form>
  );
}
