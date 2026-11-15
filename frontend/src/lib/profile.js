/**
 * Who the user is and what they care about. Everything here is stored in the browser only (localStorage);
 * nothing about the user is ever sent to the server.
 */
import { CASES, INTAKE_PLACES, INTAKE_TOPICS } from "./cases.js";

/** Question 1: who is investigating. `level` is the default detail level that person is likely to want. */
export const WHO = [
  { id: "curious", label: "Just curious", hint: "I like finding things out", level: "plain" },
  { id: "student", label: "A student", hint: "Learning how climate data works", level: "balanced" },
  { id: "educator", label: "A teacher or communicator", hint: "I explain this to other people", level: "balanced" },
  { id: "analyst", label: "A scientist or analyst", hint: "Show me the statistics", level: "technical" },
];

/** Question 4: how technical to be. */
export const LEVELS = [
  { id: "plain", label: "Plain words", hint: "Headlines first, the technical detail tucked away" },
  { id: "balanced", label: "A bit of both", hint: "An overview first, the evidence one click away" },
  { id: "technical", label: "Show me the numbers", hint: "Open on the detailed evidence" },
];

/** Question 5: what to do first. */
export const GOALS = [
  { id: "explore", label: "Explore what is changing near me", hint: "Open a case file for your places" },
  { id: "check", label: "Check a claim", hint: "Type a question such as \"is Phoenix getting hotter?\"" },
  { id: "compare", label: "Compare two places", hint: "Open the Duel" },
  { id: "forecast", label: "See what might come next", hint: "Open the forecast lab" },
  { id: "learn", label: "Learn how the evidence works", hint: "Open the glossary and explainer" },
];

const FAMILIES = {
  heat: { variables: ["T2M", "T2M_MAX", "T2M_MIN"] },
  rain: { variables: ["PRECTOTCORR"] },
  sun: { variables: ["ALLSKY_SFC_SW_DWN", "CLOUD_AMT"] },
  wind: { variables: ["WS2M"] },
  humid: { variables: ["QV2M", "TQV", "RH2M"] },
  soil: { variables: ["GWETROOT"] },
};

/** Question 2: topics. Each carries the variables and guided cases that count as a match. */
export const TOPICS = [
  ...INTAKE_TOPICS.map((t) => ({ ...t, variables: FAMILIES[t.id]?.variables ?? [t.variable], caseIds: [] })),
  { id: "poles", label: "Ice and the poles", hint: "Polar warming and sea ice", variable: "T2M", variables: [], caseIds: ["poles", "alaska", "vitals"] },
];

export const DEFAULT_PROFILE = { done: false, who: null, interests: [], places: [], level: "balanced", goal: "explore" };

/** The Overview/Detail view a person starts in, unless they have chosen one themselves. */
export const defaultView = (profile) => (profile?.level === "technical" ? "detail" : "overview");

const topicById = (id) => TOPICS.find((t) => t.id === id);
const placeById = (id) => INTAKE_PLACES.find((p) => p.id === id);

export const topicMatchesCase = (topic, c) => topic.caseIds.includes(c.id) || (topic.id !== "poles" && topic.variables.includes(c.variable));

const caseSuggestion = (c, reason) => ({ id: `case:${c.id}`, kind: "case", title: c.codename, why: c.question, reason, case: c });

/**
 * Suggestions for the "For you" pop-ups, best first: the user's places crossed with their topics, then guided
 * cases that match a topic, then the general starters. The goal moves its matching case to the front.
 */
export function suggest(profile, { limit = 3 } = {}) {
  const topics = (profile?.interests ?? []).map(topicById).filter(Boolean);
  const places = (profile?.places ?? []).map(placeById).filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (s) => {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  };

  for (const t of topics) {
    for (const p of places) {
      add({
        id: `${t.id}@${p.id}`,
        kind: "place",
        title: `${t.label} near ${p.hint}`,
        why: `How is ${t.hint.toLowerCase()} changing around ${p.hint}?`,
        reason: `You picked ${t.label.toLowerCase()} and ${p.label.toLowerCase()}.`,
        open: { variable: t.variable, lat: p.lat, lon: p.lon, name: p.hint },
      });
    }
  }
  for (const t of topics) {
    for (const c of CASES) if (topicMatchesCase(t, c)) add(caseSuggestion(c, `Matches your interest in ${t.label.toLowerCase()}.`));
  }
  for (const c of CASES) add(caseSuggestion(c, "A good place to start."));

  const wanted = { compare: (c) => c.tab === "duel", forecast: (c) => c.id === "forecast" }[profile?.goal];
  if (wanted) {
    const i = out.findIndex((s) => s.kind === "case" && wanted(s.case));
    if (i > 0) out.unshift(...out.splice(i, 1));
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- watchlist

export const WATCH_LIMIT = 8;
const round = (n, d = 2) => Math.round(Number(n) * 10 ** d) / 10 ** d;

/** A watch item is a place plus a variable. Its id merges places that round to the same 0.1 degree. */
export const watchId = (w) => `${w.variable}@${Number(w.lat).toFixed(1)},${Number(w.lon).toFixed(1)}`;

export const hasWatch = (list, item) => list.some((w) => w.id === watchId(item));

export function addWatch(list, item) {
  const id = watchId(item);
  if (list.some((w) => w.id === id)) return list;
  const entry = { id, variable: item.variable, lat: round(item.lat), lon: round(item.lon), name: item.name };
  return [entry, ...list].slice(0, WATCH_LIMIT);
}

export const removeWatch = (list, id) => list.filter((w) => w.id !== id);

export const toggleWatch = (list, item) => (hasWatch(list, item) ? removeWatch(list, watchId(item)) : addWatch(list, item));
