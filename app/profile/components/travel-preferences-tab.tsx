"use client";

import { useState } from "react";
import { EditableField } from "./editable-field";
import { SectionCard, EmptyState } from "./cards";
import {
  PlaneIcon,
  HotelIcon,
  PassportIcon,
  TagIcon,
  PhoneIcon,
  EditIcon,
  SaveIcon,
  CancelIcon,
} from "./icons";

type TravelPreferencesTabProps = {
  travelPreference: {
    preferredSeat?: string | null;
    preferredMeal?: string | null;
    preferredAirline?: string | null;
    preferredHotelCategory?: string | null;
    preferredHotelChain?: string | null;
    preferredTravelClass?: string | null;
    frequentFlyerNumbers?: string | null;
    hotelLoyaltyMembership?: string | null;
    passportDetails?: string | null;
    emergencyContactName?: string | null;
    emergencyContactNumber?: string | null;
    emergencyContactRelationship?: string | null;
  } | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
};

function labelize(value: string) {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function TravelPreferencesTab({
  travelPreference,
  onSave,
  busy,
}: TravelPreferencesTabProps) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tp = travelPreference;

  const fields = [
    { label: "Preferred seat", value: tp?.preferredSeat ? labelize(tp.preferredSeat) : null, icon: <PlaneIcon />, key: "preferredSeat" },
    { label: "Preferred meal", value: tp?.preferredMeal, icon: <TagIcon />, key: "preferredMeal" },
    { label: "Preferred airline", value: tp?.preferredAirline, icon: <PlaneIcon />, key: "preferredAirline" },
    { label: "Travel class", value: tp?.preferredTravelClass ? labelize(tp.preferredTravelClass) : null, key: "preferredTravelClass" },
    { label: "Hotel category", value: tp?.preferredHotelCategory ? labelize(tp.preferredHotelCategory) : null, icon: <HotelIcon />, key: "preferredHotelCategory" },
    { label: "Hotel chain", value: tp?.preferredHotelChain, icon: <HotelIcon />, key: "preferredHotelChain" },
    { label: "Frequent flyer numbers", value: tp?.frequentFlyerNumbers, key: "frequentFlyerNumbers" },
    { label: "Hotel loyalty membership", value: tp?.hotelLoyaltyMembership, key: "hotelLoyaltyMembership" },
    { label: "Emergency contact name", value: tp?.emergencyContactName, icon: <PhoneIcon />, key: "emergencyContactName" },
    { label: "Emergency contact number", value: tp?.emergencyContactNumber, type: "tel" as const, icon: <PhoneIcon />, key: "emergencyContactNumber" },
    { label: "Relationship", value: tp?.emergencyContactRelationship, key: "emergencyContactRelationship" },
  ];

  const handleSave = async () => {
    setError(null);
    try {
      await onSave({});
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e?.message || "Could not save travel preferences");
    }
  };

  const hasData = !!tp && Object.values(tp).some((v) => v !== null && v !== undefined && v !== "");

  return (
    <div className="space-y-6">
      {editing ? (
        <div className="glass p-5 sm:p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-ink">Edit travel preferences</h2>
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
                    type={f.type || "text"}
                    defaultValue={typeof f.value === "string" ? f.value : ""}
                    className="input"
                    disabled={busy}
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
              title: "Travel preferences",
              subtitle: "Your travel and loyalty preferences plus emergency contact details.",
              icon: <PlaneIcon />,
            }}
          >
            {!hasData ? (
              <EmptyState
                icon={<PlaneIcon />}
                title="No travel preferences set"
                subtitle="Set your seat, meal, airline and loyalty preferences to personalize your travel booking experience."
                action={
                  <button
                    onClick={() => setEditing(true)}
                    disabled={busy}
                    className="btn-primary min-w-[10rem] flex items-center gap-2"
                  >
                    <EditIcon className="h-4 w-4" /> Add preferences
                  </button>
                }
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((f) => (
                    <div key={f.key}>
                      <EditableField
                        label={f.label}
                        value={f.value}
                        type={f.type}
                        editable={true}
                        busy={busy}
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
                    <EditIcon className="h-4 w-4" /> Edit travel preferences
                  </button>
                </div>

                {error && (
                  <p className="mt-4 rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
                    {error}
                  </p>
                )}
              </>
            )}
          </SectionCard>
        </section>
      )}
    </div>
  );
}
