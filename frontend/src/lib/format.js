export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const round2 = (n) => Math.round(n * 100) / 100;
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A number with about `digits` significant digits, without exponent noise. */
export function sig(v, digits = 3) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const n = Number(v.toPrecision(digits));
  if (Math.abs(n) >= 1e6) return n.toExponential(2);
  return String(n);
}

/** Like sig(), but with an explicit + for positive values. */
export function signed(v, digits = 3) {
  const s = sig(v, digits);
  return v > 0 ? `+${s}` : s;
}

export function formatP(p) {
  if (p == null || !Number.isFinite(p)) return "—";
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

export function formatLat(lat) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
}

export function formatLon(lon) {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

export function formatPlace(lat, lon) {
  return `${formatLat(lat)} ${formatLon(lon)}`;
}

/** Arrow glyph for the sign of a trend. */
export const arrow = (sign) => (sign === "up" ? "▲" : sign === "down" ? "▼" : "▬");
