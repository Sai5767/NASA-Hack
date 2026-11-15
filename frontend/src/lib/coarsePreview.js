/**
 * Coarse whole-Earth preview (plan 6B): an orientation layer, not a measurement product.
 *
 * Static files built by tools/coarse_preview/build.py from NASA POWER monthly point data on a 15-degree grid
 * (264 points, latitudes -75..75) live in frontend/public/coarse/<VARIABLE>.json. They are fetched once, lazily, from
 * the page's own origin (no API call, no request to NASA on metric selection) and cached for the session.
 *
 * Nothing here computes a statistic: values are the file's own monthly means, decoded from integers. The globe draws
 * them as a soft, sphere-clipped, deliberately low-resolution layer labelled "Coarse global preview · approximate
 * pattern". No p-value, trend, forecast or exact value is ever attached to it.
 */
import { useEffect, useState } from "react";
import { mixLinear } from "./tokens.js";

/** Variables that have a coarse file. Any other variable shows "preview unavailable for this variable". */
export const COARSE_VARIABLES = ["T2M", "PRECTOTCORR", "CLOUD_AMT"];

export const COARSE_LABEL = "Coarse global preview";
export const COARSE_NOTE = "approximate pattern";

const cache = new Map(); // id -> { status: "ready" | "error", doc, promise }

const baseUrl = () => {
  try {
    return import.meta.env?.BASE_URL ?? "/";
  } catch {
    return "/";
  }
};

/** Decode the file's quantised integers into a Float32Array per month (NaN = no value). Pure. */
export function decodeCoarse(raw) {
  if (!raw || !Array.isArray(raw.values) || !Array.isArray(raw.months) || !raw.grid) return null;
  const scale = Number(raw.scale) || 1;
  const frames = raw.values.map((row) => {
    const out = new Float32Array(row.length);
    for (let i = 0; i < row.length; i += 1) out[i] = row[i] == null ? Number.NaN : row[i] * scale;
    return out;
  });
  const g = raw.grid;
  const points = [];
  for (let r = 0; r < g.nlat; r += 1) {
    for (let c = 0; c < g.nlon; c += 1) points.push({ lat: g.lat0 + r * g.dlat, lon: g.lon0 + c * g.dlon });
  }
  return {
    variable: raw.variable,
    label: raw.label,
    unit: raw.unit,
    months: raw.months,
    retrieved: raw.retrieved,
    sourceUrl: raw.sourceUrl,
    source: raw.source,
    grid: g,
    half: Math.min(g.dlat, g.dlon) / 2,
    points,
    frames,
  };
}

