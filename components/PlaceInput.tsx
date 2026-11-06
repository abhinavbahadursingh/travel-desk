"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { PlaceSuggestion } from "@/lib/places";

type PlaceInputProps = {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export function PlaceInput({
  id,
  name,
  label,
  placeholder,
  required,
}: PlaceInputProps) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);
  const listId = `${id}-place-suggestions`;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function lookup(query: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/places/suggest?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`place lookup failed (${res.status})`);
      const data = (await res.json()) as { results?: PlaceSuggestion[] };
      if (controller.signal.aborted) return;
      setItems(Array.isArray(data.results) ? data.results : []);
      setError(false);
      if (focusedRef.current) setOpen(true);
    } catch (err) {
      if ((err as Error).name === "AbortError" || controller.signal.aborted) return;
      setItems([]);
      setError(true);
      if (focusedRef.current) setOpen(true);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }

  function schedule(query: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Cancel any in-flight lookup so an older query cannot repopulate the list.
    abortRef.current?.abort();
    abortRef.current = null;

    if (query.length < MIN_QUERY_LENGTH) {
      setItems([]);
      setOpen(false);
      setLoading(false);
      setError(false);
      return;
    }

    setItems([]);
    setLoading(true);
    setError(false);
    setOpen(true);
    timerRef.current = setTimeout(() => void lookup(query), DEBOUNCE_MS);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    setActive(-1);
    schedule(next.trim());
  }

  function choose(item: PlaceSuggestion) {
    setValue(item.label);
    setItems([]);
    setOpen(false);
    setActive(-1);
    setError(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (items.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((index) => (index + 1) % items.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (!open || items.length === 0) return;
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
      return;
    }

    if (event.key === "Enter" && open && active >= 0 && items[active]) {
      event.preventDefault();
      choose(items[active]);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  function onFocus() {
    focusedRef.current = true;
    if (items.length > 0) setOpen(true);
  }

  function onBlur() {
    focusedRef.current = false;
    setOpen(false);
    setActive(-1);
  }

  const showPanel = open && value.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="relative">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        minLength={MIN_QUERY_LENGTH}
        maxLength={100}
        placeholder={placeholder}
        className="input"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={
          showPanel && active >= 0 ? `${id}-place-option-${active}` : undefined
        }
        aria-busy={loading}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_24px_60px_-28px_rgba(30,41,59,0.45)] backdrop-blur-xl">
          {loading && items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Searching real places…</p>
          ) : error ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              Suggestions unavailable — you can still type the place.
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              No matching places. You can still type it.
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={`${label} suggestions`}
              className="max-h-72 overflow-y-auto py-1"
            >
              {items.map((item, index) => (
                <li key={item.id} role="presentation">
                  <button
                    id={`${id}-place-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                      index === active ? "bg-indigo-50/80" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {item.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {[item.admin1, item.country].filter(Boolean).join(", ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {item.kind === "airport" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Airport
                        </span>
                      )}
                      {item.countryCode && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-500">
                          {item.countryCode}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
            Real place data from Open-Meteo · GeoNames
          </div>
        </div>
      )}
    </div>
  );
}
