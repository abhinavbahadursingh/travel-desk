import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { notificationsPatchSchema } from "@/lib/validators";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);

  const [notifications, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({ notifications, unread });
});

export const PATCH = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const parsed = notificationsPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Invalid notification update", {
      details: parsed.error.flatten(),
    });
  }
  const { ids, all } = parsed.data;
  if (all) {
    await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (ids) {
    await db.notification.updateMany({
      where: { userId: user.id, id: { in: ids } },
      data: { readAt: new Date() },
    });
  }
  const unread = await db.notification.count({
    where: { userId: user.id, readAt: null },
  });
  return NextResponse.json({ ok: true, unread });
});
