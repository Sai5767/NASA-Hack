import { useId, useMemo, useState } from "react";
import { normalize } from "../../lib/ask.js";
import { formatPlace } from "../../lib/format.js";

const MAX_ROWS = 6;

/** "33.4, -112.1" (or with N/S/E/W) → { lat, lon }; anything else → null. */
export function parseCoords(text) {
  const m = String(text ?? "").trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { lat, lon };
}

/** Prefix matches first, then substring matches, from the server's place list. */
export function searchPlaces(query, places) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const p of places) {
    const n = normalize(p.name);
    const i = n.indexOf(q);
    if (i >= 0) scored.push({ p, score: i === 0 ? 0 : n.includes(` ${q}`) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name)).slice(0, MAX_ROWS).map((s) => s.p);
}

/**
 * Accessible place search (combobox + listbox). Typing coordinates also works. When the place list could not be loaded,
 * the search is disabled with an explanation; the pin map (in the parent) still works.
 */
export default function PlaceSearch({ places, status = "ready", disabled = false, onAdd, label = "Search a city or place", isSaved }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const coords = parseCoords(query);
  const results = useMemo(() => {
    const found = searchPlaces(query, places ?? []);
    return coords ? [{ id: "coords", name: formatPlace(coords.lat, coords.lon), lat: coords.lat, lon: coords.lon, coords: true }, ...found] : found;
  }, [query, places, coords?.lat, coords?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = query.trim().length > 0 && !disabled;
  const unavailable = status === "error";

  const choose = (p) => {
    if (!p || disabled) return;
    onAdd({ name: p.name, lat: p.lat, lon: p.lon });
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
    }
  };

  return (
    <div className="place-search">
      <label className="field" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="place-search-input"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-describedby={`${inputId}-help`}
        autoComplete="off"
        placeholder={unavailable ? "Place search is unavailable" : "Phoenix, Delhi, Amazon… or 33.4, -112.1"}
        value={query}
        disabled={disabled || unavailable}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <p id={`${inputId}-help`} className="faint small place-search-help">
        {unavailable
          ? "We couldn't load the place list. You can still pin a place on the map."
          : status === "loading"
            ? "Loading the place list…"
            : "Type a name, or latitude and longitude."}
      </p>
      {open && (
        <ul id={listId} role="listbox" className="place-results" aria-label="Matching places">
          {status === "loading" && results.length === 0 && <li className="place-result skeleton" aria-hidden="true" />}
          {status !== "loading" && results.length === 0 && (
            <li className="place-empty dim small" role="option" aria-selected="false" aria-disabled="true">
              No place found — try another spelling or pin it on the map
            </li>
          )}
          {results.map((p, i) => {
            const saved = isSaved?.(p.lat, p.lon);
            return (
              <li
                key={p.id ?? `${p.lat},${p.lon}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={saved || undefined}
                className={`place-result${i === active ? " active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !saved && choose(p)}
                onMouseEnter={() => setActive(i)}
              >
                <span>{p.coords ? `Pin at ${p.name}` : p.name}{saved && <small className="faint"> · already saved</small>}</span>
                <small className="mono faint">{Number(p.lat).toFixed(1)} {Number(p.lon).toFixed(1)}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
