"use client";

import { useState } from "react";
import { SectionCard, EmptyState, StatTile } from "./cards";
import {
  ShieldIcon,
  LockIcon,
  MailIcon,
  TagIcon,
  ClockIcon,
  UsersIcon,
  EditIcon,
  SaveIcon,
  CancelIcon,
} from "./icons";

type AccountSecurityTabProps = {
  user: {
    email: string;
    role: string;
    active: boolean;
    createdAt: Date | string;
    lastLoginAt?: Date | string | null;
    lastPasswordChange?: Date | string | null;
    slackUserId?: string | null;
    mustSetPassword?: boolean;
    sessions?: Array<{
      id: string;
      ipAddress?: string | null;
      userAgent?: string | null;
      createdAt: Date | string;
      expiresAt: Date | string;
      revokedAt?: Date | string | null;
    }>;
  };
  onChangePassword: (data: { currentPassword: string; newPassword: string }) => Promise<void>;
  busy: boolean;
};

function formatDate(date: Date | string | undefined | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: Date | string | undefined | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AccountSecurityTab({
  user,
  onChangePassword,
  busy,
}: AccountSecurityTabProps) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const activeSessions = (user.sessions ?? []).filter((s) => !s.revokedAt);

  return (
    <div className="space-y-6">
      {/* Account details */}
      <SectionCard
        header={{
          title: "Account details",
          subtitle: "Your core account identity and security status.",
          icon: <ShieldIcon />,
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Corporate email
            </p>
            <p className="text-sm font-semibold text-ink break-all">{user.email}</p>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Account role
            </p>
            <p className="text-sm font-semibold text-ink capitalize">
              {user.role.replaceAll("_", " ")}
            </p>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Account status
            </p>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                user.active
                  ? "bg-emerald-50/60 border-emerald-200/60 text-emerald-700"
                  : "bg-rose-50/60 border-rose-200/60 text-rose-700"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {user.active ? "Active" : "Deactivated"}
            </span>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Member since
            </p>
            <p className="text-sm font-semibold text-ink">{formatDate(user.createdAt)}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mt-6">
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Last login
            </p>
            <p className="text-sm font-semibold text-ink">{formatDateTime(user.lastLoginAt)}</p>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Last password change
            </p>
            <p className="text-sm font-semibold text-ink">{formatDateTime(user.lastPasswordChange)}</p>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Slack connection
            </p>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50/60 text-indigo-600 text-[10px]">
                {user.slackUserId ? "✓" : "—"}
              </span>
              <span className="text-sm font-medium text-ink">
                {user.slackUserId ?? "Not connected"}
              </span>
            </div>
          </div>
          <div className="glass p-4 rounded-2xl">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Password required
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                user.mustSetPassword
                  ? "bg-amber-50/60 border-amber-200/60 text-amber-700"
                  : "bg-emerald-50/60 border-emerald-200/60 text-emerald-700"
              }`}
            >
              {user.mustSetPassword ? "Pending activation" : "Set"}
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Change password */}
      <SectionCard
        header={{
          title: "Change password",
          subtitle: "Update your account password. All active sessions will be rotated.",
          icon: <LockIcon />,
        }}
      >
        {!showPasswordForm ? (
          <div className="glass p-5 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                Change your password to keep your account secure.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                New password must be at least 8 characters.
              </p>
            </div>
            <button
              onClick={() => {
                setShowPasswordForm(true);
                setPasswordError(null);
                setCurrentPassword("");
                setNewPassword("");
              }}
              disabled={busy}
              className="btn-primary min-w-[10rem] flex items-center gap-2"
            >
              <EditIcon className="h-4 w-4" /> Change password
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPasswordError(null);
              onChangePassword({ currentPassword, newPassword }).then(
                () => {
                  setPasswordSaved(true);
                  setShowPasswordForm(false);
                  setTimeout(() => setPasswordSaved(false), 3000);
                },
                (e: any) => {
                  setPasswordError(e?.message || "Could not change password");
                },
              );
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label className="label">Current password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input"
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <label className="label">New password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input"
                disabled={busy}
              />
              <p className="text-[10px] text-slate-500">
                Must be at least 8 characters.
              </p>
            </div>

            <div className="flex items-center gap-3 border-t border-white/60 pt-4">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary min-w-[9rem]"
              >
                {busy ? <SaveIcon className="mr-2 h-4 w-4 animate-spin" /> : <SaveIcon className="mr-2" />}
                {busy ? "Changing…" : "Change password"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordError(null);
                  setCurrentPassword("");
                  setNewPassword("");
                }}
                disabled={busy}
                className="btn-glass"
              >
                Cancel
              </button>
              {passwordSaved && (
                <span className="ml-auto text-xs font-medium text-emerald-600">
                  Password changed. Sessions rotated.
                </span>
              )}
            </div>
            {passwordError && (
              <p className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
                {passwordError}
              </p>
            )}
          </form>
        )}
      </SectionCard>

      {/* Active sessions */}
      <SectionCard
        header={{
          title: "Active sessions",
          subtitle: "Currently signed-in sessions for your account.",
          icon: <UsersIcon />,
        }}
      >
        {activeSessions.length === 0 ? (
          <EmptyState
            icon={<ClockIcon />}
            title="No active sessions"
            subtitle="No sessions are currently active."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-glass">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP address</th>
                  <th>Started</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-ink">
                      {s.userAgent ? s.userAgent.slice(0, 40) : "Unknown device"}
                    </td>
                    <td className="text-sm text-slate-500">
                      {s.ipAddress ?? "—"}
                    </td>
                    <td className="text-sm text-slate-500">{formatDateTime(s.createdAt)}</td>
                    <td className="text-sm text-slate-500">{formatDateTime(s.expiresAt)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-emerald-50/60 border-emerald-200/60 text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80 animate-pulse" />
                        Active
                      </span>
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
