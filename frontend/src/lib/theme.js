/**
 * The single V2 "mission" theme. The CSS tokens live in styles/theme.css; this file holds the static fallback of the
 * colours that JavaScript draws (map dots, pins, the globe's land and sea, the stars) for code and tests with no DOM.
 * Values match the :root token block in theme.css (V2 visual spec, section 2.2).
 *
 * The theme switch was removed (spec Q2). The old ids "nebula" and "classic" still resolve, to the mission theme, so a
 * stored V1 preference never breaks anything.
 */
export const THEMES = {
  mission: {
    label: "Mission",
    colors: { a: "#b3a1ff", b: "#ff8fd6" },
    accentRgb: "179,161,255",
    globe: {
      atmosphere: "110,160,255",
      oceanA: "#12356b",
      oceanB: "#061226",
      flatOcean: "#0a1a36",
      land: "#1b3555",
      coast: "rgba(159, 196, 255, 0.60)",
      border: "rgba(159, 196, 255, 0.16)",
      grid: "rgba(125, 160, 230, 0.10)",
    },
  },
};

/** Data colours drawn by JavaScript. They never change with any interface theme. */
export const DATA_COLORS = { up: "#ff7a5c", down: "#5ab4ff", flat: "#9aa4b8", failed: "#8c97b0" };

export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = "mission";

/** The theme for an id; anything unknown (including the retired V1 themes) falls back to the default. */
export const themeOf = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME];

/** The id after `id` in the cycle of themes (with one theme, always the mission theme). */
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

/** Kept for main.jsx: there is only one theme now. */
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
