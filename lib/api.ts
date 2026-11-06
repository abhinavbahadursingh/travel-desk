import { NextRequest, NextResponse } from "next/server";
import { assertCsrf, readSessionFromRequest } from "./session";

// Duck-type: class identity via instanceof is unreliable across module
// boundaries in Next.js (multiple copies of next/server exist in the bundle).
// If the first arg quacks like a NextRequest, we treat it as one.
function isRequestLike(x: unknown): x is NextRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.method === "string" &&
    typeof r.headers === "object" &&
    r.cookies !== undefined
  );
}

/**
 * Business/API error with an HTTP status. Route handlers throw these and
 * `withApi` converts them into a consistent JSON error envelope.
 *
 * 400 invalid input, 401 missing identity, 403 authorization, 404 missing
 * resource, 409 business/state conflict, 503 external provider unavailable.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(
    status: number,
    message: string,
    options?: { code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * Wrap a route handler so thrown ApiErrors become JSON responses. Also
 * enforces CSRF (double-submit cookie) on state-changing methods whenever the
 * incoming request carries a session cookie — login/activate have no session
 * yet so they skip this automatically.
 */
export function withApi<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      const req = args[0];
      if (isRequestLike(req)) {
        const method = req.method.toUpperCase();
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
          const session = await readSessionFromRequest(req);
          if (session && !assertCsrf(req, session)) {
            throw new ApiError(
              403,
              "CSRF token missing or invalid. Refresh and try again.",
              { code: "CSRF" },
            );
          }
        }
      }
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}
