/**
 * Pure timeline logic for the local NASA POWER field and the internal monthly forecast (spec 3.2-3.4, 4.4, 5.10).
 *
 * Science rules this file enforces:
 * - Observed frames (/api/monthly-frames, kind "observed") and forecast frames (/api/monthly-forecast, kind "forecast")
 *   are kept in separate zones of one sequence with an explicit boundary. They are never averaged or merged.
 * - Forecast frames are used only when the response says `eligible === true`.
 * - A missing cell stays missing: no value, no colour, no carry-over from a neighbour or from the previous month.
 * - A colour cross-fade is allowed only between genuinely adjacent calendar months of the same kind, for a cell that
 *   is valid in both frames.
 * Live weather (Meteomatics) never enters this file.
 */
import { classify, rampFor, scaleFor, STEP_ALPHA, tokenFor } from "./ramp.js";

export const SPEEDS = [
  { id: 0.5, label: "0.5×", dwell: 1200 },
  { id: 1, label: "1×", dwell: 600 },
  { id: 2, label: "2×", dwell: 300 },
  { id: 4, label: "4×", dwell: 150 },
];
/** Reduced motion: play stays available (user-started, conveys data) but at most about two changes per second. */
export const REDUCED_SPEEDS = SPEEDS.filter((s) => s.id <= 1);
export const RANGES = [3, 5, 10];

export const OBSERVED_BADGE = "Observed (NASA POWER)";
export const FORECAST_BADGE = "Forecast — not observed data";
export const GRID_SHORT_NOTE = "Coarse local grid, not a global satellite image";

export const dwellFor = (speed) => (SPEEDS.find((s) => s.id === speed) ?? SPEEDS[1]).dwell;

/** Cross-fade length for a speed: min(0.6 x dwell, 360 ms); 0 (hard cut) with reduced motion. */
export const fadeMsFor = (speed, reduced = false) => (reduced ? 0 : Math.min(0.6 * dwellFor(speed), 360));

/**
 * V3 cross-fade between actual adjacent returned frames (plan 6B: 150-300 ms), for a step, a drag or playback.
 * Playback never fades longer than its own dwell allows; reduced motion is a hard cut.
 */
export const FRAME_FADE_MS = 220;
export const frameFadeMs = ({ playing = false, speed = 1, reduced = false } = {}) => {
  if (reduced) return 0;
  if (!playing) return FRAME_FADE_MS;
  return Math.max(90, Math.min(300, fadeMsFor(speed)));
};

const monthIndex = (f) => f.year * 12 + (f.month_num - 1);

/** True when b is the calendar month right after a and both are the same kind (observed/observed or forecast/forecast). */
export function isAdjacent(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (!Number.isFinite(a.year) || !Number.isFinite(b.year)) return false;
  return monthIndex(b) - monthIndex(a) === 1;
}

/** Half-width in degrees of one drawn cell: half the centre-to-centre spacing (spec 3.2). */
export function cellHalf(grid) {
  const n = Number(grid?.n) || 1;
  const size = Number(grid?.size_degrees) || 0;
  return n > 1 ? size / (n - 1) / 2 : size / 2;
}

/** Params for /api/monthly-frames for one place, variable and range (years ending last year). */
export function framesQuery(place, variable, rangeYears = 3, now = new Date()) {
  const endYear = now.getUTCFullYear() - 1;
  const years = Math.max(1, Math.min(10, rangeYears));
  return {
    variable: variable.id,
    lat: Number(place.lat).toFixed(4),
    lon: Number(place.lon).toFixed(4),
    start_year: Math.max(1981, endYear - years + 1),
    end_year: endYear,
  };
}

/** Params for /api/monthly-forecast (same grid as the observed frames: API defaults n = 3, size = 2). */
export function forecastQuery(place, variable) {
  return { variable: variable.id, lat: Number(place.lat).toFixed(4), lon: Number(place.lon).toFixed(4) };
}

/** Forecast is supported only for these variables (the backend says so too; this only avoids an obviously empty call). */
export const FORECAST_VARIABLES = ["T2M", "PRECTOTCORR", "CLOUD_AMT"];

/**
 * Forecast status for the card and the rail's forecast slot.
 *   "idle" (not requested) | "loading" | "error" | "withheld" | "eligible"
 */
