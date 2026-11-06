"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ManagerOption = { id: string; name: string; role: string };

export function CreateUserForm({ managers }: { managers: ManagerOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      role: String(data.get("role") ?? "employee"),
      department: String(data.get("department") ?? "").trim() || null,
      managerId: String(data.get("managerId") ?? "").trim() || null,
      active: data.get("active") === "on",
    };
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Could not create the account",
        );
      }
      setNotice(`Created ${body.name}.`);
      form.reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs text-slate-600">
        Full name
        <input name="name" required maxLength={100} className="input mt-1" />
      </label>
      <label className="text-xs text-slate-600">
        Work email
        <input name="email" type="email" required maxLength={200} className="input mt-1" />
      </label>
      <label className="text-xs text-slate-600">
        Role
        <select name="role" className="select mt-1" defaultValue="employee">
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="travel_admin">Travel admin</option>
          <option value="super_admin">Super admin</option>
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Department
        <input name="department" maxLength={100} className="input mt-1" placeholder="e.g. Sales" />
      </label>
      <label className="text-xs text-slate-600">
        Reporting manager
        <select name="managerId" className="select mt-1" defaultValue="">
          <option value="">Not assigned</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name} ({manager.role.replaceAll("_", " ")})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-5 flex items-center gap-2 text-xs text-slate-600">
        <input name="active" type="checkbox" defaultChecked />
        Active account
      </label>
      <div className="sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={busy} className="btn-primary text-xs">
          {busy ? "Creating…" : "Create account"}
        </button>
        {notice && <span className="ml-3 text-xs text-emerald-700">{notice}</span>}
        {error && <span className="ml-3 text-xs text-rose-600">{error}</span>}
      </div>
    </form>
  );
}
