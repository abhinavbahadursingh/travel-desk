"use client";

import { useState } from "react";
import Link from "next/link";
import {
  UserIcon,
  BuildingIcon,
  BriefcaseIcon,
  PlaneIcon,
  ShieldIcon,
  ActivityIcon,
} from "./icons";

type Tab = {
  key: string;
  label: string;
  icon: React.ElementType;
  href?: string;
};

const TABS: Tab[] = [
  { key: "overview", label: "Overview", icon: UserIcon },
  { key: "personal", label: "Personal Information", icon: BuildingIcon },
  { key: "professional", label: "Professional Information", icon: BriefcaseIcon },
  { key: "travel", label: "Travel Preferences", icon: PlaneIcon },
  { key: "organization", label: "Organization", icon: UserIcon },
  { key: "security", label: "Account & Security", icon: ShieldIcon },
  { key: "activity", label: "Activity", icon: ActivityIcon },
];

type ProfileTabsProps = {
  activeTab: string;
  onChange: (key: string) => void;
  className?: string;
};

export function ProfileTabs({
  activeTab,
  onChange,
  className,
}: ProfileTabsProps) {
  return (
    <div
      className={`flex gap-1 rounded-xl border border-white/70 bg-white/40 p-1 backdrop-blur-md ${className ?? ""}`}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-white/80 text-ink shadow-sm"
                : "text-slate-500 hover:text-slate-700 hover:bg-white/30"
            }`}
            aria-pressed={active}
          >
            <Icon />
            <span className="whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
