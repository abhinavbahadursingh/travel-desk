import Link from "next/link";
import { getCurrentUser, canAssignManagers, canManageUsers } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function EmployeeDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canAssignManagers(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Travel operations access only</p>
        <p className="mt-1 text-sm text-slate-500">
          The employee directory is available to travel admins and super admins.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { department: { contains: q } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      department: true,
      manager: { select: { id: true, name: true } },
      _count: { select: { requests: true, reports: true, approvals: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Travel operations</p>
            <h1 className="page-title mt-2">Employee directory</h1>
            <p className="page-subtitle mt-2">
              Accounts, roles, departments and reporting managers.{" "}
              {canManageUsers(user)
                ? "Super admins can change these from User management."
                : "Only a super admin can change accounts or roles."}
            </p>
          </div>
          {canManageUsers(user) && (
            <Link href="/admin/users" className="btn-primary">
              Manage users
            </Link>
          )}
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="border-b border-white/60 px-5 py-4 sm:px-6">
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, email or department"
              className="input min-w-[240px] flex-1"
            />
            <button type="submit" className="btn-glass">
              Search
            </button>
            {q && (
              <Link href="/admin/employees" className="btn-ghost text-xs">
                Clear
              </Link>
            )}
          </form>
        </div>

        {users.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500">
            No accounts match this search.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table-glass min-w-[860px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Reporting manager</th>
                  <th>Requests</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((person) => (
                  <tr key={person.id}>
                    <td className="font-medium text-ink">{person.name}</td>
                    <td className="text-slate-600">{person.email}</td>
                    <td className="text-slate-600">{person.role.replaceAll("_", " ")}</td>
                    <td className="text-slate-600">{person.department ?? "—"}</td>
                    <td className="text-slate-600">{person.manager?.name ?? "Not assigned"}</td>
                    <td className="text-slate-600">
                      {person._count.requests} · {person._count.reports} reports
                    </td>
                    <td>
                      <span className={person.active ? "tag-confirmed" : "chip-warn"}>
                        {person.active ? "active" : "deactivated"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
