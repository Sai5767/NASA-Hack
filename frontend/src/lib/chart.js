/** Tiny scale / tick / path helpers for the hand-built SVG charts. */
import { converter, unitLabel } from "./units.js";

export function linearScale(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const scale = (v) => r0 + (v - d0) * k;
  scale.invert = (px) => d0 + (px - r0) / k;
  scale.domain = [d0, d1];
  return scale;
}

/** "Nice" tick values between min and max (roughly `count` of them). */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].find((m) => m * mag >= raw) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

export function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function padExtent([lo, hi], fraction = 0.08) {
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * fraction, hi + span * fraction];
}

export function linePath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

/** Closed polygon path from an upper edge and a lower edge (both left-to-right). */
export function bandPath(upper, lower) {
  return `${linePath(upper)}${[...lower].reverse().map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join("")}Z`;
}

/**
 * @deprecated V2 diverging colour (literal rgb, kept only for the legacy unit test in tests/lib.test.mjs).
 * Charts use `rampColor`, which returns V3 `--data-*` tokens.
 */
export function divergingColor(value, maxAbs) {
  if (!maxAbs) return "rgb(60,70,100)";
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  const neutral = [34, 42, 66];
  const target = t >= 0 ? [255, 106, 92] : [77, 166, 255];
  const k = Math.pow(Math.abs(t), 0.85);
  const rgb = neutral.map((n, i) => Math.round(n + (target[i] - n) * k));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** Annular sector path (for the radial fingerprint). Angles in degrees, 0 = up, clockwise. */
export function sectorPath(cx, cy, r0, r1, a0, a1) {
  const rad = (deg) => ((deg - 90) * Math.PI) / 180;
  const p = (r, a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r1},${r1} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
    + `L${x2.toFixed(2)},${y2.toFixed(2)}A${r0},${r0} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)}Z`;
}

// ---------------------------------------------------------------- V3 data colours (data marks + legends only)

const RAMPS = {
  heat: { up: "warm", down: "cool" },
  water: { up: "wet", down: "dry" },
};

/** Which data ramp suits a variable: heat (°C/K/°F), water (rain, humidity, soil) or a neutral grey pair. */
export function rampFamily(unit, variable) {
  const text = `${unit ?? ""} ${variable?.group ?? ""} ${variable?.id ?? ""} ${typeof variable === "string" ? variable : ""}`.toLowerCase();
  if (/°c|°f|\bk\b|temp|heat|t2m/.test(text)) return "heat";
  if (/mm\/|g\/kg|kg\/m|water|rain|humid|soil|prec|evap|snow/.test(text)) return "water";
  return "neutral";
}

/** Colour for "above / below" marks (anomaly bars, stripes, fingerprint wedges), as a CSS var. */
export function directionColor(sign, family = "heat", step = 3) {
  if (!sign) return "var(--data-neutral)";
  if (family === "neutral") return sign > 0 ? "var(--data-cloud-3)" : "var(--data-neutral)";
  const ramp = RAMPS[family] ?? RAMPS.heat;
  return `var(--data-${sign > 0 ? ramp.up : ramp.down}-${step})`;
}

/** Stepped diverging colour (4 steps each way, neutral near zero), as a `--data-*` CSS var. */
export function rampColor(value, maxAbs, family = "heat") {
  if (!maxAbs || !Number.isFinite(value)) return "var(--data-neutral)";
  const t = Math.min(1, Math.abs(value) / maxAbs);
  if (t < 0.08) return "var(--data-neutral)";
  const step = Math.min(4, Math.max(1, Math.ceil(t * 4)));
  return directionColor(Math.sign(value), family, step);
}

// ---------------------------------------------------------------- log axis

/**
 * Whether a log y-axis may be used for these plotted values. Log needs every value > 0; otherwise the toggle is
 * disabled with a plain reason. Ignores null / non-finite gaps.
 */
export function logAxisGuard(values) {
  const finite = [...values].filter((v) => v != null && Number.isFinite(v));
  if (finite.length === 0) return { ok: false, reason: "There are no values to plot." };
  const bad = finite.filter((v) => v <= 0).length;
  if (bad > 0) {
    return {
      ok: false,
      reason: `A log scale needs every value above zero; ${bad} plotted value${bad === 1 ? " is" : "s are"} zero or below.`,
    };
  }
  return { ok: true, reason: "" };
}

/** Log10 scale with the same call shape as linearScale. Domain must be > 0. */
export function logScale(d0, d1, r0, r1) {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const k = (r1 - r0) / (l1 - l0 || 1);
  const scale = (v) => r0 + (Math.log10(Math.max(v, Number.MIN_VALUE)) - l0) * k;
  scale.invert = (px) => Math.pow(10, l0 + (px - r0) / k);
  scale.domain = [d0, d1];
  scale.log = true;
  return scale;
}

/** Ticks for a log axis: powers of ten, plus 2x and 5x steps when the range spans few decades. */
export function logTicks(min, max) {
  if (!(min > 0) || !(max > min)) return [min];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const mults = hi - lo <= 2 ? [1, 2, 5] : [1];
  const ticks = [];
  for (let e = lo; e <= hi; e += 1) {
    for (const m of mults) {
      const v = Number((m * Math.pow(10, e)).toPrecision(12));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) ticks.push(v);
    }
  }
  if (ticks.length < 2) return niceTicks(min, max, 4).filter((v) => v > 0);
  return ticks;
}

