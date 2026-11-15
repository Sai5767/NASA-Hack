/**
 * Colour themes. The CSS tokens live in styles/theme.css (selected by `data-theme` on <html>); this file holds the
 * colours that are drawn by JavaScript instead: map dots, pins, the globe's land and sea, and the stars.
 *
 * "nebula" is the default (violet); "classic" is the original cyan HUD.
 */
export const THEMES = {
  nebula: {
    label: "Nebula",
    colors: { a: "#b49bff", b: "#5ee6c4" },
    accentRgb: "180,155,255",
    globe: {
      atmosphere: "180,155,255",
      oceanA: "#25235f",
      oceanB: "#07061a",
      flatOcean: "#0b0a26",
      land: "#3b3979",
      coast: "rgba(200, 185, 255, 0.62)",
      border: "rgba(190, 175, 255, 0.17)",
      grid: "rgba(160, 145, 255, 0.11)",
    },
  },
  classic: {
    label: "Classic",
    colors: { a: "#4dffd9", b: "#ff6bd5" },
    accentRgb: "77,255,217",
    globe: {
      atmosphere: "77,255,217",
      oceanA: "#143a78",
      oceanB: "#050a1c",
      flatOcean: "#07102a",
      land: "#16486e",
      coast: "rgba(130, 215, 255, 0.62)",
      border: "rgba(150, 205, 255, 0.17)",
      grid: "rgba(110, 165, 255, 0.11)",
    },
  },
};

export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = "nebula";

/** The theme for an id; anything unknown falls back to the default. */
export const themeOf = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME];

/** The id after `id` in the cycle of themes. */
export function nextTheme(id) {
  const i = THEME_IDS.indexOf(id);
  return THEME_IDS[(i < 0 ? 0 : i + 1) % THEME_IDS.length];
}

/** Put the theme on <html> so the CSS tokens switch. Safe to call before React renders. */
export function applyTheme(id) {
  try {
    document.documentElement.dataset.theme = THEMES[id] ? id : DEFAULT_THEME;
  } catch {
    /* no document (tests) */
  }
}

/** The theme saved in this browser, or the default. */
export function savedTheme() {
  try {
    const stored = JSON.parse(window.localStorage.getItem("td-theme"));
    return THEMES[stored] ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
