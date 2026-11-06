"use client";

import Link from "next/link";
import {
  StatTile,
  EmptyState,
  SectionCard,
} from "./cards";
import {
  PlaneIcon,
  ShieldIcon,
  ActivityIcon,
  ClockIcon,
  MailIcon,
  UserIcon,
} from "./icons";
import { RoleBadge } from "./badges";

type OverviewTabProps = {
  user: {
    name: string;
    role: string;
    active: boolean;
    email: string;
    department?: string | null;
    manager?: { name: string } | null;
    reports: Array<{ id: string; name: string; role: string; active: boolean }>;
  };
  activity: {
    totalRequests: number;
    pendingRequests: number;
    submittedRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    bookedTrips: number;
    cancelledTrips: number;
    totalDecidedApprovals: number;
    unreadNotifications: number;
    recentActivity: Array<{
      id: string;
      action: string;
      entityType: string;
      summary: string;
      createdAt: Date | string;
    }>;
  };
  completion: number;
  canManageUsers: boolean;
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OverviewTab({
  user,
  activity,
  completion,
  canManageUsers,
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <SectionCard
        header={{
          title: "Profile summary",
          subtitle: "Your role, completion status and key account details at a glance.",
          icon: <UserIcon />,
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="glass p-5 rounded-2xl">
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50/60 text-indigo-600"
              >
                <UserIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Role
                </p>
                <p className="text-base font-semibold text-ink">
                  {user.role.replaceAll("_", " ")}
                </p>
                <RoleBadge role={user.role} className="mt-2" />
              </div>
            </div>
          </div>
          <div className="glass p-5 rounded-2xl">
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50/60 text-amber-600"
              >
                <ClockIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Completion
                </p>
                <p className="text-base font-semibold text-ink">{completion}%</p>
                <p className="mt-1 text-xs text-slate-500">
                  {completion >= 80 ? "Complete" : completion >= 50 ? "Almost there" : "Incomplete"}
                </p>
              </div>
            </div>
          </div>
          <div className="glass p-5 rounded-2xl">
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50/60 text-emerald-600"
              >
                <ShieldIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Status
                </p>
                <p className="text-base font-semibold text-ink capitalize">
                  {user.active ? "active" : "deactivated"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="glass p-5 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">
              Department
            </p>
            <p className="text-lg font-semibold text-ink">
              {user.department ?? "Not assigned"}
            </p>
          </div>
          <div className="glass p-5 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">
              Reporting manager
            </p>
            <p className="text-lg font-semibold text-ink">
              {user.manager?.name ?? "Not assigned"}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">
            Direct reports ({user.reports.length})
          </p>
          {user.reports.length === 0 ? (
            <EmptyState
              icon={<UsersPlaceholderIcon />}
              title="No direct reports"
              subtitle="You are not currently managing any team members."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {user.reports.map((r) => (
                <div
                  key={r.id}
                  className="glass p-4 rounded-2xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50/60 text-indigo-600 text-xs font-semibold">
                      {r.name.split(" ").map((n) => n[0]).join("").toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{r.name}</p>
                      <p className="text-[10px] text-slate-500 uppercase">
                        {r.role}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        header={{
          title: "Activity at a glance",
          subtitle: "Your travel requests, approvals and notifications.",
          icon: <ActivityIcon />,
        }}
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <StatTile
            label="Travel requests"
            value={activity.totalRequests}
            hint="Total submitted"
            tone="indigo"
          />
          <StatTile
            label="Pending"
            value={activity.pendingRequests}
            hint="Awaiting action"
            tone="amber"
          />
          <StatTile
            label="Approved"
            value={activity.approvedRequests}
            hint="Signed off"
            tone="emerald"
          />
          <StatTile
            label="Booked trips"
            value={activity.bookedTrips}
            hint="Confirmed"
            tone="emerald"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mt-6">
          <StatTile
            label="Decided approvals"
            value={activity.totalDecidedApprovals}
            hint="Requests you actioned"
            tone="purple"
          />
          <StatTile
            label="Rejected"
            value={activity.rejectedRequests}
            hint="Declined"
            tone="rose"
          />
          <StatTile
            label="Unread notifications"
            value={activity.unreadNotifications}
            hint={activity.unreadNotifications > 0 ? "New items" : "All caught up"}
            tone={activity.unreadNotifications > 0 ? "indigo" : "emerald"}
          />
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink">Recent activity</h3>
            <Link
              href="/admin/audit"
              className="text-[10px] text-indigo-600 font-semibold hover:text-indigo-700 underline"
            >
              View audit log
            </Link>
          </div>
          {activity.recentActivity.length === 0 ? (
            <EmptyState
              icon={<ClockIcon />}
              title="No recent activity"
              subtitle="Your activity will appear here as you take actions."
            />
          ) : (
            <div className="grid gap-3">
              {activity.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="glass p-3 rounded-2xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50/60 text-indigo-600 text-[10px] font-semibold"
                    >
                      {item.action.split(".").pop()?.[0] || "A"}
                    </div>
                    <div className="text-sm">
                      <p className="font-medium text-ink">{item.summary}</p>
                      <p className="text-[10px] text-slate-500">
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function UsersPlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