/** Turn a chart title into a safe file-name stem: "Air temperature, Paris" -> "air-temperature-paris". */
export function slugify(text, fallback = "chart") {
  const s = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return s || fallback;
}

// ---------------------------------------------------------------- chart specs (what the ChartViewer draws)

/**
 * A ChartSpec describes the plotted backend values of one chart so the shared ChartViewer can redraw, convert and
 * export it. Shape:
 *   { title, source, unit, variable, delta, convertible, xLabel, xKind: "year" | "time" | "month" | "index",
 *     series: [{ id, label, type: "line" | "points" | "bars" | "band", style, data: [{ x, y, lo, hi, label, note, color }] }],
 *     markers: [{ x, label }], thresholds: [{ y, label }], forecastFrom, zeroLine, yLabel }
 * `delta: true` marks differences / anomalies / slopes (unit conversion drops the °F offset); a series may override it.
 * `convertible: false` (z-scores) disables unit conversion. `note` strings (p-values, grades) are shown verbatim.
 */
export function chartSpec(spec) {
  return {
    title: "Chart",
    source: "",
    unit: "",
    delta: false,
    convertible: true,
    xLabel: "Year",
    xKind: "year",
    markers: [],
    thresholds: [],
    ...spec,
    series: (spec.series ?? []).filter((s) => s && s.data && s.data.length),
  };
}

/** Every finite y / lo / hi value a spec plots (for extents and the log-axis guard). */
export function specYValues(spec) {
  const out = [];
  for (const s of spec.series) {
    for (const d of s.data) {
      for (const v of s.type === "band" ? [d.lo, d.hi] : [d.y]) if (v != null && Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

export function specXValues(spec) {
  const out = [];
  for (const s of spec.series) for (const d of s.data) if (Number.isFinite(d.x)) out.push(d.x);
  return out;
}

/**
 * Copy of `spec` with every plotted y / lo / hi (and threshold) shown in unit `to`. Display only: `note` strings
 * (p-values, grades) and x values are never touched. Returns the spec unchanged when no conversion applies.
 */
export function convertSpec(spec, to) {
  if (!to || !spec.convertible || to === spec.unit) return spec;
  const conv = (delta) => converter(spec.unit, to, { delta });
  const base = conv(Boolean(spec.delta));
  return {
    ...spec,
    unit: unitLabel(spec.unit, to),
    sourceUnit: spec.unit,
    series: spec.series.map((s) => {
      const f = s.delta == null ? base : conv(Boolean(s.delta));
      return { ...s, data: s.data.map((d) => ({ ...d, y: f(d.y), lo: f(d.lo), hi: f(d.hi) })) };
    }),
    thresholds: (spec.thresholds ?? []).map((t) => ({ ...t, y: base(t.y) })),
  };
}
