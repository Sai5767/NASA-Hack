/**
 * Design tokens for canvas code (spec 2.1): canvas must not hard-code colours, so it reads the CSS custom properties
 * once per mount and caches them. FALLBACK mirrors the spec 2.2 token block, for tests and for a page whose stylesheet
 * has not loaded yet.
 */

export const FALLBACK = {
  "--data-warm-1": "#f7dc8f",
  "--data-warm-2": "#f9b54a",
  "--data-warm-3": "#f77f35",
  "--data-warm-4": "#ff5340",
  "--data-cool-1": "#a6e3f2",
  "--data-cool-2": "#5cc0f5",
  "--data-cool-3": "#5a9dff",
  "--data-cool-4": "#5683ff",
  "--data-neutral": "#9aa4b8",
  "--data-wet-1": "#a5ecd9",
  "--data-wet-2": "#4fd1b5",
  "--data-wet-3": "#25b3a3",
  "--data-wet-4": "#1a9c93",
  "--data-dry-1": "#ead9b0",
  "--data-dry-2": "#d1ac6b",
  "--data-dry-3": "#bd8a47",
  "--data-dry-4": "#a8733a",
  "--data-cloud-1": "#aab4c8",
  "--data-cloud-2": "#c5cddc",
  "--data-cloud-3": "#dfe5ef",
  "--data-cloud-4": "#ffffff",
  "--missing-fg": "#8c97b0",
  "--forecast-line": "#e9e4ff",
  "--text-dim": "#aab6d3",
  "--text-faint": "#8c99ba",
  "--text-on-data": "#05070d",
  "--accent": "#b3a1ff",
  "--live": "#ff8fd6",
  "--up": "#ff7a5c",
  "--down": "#5ab4ff",
  "--flat": "#9aa4b8",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Read every token in FALLBACK from the document (only 6-digit hex values are accepted; anything else falls back). */
export function readTokens(doc = typeof document !== "undefined" ? document : null) {
  const out = { ...FALLBACK };
  if (!doc?.documentElement || typeof getComputedStyle !== "function") return out;
  const style = getComputedStyle(doc.documentElement);
  for (const name of Object.keys(FALLBACK)) {
    const v = style.getPropertyValue(name).trim();
    if (HEX.test(v)) out[name] = v.toLowerCase();
  }
  return out;
}

export function hexToRgb(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgba = (hex, alpha) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, s)) * 255);
};

/** Blend two #rrggbb colours in linear RGB (spec 4.4: display transition only). t is clamped to [0, 1]. */
export function mixLinear(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgb(a).map(toLinear);
  const [br, bg, bb] = hexToRgb(b).map(toLinear);
  const parts = [ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k].map(toSrgb);
  return `#${parts.map((p) => p.toString(16).padStart(2, "0")).join("")}`;
}