export function forecastStatus(req) {
  if (!req || (!req.loading && !req.data && !req.error)) return { kind: "idle" };
  if (req.loading) return { kind: "loading" };
  if (req.error) return { kind: "error", message: req.error };
  const d = req.data;
  if (d.eligible === true && Array.isArray(d.frames) && d.frames.some((f) => f?.kind === "forecast")) {
    const fs = d.frames.filter((f) => f.kind === "forecast");
    return { kind: "eligible", first: fs[0].label, last: fs[fs.length - 1].label, data: d };
  }
  return {
    kind: "withheld",
    reason: d.reason || "Forecast withheld: it did not pass its own accuracy checks.",
    reasonCode: d.reason_code ?? null,
    data: d,
  };
}

/**
 * One sequence for the rail: observed frames first, then (only if eligible) forecast frames.
 * Returns null when there is no observed response.
 */
export function buildTimeline(framesResp, forecastResp = null) {
  if (!framesResp || !Array.isArray(framesResp.frames)) return null;
  const observed = framesResp.frames.filter((f) => f?.kind === "observed");
  const eligible = forecastResp?.eligible === true;
  const forecast = eligible ? (forecastResp.frames ?? []).filter((f) => f?.kind === "forecast") : [];
  const frames = [...observed, ...forecast];
  let lastObserved = observed.length - 1;
  while (lastObserved > 0 && !(observed[lastObserved].valid_cells > 0)) lastObserved -= 1;
  const failed = new Set((framesResp.cells ?? []).filter((c) => c.ok === false).map((c) => c.cell_id));
  return {
    frames,
    observedCount: observed.length,
    forecastCount: forecast.length,
    lastObserved: Math.max(0, lastObserved),
    scale: scaleFor(observed),
    variable: framesResp.variable ?? null,
    units: framesResp.variable?.units ?? framesResp.provenance?.units ?? "",
    grid: framesResp.grid ?? null,
    half: cellHalf(framesResp.grid),
    provenance: framesResp.provenance ?? null,
    coverage: framesResp.coverage ?? null,
    failedCells: failed,
    forecastProvenance: eligible ? forecastResp.provenance ?? null : null,
    alignment: eligible ? forecastResp.alignment ?? null : null,
  };
}

export const isForecastIndex = (tl, i) => !!tl && i >= tl.observedCount && i < tl.frames.length;

/** Default position: paused on the most recent observed month that has data. No autoplay. */
export const defaultIndex = (tl) => (tl ? tl.lastObserved : 0);

/**
 * Next index while playing, or null to stop. Play stops on the last observed month and never continues into the
 * forecast; from inside the forecast zone (entered deliberately) it plays to the last forecast frame.
 */
export function nextPlayIndex(tl, i) {
  if (!tl) return null;
  if (i < tl.observedCount) return i < tl.lastObserved ? i + 1 : null;
  return i < tl.frames.length - 1 ? i + 1 : null;
}

/** True when the play button should read "Replay" (at the end of the zone the thumb is in). */
export const atPlayEnd = (tl, i) => nextPlayIndex(tl, i) === null;

/** Clamp a step (buttons, keys, drag) to the whole sequence: stepping into the forecast is a deliberate action. */
export const stepIndex = (tl, i, delta) => (tl ? Math.max(0, Math.min(tl.frames.length - 1, i + delta)) : 0);

/**
 * How each cell changes from frame a to frame b (spec 4.4):
 *   "tween"   both frames adjacent, same kind, cell valid in both: colour may interpolate
 *   "fadeIn"  missing -> valid in adjacent frames: pattern removed at once, fill fades in
 *   "fadeOut" valid -> missing in adjacent frames: fill fades out, then the missing pattern
 *   "cut"     anything else (non-adjacent, observed <-> forecast, first frame): instant
 *   "none"    missing -> missing
 */
