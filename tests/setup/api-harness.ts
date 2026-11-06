// Helpers for calling App Router route handlers directly from Vitest.
//
// Route handlers resolve the current user from a session cookie via
// `next/headers`, which is only callable inside a request scope. For tests we
// mock `next/headers` to return a mutable cookie store that callers (callRoute
// or callRouteWithCookies) populate per call. Two modes are supported:
//
//   1. Dev-identity path (`callRoute`): the mocked cookies are empty, which
//      makes `readSessionFromCookies()` fall through so `getCurrentUser()`
//      resolves the user from `DEV_USER_EMAIL` + `ALLOW_DEV_IDENTITY=1`.
//   2. Real-session path (`callRouteWithCookies`): the test creates a real
//      Session row and passes `tc_session=<id>.<rawToken>` so the handler
//      resolves identity (and CSRF) through the production code paths.

import { vi } from "vitest";
import { NextRequest } from "next/server";

type CookieRecord = { name: string; value: string };

// Per-call cookie bag. Each callRoute* helper sets this before invoking the
// handler and clears it in `finally`. The mock below reads from it.
let activeCookies: CookieRecord[] = [];

vi.mock("next/headers", () => {
  const cookies = () =>
    Promise.resolve({
      get: (name: string) => {
        const match = activeCookies.find((c) => c.name === name);
        return match ? { name: match.name, value: match.value } : undefined;
      },
      getAll: () => activeCookies.map((c) => ({ name: c.name, value: c.value })),
      has: (name: string) => activeCookies.some((c) => c.name === name),
      set: () => undefined,
      delete: () => undefined,
    });
  const headers = () =>
    Promise.resolve({
      get: () => null,
      has: () => false,
      forEach: () => undefined,
      entries: () => [].values(),
      keys: () => [].values(),
      values: () => [].values(),
    });
  return { cookies, headers };
});

export type ParamsOf<T> = T extends (req: NextRequest, ctx: infer C) => unknown ? C : never;

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response> | Response;

export async function callRoute<Ctx = unknown>(
  handler: Handler<Ctx>,
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    params?: Record<string, string>;
    userEmail: string;
  },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const previousEmail = process.env.DEV_USER_EMAIL;
  process.env.ALLOW_DEV_IDENTITY = "1";
  process.env.DEV_USER_EMAIL = options.userEmail;
  const previousCookies = activeCookies;
  activeCookies = [];
  try {
    return await invoke(handler, {
      method: options.method,
      url: options.url,
      body: options.body,
      params: options.params,
    });
  } finally {
    activeCookies = previousCookies;
    if (previousEmail === undefined) {
      delete process.env.DEV_USER_EMAIL;
    } else {
      process.env.DEV_USER_EMAIL = previousEmail;
    }
  }
}

// Second helper — used by the CSRF suite. Does NOT touch DEV_USER_EMAIL, so
// identity must come from the session cookie the caller supplies. The same
// cookies are also attached to the NextRequest so `readSessionFromRequest`
// (used inside withApi) sees them too.
export async function callRouteWithCookies<Ctx = unknown>(
  handler: Handler<Ctx>,
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    params?: Record<string, string>;
    cookies: CookieRecord[];
    extraHeaders?: Record<string, string>;
  },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const previousCookies = activeCookies;
  activeCookies = options.cookies;
  try {
    return await invoke(handler, {
      method: options.method,
      url: options.url,
      body: options.body,
      params: options.params,
      cookies: options.cookies,
      extraHeaders: options.extraHeaders,
    });
  } finally {
    activeCookies = previousCookies;
  }
}

async function invoke<Ctx>(
  handler: Handler<Ctx>,
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    params?: Record<string, string>;
    cookies?: CookieRecord[];
    extraHeaders?: Record<string, string>;
  },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const method = options.method ?? "GET";
  const url = options.url ?? "http://localhost/test";
  const headers: Record<string, string> = { ...(options.extraHeaders ?? {}) };
  if (options.cookies && options.cookies.length > 0) {
    headers.cookie = options.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const req = new NextRequest(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const ctx = {
    params: Promise.resolve(options.params ?? {}),
  } as unknown as Ctx;
  const res = await handler(req, ctx);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
