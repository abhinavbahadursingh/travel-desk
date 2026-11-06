// Operator-triggered outbox drain. Idempotent and safe to spam — the
// processor serialises itself per Node process. Returns a summary of the
// drain so an operator can confirm what happened.

import { NextResponse } from "next/server";
import { getCurrentUser, canViewAudit } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { processOutbox } from "@/lib/notifications";

export const POST = withApi(async () => {
  const user = await getCurrentUser();
  if (!canViewAudit(user)) {
    throw new ApiError(
      403,
      "Only a super admin can drive the notification outbox.",
    );
  }
  const result = await processOutbox({ limit: 100 });
  return NextResponse.json(result);
});