export function transitionPlan(a, b, { eitherWay = false } = {}) {
  const plan = new Map();
  if (!b) return plan;
  const adjacent = isAdjacent(a, b) || (eitherWay && isAdjacent(b, a));
  const before = new Map((a?.cells ?? []).map((c) => [c.cell_id, c]));
  for (const c of b.cells ?? []) {
    const p = before.get(c.cell_id);
    const nowMissing = isMissing(c);
    const wasMissing = !p || isMissing(p);
    if (!adjacent || !p) plan.set(c.cell_id, nowMissing && p && wasMissing ? "none" : "cut");
    else if (wasMissing && nowMissing) plan.set(c.cell_id, "none");
    else if (wasMissing) plan.set(c.cell_id, "fadeIn");
    else if (nowMissing) plan.set(c.cell_id, "fadeOut");
    else plan.set(c.cell_id, "tween");
  }
  return plan;
}

export const isMissing = (c) => !c || c.missing === true || c.value == null || c.anomaly == null;

const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(digits));
const signedFmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatLatLon(lat, lon) {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

/** Tooltip / table text for one cell (spec 3.2 / 3.3 / 3.4). */
export function cellTip(cell, frame, { units = "", failed = false } = {}) {
  const where = `r${cell.row} c${cell.col} · ${formatLatLon(cell.lat, cell.lon)} · ${frame.label}`;
  if (failed) return `${where} · This cell could not be loaded`;
  if (isMissing(cell)) return `${where} · No data for this cell this month`;
  const normal = `vs its own ${MONTH_LONG[(frame.month_num ?? 1) - 1]} normal`;
  const parts = [where, `${fmt(cell.value, 1)} ${units}`.trim(), `${signedFmt(cell.anomaly)} ${units} ${normal}`.replace(/\s+/g, " ")];
  if (frame.kind === "forecast" && cell.lo != null && cell.hi != null) parts.push(`range ${fmt(cell.lo, 2)} to ${fmt(cell.hi, 2)} ${units}`.trim());
  parts.push(frame.badge || (frame.kind === "forecast" ? FORECAST_BADGE : OBSERVED_BADGE));
  return parts.join(" · ");
}

/**
 * Draw-ready cells for one frame: { id, lat, lon, row, col, state: "valid" | "missing" | "failed", kind, token, alpha,
 * sign, tip }. `token` is a CSS token name; the globe resolves it to a colour.
 */
export function fieldCells(tl, frame) {
  if (!tl || !frame) return [];
  const ramp = rampFor(tl.variable);
  return (frame.cells ?? []).map((c) => {
    const failed = tl.failedCells.has(c.cell_id);
    const base = { id: c.cell_id, lat: c.lat, lon: c.lon, row: c.row, col: c.col, kind: frame.kind, tip: cellTip(c, frame, { units: tl.units, failed }) };
    if (failed) return { ...base, state: "failed", token: null, alpha: 0, sign: 0 };
    if (isMissing(c)) return { ...base, state: "missing", token: null, alpha: 0, sign: 0 };
    const cls = classify(c.anomaly, tl.scale);
    const alpha = frame.kind === "forecast" ? 0.55 : STEP_ALPHA[cls?.step ?? 0];
    return { ...base, state: "valid", token: tokenFor(cls, ramp), alpha, sign: cls?.side === "pos" ? 1 : cls?.side === "neg" ? -1 : 0 };
  });
}

/** The rail's mean readout from the frame's own `mean_anomaly` (never recomputed here). */
export function meanReadout(frame, units = "") {
  if (!frame) return "";
  if (!(frame.valid_cells > 0) || frame.mean_anomaly == null) return "No data this month";
  const a = frame.mean_anomaly;
  const arrow = a > 0 ? "▲" : a < 0 ? "▼" : "▬";
  return `${arrow} ${signedFmt(a)} ${units} vs normal`.replace(/\s+/g, " ").trim();
}

/** aria-valuetext for the month slider. */
export function sliderText(frame, units = "") {
  if (!frame) return "";
  const kind = frame.kind === "forecast" ? "forecast, not observed" : "observed, NASA POWER";
  const name = `${MONTH_LONG[(frame.month_num ?? 1) - 1]} ${frame.year}`;
  if (!(frame.valid_cells > 0) || frame.mean_anomaly == null) return `${name}, ${kind}, no data this month`;
  const a = frame.mean_anomaly;
  const word = a > 0 ? "plus" : a < 0 ? "minus" : "";
  const unitWord = units === "°C" ? "degrees Celsius" : units;
  return `${name}, ${kind}, mean ${word} ${Math.abs(a).toFixed(1)} ${unitWord} versus normal`.replace(/\s+/g, " ");
}

/** Partial-coverage badge text, e.g. "2 of 9 cells missing" for this frame, or null when complete. */
export function coverageBadge(frame, grid) {
  if (!frame) return null;
  const total = grid?.total_cells ?? (frame.cells ?? []).length;
  const missing = frame.missing_cells ?? (frame.cells ?? []).filter(isMissing).length;
  return missing > 0 ? `${missing} of ${total} cells missing` : null;
}

/** Rail caption (spec 5.10 row 3). */
export function railCaption(tl, frame) {
  if (!tl) return "";
  const n = tl.grid?.n ?? 1;
  const size = tl.grid?.size_degrees;
  const units = tl.units ? ` · ${tl.units}` : "";
  const gridText = ` · ${n}×${n} local grid${size ? ` ≈ ${size}° wide` : ""}`;
  if (frame?.kind === "forecast") return `Statistical forecast from NASA POWER history · not observed${units}${gridText} · ${GRID_SHORT_NOTE}`;
  return `NASA POWER (observed/reanalysis)${units}${gridText} · ${GRID_SHORT_NOTE}`;
}

/** Year tick positions (January frames) for the track. */
export const yearTicks = (tl) => (tl ? tl.frames.map((f, i) => ({ i, f })).filter(({ f }) => f.month_num === 1 && f.kind === "observed") : []);

/** Bar model for the track: one per frame, height fraction of the fixed scale, or a missing slot. */
export function trackBars(tl) {
  if (!tl) return [];
  const ramp = rampFor(tl.variable);
  return tl.frames.map((f, i) => {
    if (!(f.valid_cells > 0) || f.mean_anomaly == null) return { i, kind: f.kind, missing: true };
    const cls = classify(f.mean_anomaly, tl.scale);
    const h = tl.scale ? Math.min(1, Math.abs(f.mean_anomaly) / tl.scale) : 0;
    return { i, kind: f.kind, missing: false, up: f.mean_anomaly >= 0, h, token: tokenFor(cls, ramp) };
  });
}

/** Rows of the accessible grid table for one frame (rows x columns). */
export function tableRows(tl, frame) {
  if (!tl || !frame) return [];
  const byRow = new Map();
  for (const c of frame.cells ?? []) {
    if (!byRow.has(c.row)) byRow.set(c.row, []);
    byRow.get(c.row).push(c);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cells]) => ({
      row,
      cells: cells
        .sort((a, b) => a.col - b.col)
        .map((c) => {
          const failed = tl.failedCells.has(c.cell_id);
          const missing = failed || isMissing(c);
          return {
            id: c.cell_id,
            col: c.col,
            where: formatLatLon(c.lat, c.lon),
            text: failed ? "Could not be loaded" : missing ? "Missing" : `${fmt(c.value, 1)} ${tl.units} (${signedFmt(c.anomaly)} vs normal)`.replace(/\s+/g, " "),
            missing,
          };
        }),
    }));
}

/** Geographic extent of the grid (cell centres +/- half) for the bracket frame and the camera. */
export function gridExtent(cells, half) {
  if (!cells?.length) return null;
  const lats = cells.map((c) => c.lat);
  const lons = cells.map((c) => c.lon);
  return {
    south: Math.min(...lats) - half,
    north: Math.max(...lats) + half,
    west: Math.min(...lons) - half,
    east: Math.max(...lons) + half,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}

/** Expected cell centres while the request is in flight (empty outlines only, spec 4.5). Mirrors the API's n/size. */
export function expectedCells(place, n = 3, size = 2) {
  if (!place) return [];
  const half = n > 1 ? size / (n - 1) / 2 : size / 2;
  const step = n > 1 ? size / (n - 1) : 0;
  const out = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      out.push({ id: `r${r}_c${c}`, row: r, col: c, lat: place.lat + size / 2 - r * step - (n > 1 ? 0 : size / 2), lon: place.lon - size / 2 + c * step + (n > 1 ? 0 : size / 2), state: "pending", half });
    }
  }
  return out;
}
