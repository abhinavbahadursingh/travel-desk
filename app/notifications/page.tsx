import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NotificationActions } from "./NotificationActions";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  const [notifications, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="page-title mt-2">Notifications</h1>
            <p className="page-subtitle mt-2">
              Approval, booking and cancellation events addressed to you.
            </p>
          </div>
          <NotificationActions
            unread={unread}
            ids={notifications.filter((n) => !n.readAt).map((n) => n.id)}
          />
        </div>
      </section>

      <section className="glass overflow-hidden">
        {notifications.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold">No notifications yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Workflow events will appear here as requests move through approval and booking.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/60">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={`px-5 py-4 sm:px-6 ${notification.readAt ? "" : "bg-indigo-50/40"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{notification.title}</p>
                      {!notification.readAt && (
                        <span className="chip-neutral">unread</span>
                      )}
                    </div>
                    {notification.body && (
                      <p className="mt-1 max-w-3xl text-sm text-slate-600">
                        {notification.body}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {notification.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
                      {" · "}
                      {notification.type.replaceAll("_", " ")}
                    </p>
                  </div>
                  {notification.link && (
                    <Link href={notification.link} className="btn-glass text-xs">
                      Open
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
