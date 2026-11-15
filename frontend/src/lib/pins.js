/**
 * Pins (owner feedback items 9, 10, 12).
 *
 * 1. Pin history: the last few active pins, so an accidental second pin can be undone (Ctrl/Cmd+Z or
 *    "Back to previous pin"). In memory only.
 * 2. Result cache: completed backend results (trend, scan) keyed by their request key, so undo and "Open" restore a
 *    result without refetching. In memory only, bounded.
 * 3. Saved pins: label + colour + place + question (+ the scan result) kept in localStorage under `td-saved-pins-v1`
 *    until the user unpins them. Total size is bounded; the oldest result payloads are dropped first, never a pin.
 *
 * Nothing here is personal: a saved pin is a location, a variable, years and public NASA POWER results. No account data.
 * Backend values are stored and returned exactly as received; nothing is recalculated.
 */
import { PIN_COLORS } from "./theme.js";

export const PIN_HISTORY_MAX = 10;
export const RESULT_CACHE_MAX = 24;
export const SAVED_PINS_KEY = "td-saved-pins-v1";
export const SAVED_PINS_MAX = 40;
export const SAVED_PINS_MAX_BYTES = 1_500_000;
export const PIN_LABEL_MAX = 40;

// ---------------------------------------------------------------- history

const samePin = (a, b) => !!a && !!b && a.lat === b.lat && a.lon === b.lon && a.variable === b.variable && a.start === b.start && a.end === b.end;

/**
 * History with `entry` pushed on top (newest last), bounded to `max`. An entry is
 * `{ params: {variable, lat, lon, start, end}, scanCfg?: {size, n}, gridKey?: string }`.
 * Pushing the same pin as the newest entry is a no-op.
 */
