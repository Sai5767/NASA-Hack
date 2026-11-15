/**
 * Page state in the URL hash, so browser back/forward move between Main and Explore and between Explore tools.
 *
 * Rule (spec 1.1): a change of page, or of Explore tool, pushes a history entry; a change of parameters (place, variable,
 * years, the second Duel pin) replaces the current entry. The hash format is lib/share.js's, so old shared links still open.
 */
import { decodeState, encodeState } from "./share.js";

/** Explore tools in tab order. `investigate` is shown as "Detail" (the full statistical case file). */
export const EXPLORE_TABS = [
  { id: "sweep", label: "Sweep" },
  { id: "scan", label: "Scan" },
  { id: "duel", label: "Duel" },
  { id: "world", label: "World" },
  { id: "vitals", label: "Vitals" },
  { id: "ledger", label: "Ledger" },
  { id: "events", label: "Events" },
  { id: "investigate", label: "Detail", divider: true },
  { id: "learn", label: "Learn" },
];
/** The tool Explore opens on the first time: Detail reuses the trend Main already loaded, so the flip costs no request. */
export const DEFAULT_EXPLORE_TAB = "investigate";

const DEFAULT_ROUTE = { page: "main", tab: "investigate", params: null, pinB: null };

/** The route a hash describes, always complete (defaults fill anything missing or invalid). */
export function routeFromHash(hash) {
  const s = decodeState(hash);
  if (!s) return { ...DEFAULT_ROUTE };
  // Main always shows the case-file question; a Main link with a tool id is normalised.
  const tab = s.page === "main" ? "investigate" : s.tab;
  return { page: s.page, tab, params: s.params, pinB: tab === "duel" ? s.pinB : null };
}

/** The hash for a route ("" for a bare Main page, so the opening URL stays clean). */
export function hashFromRoute({ page, tab, params, pinB }) {
  if (page === "main" && !params) return "";
  return encodeState({ page, tab: page === "main" ? "investigate" : tab, params, pinB: tab === "duel" ? pinB : null });
}

/** "push" when the page or Explore tool changed, "replace" when only the parameters changed, "none" when nothing did. */
export function historyMode(prev, next) {
  if (!prev) return "replace";
  if (prev.page !== next.page) return "push";
  if (next.page === "explore" && prev.tab !== next.tab) return "push";
  return hashFromRoute(prev) === hashFromRoute(next) ? "none" : "replace";
}

/** Direction of the page-flip motion: towards Explore slides left, back to Main slides right. */
export const flipDirection = (from, to) => (from === to ? "none" : to === "explore" ? "forward" : "back");
