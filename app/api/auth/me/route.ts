import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { readSessionFromCookies } from "@/lib/session";

// GET /api/auth/me — who am I? Returns 401 when not signed in. Never leaks
// password/session internals; the csrfToken is the only extra field clients
// need for state-changing requests.
export const GET = withApi(async () => {
  const session = await readSessionFromCookies();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const user = session.user;
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustSetPassword: user.mustSetPassword,
    },
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
});
