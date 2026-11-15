/**
 * Display-only unit conversions for the chart viewer (owner item 7).
 *
 * Rules (do not loosen these):
 *  - Conversions change the numbers drawn on a chart, its axis and its CSV export only. They are never applied to
 *    p-values, z-scores, significance, evidence grades, sample sizes or any text label returned by the backend.
 *  - A conversion is offered only where it is an exact linear relation (or is clearly labelled approximate:
 *    mm/day -> mm/month uses an average month of 30.44 days).
 *  - Absolute temperatures use the full affine conversion (degF = degC * 1.8 + 32, K = degC + 273.15).
 *    Differences, anomalies and slopes ("per decade", "vs average") are *deltas*: only the scale factor applies
 *    (a 1 degC/decade trend is 1.8 degF/decade and 1 K/decade). Pass `{ delta: true }` for those.
 *  - Scale-only families (rain, sunlight, wind, pressure) have no offset, so delta and absolute values convert alike.
 *
 * Each unit is defined by `factor` and `offset` relative to its family base: display = base * factor + offset.
 */

export const UNIT_FAMILIES = {
  temperature: {
    base: "°C",
    units: [
      { id: "°C", label: "°C", factor: 1, offset: 0 },
      { id: "°F", label: "°F", factor: 1.8, offset: 32 },
      { id: "K", label: "K", factor: 1, offset: 273.15 },
    ],
  },
  rate: {
    base: "mm/day",
    units: [
      { id: "mm/day", label: "mm/day", factor: 1, offset: 0 },
      { id: "mm/month", label: "mm/month (approx.)", factor: 30.44, offset: 0, approximate: true, note: "Uses an average month of 30.44 days." },
      { id: "in/day", label: "in/day", factor: 1 / 25.4, offset: 0 },
    ],
  },
  irradiance: {
    base: "W/m²",
    units: [
      { id: "W/m²", label: "W/m²", factor: 1, offset: 0 },
      { id: "kWh/m²/day", label: "kWh/m²/day", factor: 0.024, offset: 0 },
      { id: "MJ/m²/day", label: "MJ/m²/day", factor: 0.0864, offset: 0 },
    ],
  },
  speed: {
    base: "m/s",
    units: [
      { id: "m/s", label: "m/s", factor: 1, offset: 0 },
      { id: "km/h", label: "km/h", factor: 3.6, offset: 0 },
      { id: "mph", label: "mph", factor: 1 / 0.44704, offset: 0 },
    ],
  },
  pressure: {
    base: "kPa",
    units: [
      { id: "kPa", label: "kPa", factor: 1, offset: 0 },
      { id: "hPa", label: "hPa", factor: 10, offset: 0 },
    ],
  },
};

// Spellings the backend / older fixtures use, mapped to a unit id above.
const ALIASES = {
  "°c": "°C", "c": "°C", "degc": "°C", "deg c": "°C", "celsius": "°C", "℃": "°C",
  "°f": "°F", "f": "°F", "degf": "°F", "fahrenheit": "°F", "℉": "°F",
  "k": "K", "kelvin": "K",
  "mm/day": "mm/day", "mm/d": "mm/day", "mm day-1": "mm/day",
  "mm/month": "mm/month", "in/day": "in/day",
  "w/m²": "W/m²", "w/m2": "W/m²", "w/m^2": "W/m²", "w m-2": "W/m²",
  "kwh/m²/day": "kWh/m²/day", "kwh/m2/day": "kWh/m²/day", "kwh/m^2/day": "kWh/m²/day",
  "mj/m²/day": "MJ/m²/day", "mj/m2/day": "MJ/m²/day", "mj/m^2/day": "MJ/m²/day",
  "m/s": "m/s", "m s-1": "m/s", "km/h": "km/h", "kph": "km/h", "mph": "mph",
  "kpa": "kPa", "hpa": "hPa", "mb": "hPa", "mbar": "hPa",
};

const BY_ID = new Map();
for (const [family, def] of Object.entries(UNIT_FAMILIES)) {
  for (const u of def.units) BY_ID.set(u.id, { ...u, family });
}

/**
 * Split a backend unit string into a known unit id plus any trailing qualifier, e.g.
 * "°C vs 1951–1980" -> { id: "°C", suffix: " vs 1951–1980" }. Unknown units return { id: null }.
 */
export function parseUnit(unit) {
  if (unit == null) return { id: null, suffix: "", raw: "" };
  const raw = String(unit).trim();
  const direct = ALIASES[raw.toLowerCase()] ?? (BY_ID.has(raw) ? raw : null);
  if (direct) return { id: direct, suffix: "", raw };
  // Leading unit token followed by a qualifier ("°C vs 1951–1980", "mm/day per decade").
  const m = raw.match(/^(\S+)(\s.*)$/);
  if (m) {
    const id = ALIASES[m[1].toLowerCase()] ?? (BY_ID.has(m[1]) ? m[1] : null);
    if (id) return { id, suffix: m[2], raw };
  }
  return { id: null, suffix: "", raw };
}

export function unitInfo(id) {
  return BY_ID.get(id) ?? null;
}

/** The units a value in `unit` may be shown in (including itself), or [] when no exact conversion exists. */
export function unitOptions(unit) {
  const { id } = parseUnit(unit);
  const info = id && BY_ID.get(id);
  if (!info) return [];
  return UNIT_FAMILIES[info.family].units;
}

/**
 * A function converting numbers from `from` to `to`. `delta: true` for differences, anomalies and slopes
 * (drops the offset). Returns the identity when the units match or are not convertible.
 */
export function converter(from, to, { delta = false } = {}) {
  const a = BY_ID.get(parseUnit(from).id);
  const b = BY_ID.get(parseUnit(to).id);
  if (!a || !b || a.family !== b.family || a.id === b.id) return (v) => v;
  const k = b.factor / a.factor;
  const shift = delta ? 0 : b.offset - a.offset * k;
  return (v) => (v == null || !Number.isFinite(v) ? v : v * k + shift);
}

export function convertValue(v, from, to, opts) {
  return converter(from, to, opts)(v);
}

/** Slopes (per year / per decade) are deltas: the scale factor only, never the °F +32 offset. */
export function convertSlope(v, from, to) {
  return converter(from, to, { delta: true })(v);
}

/** Display label for `to`, keeping the original qualifier ("°F vs 1951–1980"). */
export function unitLabel(original, to) {
  const { id, suffix, raw } = parseUnit(original);
  if (!id || !to || to === id) return raw;
  return `${to}${suffix}`;
}

/** True when converting `from` -> `to` is approximate (shown next to the axis label). */
export function isApproximate(from, to) {
  const a = BY_ID.get(parseUnit(from).id);
  const b = BY_ID.get(parseUnit(to).id);
  if (!a || !b || a.id === b.id) return false;
  return Boolean(a.approximate || b.approximate);
}
