"use client";

import { useState, useEffect } from "react";
import { EditableField } from "./editable-field";
import { SectionCard, EmptyState, StatTile } from "./cards";
import {
  PhoneIcon,
  MailIcon,
  MapPinIcon,
  CalendarIcon,
  TagIcon,
  EditIcon,
  SaveIcon,
  CancelIcon,
} from "./icons";

type PersonalInfoTabProps = {
  user: {
    name: string;
    email: string;
    phone?: string | null;
    alternatePhone?: string | null;
    personalEmail?: string | null;
    dateOfBirth?: Date | string | null;
    gender?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pinCode?: string | null;
    profilePicture?: string | null;
  };
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function PersonalInfoTab({
  user,
  onSave,
  busy,
}: PersonalInfoTabProps) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = [
    { label: "Name", value: user.name, type: "text" as const, icon: <UserIcon />, key: "name" },
    { label: "Phone", value: user.phone, type: "tel" as const, icon: <PhoneIcon />, key: "phone" },
    { label: "Alternate phone", value: user.alternatePhone, type: "tel" as const, icon: <PhoneIcon />, key: "alternatePhone" },
    { label: "Work email", value: user.email, type: "email" as const, icon: <MailIcon />, key: "email", editable: false },
    { label: "Personal email", value: user.personalEmail, type: "email" as const, icon: <MailIcon />, key: "personalEmail" },
    { label: "Date of birth", value: user.dateOfBirth ? formatDate(user.dateOfBirth) : null, type: "date" as const, icon: <CalendarIcon />, key: "dateOfBirth" },
    { label: "Gender", value: user.gender, icon: <TagIcon />, key: "gender" },
    { label: "Address", value: user.address, icon: <MapPinIcon />, key: "address" },
    { label: "City", value: user.city, icon: <MapPinIcon />, key: "city" },
    { label: "State / Province", value: user.state, icon: <MapPinIcon />, key: "state" },
    { label: "Country", value: user.country, icon: <MapPinIcon />, key: "country" },
    { label: "PIN / Postal code", value: user.pinCode, icon: <TagIcon />, key: "pinCode" },
  ];

  const handleSave = async (form: HTMLFormElement) => {
    setError(null);
    try {
      const formData = new FormData(form);
      const data: Record<string, unknown> = {};
      fields.forEach((f) => {
        if (f.key === "email") return;
        const val = formData.get(f.key);
        if (val !== null) data[f.key] = val;
      });
      await onSave(data);
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e?.message || "Could not save personal information");
    }
  };

  return (
    <div className="space-y-6">
      {editing ? (
        <div className="glass p-5 sm:p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-ink">Edit personal information</h2>
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave(e.currentTarget);
            }}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => {
                if (f.key === "email") return null;
                return (
                  <div key={f.key} className="space-y-2">
                    <label className="label">{f.label}</label>
                    <input
                      name={f.key}
                      type={f.type}
                      defaultValue={typeof f.value === "string" ? f.value : ""}
                      className="input"
                      disabled={busy}
                    />
                  </div>
                );
              })}
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
              title: "Personal information",
              subtitle: "Your contact and personal details. Edit to update.",
              icon: <UserIcon />,
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key}>
                  <EditableField
                    label={f.label}
                    value={f.value}
                    type={f.type}
                    editable={true}
                    busy={busy}
                    onSave={(newValue) => onSave({ [f.key]: newValue })}
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="btn-primary min-w-[10rem] flex items-center gap-2"
              >
                <EditIcon className="h-4 w-4" /> Edit personal information
              </button>
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

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
