"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

export type AirportOption = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  type: "international" | "domestic" | "regional";
  distanceKm?: number | null;
};

export type AirportComboboxHandle = {
  getValue: () => AirportOption | null;
  setValue: (option: AirportOption | null) => void;
  focus: () => void;
};

type Props = {
  id: string;
  fieldPrefix: string; // e.g. "origin" — hidden inputs become originAirportCode, etc.
  label: string;
  placeholder: string;
  required?: boolean;
  initial?: AirportOption | null;
  onChange?: (option: AirportOption | null) => void;
  // Returning false prevents selection (used to block picking the same airport
  // for both origin and destination).
  canSelect?: (option: AirportOption) => boolean;
  blockedMessage?: string;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function labelFor(airport: AirportOption): string {
  return `${airport.city} (${airport.iata}) — ${airport.name}`;
}

function typeBadgeClass(type: AirportOption["type"]): string {
  if (type === "international") return "bg-indigo-50 text-indigo-600";
  if (type === "domestic") return "bg-sky-50 text-sky-600";
  return "bg-slate-100 text-slate-600";
}

export const AirportCombobox = forwardRef<AirportComboboxHandle, Props>(
  function AirportCombobox(
    {
      id,
      fieldPrefix,
      label,
      placeholder,
      required,
      initial,
      onChange,
      canSelect,
      blockedMessage,
    },
    ref,
  ) {
    const [text, setText] = useState(initial ? labelFor(initial) : "");
    const [selected, setSelected] = useState<AirportOption | null>(initial ?? null);
    const [items, setItems] = useState<AirportOption[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [active, setActive] = useState(-1);
    const [nearbyLabel, setNearbyLabel] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusedRef = useRef(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listId = `${id}-airport-suggestions`;

    useImperativeHandle(ref, () => ({
      getValue: () => selected,
      setValue: (option) => {
        setSelected(option);
        setText(option ? labelFor(option) : "");
        setItems([]);
        setOpen(false);
        setNearbyLabel(null);
        setBlocked(null);
        onChange?.(option);
      },
      focus: () => inputRef.current?.focus(),
    }));

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
          `/api/airports/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`search failed (${res.status})`);
        const data = (await res.json()) as { results?: AirportOption[] };
        if (controller.signal.aborted) return;
        const results = Array.isArray(data.results) ? data.results : [];
        setItems(results);
        setErrorMsg(null);
        setNearbyLabel(null);

        // If nothing matched and the query looks like a city name, try the
        // nearby endpoint. "Nothing matched" also fires when the user typed a
        // city that has no airport of its own (Ghaziabad → nearest DEL).
        if (results.length === 0 && query.length >= MIN_QUERY_LENGTH) {
          const res2 = await fetch(
            `/api/airports/nearby?city=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (res2.ok) {
            const d2 = (await res2.json()) as { results?: AirportOption[] };
            const near = Array.isArray(d2.results) ? d2.results : [];
            if (near.length > 0) {
              setItems(near);
              setNearbyLabel(`Nearest airports to ${query}`);
            }
          }
        }

        if (focusedRef.current) setOpen(true);
      } catch (err) {
        if ((err as Error).name === "AbortError" || controller.signal.aborted) return;
        setItems([]);
        setErrorMsg("Suggestions unavailable right now.");
        if (focusedRef.current) setOpen(true);
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    }

    function schedule(query: string) {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      abortRef.current = null;
      setBlocked(null);

      if (query.length < MIN_QUERY_LENGTH) {
        setItems([]);
        setOpen(false);
        setLoading(false);
        setErrorMsg(null);
        setNearbyLabel(null);
        return;
      }

      setItems([]);
      setLoading(true);
      setErrorMsg(null);
      setNearbyLabel(null);
      setOpen(true);
      timerRef.current = setTimeout(() => void lookup(query), DEBOUNCE_MS);
    }

    function onInputChange(event: ChangeEvent<HTMLInputElement>) {
      const next = event.target.value;
      setText(next);
      setActive(-1);
      // Typing invalidates any previously selected airport.
      if (selected) {
        setSelected(null);
        onChange?.(null);
      }
      schedule(next.trim());
    }

    function choose(option: AirportOption) {
      if (canSelect && !canSelect(option)) {
        setBlocked(
          blockedMessage ?? "That airport is already selected for the other field.",
        );
        return;
      }
      setSelected(option);
      setText(labelFor(option));
      setItems([]);
      setOpen(false);
      setActive(-1);
      setErrorMsg(null);
      setNearbyLabel(null);
      setBlocked(null);
      onChange?.(option);
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
      // Delay close so an onClick on an option can still fire.
      setTimeout(() => {
        setOpen(false);
        setActive(-1);
      }, 120);
    }

    const showPanel = open && text.trim().length >= MIN_QUERY_LENGTH;

    return (
      <div className="relative">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          ref={inputRef}
          type="text"
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
            showPanel && active >= 0 ? `${id}-airport-option-${active}` : undefined
          }
          aria-busy={loading}
          value={text}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* Hidden fields submitted with the form. */}
        <input
          type="hidden"
          name={fieldPrefix}
          value={selected ? `${selected.city} (${selected.iata})` : ""}
        />
        <input
          type="hidden"
          name={`${fieldPrefix}AirportCode`}
          value={selected?.iata ?? ""}
        />
        <input
          type="hidden"
          name={`${fieldPrefix}AirportName`}
          value={selected?.name ?? ""}
        />
        <input type="hidden" name={`${fieldPrefix}City`} value={selected?.city ?? ""} />
        <input
          type="hidden"
          name={`${fieldPrefix}Country`}
          value={selected?.country ?? ""}
        />
        <input
          type="hidden"
          name={`${fieldPrefix}Latitude`}
          value={selected ? String(selected.latitude) : ""}
        />
        <input
          type="hidden"
          name={`${fieldPrefix}Longitude`}
          value={selected ? String(selected.longitude) : ""}
        />

        {selected && (
          <p className="mt-1 text-[11px] text-emerald-700">
            <span className="font-semibold">{selected.iata}</span> · {selected.name}
          </p>
        )}

        {blocked && (
          <p className="mt-1 text-[11px] text-rose-600">{blocked}</p>
        )}

        {showPanel && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_24px_60px_-28px_rgba(30,41,59,0.45)] backdrop-blur-xl">
            {loading && items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                Searching airports…
              </p>
            ) : errorMsg ? (
              <p className="px-4 py-3 text-sm text-slate-500">{errorMsg}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                No matching airports.
              </p>
            ) : (
              <>
                {nearbyLabel && (
                  <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {nearbyLabel}
                  </p>
                )}
                <ul
                  id={listId}
                  role="listbox"
                  aria-label={`${label} suggestions`}
                  className="max-h-80 overflow-y-auto py-1"
                >
                  {items.map((item, index) => (
                    <li key={`${item.iata}-${index}`} role="presentation">
                      <button
                        id={`${id}-airport-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(item)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                          index === active ? "bg-indigo-50/80" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold tracking-wider text-white">
                          {item.iata}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {item.name}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {item.city}, {item.country}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeBadgeClass(item.type)}`}
                          >
                            {item.type}
                          </span>
                          {typeof item.distanceKm === "number" && item.distanceKm > 0 && (
                            <span className="text-[10px] text-slate-400">
                              {Math.round(item.distanceKm)} km
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
              Airport data from mwgg/Airports (public domain) · {items.length} shown
            </div>
          </div>
        )}
      </div>
    );
  },
);
