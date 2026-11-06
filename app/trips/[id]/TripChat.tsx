"use client";
import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function TripChat({ tripId }: { tripId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const content = input.trim();
    if (!content) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const raw = await res.text();
      let payload: { reply?: string; error?: unknown } | null = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (res.ok && payload?.reply) {
        setMessages([...next, { role: "assistant", content: payload.reply }]);
      } else {
        const detail =
          (payload?.error && typeof payload.error === "string" && payload.error) ||
          (payload?.error && JSON.stringify(payload.error)) ||
          (raw && raw.slice(0, 200)) ||
          res.statusText ||
          `HTTP ${res.status}`;
        setMessages([
          ...next,
          { role: "assistant", content: `Error: ${detail}` },
        ]);
      }
    } catch (e) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
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
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.2-.6L3 21l1.7-4.6a8.4 8.4 0 0 1-1.2-4.4 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.5 7.9z" />
          </svg>
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">Ask the AI planner</h2>
          <p className="text-[11px] text-slate-500">Refine the plan in conversation</p>
        </div>
      </div>

      <div className="chat-scroll space-y-2.5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-2xl">✦</span>
            <p className="text-xs leading-relaxed text-slate-500">
              Ask things like &ldquo;Can I depart a day later?&rdquo; or &ldquo;Find a cheaper
              hotel near the office.&rdquo;
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}
            >
              {m.content}
            </div>
          ))
        )}
        {busy && (
          <div className="chat-bubble-ai inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 [animation-delay:240ms]" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Ask about this trip…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()} className="btn-primary px-4">
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
