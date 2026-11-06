"use client";

import { SectionCard, EmptyState } from "./cards";
import {
  UsersIcon,
  ChevronRightIcon,
  MapPinIcon,
  TagIcon,
  ShieldIcon,
} from "./icons";

type OrganizationTabProps = {
  user: {
    id: string;
    name: string;
    role: string;
    manager?: { id: string; name: string; email: string; role: string } | null;
    reports: Array<{ id: string; name: string; email: string; role: string; active: boolean }>;
    department?: string | null;
  };
  teamMembers?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    department?: string | null;
  }>;
  canManageUsers: boolean;
  isManager: boolean;
};

export function OrganizationTab({
  user,
  teamMembers,
  canManageUsers,
  isManager,
}: OrganizationTabProps) {
  return (
    <div className="space-y-6">
      {/* Reporting manager */}
      <SectionCard
        header={{
          title: "Reporting manager",
          subtitle: "The person who approves your travel requests.",
          icon: <UsersIcon />,
        }}
      >
        {!user.manager ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No reporting manager assigned"
            subtitle="Ask a super admin to assign a reporting manager."
          />
        ) : (
          <div className="glass p-5 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50/60 text-indigo-600 text-xs font-semibold">
                {user.manager.name.split(" ").map((n) => n[0]).join("").toUpperCase() || "?"}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{user.manager.name}</p>
                <p className="text-[11px] text-slate-500">{user.manager.role}</p>
                <p className="text-[11px] text-slate-500">{user.manager.email}</p>
              </div>
            </div>
            <span className="text-xs text-slate-400">
              {user.manager.role.replaceAll("_", " ")}
            </span>
          </div>
        )}
      </SectionCard>

      {/* Direct reports */}
      <SectionCard
        header={{
          title: "Direct reports",
          subtitle: "Team members who report to you.",
          icon: <UsersIcon />,
        }}
      >
        {!isManager ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Not applicable"
            subtitle="Direct reports are only shown for managers."
          />
        ) : user.reports.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No direct reports"
            subtitle="You are not currently managing any team members."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-glass">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {user.reports.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-ink">{r.name}</td>
                    <td className="text-sm text-slate-500">{r.email}</td>
                    <td className="text-sm text-slate-500">{r.role.replaceAll("_", " ")}</td>
                    <td>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          r.active
                            ? "bg-emerald-50/60 border-emerald-200/60 text-emerald-700"
                            : "bg-rose-50/60 border-rose-200/60 text-rose-700"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Team members (for managers/admins) */}
      {isManager || canManageUsers ? (
        <SectionCard
          header={{
            title: "Team members",
            subtitle: "Employees in your reporting structure.",
            icon: <ShieldIcon />,
          }}
        >
          {!teamMembers || teamMembers.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title="No team members"
              subtitle="No team members found in your reporting structure."
            />
          ) : (
            <div className="table-scroll">
              <table className="table-glass">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((m) => (
                    <tr key={m.id}>
                      <td className="font-medium text-ink">{m.name}</td>
                      <td className="text-sm text-slate-500">{m.email}</td>
                      <td className="text-sm text-slate-500">{m.role.replaceAll("_", " ")}</td>
                      <td className="text-sm text-slate-500">{m.department ?? "—"}</td>
                      <td>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            m.active
                              ? "bg-emerald-50/60 border-emerald-200/60 text-emerald-700"
                              : "bg-rose-50/60 border-rose-200/60 text-rose-700"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                          {m.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* Org hierarchy info */}
      <SectionCard
        header={{
          title: "Organization",
          subtitle: "Your position in the company structure.",
          icon: <MapPinIcon />,
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Department
            </p>
            <p className="text-sm font-semibold text-ink">
              {user.department ?? "Not assigned"}
            </p>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Your role
            </p>
            <p className="text-sm font-semibold text-ink capitalize">
              {user.role.replaceAll("_", " ")}
            </p>
          </div>
        </div>
        <div className="mt-4 glass p-4 rounded-2xl border-l-4 border-indigo-400">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Reporting chain
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-ink">{user.name}</span>
            {user.manager ? (
              <>
                <span className="text-slate-400">&lt;</span>
                <ChevronRightIcon className="h-3 w-3 text-slate-400" />
                <span className="font-medium text-ink">{user.manager.name}</span>
              </>
            ) : (
              <span className="text-slate-400"> → No manager assigned</span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
