/**
 * The single V3 "Quiet Earth" theme. The tokens live in styles/theme.css (the one source of truth); this file holds the
 * static mirror of the colours JavaScript draws (map dots, pins, the globe's land and sea) for code and tests with no DOM.
 * See docs/V3_QUIET_EARTH_VISUAL_SPEC.md.
 *
 * There is no theme picker. The id "mission" and the retired ids ("nebula", "classic", anything unknown) all resolve to
 * the one theme, and every V2 export is kept so existing imports keep working.
 */
export const THEMES = {
  mission: {
    label: "Quiet Earth",
    // a = pin A / primary marker (--accent, now white); b = pin B / live (--live, now silver). Interface is monochrome.
    colors: { a: "#f2f2f2", b: "#a3a3a3" },
    accentRgb: "242,242,242",
    // Earth exceptions (spec 3B): natural ocean, muted land, a subtle blue rim. Inside the globe only.
    globe: {
      atmosphere: "120,170,230",
      oceanA: "#1d4a72",
      oceanB: "#061525",
      flatOcean: "#0a2236",
      land: "#3f5236",
      coast: "rgba(225, 232, 225, 0.26)",
      border: "rgba(255, 255, 255, 0.07)",
      grid: "rgba(255, 255, 255, 0.035)",
      limb: "rgba(150, 190, 235, 0.30)",
    },
  },
};

/** Data colours drawn by JavaScript (data layers and their legends only; UI arrows are monochrome --trend-*). */
export const DATA_COLORS = { up: "#d08455", down: "#6f9fc9", flat: "#7a7a7a", failed: "#8c8c8c" };

/**
 * Saved-pin palette (owner feedback item 10): never news red/amber/green, always drawn with a label and pin glyph.
 * Mirrors --pin-1..--pin-6 in theme.css. `outline` is the ring colour to draw around the marker.
 */
export const PIN_COLORS = [
  { id: "snow", label: "Snow", hex: "#f5f5f5", outline: "#050505" },
  { id: "silver", label: "Silver", hex: "#a3a3a3", outline: "#050505" },
  { id: "ice", label: "Ice", hex: "#9fd3f0", outline: "#050505" },
  { id: "lavender", label: "Lavender", hex: "#c4b5fd", outline: "#050505" },
  { id: "sand", label: "Sand", hex: "#d6c7a1", outline: "#050505" },
  { id: "graphite", label: "Graphite", hex: "#5c5c5c", outline: "#ffffff" },
];

/** News attention colours (verified markers: outline/glyph/leader only). Mirrors --news-* in theme.css. */
export const NEWS_COLORS = { low: "#4cc38a", medium: "#f5b83d", high: "#f2555a", unverified: "#8c8c8c" };

export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = "mission";

/** The theme for an id; anything unknown (including the retired V1 themes) falls back to the default. */
export const themeOf = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME];

/** Kept for compatibility: with one theme the "next" theme is always the same one. */
export function nextTheme(id) {
  const i = THEME_IDS.indexOf(id);
  return THEME_IDS[(i < 0 ? 0 : i + 1) % THEME_IDS.length];
}

/** Put the theme on <html>. Safe to call before React renders. */
export function applyTheme(id) {
  try {
    document.documentElement.dataset.theme = THEMES[id] ? id : DEFAULT_THEME;
  } catch {
    /* no document (tests) */
  }
}

/** Kept for main.jsx: there is only one theme. */
export const savedTheme = () => DEFAULT_THEME;

/** Reflect the in-app "Reduce motion" preference on <html> so motion.css can switch animation off. */
export function applyMotionPref(reduced) {
  try {
    if (reduced) document.documentElement.dataset.motion = "reduced";
    else delete document.documentElement.dataset.motion;
  } catch {
    /* no document (tests) */
  }
}

/** True when the OS asks for reduced motion or the user switched it on in Account. */
export function motionReduced() {
  try {
    return document.documentElement.dataset.motion === "reduced" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