/** Load (once) and cache one variable's preview. Resolves to the decoded doc, or null when unavailable. */
export function loadCoarse(variableId, fetcher = typeof fetch === "function" ? fetch : null) {
  if (!variableId || !COARSE_VARIABLES.includes(variableId) || !fetcher) return Promise.resolve(null);
  const hit = cache.get(variableId);
  if (hit?.status === "ready") return Promise.resolve(hit.doc);
  if (hit?.promise) return hit.promise;
  const promise = fetcher(`${baseUrl()}coarse/${variableId}.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((raw) => {
      const doc = decodeCoarse(raw);
      if (!doc) throw new Error("bad file");
      cache.set(variableId, { status: "ready", doc });
      return doc;
    })
    .catch(() => {
      cache.set(variableId, { status: "error" });
      return null;
    });
  cache.set(variableId, { status: "loading", promise });
  return promise;
}

/** Synchronous cache read (null if not loaded yet). */
export const cachedCoarse = (variableId) => (cache.get(variableId)?.status === "ready" ? cache.get(variableId).doc : null);

/**
 * React hook: { status: "none" | "loading" | "ready" | "unavailable", doc }.
 * "none" = no variable chosen; "unavailable" = no file for this variable or it could not be loaded.
 */
export function useCoarsePreview(variableId) {
  const [state, setState] = useState(() => initial(variableId));
  useEffect(() => {
    let alive = true;
    setState(initial(variableId));
    if (!variableId || !COARSE_VARIABLES.includes(variableId)) return undefined;
    if (cachedCoarse(variableId)) return undefined;
    loadCoarse(variableId).then((doc) => {
      if (alive) setState(doc ? { status: "ready", doc } : { status: "unavailable", doc: null });
    });
    return () => {
      alive = false;
    };
  }, [variableId]);
  return state;
}

function initial(variableId) {
  if (!variableId) return { status: "none", doc: null };
  if (!COARSE_VARIABLES.includes(variableId)) return { status: "unavailable", doc: null };
  const doc = cachedCoarse(variableId);
  if (doc) return { status: "ready", doc };
  if (cache.get(variableId)?.status === "error") return { status: "unavailable", doc: null };
  return { status: "loading", doc: null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-05" -> "May 2024". */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Jan 2023–Dec 2025" for the legend. */
export function coverageLabel(doc) {
  if (!doc?.months?.length) return "";
  return `${monthLabel(doc.months[0])}–${monthLabel(doc.months[doc.months.length - 1])}`;
}

/** Key "YYYY-MM" of a timeline frame (observed or forecast) or null. */
export function frameMonthKey(frame) {
  if (!frame || !Number.isFinite(frame.year) || !Number.isFinite(frame.month_num)) return null;
  return `${frame.year}-${String(frame.month_num).padStart(2, "0")}`;
}

/**
 * Which preview month to draw for a wanted month.
 * Exact match -> that month. No match -> keep `fallbackIndex` (the last one shown, else the latest month) and say so.
 * Returns { index, exact, label, note }.
 */
export function pickCoarseMonth(doc, wantedKey, fallbackIndex = null) {
  if (!doc?.months?.length) return null;
  const last = doc.months.length - 1;
  if (wantedKey) {
    const i = doc.months.indexOf(wantedKey);
    if (i >= 0) return { index: i, exact: true, label: monthLabel(doc.months[i]), note: "" };
    const keep = Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex <= last ? fallbackIndex : last;
    return {
      index: keep,
      exact: false,
      label: monthLabel(doc.months[keep]),
      note: `No preview for ${monthLabel(wantedKey)}; still showing ${monthLabel(doc.months[keep])}`,
    };
  }
  const i = Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex <= last ? fallbackIndex : last;
  return { index: i, exact: true, label: monthLabel(doc.months[i]), note: "" };
}

/**
 * Display colour scale for the preview's absolute monthly values (display only; nothing statistical).
 * Each scale maps a value to a position in [-1, 1] along the variable's two data ramps (spec 2.3).
 */
const SCALES = {
  T2M: { neg: "cool", pos: "warm", mid: 10, lo: -20, hi: 35, below: "Colder", above: "Hotter" },
  PRECTOTCORR: { neg: "dry", pos: "wet", mid: 2, lo: 0, hi: 10, below: "Drier", above: "Wetter" },
  CLOUD_AMT: { neg: "cool", pos: "cloud", mid: 50, lo: 0, hi: 100, below: "Clearer", above: "Cloudier" },
};

export const coarseScale = (variableId) => SCALES[variableId] ?? null;

/** Position in [-1, 1] of a value on a variable's display scale, or null. */
export function coarsePosition(variableId, v) {
  const s = SCALES[variableId];
  if (!s || v == null || !Number.isFinite(v)) return null;
  if (v >= s.mid) return Math.min(1, (v - s.mid) / (s.hi - s.mid));
  return -Math.min(1, (s.mid - v) / (s.mid - s.lo));
}

/** The nine legend tokens, low end first (same order as ramp.legendSwatches). */
export function coarseLegendTokens(variableId) {
  const s = SCALES[variableId];
  if (!s) return [];
  return [...[4, 3, 2, 1].map((k) => `--data-${s.neg}-${k}`), "--data-neutral", ...[1, 2, 3, 4].map((k) => `--data-${s.pos}-${k}`)];
}

/** Hex colour for a value: linear blend between neighbouring ramp steps (display only). */
export function coarseColor(variableId, v, tokens) {
  const p = coarsePosition(variableId, v);
  if (p == null) return null;
  const stops = coarseLegendTokens(variableId).map((t) => tokens[t]).filter(Boolean);
  if (stops.length < 2) return null;
  const x = ((p + 1) / 2) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixLinear(stops[i], stops[i + 1], x - i);
}
