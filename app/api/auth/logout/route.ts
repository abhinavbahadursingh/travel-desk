import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import {
  clearAuthCookies,
  readSessionFromRequest,
  revokeSessionById,
} from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

// POST /api/auth/logout
// Revokes the current session row and clears both cookies. Idempotent.
export const POST = withApi(async (req: NextRequest) => {
  const session = await readSessionFromRequest(req);
  if (session) {
    await revokeSessionById(session.id);
    await recordAudit(db, {
      actorId: session.userId,
      action: "auth.logout",
      entityType: "User",
      entityId: session.userId,
      summary: `${session.user.name} signed out`,
    });
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
});
