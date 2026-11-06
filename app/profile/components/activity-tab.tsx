"use client";

import { SectionCard, EmptyState, StatTile } from "./cards";
import {
  ActivityIcon,
  PlaneIcon,
  ShieldIcon,
  ClockIcon,
  MailIcon,
} from "./icons";

type ActivityTabProps = {
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
};

function formatDateTime(date: Date | string) {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityTab({ activity }: ActivityTabProps) {
  return (
    <div className="space-y-6">
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
          hint="Drafts awaiting submission"
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
          label="Submitted"
          value={activity.submittedRequests}
          hint="Awaiting approval"
          tone="indigo"
        />
        <StatTile
          label="Rejected"
          value={activity.rejectedRequests}
          hint="Declined"
          tone="rose"
        />
        <StatTile
          label="Cancelled"
          value={activity.cancelledTrips}
          hint="Cancelled trips"
          tone="rose"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mt-6">
        <StatTile
          label="Approvals decided"
          value={activity.totalDecidedApprovals}
          hint="Requests you actioned"
          tone="purple"
        />
        <StatTile
          label="Unread notifications"
          value={activity.unreadNotifications}
          hint={activity.unreadNotifications > 0 ? "New items" : "All caught up"}
          tone={activity.unreadNotifications > 0 ? "indigo" : "emerald"}
        />
      </div>

      <SectionCard
        header={{
          title: "Recent activity",
          subtitle: "Your latest actions across the travel platform.",
          icon: <ActivityIcon />,
        }}
      >
        {activity.recentActivity.length === 0 ? (
          <EmptyState
            icon={<ClockIcon />}
            title="No recent activity"
            subtitle="Your activity will appear here as you submit requests, approve trips and manage bookings."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-glass">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Details</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {activity.recentActivity.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium text-ink">
                      {item.action.split(".").pop()?.replaceAll("_", " ") ?? item.action}
                    </td>
                    <td className="text-sm text-slate-500">
                      {item.summary} ({item.entityType})
                    </td>
                    <td className="text-sm text-slate-500">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
