import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markersFor, SEVERITY_GLYPH } from "../src/lib/globeNews.js";
import { CYCLE, createCycle, isEligible, pickNext, stepCycle } from "../src/lib/newsCycle.js";
import { SHOWCASE_CITIES, showcaseBatches, showcaseFor } from "../src/lib/showcaseCities.js";

const cand = (id, o = {}) => ({ id, showcase: false, order: 0, eligible: true, ...o });
const run = (state, input, from, to, step = 250) => {
  const seen = [];
  for (let t = from; t <= to; t += step) {
    stepCycle(state, input, t);
    seen.push(state.activeId);
  }
  return seen;
};

test("queue: saved places come before showcase cities, then the least recently shown", () => {
  const s = createCycle();
  const list = [cand("showcase-london", { showcase: true, order: 0 }), cand("home", { order: 5 }), cand("showcase-tokyo", { showcase: true, order: 1 })];
  assert.equal(pickNext(list, s, 100_000), "home");
  s.lastShown.set("home", 99_000); // just shown: rests while others are available
  assert.equal(pickNext(list, s, 100_000), "showcase-london");
  s.lastShown.set("showcase-london", 50_000);
  assert.equal(pickNext(list, s, 100_000), "showcase-tokyo"); // never shown beats shown-before
});

test("queue: when everything is cooling down the least recent repeats instead of going dark", () => {
  const s = createCycle();
  s.lastShown.set("a", 90_000);
  s.lastShown.set("b", 95_000);
  assert.equal(pickNext([cand("a"), cand("b")], s, 100_000), "a");
  assert.equal(pickNext([cand("a", { eligible: false }), cand("b", { eligible: false })], s, 100_000), null);
});

test("only one automatic callout is ever active, and the cycle visits every eligible city", () => {
  const s = createCycle();
  const candidates = ["a", "b", "c"].map((id, i) => cand(id, { order: i }));
  const seen = run(s, { enabled: true, candidates }, 5_000, 200_000);
  assert.ok(seen.every((id) => id === null || typeof id === "string")); // a single id (or none) at every step
  assert.deepEqual([...new Set(seen.filter(Boolean))].sort(), ["a", "b", "c"]);
  assert.ok(seen.includes(null)); // there is a calm gap between callouts
});

test("dwell: a callout stays for the dwell time, then closes and the next opens after the gap", () => {
  const s = createCycle();
  const candidates = [cand("a", { order: 0 }), cand("b", { order: 1 })];
  stepCycle(s, { enabled: true, candidates }, 3_000);
  assert.equal(s.activeId, "a");
  stepCycle(s, { enabled: true, candidates }, 3_000 + CYCLE.dwellMs - 1);
  assert.equal(s.activeId, "a");
  stepCycle(s, { enabled: true, candidates }, 3_000 + CYCLE.dwellMs);
  assert.equal(s.activeId, null);
  stepCycle(s, { enabled: true, candidates }, 3_000 + CYCLE.dwellMs + CYCLE.gapMs);
  assert.equal(s.activeId, "b");
});

test("limb: a marker that turns toward the limb or behind the Earth closes at once and is not chosen", () => {
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: true, placeable: true }), true);
  assert.equal(isEligible({ fade: CYCLE.minFade - 0.01, clustered: false, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 0, clustered: false, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: true, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: false, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: true, placeable: false }), false);
  const s = createCycle();
  stepCycle(s, { enabled: true, candidates: [cand("a")] }, 3_000);
  assert.equal(s.activeId, "a");
  stepCycle(s, { enabled: true, candidates: [cand("a", { eligible: false })] }, 3_500);
  assert.equal(s.activeId, null);
  // A marker that disappears from the list altogether also closes.
  stepCycle(s, { enabled: true, candidates: [] }, 8_000);
  assert.equal(s.activeId, null);
});

