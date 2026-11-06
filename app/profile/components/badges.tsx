"use client";

import { useState } from "react";

type RoleBadgeProps = {
  role: string;
  className?: string;
};

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const variants: Record<string, string> = {
    employee: "bg-indigo-50/60 border-indigo-200/60 text-indigo-700",
    manager: "bg-amber-50/60 border-amber-200/60 text-amber-700",
    travel_admin: "bg-purple-50/60 border-purple-200/60 text-purple-700",
    super_admin: "bg-rose-50/60 border-rose-200/60 text-rose-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${variants[role] ?? "bg-slate-50/60 border-slate-200/60 text-slate-600"} ${className ?? ""}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
        aria-hidden="true"
      />
      {role.replaceAll("_", " ")}
    </span>
  );
}

type StatusBadgeProps = {
  active: boolean;
  className?: string;
};

export function StatusBadge({ active, className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        active
          ? "bg-emerald-50/60 border-emerald-200/60 text-emerald-700"
          : "bg-rose-50/60 border-rose-200/60 text-rose-700"
      } ${className ?? ""}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-80 animate-pulse"
        aria-hidden="true"
      />
      {active ? "Active" : "Deactivated"}
    </span>
  );
}

type CompletionRingProps = {
  percentage: number;
  size?: number;
  label?: string;
};

export function CompletionRing({
  percentage,
  size = 88,
  label = "Profile complete",
}: CompletionRingProps) {
  const stroke = size * 0.78;
  const radius = stroke / (2 * Math.PI);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color =
    percentage >= 80
      ? "#10b981"
      : percentage >= 50
        ? "#f59e0b"
        : "#6366f1";

  return (
    <div className="relative flex flex-col items-center">
      <svg
        className="transform -rotate-90"
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-label={`${label}: ${percentage}%`}
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="rgba(99, 102, 241, 0.15)"
          strokeWidth={stroke}
          fill="none"
          className="transition stroke-duration-500"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-semibold text-ink">{percentage}%</span>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
    </div>
  );
}

type AvatarProps = {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
};

export function Avatar({ src, name, size = "md" }: AvatarProps) {
  const dims = { sm: 40, md: 64, lg: 112 }[size];
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex-shrink-0" aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          width={dims}
          height={dims}
          className="rounded-full object-cover border border-white/80 shadow-sm"
          style={{ width: dims, height: dims }}
        />
      ) : (
        <div
          className={`flex items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white font-bold shadow-md ${dims === 112 ? "text-2xl" : dims === 64 ? "text-xl" : "text-lg"}`}
          style={{
            width: dims,
            height: dims,
            fontSize: dims === 112 ? 32 : dims === 64 ? 24 : 20,
          }}
        >
          {initials || "?"}
        </div>
      )}
    </div>
  );
}
