"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
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
        <span className="text-slate-500">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          className="input mt-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-500">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={busy || !email.trim() || !password}
        className="btn-primary w-full"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="flex justify-between text-[11px] text-slate-500">
        <Link href="/activate" className="hover:text-indigo-600">
          Activate account
        </Link>
      </div>
    </form>
  );
}
