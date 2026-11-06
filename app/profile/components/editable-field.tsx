"use client";

import { useState } from "react";
import { EditIcon } from "./icons";

type EditableFieldProps = {
  label: string;
  value: string | number | null | undefined;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "date" | "number" | "password";
  editable?: boolean;
  onSave?: (value: string) => void;
  busy?: boolean;
};

export function EditableField({
  label,
  value,
  placeholder = "—",
  type = "text",
  editable = false,
  onSave,
  busy,
}: EditableFieldProps) {
  const [editMode, setEditMode] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);

  const displayValue =
    value === null || value === undefined || value === "" ? placeholder : value;

  const handleSave = async () => {
    if (!onSave || !inputValue.trim()) {
      setEditMode(false);
      setInputValue("");
      return;
    }
    setSaving(true);
    try {
      await onSave(inputValue.trim());
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editable) {
    return (
      <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-500 text-sm">{label}</dt>
        <dd className="font-medium text-ink text-right">{displayValue}</dd>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500 text-sm">{label}</dt>
      <div className="flex items-center gap-2">
        {editMode ? (
          <div className="flex items-center gap-2">
            <input
              type={type}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setEditMode(false);
                  setInputValue("");
                }
              }}
              className="input min-w-[120px] text-sm"
              disabled={busy || saving}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={busy || saving || !inputValue.trim()}
              className="btn-glass disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? <span className="spinner h-3 w-3 border-2 border-current border-t-transparent rounded-full" /> : <EditIcon />}
            </button>
            <button
              onClick={() => {
                setEditMode(false);
                setInputValue("");
              }}
              disabled={busy || saving}
              className="text-[10px] text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => {
                setInputValue(String(displayValue));
                setEditMode(true);
              }}
              disabled={busy}
              className="text-indigo-600 hover:text-indigo-700 p-1 rounded hover:bg-indigo-50"
              aria-label="Edit"
            >
              <EditIcon className="h-4 w-4" />
            </button>
            <dd className="font-medium text-ink text-right">{displayValue}</dd>
          </>
        )}
      </div>
    </div>
  );
}
