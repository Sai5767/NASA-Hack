/**
 * Design tokens for canvas code: canvas must not hard-code colours, so it reads the CSS custom properties of
 * styles/theme.css (the one source of truth, docs/V3_QUIET_EARTH_VISUAL_SPEC.md) once per mount and caches them.
 * FALLBACK mirrors theme.css for tests and for a page whose stylesheet has not loaded yet. Keep the two in sync.
 */

export const FALLBACK = {
  // Interface (black / white / neutral grey)
  "--bg": "#050505",
  "--surface": "#0e0e0e",
  "--border": "#2a2a2a",
  "--border-control": "#6b6b6b",
  "--white": "#ffffff",
  "--text": "#f2f2f2",
  "--text-dim": "#b3b3b3",
  "--text-faint": "#8c8c8c",
  "--text-on-light": "#050505",
  "--focus-ring": "#ffffff",
  "--trend-up": "#f2f2f2",
  "--trend-down": "#f2f2f2",
  "--trend-flat": "#8c8c8c",
  "--evidence-on": "#f2f2f2",
  "--evidence-off": "#3d3d3d",
  "--star": "#d9d9d9",
  // Earth exceptions (inside the globe only)
  "--earth-ocean-lit": "#1d4a72",
  "--earth-ocean-dark": "#061525",
  "--earth-flat-ocean": "#0a2236",
  "--earth-land": "#3f5236",
  "--earth-land-dry": "#6e6146",
  "--earth-ice": "#e6ebee",
  // Data scales (data layer + legend only)
  "--data-warm-1": "#efd8b8",
  "--data-warm-2": "#e2b182",
  "--data-warm-3": "#d08455",
  "--data-warm-4": "#c0654a",
  "--data-cool-1": "#cadcea",
  "--data-cool-2": "#9cbfdd",
  "--data-cool-3": "#6f9fc9",
  "--data-cool-4": "#4a7fb5",
  "--data-neutral": "#7a7a7a",
  "--data-wet-1": "#c3e0dd",
  "--data-wet-2": "#8cc3bf",
  "--data-wet-3": "#5aa3a0",
  "--data-wet-4": "#3f8a8c",
  "--data-dry-1": "#e8dcc0",
  "--data-dry-2": "#cdb88a",
  "--data-dry-3": "#ad935e",
  "--data-dry-4": "#93804e",
  "--data-cloud-1": "#8a8a8a",
  "--data-cloud-2": "#adadad",
  "--data-cloud-3": "#d0d0d0",
  "--data-cloud-4": "#f0f0f0",
  "--text-on-data": "#050505",
  "--missing-fg": "#8c8c8c",
  "--forecast-line": "#e6e6e6",
  "--cell-stroke": "#f2f2f2",
  // News attention (verified marker outline / glyph / leader only)
  "--news-green": "#4cc38a",
  "--news-amber": "#f5b83d",
  "--news-red": "#f2555a",
  "--news-unverified": "#8c8c8c",
  // Saved-pin palette
  "--pin-1": "#f5f5f5",
  "--pin-2": "#a3a3a3",
  "--pin-3": "#9fd3f0",
  "--pin-4": "#c4b5fd",
  "--pin-5": "#d6c7a1",
  "--pin-6": "#5c5c5c",
  // Legacy names still read by canvas code (re-pointed to V3 values)
  "--accent": "#f2f2f2",
  "--live": "#a3a3a3",
  "--up": "#d08455",
  "--down": "#6f9fc9",
  "--flat": "#7a7a7a",
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
