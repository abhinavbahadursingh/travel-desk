"use client";
import { useEffect } from "react";

// Monkey-patches window.fetch once so every state-changing request
// (POST/PUT/PATCH/DELETE) automatically carries the X-CSRF-Token header, read
// from the tc_csrf cookie. No existing client component had to change.

const PATCHED = Symbol.for("travel-agent.csrf.patched");

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)tc_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function CsrfFetchBridge() {
  useEffect(() => {
    const w = window as unknown as Record<PropertyKey, unknown>;
    if (w[PATCHED]) return;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const nextInit: RequestInit = { ...(init ?? {}) };
      const method = (nextInit.method ?? "GET").toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const token = readCsrfCookie();
        if (token) {
          const headers = new Headers(nextInit.headers ?? {});
          if (!headers.has("x-csrf-token")) headers.set("x-csrf-token", token);
          nextInit.headers = headers;
        }
      }
      return original(input, nextInit);
    };
    w[PATCHED] = true;
  }, []);
  return null;
}
