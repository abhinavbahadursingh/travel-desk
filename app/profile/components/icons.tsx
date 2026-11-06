type IconProps = {
  className?: string;
};

export function UserIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function BuildingIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10h18v8H3z" />
      <path d="M3 14h18" />
      <path d="M3 18h18" />
      <path d="M10 3v7" />
      <path d="M14 3v7" />
      <path d="M19 3v2" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3h2v4h16V3h2v13H2V3z" />
      <path d="M7 21h10" />
      <path d="M8 11h8" />
    </svg>
  );
}

export function PlaneIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.5 11.2 13.9 9 10.4 3.4a1 1 0 0 0-1.7 0L6.2 8.2l-3.4.9a1 1 0 0 0-.5 1.7l4.2 3.2-1.2 3.9a1 1 0 0 0 1.5 1.1l4-2.5 4.7 1.9a1 1 0 0 0 1.4-1.1l-.6-4.2 3.7-1.5a1 1 0 0 0 0-1.8z" />
    </svg>
  );
}

export function HotelIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10h18v8H3z" />
      <path d="M9 3v7" />
      <path d="M15 3v7" />
      <path d="M3 13h18" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1l3 5v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6l3-5z" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 16a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-3z" />
      <path d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
    </svg>
  );
}

export function MailIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function PhoneIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.8 19.8 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function MapPinIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function TagIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 17.17a2 2 0 0 1 0-2.83l7.17-7.17a2 2 0 0 1 2.83 0l2.31 2.31z" />
      <line x1="1" y1="4" x2="1" y2="10" />
      <line x1="4" y1="1" x2="10" y2="1" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function ActivityIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function SlackIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.394 15.866L6.71 11.49H4v-3.57h5.826l-2.317 4.376L2.317 21h3.57l3.516-6.634 2.595 4.899H16v3.569h-5.826l2.317-4.376L21.683 3h-3.57l-3.516 6.634-2.595-4.899H8v-3.569z" />
    </svg>
  );
}

export function EditIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function SaveIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

export function CancelIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 4v6h6" />
      <path d="M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 8.63l6.17 3.14" />
      <path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 15.37l-6.17-3.14" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function PassportIcon({ className }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 17h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2l-1 5 2-2z" />
      <path d="M17 17H5" />
    </svg>
  );
}
