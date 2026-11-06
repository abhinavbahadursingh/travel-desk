"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ManagerOption = { id: string; name: string; role: string };

export function UserRow({
  account,
  managers,
  isSelf,
}: {
  account: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    department: string | null;
    managerId: string | null;
  };
  managers: ManagerOption[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      name: String(data.get("name") ?? "").trim(),
      role: String(data.get("role") ?? account.role),
      department: String(data.get("department") ?? "").trim() || null,
      managerId: String(data.get("managerId") ?? "").trim() || null,
      active: data.get("active") === "on",
    };
    try {
      const res = await fetch(`/api/admin/users/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not update the account",
        );
      }
      setNotice("Saved.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td className="font-medium text-ink">
          {account.name}
          {isSelf && <span className="ml-2 chip-neutral">you</span>}
        </td>
        <td className="text-slate-600">{account.email}</td>
        <td className="text-slate-600">{account.role.replaceAll("_", " ")}</td>
        <td className="text-slate-600">{account.department ?? "—"}</td>
        <td className="text-slate-600">
          {managers.find((manager) => manager.id === account.managerId)?.name ?? "Not assigned"}
        </td>
        <td>
          <span className={account.active ? "tag-confirmed" : "chip-warn"}>
            {account.active ? "active" : "deactivated"}
          </span>
        </td>
        <td className="text-right">
          <button type="button" onClick={() => setOpen((value) => !value)} className="btn-glass text-xs">
            {open ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-white/40">
            <form onSubmit={save} className="grid gap-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs text-slate-600">
                Full name
                <input name="name" defaultValue={account.name} className="input mt-1" maxLength={100} />
              </label>
              <label className="text-xs text-slate-600">
                Role
                <select name="role" defaultValue={account.role} className="select mt-1" disabled={isSelf}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="travel_admin">Travel admin</option>
                  <option value="super_admin">Super admin</option>
                </select>
                {isSelf && (
                  <span className="mt-1 block text-[10px] text-slate-400">
                    You cannot change your own role.
                  </span>
                )}
              </label>
              <label className="text-xs text-slate-600">
                Department
                <input
                  name="department"
                  defaultValue={account.department ?? ""}
                  className="input mt-1"
                  maxLength={100}
                />
              </label>
              <label className="text-xs text-slate-600">
                Reporting manager
                <select name="managerId" defaultValue={account.managerId ?? ""} className="select mt-1">
                  <option value="">Not assigned</option>
                  {managers
                    .filter((manager) => manager.id !== account.id)
                    .map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name} ({manager.role.replaceAll("_", " ")})
                      </option>
                    ))}
                </select>
              </label>
              <label className="mt-5 flex items-center gap-2 text-xs text-slate-600">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={account.active}
                  disabled={isSelf}
                />
                Active account
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={busy} className="btn-primary text-xs">
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
              {notice && <p className="text-xs text-emerald-700">{notice}</p>}
              {error && <p className="text-xs text-rose-600 sm:col-span-2">{error}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
