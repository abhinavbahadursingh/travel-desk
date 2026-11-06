"use client";

import { EditIcon, UserIcon, BuildingIcon, MailIcon, TagIcon } from "./icons";
import { Avatar, RoleBadge, StatusBadge } from "./badges";
import { SignOutButton } from "../SignOutButton";

type ProfileHeaderProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    department?: string | null;
    employeeId?: string | null;
    jobTitle?: string | null;
    profilePicture?: string | null;
    createdAt?: string | Date | null;
  };
  onEditProfile: () => void;
};

export function ProfileHeader({
  user,
  onEditProfile,
}: ProfileHeaderProps) {
  return (
    <section className="glass relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-50 blur-[80px]"
        style={{
          background:
            "radial-gradient(circle at 70% 30%, rgba(99,102,241,0.35), rgba(139,92,246,0.25) 55%, transparent 75%)",
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Avatar src={user.profilePicture ?? undefined} name={user.name} size="lg" />
            <div className="flex flex-col gap-1 sm:flex sm:flex-col sm:items-start gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {user.name}
                </h1>
                <RoleBadge role={user.role} />
              </div>
              {user.jobTitle && (
                <p className="text-sm text-slate-500 sm:text-base">
                  {user.jobTitle}
                </p>
              )}
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <BuildingIcon className="h-4 w-4" />
                  {user.department ?? "Not assigned"}
                </span>
                {user.employeeId && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <TagIcon className="h-4 w-4" />
                    Emp ID: {user.employeeId}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end sm:items-start gap-4">
            <StatusBadge active={user.active} />
            <SignOutButton />
            <button
              onClick={onEditProfile}
              className="btn-primary min-w-[10rem]"
            >
              <EditIcon className="mr-2" /> Edit profile
            </button>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 border-t border-white/60 pt-6 sm:pt-8">
          <div className="flex items-center gap-3 text-sm">
            <MailIcon className="h-4 w-4 text-slate-400" />
            <span className="font-medium text-ink">{user.email}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <UserIcon className="h-4 w-4 text-slate-400" />
            <span className="font-medium text-ink">
              Member since{" "}
              <time
                dateTime={
                  user.createdAt
                    ? user.createdAt instanceof Date
                      ? user.createdAt.toISOString()
                      : user.createdAt
                    : ""
                }
              >
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString(
                  undefined,
                  { month: "short", year: "numeric" },
                ) : "—"}
              </time>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