test("user takeover closes the callout immediately and the cycle resumes only after the idle delay", () => {
  const s = createCycle();
  const candidates = [cand("a")];
  stepCycle(s, { enabled: true, candidates }, 3_000);
  assert.equal(s.activeId, "a");
  stepCycle(s, { enabled: false, candidates }, 4_000); // hover, focus, drag, drawer or scrub
  assert.equal(s.activeId, null);
  stepCycle(s, { enabled: true, candidates }, 4_000 + CYCLE.resumeMs - 1);
  assert.equal(s.activeId, null);
  stepCycle(s, { enabled: true, candidates }, 4_000 + CYCLE.resumeMs);
  assert.equal(s.activeId, "a");
  // Holding keeps pushing the resume point forward.
  stepCycle(s, { enabled: false, candidates }, 20_000);
  stepCycle(s, { enabled: false, candidates }, 21_000);
  stepCycle(s, { enabled: true, candidates }, 21_000 + CYCLE.resumeMs - 1);
  assert.equal(s.activeId, null);
});

test("reduced motion: with the cycle disabled nothing ever opens automatically", () => {
  const s = createCycle();
  const seen = run(s, { enabled: false, candidates: [cand("a"), cand("b")] }, 0, 120_000, 500);
  assert.ok(seen.every((id) => id === null));
});

