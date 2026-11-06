"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs } from "./tabs";
import {
  OverviewTab,
  PersonalInfoTab,
  ProfessionalInfoTab,
  TravelPreferencesTab,
  OrganizationTab,
  AccountSecurityTab,
  ActivityTab,
} from "./index";

type TabKey =
  | "overview"
  | "personal"
  | "professional"
  | "travel"
  | "organization"
  | "security"
  | "activity";

type ProfilePageClientProps = {
  initialTab: TabKey;
  user: any;
  teamMembers: any[];
  completion: number;
  canManageUsers: boolean;
  isManager: boolean;
};

const API = "/api/profile";

export function ProfilePageClient({
  initialTab,
  user,
  teamMembers,
  completion,
  canManageUsers,
  isManager,
}: ProfilePageClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [busy, setBusy] = useState(false);
  const [savedSection, setSavedSection] = useState<TabKey | null>(null);
  const router = useRouter();

  async function saveSection(tab: TabKey, data: Record<string, unknown>) {
    setBusy(true);
    try {
      let url: string;
      let method: string;
      let body: any = data;

      if (tab === "travel") {
        url = `${API}/travel-preferences`;
        method = "PATCH";
      } else if (tab === "security") {
        url = `${API}/password`;
        method = "POST";
      } else {
        url = API;
        method = "PATCH";
      }

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not save changes",
        );
      }
      setSavedSection(tab);
      router.refresh();
      setTimeout(() => setSavedSection(null), 3000);
    } catch (e: any) {
      alert(e?.message || "Could not save changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ProfileHeader
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          active: user.active,
          department: user.department,
          employeeId: user.employeeId,
          jobTitle: user.jobTitle,
          profilePicture: user.profilePicture,
          createdAt: user.createdAt,
        }}
        onEditProfile={() => setActiveTab("personal")}
      />

      <ProfileTabs
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
      />

      {activeTab === "overview" && (
        <OverviewTab
          user={{
            name: user.name,
            role: user.role,
            active: user.active,
            email: user.email,
            department: user.department,
            manager: user.manager,
            reports: user.reports ?? [],
          }}
          activity={user.activity ?? {
            totalRequests: 0,
            pendingRequests: 0,
            submittedRequests: 0,
            approvedRequests: 0,
            rejectedRequests: 0,
            bookedTrips: 0,
            cancelledTrips: 0,
            totalDecidedApprovals: 0,
            unreadNotifications: 0,
            recentActivity: [],
          }}
          completion={completion}
          canManageUsers={canManageUsers}
        />
      )}

      {activeTab === "personal" && (
        <PersonalInfoTab
          user={{
            ...user,
            email: user.email,
          }}
          onSave={(data) => saveSection("personal", data)}
          busy={busy}
        />
      )}

      {activeTab === "professional" && (
        <ProfessionalInfoTab
          user={user}
          onSave={(data) => saveSection("professional", data)}
          busy={busy}
          canEdit={true}
        />
      )}

      {activeTab === "travel" && (
        <TravelPreferencesTab
          travelPreference={user.travelPreference ?? null}
          onSave={(data) => saveSection("travel", data)}
          busy={busy}
        />
      )}

      {activeTab === "organization" && (
        <OrganizationTab
          user={{
            id: user.id,
            name: user.name,
            role: user.role,
            manager: user.manager,
            reports: user.reports ?? [],
            department: user.department,
          }}
          teamMembers={teamMembers}
          canManageUsers={canManageUsers}
          isManager={isManager}
        />
      )}

      {activeTab === "security" && (
        <AccountSecurityTab
          user={{
            email: user.email,
            role: user.role,
            active: user.active,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
            lastPasswordChange: user.lastPasswordChange,
            slackUserId: user.slackUserId,
            mustSetPassword: user.mustSetPassword,
            sessions: user.sessions ?? [],
          }}
          onChangePassword={(data) => saveSection("security", data)}
          busy={busy}
        />
      )}

      {activeTab === "activity" && (
        <ActivityTab
          activity={user.activity ?? {
            totalRequests: 0,
            pendingRequests: 0,
            submittedRequests: 0,
            approvedRequests: 0,
            rejectedRequests: 0,
            bookedTrips: 0,
            cancelledTrips: 0,
            totalDecidedApprovals: 0,
            unreadNotifications: 0,
            recentActivity: [],
          }}
        />
      )}

      {savedSection && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 glass px-6 py-3 rounded-full border border-white/80 backdrop-blur-md shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
          <span className="text-sm font-medium text-emerald-700 flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-500" /> Changes saved
          </span>
        </div>
      )}
    </div>
  );
}
