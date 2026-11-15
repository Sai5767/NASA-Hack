/**
 * Globe cell / dot view models for Explore (Scan a region, World, Time-lapse). Moved out of App.jsx (owner item 6).
 *
 * Scan-cell evidence encoding (shared with the Scan summary chips; spec 2.3):
 *   holds   solid outline   = the trend still holds after correction (accounting for testing many cells at once)
 *   before  dashed outline  = significant only before correction
 *   none    no outline      = no clear trend
 *   failed  dotted neutral  = not analysed
 * Fill colour is the data layer's rise/fall/flat scale only (--data-up/down/flat). News red/amber/green never appear.
 * All numbers are the backend's own values; nothing here computes a statistic.
 */
import { formatP, formatPlace, signed } from "./format.js";
import { intensity, mixHex } from "./lapse.js";
import { DATA_COLORS } from "./theme.js";
import { readTokens } from "./tokens.js";

export const CELL_STYLES = {
  holds: { id: "holds", label: "Holds after correction", line: "solid", dash: null, width: 2.2 },
  before: { id: "before", label: "Only before correction", line: "dashed", dash: [4, 3], width: 1.4 },
  none: { id: "none", label: "No clear trend", line: "none", dash: null, width: 0 },
  failed: { id: "failed", label: "Not analysed", line: "dotted", dash: [1.5, 2.5], width: 1 },
};

/** Which evidence style a backend scan cell gets. */
export function cellStyleOf(c) {
  if (!c?.ok) return "failed";
  if (c.significant_fdr) return "holds";
  if (c.significant) return "before";
  return "none";
}

const STATUS = {
  holds: "holds after correction",
  before: "only before correction",
  none: "no clear trend",
};

/** Globe `cells` for a /api/grid response. */
export function scanCells(data, { colors = DATA_COLORS, tokens = readTokens() } = {}) {
  const units = data?.variable?.units ?? "";
  const cells = data?.cells ?? [];
  const ok = cells.filter((c) => c.ok);
  const maxAbs = Math.max(...ok.map((c) => Math.abs(c.slope_per_decade)), 1e-9);
  return cells.map((c) => {
    const place = formatPlace(c.lat, c.lon);
    const style = cellStyleOf(c);
    if (style === "failed") {
      return {
        lat: c.lat, lon: c.lon, style, fill: tokens["--missing-fg"] ?? colors.failed, alpha: 0.16,
        stroke: tokens["--missing-fg"] ?? colors.failed, strokeWidth: CELL_STYLES.failed.width, dash: CELL_STYLES.failed.dash,
        tip: `${place} · not analysed`,
      };
    }
    const color = c.slope_per_decade >= 0 ? colors.up : colors.down;
    const strength = Math.abs(c.slope_per_decade) / maxAbs;
    const s = CELL_STYLES[style];
    return {
      lat: c.lat,
      lon: c.lon,
      style,
      fill: c.significant ? color : colors.flat,
      alpha: c.significant ? 0.26 + 0.5 * strength : 0.14,
      stroke: style === "none" ? null : tokens["--cell-stroke"],
      strokeWidth: s.width,
      dash: s.dash,
      tip: `${place} · ${signed(c.slope_per_decade)} ${units}/decade · p ${formatP(c.p_value)} · ${STATUS[style]}`,
    };
  });
}

/** Which cell styles a set of scan cells uses (for the legend: list every style shown, nothing else). */
export function cellStylesShown(cells) {
  const seen = new Set((cells ?? []).map((c) => c.style).filter(Boolean));
  return ["holds", "before", "none", "failed"].filter((s) => seen.has(s));
}

/** One dot per place in the world survey: colour = direction, ring = holds after correction, size = signal vs noise. */
export function worldDots(data, { colors = DATA_COLORS } = {}) {
  const units = data?.variable?.units ?? "";
  return (data?.places ?? []).map((p) => {
    if (!p.ok) {
      return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, color: colors.failed, r: 3.5, ring: false, failed: true, tip: `${p.name} · not measurable here` };
    }
    const color = p.significant ? (p.slope_per_decade >= 0 ? colors.up : colors.down) : colors.flat;
    const status = p.significant_fdr ? STATUS.holds : p.significant ? STATUS.before : STATUS.none;
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      color,
      r: 4 + Math.min(5, Math.abs(p.signal_to_noise ?? 0) * 1.6),
      ring: p.significant_fdr,
      sign: p.significant ? (p.slope_per_decade >= 0 ? "up" : "down") : undefined,
      failed: false,
      tip: `${p.name} · ${signed(p.slope_per_decade)} ${units}/decade · ${status}`,
    };
  });
}

/** Time-lapse: each dot fades from grey toward the rise colour (above what is usual here) or the fall colour (below). */
export function lapseDots(data, prepared, year, { colors = DATA_COLORS } = {}) {
  const units = data?.variable?.units ?? "";
  return (data?.places ?? []).map((p) => {
    const base = { id: p.id, name: p.name, lat: p.lat, lon: p.lon, ring: false };
    if (!p.ok) return { ...base, color: colors.failed, r: 3.5, failed: true, tip: `${p.name} · not measurable here` };
    const a = prepared.at(p.id, year);
    if (a == null) return { ...base, color: colors.failed, r: 3, tip: `${p.name} · no value for ${year}` };
    const k = intensity(a, prepared.scale);
    return {
      ...base,
      color: mixHex(colors.flat, a >= 0 ? colors.up : colors.down, k),
      r: 4 + 5 * k,
      sign: a > 0 ? "up" : a < 0 ? "down" : undefined,
      tip: `${p.name} · ${year}: ${signed(a, 3)} ${units} compared with what is usual for this place`,
    };
  });
}
