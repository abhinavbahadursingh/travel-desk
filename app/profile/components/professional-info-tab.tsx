"use client";

import { useState } from "react";
import { EditableField } from "./editable-field";
import { SectionCard } from "./cards";
import {
  BriefcaseIcon,
  TagIcon,
  CalendarIcon,
  MapPinIcon,
  EditIcon,
  SaveIcon,
  CancelIcon,
} from "./icons";

type ProfessionalInfoTabProps = {
  user: {
    employeeId?: string | null;
    jobTitle?: string | null;
    designation?: string | null;
    employmentType?: string | null;
    joiningDate?: Date | string | null;
    officeLocation?: string | null;
    businessUnit?: string | null;
    costCentre?: string | null;
    workLocation?: string | null;
  };
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  canEdit: boolean;
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function labelize(value: string) {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function ProfessionalInfoTab({
  user,
  onSave,
  busy,
  canEdit,
}: ProfessionalInfoTabProps) {
  const editingState = useEditingState();
  const editing = editingState.editing;
  const setEditing = editingState.setEditing;
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = [
    { label: "Employee ID", value: user.employeeId, icon: <TagIcon />, key: "employeeId", editable: false },
    { label: "Job title", value: user.jobTitle, icon: <BriefcaseIcon />, key: "jobTitle" },
    { label: "Designation", value: user.designation, icon: <TagIcon />, key: "designation" },
    { label: "Employment type", value: user.employmentType ? labelize(user.employmentType) : null, key: "employmentType" },
    { label: "Joining date", value: user.joiningDate ? formatDate(user.joiningDate) : null, icon: <CalendarIcon />, key: "joiningDate" },
    { label: "Office location", value: user.officeLocation, icon: <MapPinIcon />, key: "officeLocation" },
    { label: "Business unit", value: user.businessUnit, icon: <BriefcaseIcon />, key: "businessUnit" },
    { label: "Cost centre", value: user.costCentre, icon: <TagIcon />, key: "costCentre" },
    { label: "Work location", value: user.workLocation ? labelize(user.workLocation) : null, key: "workLocation" },
  ];

  const handleSave = async () => {
    setError(null);
    try {
      await onSave({});
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e?.message || "Could not save professional information");
    }
  };

  return (
    <div className="space-y-6">
      {editing ? (
        <div className="glass p-5 sm:p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-ink">Edit professional information</h2>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-[10px] text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-2">
                  <label className="label">{f.label}</label>
                  <input
                    type="text"
                    defaultValue={typeof f.value === "string" ? f.value : ""}
                    className="input"
                    disabled={busy || !f.editable}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-white/60 pt-5">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary min-w-[9rem]"
              >
                {busy ? <SaveIcon className="mr-2 h-4 w-4 animate-spin" /> : <SaveIcon className="mr-2" />}
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                className="btn-glass"
              >
                Cancel
              </button>
              {saved && (
                <span className="ml-auto text-xs font-medium text-emerald-600">
                  Changes saved.
                </span>
              )}
            </div>
          </form>
        </div>
      ) : (
        <section className="space-y-6">
          <SectionCard
            header={{
              title: "Professional information",
              subtitle: "Your employment details. Some fields are managed by a super admin.",
              icon: <BriefcaseIcon />,
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key}>
                  <EditableField
                    label={f.label}
                    value={f.value}
                    editable={f.editable && canEdit}
                    busy={busy}
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between">
              {canEdit ? (
                <button
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  className="btn-primary min-w-[10rem] flex items-center gap-2"
                >
                  <EditIcon className="h-4 w-4" /> Edit professional information
                </button>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Role, employee ID and reporting manager are managed by a super admin.
                </p>
              )}
              {error && (
                <p className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
                  {error}
                </p>
              )}
            </div>
          </SectionCard>
        </section>
      )}
    </div>
  );
}

function useEditingState() {
  const [editing, setEditing] = useState(false);
  return { editing, setEditing };
}