export function pushPin(history, entry, max = PIN_HISTORY_MAX) {
  if (!entry?.params) return history;
  const list = Array.isArray(history) ? history : [];
  if (samePin(list[list.length - 1]?.params, entry.params)) return list;
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** `{ entry, history }`: the newest entry and the history without it; entry is null when the history is empty. */
export function popPin(history) {
  const list = Array.isArray(history) ? history : [];
  if (!list.length) return { entry: null, history: list };
  return { entry: list[list.length - 1], history: list.slice(0, -1) };
}

// ---------------------------------------------------------------- result cache (in memory)

/** A tiny LRU map. `get` refreshes recency; `set` evicts the least recently used entry beyond `max`. */
export function createResultCache(max = RESULT_CACHE_MAX) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },
    has: (key) => map.has(key),
    set(key, value) {
      if (value == null) return;
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

// ---------------------------------------------------------------- saved pins (localStorage)

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const cleanText = (s, max) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const round2 = (n) => Math.round(n * 100) / 100;
const COLOR_IDS = PIN_COLORS.map((c) => c.id);

export const pinColor = (id) => PIN_COLORS.find((c) => c.id === id) ?? PIN_COLORS[0];

/** The first palette colour not already used by a saved pin (cycles when all six are used). */
export function nextPinColor(pins) {
  const used = new Set((pins ?? []).map((p) => p.color));
  return (PIN_COLORS.find((c) => !used.has(c.id)) ?? PIN_COLORS[(pins?.length ?? 0) % PIN_COLORS.length]).id;
}

/**
 * The scan summary kept with a pin: counts of backend flags plus the variable's name and units. Counting the backend's
 * own booleans is not a statistic; no value is recomputed.
 */
export function scanSummary(data) {
  if (!isObj(data) || !Array.isArray(data.cells)) return null;
  const ok = data.cells.filter((c) => c?.ok);
  return {
    cells: data.cells.length,
    analysed: ok.length,
    significant: ok.filter((c) => c.significant).length,
    holds: ok.filter((c) => c.significant_fdr).length,
    rising: ok.filter((c) => c.significant && c.slope_per_decade > 0).length,
    falling: ok.filter((c) => c.significant && c.slope_per_decade < 0).length,
    variable: cleanText(data.variable?.label, 60),
    units: cleanText(data.variable?.units, 20),
    size: finite(data.size) ? data.size : null,
    n: finite(data.n) ? data.n : null,
  };
}

function cleanSummary(s) {
  if (!isObj(s)) return null;
  const n = (v) => (finite(v) && v >= 0 ? Math.round(v) : 0);
  return {
    cells: n(s.cells),
    analysed: n(s.analysed),
    significant: n(s.significant),
    holds: n(s.holds),
    rising: n(s.rising),
    falling: n(s.falling),
    variable: cleanText(s.variable, 60),
    units: cleanText(s.units, 20),
    size: finite(s.size) ? s.size : null,
    n: finite(s.n) ? s.n : null,
  };
}

/** A clean saved pin, or null. Unknown fields are dropped. */
export function cleanSavedPin(raw) {
  if (!isObj(raw)) return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const variable = typeof raw.variable === "string" && /^[A-Za-z0-9_]{2,32}$/.test(raw.variable) ? raw.variable : null;
  const start = Number.parseInt(raw.start, 10);
  const end = Number.parseInt(raw.end, 10);
  if (!variable || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const id = typeof raw.id === "string" && /^[a-z0-9-]{4,40}$/.test(raw.id) ? raw.id : newPinId();
  let scan = null;
  if (isObj(raw.scan) && isObj(raw.scan.cfg) && finite(raw.scan.cfg.size) && finite(raw.scan.cfg.n)) {
    scan = {
      cfg: { size: raw.scan.cfg.size, n: raw.scan.cfg.n },
      key: typeof raw.scan.key === "string" ? raw.scan.key.slice(0, 200) : "",
      summary: cleanSummary(raw.scan.summary),
      data: isObj(raw.scan.data) && Array.isArray(raw.scan.data.cells) ? raw.scan.data : null,
      dropped: !!raw.scan.dropped,
    };
  }
  return {
    id,
    label: cleanText(raw.label, PIN_LABEL_MAX) || `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`,
    color: COLOR_IDS.includes(raw.color) ? raw.color : COLOR_IDS[0],
    lat: round2(lat),
    lon: round2(lon),
    variable,
    start,
    end,
    savedAt: finite(raw.savedAt) ? raw.savedAt : Date.now(),
    scan,
  };
}

let seq = 0;
export function newPinId() {
  seq = (seq + 1) % 1000;
  return `pin-${Date.now().toString(36)}-${seq.toString(36)}`;
}

const sizeOf = (list) => {
  try {
    return JSON.stringify(list).length;
  } catch {
    return Infinity;
  }
};

/**
 * Fit the list under `maxBytes` by dropping scan payloads (oldest pin first). The pin, its question and its scan
 * summary always stay. Returns `{ pins, dropped }` where dropped is the number of payloads removed.
 */
export function boundSavedPins(pins, maxBytes = SAVED_PINS_MAX_BYTES) {
  let list = pins.map((p) => ({ ...p, scan: p.scan ? { ...p.scan } : null }));
  let dropped = 0;
  if (sizeOf(list) <= maxBytes) return { pins: list, dropped };
  const order = list
    .map((p, i) => ({ i, at: p.savedAt }))
    .filter(({ i }) => list[i].scan?.data)
    .sort((a, b) => a.at - b.at);
  for (const { i } of order) {
    list[i].scan.data = null;
    list[i].scan.dropped = true;
    dropped += 1;
    if (sizeOf(list) <= maxBytes) break;
  }
  return { pins: list, dropped };
}

const store = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Saved pins from localStorage (an empty list if none, unreadable or blocked). */
export function loadSavedPins(storage = store()) {
  try {
    const raw = storage?.getItem(SAVED_PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.pins) ? parsed.pins : [];
    return list.map(cleanSavedPin).filter(Boolean).slice(0, SAVED_PINS_MAX);
  } catch {
    return [];
  }
}

/**
 * Save the list (bounded). Returns `{ pins, dropped, ok }`: the list as stored (payloads may have been dropped),
 * how many payloads were dropped by this save, and whether storage accepted it.
 */
export function saveSavedPins(pins, storage = store(), maxBytes = SAVED_PINS_MAX_BYTES) {
  const bounded = boundSavedPins(pins.slice(0, SAVED_PINS_MAX), maxBytes);
  if (!storage) return { ...bounded, ok: false };
  try {
    if (!bounded.pins.length) storage.removeItem(SAVED_PINS_KEY);
    else storage.setItem(SAVED_PINS_KEY, JSON.stringify({ version: 1, pins: bounded.pins }));
    return { ...bounded, ok: true };
  } catch {
    // Quota exceeded even after bounding: drop every payload and try once more.
    const bare = bounded.pins.map((p) => (p.scan?.data ? { ...p, scan: { ...p.scan, data: null, dropped: true } } : p));
    const extra = bare.filter((p, i) => bounded.pins[i].scan?.data).length;
    try {
      storage.setItem(SAVED_PINS_KEY, JSON.stringify({ version: 1, pins: bare }));
      return { pins: bare, dropped: bounded.dropped + extra, ok: true };
    } catch {
      return { ...bounded, ok: false };
    }
  }
}

export function clearSavedPins(storage = store()) {
  try {
    storage?.removeItem(SAVED_PINS_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The list with `pin` added (or replacing a pin with the same id). Newest first. */
export function addSavedPin(pins, pin) {
  const clean = cleanSavedPin(pin);
  if (!clean) return pins;
  return [clean, ...pins.filter((p) => p.id !== clean.id)].slice(0, SAVED_PINS_MAX);
}

export const removeSavedPin = (pins, id) => pins.filter((p) => p.id !== id);

/** The saved pin at the same spot and question, if any. */
export const findSavedPin = (pins, params) =>
  params ? pins.find((p) => p.lat === params.lat && p.lon === params.lon && p.variable === params.variable && p.start === params.start && p.end === params.end) ?? null : null;

/** Globe marker props for the Globe agent: `[{ id, lat, lon, label, color, outline }]` (hex values from PIN_COLORS). */
export const savedPinMarkers = (pins) =>
  pins.map((p) => {
    const c = pinColor(p.color);
    return { id: p.id, lat: p.lat, lon: p.lon, label: p.label, color: c.hex, outline: c.outline, colorId: c.id };
  });
