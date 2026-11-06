"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/roles";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

type IconName =
  | "home"
  | "trips"
  | "new"
  | "approvals"
  | "manager"
  | "team"
  | "bookings"
  | "history"
  | "notifications"
  | "admin"
  | "allTrips"
  | "cancellations"
  | "employees"
  | "reports"
  | "users"
  | "policy"
  | "audit"
  | "health"
  | "profile";

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, React.ReactNode> = {
    home: <path d="M4 10.5 12 4l8 6.5V20H4zM9.5 20v-6h5v6" />,
    trips: (
      <>
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
        <path d="M8 9.5h8M8 13h5" />
      </>
    ),
    new: <path d="M12 5v14M5 12h14" />,
    approvals: (
      <>
        <path d="M9 12.5l2 2 4.5-5" />
        <path d="M12 3.5l7 3v5.2c0 4.4-2.9 7.6-7 8.8-4.1-1.2-7-4.4-7-8.8V6.5z" />
      </>
    ),
    manager: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M16 8.5l2 2 3.5-4" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M16 6.5a2.5 2.5 0 0 1 0 5M17.5 20c0-2.2-.7-3.9-2-5" />
      </>
    ),
    bookings: (
      <>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
        <path d="M12 7v10" strokeDasharray="2 2" />
      </>
    ),
    history: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 1.8" />
      </>
    ),
    notifications: (
      <>
        <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    admin: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.42.68.79.83.2.08.42.12.64.12H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
      </>
    ),
    allTrips: (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </>
    ),
    cancellations: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </>
    ),
    employees: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M18 8v6M15 11h6" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V4" />
        <path d="M8 20v-6M12 20V9M16 20v-9M20 20V6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M17 8h4M19 6v4" />
      </>
    ),
    policy: (
      <>
        <path d="M6 3.5h8l4 4V20H6z" />
        <path d="M14 3.5V8h4M9 12h6M9 16h6" />
      </>
    ),
    audit: <path d="M3 12h4l2-5 3 10 2-5h7" />,
    health: (
      <>
        <path d="M3 12h4l2-4 3 8 2-4h7" />
        <path d="M20 8a8.5 8.5 0 1 0 1 4" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true" {...common}>
      {paths[name]}
    </svg>
  );
}

function roleLabel(role: Role) {
  if (role === "super_admin") return "Super admin";
  if (role === "travel_admin") return "Travel admin";
  if (role === "manager") return "Manager";
  return "Employee";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Sidebar({
  name,
  role,
  pendingCount,
  unreadCount,
}: {
  name: string;
  role: Role;
  pendingCount: number;
  unreadCount: number;
}) {
  const pathname = usePathname();
  const isManager = role === "manager";
  const isTravelAdmin = role === "travel_admin";
  const isSuperAdmin = role === "super_admin";
  const isAdmin = isTravelAdmin || isSuperAdmin;

  const workspace: NavItem[] = [
    { href: "/", label: "Dashboard", icon: <Icon name="home" /> },
    { href: "/trips/new", label: "New request", icon: <Icon name="new" /> },
    { href: "/trips", label: isAdmin ? "All trips" : "My trips", icon: <Icon name="trips" /> },
    { href: "/bookings", label: "My bookings", icon: <Icon name="bookings" /> },
    { href: "/history", label: "Travel history", icon: <Icon name="history" /> },
    {
      href: "/notifications",
      label: "Notifications",
      icon: <Icon name="notifications" />,
      badge: unreadCount,
    },
  ];

  const manager: NavItem[] = isManager
    ? [
        { href: "/manager", label: "Manager dashboard", icon: <Icon name="manager" /> },
        {
          href: "/approvals",
          label: "Approval inbox",
          icon: <Icon name="approvals" />,
          badge: pendingCount,
        },
        { href: "/team", label: "My employees", icon: <Icon name="team" /> },
      ]
    : [];

  const operations: NavItem[] = isAdmin
    ? [
        { href: "/admin", label: "Operations", icon: <Icon name="admin" /> },
        { href: "/admin/bookings", label: "Booking operations", icon: <Icon name="bookings" /> },
        { href: "/admin/cancellations", label: "Cancellations", icon: <Icon name="cancellations" /> },
        { href: "/admin/employees", label: "Employee directory", icon: <Icon name="employees" /> },
        { href: "/admin/approvals", label: "Approval overview", icon: <Icon name="approvals" /> },
        { href: "/admin/reports", label: "Travel reports", icon: <Icon name="reports" /> },
      ]
    : [];

  const administration: NavItem[] = isSuperAdmin
    ? [
        { href: "/admin/users", label: "User management", icon: <Icon name="users" /> },
        { href: "/admin/policy", label: "Policy configuration", icon: <Icon name="policy" /> },
        { href: "/admin/audit", label: "System activity", icon: <Icon name="audit" /> },
        { href: "/admin/health", label: "System health", icon: <Icon name="health" /> },
      ]
    : [];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const renderLink = (item: NavItem, mobile = false) => {
    const active = isActive(item.href);
    if (mobile) {
      return (
        <Link
          key={item.href}
          href={item.href}
          className={`mobile-nav-pill ${active ? "mobile-nav-pill-active" : ""}`}
        >
          {item.label}
          {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
        </Link>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-link ${active ? "nav-link-active" : ""}`}
      >
        <span className="nav-icon-wrap">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
      </Link>
    );
  };

  const group = (label: string, items: NavItem[]) =>
    items.length > 0 ? (
      <div className="mt-6 space-y-1">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </p>
        {items.map((item) => renderLink(item))}
      </div>
    ) : null;

  return (
    <>
      <aside className="sidebar hidden lg:flex flex-col">
        <Link href="/" className="flex items-center gap-3 px-1">
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
              <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold tracking-tight text-ink">
              Travel Agent
            </span>
            <span className="block truncate text-[11px] text-slate-500">
              Corporate travel, simplified
            </span>
          </span>
        </Link>

        <div className="mt-8 space-y-1">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>
          {workspace.map((item) => renderLink(item))}
        </div>
        {group("Manager", manager)}
        {group("Travel operations", operations)}
        {group("Administration", administration)}

        <div className="mt-auto space-y-3 pt-6">
          <Link
            href="/profile"
            className="user-card user-card-link flex items-center gap-3"
            title="Manage profile"
            aria-label="Manage profile"
          >
            <span className="avatar">{initials(name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
              <span className="block truncate text-[11px] text-slate-500">
                {roleLabel(role)}
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-slate-400"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
          <p className="px-2 text-center text-[10px] text-slate-400">
            Local dev · signed in via DEV_USER_EMAIL
          </p>
        </div>
      </aside>

      <header className="mobile-bar lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-mark h-9 w-9 rounded-xl">
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
                <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight">Travel Agent</span>
          </Link>
          <Link href="/profile" aria-label="Manage profile" className="avatar h-8 w-8 text-[10px]">
            {initials(name)}
          </Link>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {[...workspace, ...manager, ...operations, ...administration].map((item) =>
            renderLink(item, true),
          )}
        </nav>
      </header>
    </>
  );
}
