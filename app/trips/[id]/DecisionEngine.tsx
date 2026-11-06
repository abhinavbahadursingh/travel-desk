"use client";
import { useState } from "react";

const QUICK_QUESTIONS = [
  "Should I prefer train or flight?",
  "Which option is cheapest?",
  "Which option saves the most time?",
  "Which option best satisfies company policy?",
];

type Props = { tripId: string };

export function DecisionEngine({ tripId }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    setAnswer(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const raw = await res.text();
      let payload: { answer?: string; error?: unknown } | null = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (res.ok && payload?.answer) {
        setAnswer(payload.answer);
      } else {
        let detail = "";
        if (payload?.error) {
          detail =
            typeof payload.error === "string"
              ? payload.error
              : JSON.stringify(payload.error);
        } else if (raw) {
          detail = raw.slice(0, 240);
        } else {
          detail = res.statusText || `HTTP ${res.status}`;
        }
        setErr(detail);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="chat-icon">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l1.9 4.6L18 9l-4.1 1.4L12 15l-1.9-4.6L6 9l4.1-1.4z" />
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
          </svg>
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">Decision engine</h2>
          <p className="text-[11px] text-slate-500">
            Compares the real retrieved options
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setQuestion(q);
              ask(q);
            }}
            disabled={busy}
            className="rounded-full border border-white/70 bg-white/55 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Ask e.g. 'cheapest option within policy?'"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          disabled={busy}
        />
        <button
          onClick={() => ask(question)}
          disabled={busy || !question.trim()}
          className="btn-primary px-4"
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>

      {answer && (
        <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50/70 p-3 text-sm leading-relaxed text-indigo-900 whitespace-pre-wrap">
          {answer}
        </div>
      )}
      {err && (
        <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 p-3 text-xs text-rose-800">
          {err}
        </div>
      )}
    </div>
  );
}