test("verified and unverified markers map to the right treatment", () => {
  const place = { id: "p", name: "Delhi", lat: 28.6, lon: 77.2 };
  const story = (over) => ({ item: { id: "i", title: "Heat", publisher: "BBC", published_at: "2026-11-01T00:00:00Z", lat: 28.6, lon: 77.2, ...over }, place });
  const green = markersFor([story({ publisher_verified: true, severity: "green" })])[0];
  const amber = markersFor([story({ publisher_verified: true, severity: "amber" })])[0];
  const red = markersFor([story({ publisher_verified: true, severity: "red" })])[0];
  const unv = markersFor([story({ publisher_verified: false, severity: "red" })])[0];
  assert.deepEqual([green.tone, amber.tone, red.tone], ["green", "amber", "red"]);
  assert.equal(unv.tone, "unverified"); // never an urgency colour
  assert.equal(unv.verified, false);
  assert.equal(unv.glyph, SEVERITY_GLYPH.unverified);
  assert.equal(unv.lead.verified, false);
  assert.equal(unv.lead.severity, null);
  // Colour sits on the marker, leader and glyph only: the callout body uses neutral surface tokens.
  const css = readFileSync(new URL("../src/styles/globe.css", import.meta.url), "utf8");
  const callout = css.match(/\.gl-callout \{[^}]*\}/)?.[0] ?? "";
  assert.ok(callout.includes("background: var(--surface)"));
  assert.ok(!/--news-(green|amber|red)/.test(callout));
  assert.match(css, /\.gl-news--unverified \.gl-news-dot \{ border-style: dashed/);
  assert.match(css, /\.gl-news--unverified \.gl-callout \{ border-style: dashed; border-color: var\(--news-unverified\)/);
});

test("showcase: ten fixed cities, batches of at most five, saved places take their own place", () => {
  assert.equal(SHOWCASE_CITIES.length, 10);
  assert.ok(SHOWCASE_CITIES.every((c) => c.showcase === true && Number.isFinite(c.lat) && Number.isFinite(c.lon)));
  const names = SHOWCASE_CITIES.map((c) => c.name);
  for (const n of ["London", "New York", "São Paulo", "Cairo", "Delhi", "Singapore", "Tokyo", "Sydney", "Johannesburg", "Mexico City"]) {
    assert.ok(names.includes(n), n);
  }
  const all = showcaseBatches([]);
  assert.deepEqual(all.map((b) => b.cities.length), [5, 5]);
  assert.ok(all.every((b) => b.param.split(",").length <= 5 && b.param.length <= 300));
  // A saved place next to a showcase city replaces it, so the city is not fetched twice.
  const withDelhi = showcaseFor([{ id: "mine", name: "Delhi", lat: 28.6, lon: 77.2 }]);
  assert.equal(withDelhi.length, 9);
  assert.ok(!withDelhi.some((c) => c.name === "Delhi"));
});

test("markers carry the showcase flag so saved places can be ranked first", () => {
  const item = { id: "i", title: "Flood", publisher: "BBC", published_at: "2026-11-01T00:00:00Z", lat: 51.51, lon: -0.13, publisher_verified: true, severity: "amber" };
  const [m] = markersFor([{ item, place: SHOWCASE_CITIES[0] }]);
  assert.equal(m.showcase, true);
  const [s] = markersFor([{ item, place: { id: "mine", name: "Home", lat: 51.51, lon: -0.13 } }]);
  assert.equal(s.showcase, false);
});

test("capitals: fifty unique main-country capitals with valid positions", async () => {
  const { CAPITALS, capitalCard, capitalMarkers, coordText, equatorText, solarOffsetText } = await import("../src/lib/capitals.js");
  assert.equal(CAPITALS.length, 50);
  assert.equal(new Set(CAPITALS.map((c) => c.id)).size, 50);
  assert.equal(new Set(CAPITALS.map((c) => c.country)).size, 50); // one capital per country
  assert.ok(CAPITALS.every((c) => c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180 && c.name && c.country));
  // Spread over the planet: every inhabited continent has several.
  assert.ok(CAPITALS.filter((c) => c.lon < -30 && c.lat > 10).length >= 3); // North America
  assert.ok(CAPITALS.filter((c) => c.lon < -30 && c.lat < 10).length >= 5); // South America
  assert.ok(CAPITALS.filter((c) => c.lon > -20 && c.lon < 40 && c.lat > 36).length >= 10); // Europe
  assert.ok(CAPITALS.filter((c) => c.lon > -20 && c.lon < 52 && c.lat < 36 && c.lat > -35).length >= 5); // Africa
  assert.ok(CAPITALS.filter((c) => c.lon > 60).length >= 10); // Asia and Oceania
  // Details are derived from the position, never invented.
  assert.equal(coordText(28.61, 77.21), "28.6° N, 77.2° E");
  assert.equal(coordText(-41.29, 174.78), "41.3° S, 174.8° E");
  assert.equal(solarOffsetText(77.21), "Sun time is 5 h 09 min ahead of Greenwich");
  assert.equal(solarOffsetText(-77.04), "Sun time is 5 h 08 min behind Greenwich");
  assert.equal(solarOffsetText(0.05), "On the Greenwich meridian");
  assert.equal(equatorText(-0.18), "Almost on the equator");
  assert.equal(equatorText(64.15), "7,130 km north of the equator");
  const q = capitalCard(CAPITALS.find((c) => c.name === "La Paz"));
  assert.equal(q.country, "Bolivia · seat of government");
  assert.equal(q.details.length, 2); // position plus one derived detail
  assert.match(q.fact, /highest seat of government/);
  // Markers: neutral, hidden-at-rest dots with a card and no news story.
  const ms = capitalMarkers();
  assert.ok(ms.every((m) => m.kind === "capital" && m.tone === "capital" && m.lead === null && m.card && m.open === false));
});

test("news and capital popups take turns and share the single-popup invariant", () => {
  const s = createCycle();
  const mixed = [cand("n1", { order: 0 }), cand("n2", { order: 1 }), cand("c1", { kind: "capital", order: 2 }), cand("c2", { kind: "capital", order: 3 })];
  const seen = run(s, { enabled: true, candidates: mixed }, 5_000, 120_000);
  const order = [];
  for (const id of seen) if (id && order[order.length - 1] !== id) order.push(id);
  const kinds = order.map((id) => (id.startsWith("c") ? "capital" : "news"));
  for (let i = 1; i < kinds.length; i += 1) assert.notEqual(kinds[i], kinds[i - 1], `turns alternate: ${order.join(",")}`);
  assert.ok(kinds.includes("capital") && kinds.includes("news"));
  // With no news available, capitals run alone; with only news, news runs alone.
  const alone = createCycle();
  const onlyCaps = run(alone, { enabled: true, candidates: [cand("c1", { kind: "capital" }), cand("c2", { kind: "capital" })] }, 5_000, 60_000);
  assert.ok(onlyCaps.filter(Boolean).length > 0);
  const onlyNews = run(createCycle(), { enabled: true, candidates: [cand("n1")] }, 5_000, 60_000);
  assert.ok(onlyNews.filter(Boolean).length > 0);
});