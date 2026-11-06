import type { Role } from "./auth";

export type { Role };

export const ROLES: Role[] = ["employee", "manager", "travel_admin", "super_admin"];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  travel_admin: "Travel admin",
  super_admin: "Super admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  employee: "Request trips and track your own bookings.",
  manager: "Review and approve requests routed to you.",
  travel_admin: "Run booking operations, cancellations and company travel reports.",
  super_admin: "Manage accounts, roles, manager assignments and company policy.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}
