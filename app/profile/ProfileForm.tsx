"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  initial: {
    name: string;
    slackUserId: string | null;
  };
};

export function ProfileForm({ initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [slackUserId, setSlackUserId] = useState(initial.slackUserId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slackUserId: slackUserId.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not save profile",
        );
      }
      setName(json.name);
      setSlackUserId(json.slackUserId ?? "");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Display name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={100}
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="slackUserId">
            Slack user ID{" "}
            <span className="font-normal normal-case tracking-normal text-slate-400">
              optional
            </span>
          </label>
          <input
            id="slackUserId"
            name="slackUserId"
            maxLength={100}
            className="input"
            placeholder="U012ABCDEF"
            value={slackUserId}
            onChange={(e) => {
              setSlackUserId(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        The Slack user ID links your account to <code>/travel</code> commands. Leave it
        blank to unlink Slack.
      </p>

      {error && (
        <p className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/60 pt-5">
        <button type="submit" disabled={busy} className="btn-primary min-w-[9rem]">
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-glass"
          onClick={() => {
            setName(initial.name);
            setSlackUserId(initial.slackUserId ?? "");
            setError(null);
            setSaved(false);
          }}
        >
          Reset
        </button>
        {saved && (
          <span className="text-xs font-medium text-emerald-600">Profile updated.</span>
        )}
      </div>
    </form>
  );
}
