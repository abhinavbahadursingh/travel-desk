import Link from "next/link";
import { getCurrentUser, canManageUsers } from "@/lib/auth";
import { db } from "@/lib/db";
import { CreateUserForm } from "./CreateUserForm";
import { UserRow } from "./UserRow";

export default async function UserManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; active?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canManageUsers(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Super admin access only</p>
        <p className="mt-1 text-sm text-slate-500">
          Account, role and manager changes are restricted to super admins.
        </p>
        <Link href="/admin/employees" className="btn-glass mt-4 inline-flex">
          Open employee directory
        </Link>
      </div>
    );
  }

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const role = params.role?.trim() ?? "";
  const active = params.active?.trim() ?? "";

  const [users, managers, unassigned] = await Promise.all([
    db.user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { email: { contains: q } },
                { department: { contains: q } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        department: true,
        managerId: true,
      },
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: {
        active: true,
        role: { in: ["manager", "travel_admin", "super_admin"] },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    db.user.count({ where: { managerId: null, role: "employee", active: true } }),
  ]);

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Administration</p>
            <h1 className="page-title mt-2">User management</h1>
            <p className="page-subtitle mt-2">
              Create accounts, assign roles and reporting managers, and activate or deactivate
              access. Every change is audited. {unassigned} active employee
              {unassigned === 1 ? "" : "s"} still need a reporting manager.
            </p>
          </div>
          <span className="glass-pill">{users.length} accounts</span>
        </div>
      </section>

      <section className="glass p-5 sm:p-6">
        <h2 className="font-semibold tracking-tight">Create account</h2>
        <p className="mt-1 text-xs text-slate-500">
          This creates the account record only. Authentication stays on the DEV_USER_EMAIL local
          mechanism in this phase.
        </p>
        <div className="mt-4">
          <CreateUserForm managers={managers} />
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4 sm:px-6">
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, email or department"
              className="input min-w-[220px] flex-1"
            />
            <select name="role" defaultValue={role} className="select w-auto">
              <option value="">All roles</option>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="travel_admin">Travel admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            <select name="active" defaultValue={active} className="select w-auto">
              <option value="">Any status</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </select>
            <button type="submit" className="btn-glass">
              Filter
            </button>
            {(q || role || active) && (
              <Link href="/admin/users" className="btn-ghost text-xs">
                Clear
              </Link>
            )}
          </form>
        </div>

        {users.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500">
            No accounts match this filter.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[920px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Reporting manager</th>
                  <th>Status</th>
                  <th aria-label="Edit" />
                </tr>
              </thead>
              <tbody>
                {users.map((account) => (
                  <UserRow
                    key={account.id}
                    account={account}
                    managers={managers}
                    isSelf={account.id === user.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
