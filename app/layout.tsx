import "./globals.css";
import type { Metadata } from "next";
import { tryGetCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRole } from "@/lib/roles";
import { assertProductionEnv } from "@/lib/env";
import { Sidebar } from "@/components/Sidebar";
import { CsrfFetchBridge } from "@/components/CsrfFetchBridge";

// Validate the production environment on first render. Safe in dev (no-op).
assertProductionEnv();

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Travel Agent — Corporate travel, simplified",
  description: "Plan, approve and book business travel with an AI-assisted workspace.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await tryGetCurrentUser();

  if (!user) {
    // Unauthenticated: minimal shell so /login and /activate can render. The
    // middleware redirects everything else to /login.
    return (
      <html lang="en">
        <body>
          <div className="ambient" aria-hidden="true">
            <span className="ambient-orb ambient-orb--1" />
            <span className="ambient-orb ambient-orb--2" />
            <span className="ambient-orb ambient-orb--3" />
            <span className="ambient-orb ambient-orb--4" />
          </div>
          <CsrfFetchBridge />
          <main className="app-main auth-main">{children}</main>
        </body>
      </html>
    );
  }

  const [pendingCount, unreadCount] = await Promise.all([
    user.role === "manager" || user.role === "travel_admin" || user.role === "super_admin"
      ? db.approval.count({ where: { approverId: user.id, decision: "pending" } })
      : Promise.resolve(0),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <html lang="en">
      <body>
        <div className="ambient" aria-hidden="true">
          <span className="ambient-orb ambient-orb--1" />
          <span className="ambient-orb ambient-orb--2" />
          <span className="ambient-orb ambient-orb--3" />
          <span className="ambient-orb ambient-orb--4" />
        </div>

        <CsrfFetchBridge />

        <Sidebar
          name={user.name}
          role={isRole(user.role) ? user.role : "employee"}
          pendingCount={pendingCount}
          unreadCount={unreadCount}
        />

        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
