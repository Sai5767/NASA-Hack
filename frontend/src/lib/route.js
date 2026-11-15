/**
 * Page state in the URL hash, so browser back/forward move between Main and Explore and between Explore tools.
 *
 * Rule (spec 1.1): a change of page, or of Explore tool (or of the tool opened alongside it), pushes a history entry;
 * a change of parameters (place, variable, years, the second Duel pin) replaces the current entry. The hash format is
 * lib/share.js's, so old shared links still open. Two V3 additions live only here:
 *   t=ask            the Ask tool (share.js does not know it; routeFromHash restores it)
 *   with=<tool id>   a second tool open alongside the first, e.g. #p=explore&t=duel&with=scan (owner item 13)
 */
import { decodeState, encodeState } from "./share.js";

/**
 * Explore tools in tab order, grouped (plan 4.5, owner item 13). `investigate` is the full statistical case file.
 * `group` is one of EXPLORE_GROUPS' ids; `hint` is the tab's tooltip.
 */
export const EXPLORE_TABS = [
  { id: "investigate", label: "Case file", group: "place", hint: "Every check behind one place's trend" },
  { id: "sweep", label: "Sweep", group: "place", hint: "Every variable at this place, ranked" },
  { id: "scan", label: "Scan a region", group: "place", hint: "Is the change the same all around the pin?" },
  { id: "saved", label: "Saved", group: "place", hint: "Your saved pins and their scans" },
  { id: "duel", label: "Duel", group: "compare", hint: "Two places, one variable" },
  { id: "world", label: "World", group: "compare", hint: "Sample sites around the planet" },
  { id: "vitals", label: "Vitals", group: "compare", hint: "Planet-wide records" },
  { id: "ledger", label: "Ledger", group: "compare", hint: "Every trend tested, ranked by evidence" },
  { id: "events", label: "Events", group: "compare", hint: "Famous heat waves, droughts and floods" },
  { id: "ask", label: "Ask", group: "compare", hint: "Type a question; we pick the place and variable" },
  { id: "learn", label: "Learn", group: "learn", hint: "Guided cases, glossary and how it works" },
];
export const EXPLORE_GROUPS = [
  { id: "place", label: "Place tools" },
  { id: "compare", label: "Compare & context" },
  { id: "learn", label: "Learn" },
];
export const EXPLORE_TAB_IDS = EXPLORE_TABS.map((t) => t.id);
export const tabsInGroup = (group) => EXPLORE_TABS.filter((t) => t.group === group);
export const tabLabel = (id) => EXPLORE_TABS.find((t) => t.id === id)?.label ?? id;

/** Tools that only this module knows (share.js validates its own list). */
const ROUTE_ONLY_TABS = ["ask"];

/** The tool Explore opens on the first time: the case file reuses the trend Main already loaded, so the flip costs no request. */
export const DEFAULT_EXPLORE_TAB = "investigate";

/**
 * Which tools may be open together. All pairs here share the one active pin A and the app's params and fit on one
 * globe: Scan draws its grid around pin A; Duel adds pin B; the case file and Sweep need no globe layer of their own.
 */
const COMPATIBLE = {
  scan: ["duel", "investigate", "sweep"],
  duel: ["scan", "investigate"],
  investigate: ["scan", "duel"],
  sweep: ["scan"],
};
/** Why a tool cannot be opened alongside another (shown as the disabled control's reason). */
const SOLO_REASON = {
  world: "World draws sample sites over the whole globe, so it can't share the globe with a pinned place.",
  vitals: "Vitals shows planet-wide records, not a place, so there is nothing to pair it with.",
  ledger: "The ledger covers every sample place at once; open it on its own.",
  events: "Events moves the globe to each event's place, which would fight the other tool's pin.",
  ask: "Ask chooses a new place, so it opens on its own.",
  learn: "Learn is reading material; open it on its own.",
  saved: "Saved opens a pin; open it on its own, then pick a tool.",
};

/** { ok, reason } for opening `other` alongside `tab`. */
export function canCombine(tab, other) {
  if (!other || other === tab) return { ok: false, reason: "That tool is already open." };
  if (COMPATIBLE[tab]?.includes(other)) return { ok: true, reason: "" };
  const reason = SOLO_REASON[other] ?? SOLO_REASON[tab] ?? `${tabLabel(other)} and ${tabLabel(tab)} can't share the globe.`;
  return { ok: false, reason };
}
/** The tools that may be opened alongside `tab` (in tab order). */
export const companionsOf = (tab) => EXPLORE_TAB_IDS.filter((id) => COMPATIBLE[tab]?.includes(id));
/** Every tool open in a route, primary first. */
export const openTools = (route) => (route?.also ? [route.tab, route.also] : [route?.tab]).filter(Boolean);
/** True when `id` is open in the route, as the primary tool or alongside it. */
export const isOpen = (route, id) => route?.tab === id || route?.also === id;
const usesPinB = (tab, also) => tab === "duel" || also === "duel";

const DEFAULT_ROUTE = { page: "main", tab: "investigate", params: null, pinB: null, also: null };

function readExtras(hash) {
  try {
    const q = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
    return { t: q.get("t"), with: q.get("with") };
  } catch {
    return { t: null, with: null };
  }
}

/** The route a hash describes, always complete (defaults fill anything missing or invalid). */
export function routeFromHash(hash) {
  const extra = readExtras(hash);
  const routeOnly = ROUTE_ONLY_TABS.includes(extra.t) ? extra.t : null;
  // share.js only knows its own tool ids, so a route-only tool is decoded as "learn" (same shape: no pin B) and restored.
  const source = routeOnly ? String(hash ?? "").replace(/([#&]|^)t=ask(?=&|$)/, "$1t=learn") : hash;
  const s = decodeState(source);
  if (!s) return { ...DEFAULT_ROUTE };
  // Main always shows the case-file question; a Main link with a tool id is normalised.
  const page = routeOnly && !/(^|[#&])p=main(&|$)/.test(String(hash)) ? "explore" : s.page;
  const tab = page === "main" ? "investigate" : routeOnly ?? s.tab;
  const also = page === "explore" && extra.with && canCombine(tab, extra.with).ok ? extra.with : null;
  return { page, tab, params: s.params, pinB: usesPinB(tab, also) ? s.pinB : null, also };
}

/** The hash for a route ("" for a bare Main page, so the opening URL stays clean). */
export function hashFromRoute({ page, tab, params, pinB, also = null }) {
  if (page === "main" && !params) return "";
  const t = page === "main" ? "investigate" : tab;
  const a = page === "explore" && also && canCombine(t, also).ok ? also : null;
  const base = encodeState({ page, tab: t, params, pinB: usesPinB(t, a) ? pinB : null });
  return a ? `${base}&with=${a}` : base;
}

/** "push" when the page or Explore tool(s) changed, "replace" when only the parameters changed, "none" when nothing did. */
export function historyMode(prev, next) {
  if (!prev) return "replace";
  if (prev.page !== next.page) return "push";
  if (next.page === "explore" && (prev.tab !== next.tab || (prev.also ?? null) !== (next.also ?? null))) return "push";
  return hashFromRoute(prev) === hashFromRoute(next) ? "none" : "replace";
}

/** Direction of the page-flip motion: towards Explore slides left, back to Main slides right. */
export const flipDirection = (from, to) => (from === to ? "none" : to === "explore" ? "forward" : "back");
