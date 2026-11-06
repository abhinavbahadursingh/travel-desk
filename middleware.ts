import { NextRequest, NextResponse } from "next/server";

// Kept in sync with lib/session.ts. Middleware runs in Edge runtime and cannot
// import node:crypto, so we duplicate just the cookie name here.
const SESSION_COOKIE = "tc_session";

// Lightweight middleware gate. Pages require a session (or an explicit
// local-dev identity override) to render; API routes return their own 401 so
// we don't rewrite them here. The actual signature/expiry check happens in
// getCurrentUser(); this is just a quick cookie-presence filter so the login
// page is reachable without crashing the layout.

const PUBLIC_PAGE_PATHS = new Set(["/login", "/activate"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let API, Next internals and static assets through.
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next();
  }

  // Auth pages are public.
  if (PUBLIC_PAGE_PATHS.has(pathname)) return NextResponse.next();

  // Local-dev convenience: skip the gate when the operator opts in explicitly.
  // Hard-disabled in production so a leaked env var cannot bypass auth.
  if (
    process.env.ALLOW_DEV_IDENTITY === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }

  const hasCookie = req.cookies.has(SESSION_COOKIE);
  if (hasCookie) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname + (req.nextUrl.search || ""));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon|robots\\.txt|manifest\\.json).*)"],
};
