import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAPITALS, capitalCard, capitalMarkers, capitalPlaces, coordText, equatorText, MAIN_COUNT, solarOffsetText } from "../src/lib/capitals.js";
import { CAPITAL_NEWS, batchOutcome, capitalStoriesSnapshot, resetCapitalNews, runCapitalNews } from "../src/lib/capitalNews.js";
import { markersFor, SEVERITY_GLYPH } from "../src/lib/globeNews.js";
import { CYCLE, activeIds, createCycle, isEligible, pickNext, stepCycle } from "../src/lib/newsCycle.js";

const cand = (id, o = {}) => ({ id, kind: "capital", order: 0, eligible: true, ...o });
const many = (n, o = {}) => Array.from({ length: n }, (_, i) => cand(`c${i}`, { order: i, ...o }));
const run = (state, input, from, to, step = 250) => {
  const frames = [];
  for (let t = from; t <= to; t += step) {
    stepCycle(state, input, t);
    frames.push({ t, ids: activeIds(state) });
  }
  return frames;
};

test("queue: priority rank first, then least recently shown, and open popups are skipped", () => {
  const s = createCycle();
  const list = [
    cand("plain", { rank: 3, order: 0 }),
    cand("unverified", { rank: 2, order: 1 }),
    cand("verified", { rank: 1, order: 2 }),
    cand("saved", { kind: "news", rank: 0, order: 3 }),
  ];
  assert.equal(pickNext(list, s, 100_000), "saved");
  s.active.set("saved", { since: 0 });
  assert.equal(pickNext(list, s, 100_000), "verified");
  s.lastShown.set("verified", 99_000); // just shown: rests while others are available
  assert.equal(pickNext(list, s, 100_000), "unverified");
  assert.equal(pickNext([cand("a", { eligible: false })], s, 100_000), null);
  // Within one rank the least recently shown goes first.
  const t = createCycle();
  t.lastShown.set("x", 10_000);
  t.lastShown.set("y", 20_000);
  assert.equal(pickNext([cand("y", { rank: 3 }), cand("x", { rank: 3 })], t, 100_000), "x");
  // Without an explicit rank a capital counts as rank 3 and news as rank 0.
  assert.equal(pickNext([cand("cap"), cand("news", { kind: "news" })], createCycle(), 100_000), "news");
});

test("queue: when everything is cooling down the least recent repeats instead of going dark", () => {
  const s = createCycle();
  s.lastShown.set("a", 90_000);
  s.lastShown.set("b", 95_000);
  assert.equal(pickNext([cand("a"), cand("b")], s, 100_000), "a");
  // A rested candidate beats a cooling one of better rank.
  assert.equal(pickNext([cand("a", { rank: 0 }), cand("fresh", { rank: 3 })], s, 100_000), "fresh");
});

test("several popups at once, never more than the limit, and they come out one by one", () => {
  const s = createCycle();
  const frames = run(s, { enabled: true, candidates: many(12) }, 5_000, 90_000);
  assert.ok(frames.every((f) => f.ids.length <= CYCLE.maxActive), "never above the limit");
  assert.equal(Math.max(...frames.map((f) => f.ids.length)), CYCLE.maxActive, "reaches the limit (several at once)");
  // Staggered: at most one popup opens between two steps.
  for (let i = 1; i < frames.length; i += 1) {
    const opened = frames[i].ids.filter((id) => !frames[i - 1].ids.includes(id)).length;
    assert.ok(opened <= 1, `at most one opens per step (${frames[i].t} ms)`);
  }
  // And a new one opens only after the spawn gap.
  const openedAt = [];
  frames.forEach((f, i) => {
    for (const id of f.ids) if (i === 0 || !frames[i - 1].ids.includes(id)) openedAt.push(f.t);
  });
  for (let i = 1; i < openedAt.length; i += 1) assert.ok(openedAt[i] - openedAt[i - 1] >= CYCLE.spawnGapMs - 250, "spawn gap respected");
  // Every candidate gets its turn over time.
  assert.equal(new Set(frames.flatMap((f) => f.ids)).size, 12);
});

test("the limit is lower on a phone", () => {
  const s = createCycle();
  const frames = run(s, { enabled: true, candidates: many(12), max: CYCLE.maxActivePhone }, 5_000, 60_000);
  assert.equal(Math.max(...frames.map((f) => f.ids.length)), CYCLE.maxActivePhone);
  assert.ok(CYCLE.maxActivePhone < CYCLE.maxActive);
});

test("dwell: each popup stays for the dwell time and then closes", () => {
  const s = createCycle();
  const candidates = many(1);
  stepCycle(s, { enabled: true, candidates }, 3_000);
  assert.deepEqual(activeIds(s), ["c0"]);
  stepCycle(s, { enabled: true, candidates }, 3_000 + CYCLE.dwellMs - 1);
  assert.deepEqual(activeIds(s), ["c0"]);
  stepCycle(s, { enabled: true, candidates }, 3_000 + CYCLE.dwellMs);
  // The first opening is over. (With a single eligible candidate the same step may open it again, with a fresh start.)
  assert.ok(!activeIds(s).includes("c0") || s.active.get("c0").since > 3_000);
  // With plenty of candidates a closed popup is replaced by a fresh one, not repeated straight away.
  const t = createCycle();
  const six = many(6);
  const frames = run(t, { enabled: true, candidates: six }, 3_000, 3_000 + CYCLE.dwellMs, 250);
  assert.ok(frames[0].ids.includes("c0"));
  assert.ok(!frames[frames.length - 1].ids.includes("c0"), "c0 closed after its dwell and was not reopened at once");
});

test("limb: a popup that turns toward the limb or behind the Earth closes at once and is not chosen", () => {
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: true, placeable: true }), true);
  assert.equal(isEligible({ fade: CYCLE.minFade - 0.01, clustered: false, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 0, clustered: false, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: true, hasStory: true, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: false, placeable: true }), false);
  assert.equal(isEligible({ fade: 1, clustered: false, hasStory: true, placeable: false }), false);
  const s = createCycle();
  stepCycle(s, { enabled: true, candidates: [cand("a"), cand("b")] }, 3_000);
  stepCycle(s, { enabled: true, candidates: [cand("a"), cand("b")] }, 4_500);
  assert.deepEqual(activeIds(s).sort(), ["a", "b"]);
  stepCycle(s, { enabled: true, candidates: [cand("a", { eligible: false }), cand("b")] }, 5_000);
  assert.deepEqual(activeIds(s), ["b"]);
  stepCycle(s, { enabled: true, candidates: [] }, 5_500); // a marker that disappears altogether also closes
  assert.deepEqual(activeIds(s), []);
});

test("user takeover closes every popup immediately and the cycle resumes only after the idle delay", () => {
  const s = createCycle();
  const candidates = many(3);
  stepCycle(s, { enabled: true, candidates }, 3_000);
  stepCycle(s, { enabled: true, candidates }, 4_500);
  assert.equal(activeIds(s).length, 2);
  stepCycle(s, { enabled: false, candidates }, 5_000); // drag, scrub, an open drawer or reduced motion
  assert.deepEqual(activeIds(s), []);
  stepCycle(s, { enabled: true, candidates }, 5_000 + CYCLE.resumeMs - 1);
  assert.deepEqual(activeIds(s), []);
  stepCycle(s, { enabled: true, candidates }, 5_000 + CYCLE.resumeMs);
  assert.equal(activeIds(s).length, 1);
  // Holding keeps pushing the resume point forward.
  stepCycle(s, { enabled: false, candidates }, 20_000);
  stepCycle(s, { enabled: false, candidates }, 21_000);
  stepCycle(s, { enabled: true, candidates }, 21_000 + CYCLE.resumeMs - 1);
  assert.deepEqual(activeIds(s), []);
});

test("hover or focus freezes the set so a popup can be reached and clicked, then the time carries on", () => {
  const s = createCycle();
  const candidates = many(6);
  stepCycle(s, { enabled: true, candidates }, 3_000);
  stepCycle(s, { enabled: true, candidates }, 4_500);
  const before = activeIds(s);
  assert.equal(before.length, 2);
  // Frozen well past the dwell: nothing expires and nothing new opens.
  for (let t = 5_000; t <= 40_000; t += 1_000) stepCycle(s, { enabled: true, frozen: true, candidates }, t);
  assert.deepEqual(activeIds(s), before);
  // Released: the frozen time is given back, so the popups are still there and keep their remaining dwell.
  stepCycle(s, { enabled: true, candidates }, 41_000);
  for (const id of before) assert.ok(activeIds(s).includes(id), `${id} is still open right after release`);
  const remaining = s.active.get(before[0]).since;
  assert.ok(41_000 - remaining < CYCLE.dwellMs, "the dwell time was not used up while frozen");
  // They close after the rest of their dwell, not instantly.
  stepCycle(s, { enabled: true, candidates }, 41_000 + CYCLE.dwellMs + 2_000);
  for (const id of before) assert.ok(!activeIds(s).includes(id) || s.active.get(id).since > remaining, "closes once its dwell is over");
  // A frozen popup that rotates behind the limb still closes.
  const f = createCycle();
  stepCycle(f, { enabled: true, candidates: [cand("a")] }, 3_000);
  stepCycle(f, { enabled: true, frozen: true, candidates: [cand("a", { eligible: false })] }, 3_500);
  assert.deepEqual(activeIds(f), []);
});

test("reduced motion: with the cycle disabled nothing ever opens automatically", () => {
  const s = createCycle();
  const frames = run(s, { enabled: false, candidates: many(4) }, 0, 120_000, 500);
  assert.ok(frames.every((f) => f.ids.length === 0));
});

test("verified and unverified markers map to the right treatment; the border carries the colour", () => {
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
  assert.equal(unv.lead.severity, null);
  const css = readFileSync(new URL("../src/styles/globe.css", import.meta.url), "utf8");
  assert.match(css, /\.gl-news--green \.gl-callout \{ border-color: var\(--news-green\)/);
  assert.match(css, /\.gl-news--amber \.gl-callout \{ border-color: var\(--news-amber\)/);
  assert.match(css, /\.gl-news--red \.gl-callout \{ border-color: var\(--news-red\)/);
  const base = css.match(/^\.gl-callout \{[^}]*\}/m)?.[0] ?? "";
  assert.ok(base.length > 20, "found the base .gl-callout rule");
  assert.ok(base.includes("background: var(--surface)")); // the box itself stays near-black
  assert.ok(!/--news-(green|amber|red)/.test(base));
  assert.match(css, /\.gl-news--unverified \.gl-callout \{ border-style: dashed; border-color: var\(--news-unverified\)/);
});

test("capitals: every UN member state, one capital each, with valid positions", () => {
  assert.equal(CAPITALS.length, 193);
  assert.equal(new Set(CAPITALS.map((c) => c.id)).size, 193);
  assert.equal(new Set(CAPITALS.map((c) => c.country)).size, 193);
  assert.ok(CAPITALS.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180 && c.name && c.country));
  assert.equal(CAPITALS.filter((c) => c.main).length, MAIN_COUNT);
  assert.ok(CAPITALS.slice(0, MAIN_COUNT).every((c) => c.main) && CAPITALS.slice(MAIN_COUNT).every((c) => !c.main));
  for (const country of ["United States", "China", "India", "Brazil", "Nigeria", "Australia", "Russia", "Japan", "Tuvalu", "Vanuatu", "Bhutan", "Liechtenstein"]) {
    assert.ok(CAPITALS.some((c) => c.country === country), country);
  }
  assert.equal(capitalPlaces().length, 193);
  assert.ok(capitalPlaces().every((p) => p.capital === true));
  // Spread over the planet.
  assert.ok(CAPITALS.filter((c) => c.lon > 100).length >= 15);
  assert.ok(CAPITALS.filter((c) => c.lon < -60).length >= 25);
  assert.ok(CAPITALS.filter((c) => c.lat < -10).length >= 20);
  assert.ok(CAPITALS.filter((c) => c.lat > 50).length >= 15);
});

test("capital details are derived from the position, never invented", () => {
  assert.equal(coordText(28.61, 77.21), "28.6° N, 77.2° E");
  assert.equal(coordText(-41.29, 174.78), "41.3° S, 174.8° E");
  assert.equal(solarOffsetText(77.21), "Sun time is 5 h 09 min ahead of Greenwich");
  assert.equal(solarOffsetText(-77.04), "Sun time is 5 h 08 min behind Greenwich");
  assert.equal(solarOffsetText(0.05), "On the Greenwich meridian");
  assert.equal(equatorText(-0.18), "Almost on the equator");
  assert.equal(equatorText(64.15), "7,130 km north of the equator");
  assert.equal(equatorText(-34.6), "3,850 km south of the equator");
  const lp = capitalCard(CAPITALS.find((c) => c.name === "La Paz"));
  assert.equal(lp.country, "Bolivia · seat of government");
  assert.equal(lp.details.length, 2); // position plus one derived detail
  assert.match(lp.fact, /highest seat of government/);
  assert.equal(capitalCard(CAPITALS[0], { full: true }).details.length, 3);
});

test("capital markers: neutral without news, severity from verified news, neutral when only unverified", () => {
  const none = capitalMarkers();
  assert.equal(none.length, 193);
  assert.ok(none.every((m) => m.kind === "capital" && m.tone === "capital" && m.lead === null && m.count === 0 && m.card && m.open === false));
  const places = capitalPlaces();
  const named = (n) => places.find((p) => p.name === n);
  const item = (id, place, over) => ({ item: { id, title: `Story ${id}`, publisher: "BBC", published_at: "2026-11-01T00:00:00Z", lat: place.lat, lon: place.lon, ...over }, place });
  const ms = capitalMarkers([
    item("1", named("London"), { publisher_verified: true, severity: "red" }),
    item("2", named("Cairo"), { publisher_verified: false, severity: "red" }),
    item("3", named("Paris"), { publisher_verified: true, severity: "green" }),
    item("4", named("Paris"), { publisher_verified: true, severity: "amber" }),
  ]);
  const by = (n) => ms.find((m) => m.name === n);
  assert.equal(by("London").tone, "red");
  assert.equal(by("London").verified, true);
  assert.equal(by("Cairo").tone, "unverified");
  assert.equal(by("Cairo").verified, false);
  assert.equal(by("Paris").tone, "amber"); // the highest verified severity wins
  assert.equal(by("Paris").count, 2);
  assert.equal(by("Berlin").tone, "capital");
  assert.ok(by("London").lead.precision.startsWith("Location: city centre"));
  // The marker keeps the capital's own position, not the story's.
  assert.equal(by("London").lat, named("London").lat);
});

test("capital news: polite bounded batches, main countries first, stops when the provider keeps failing", async () => {
  resetCapitalNews();
  const calls = [];
  const sleeps = [];
  const ok = (param) => ({ items: [], partial_failures: [], locations_queried: param.split(",").map(() => ({ source: "saved_location" })) });
  await runCapitalNews({
    fetchBatch: async (param) => (calls.push(param), ok(param)),
    sleep: async (ms) => void sleeps.push(ms),
  });
  assert.equal(calls.length, CAPITAL_NEWS.maxBatches); // bounded
  assert.ok(calls.every((p) => p.split(",").length <= CAPITAL_NEWS.batchSize && p.length <= 300));
  assert.ok(calls[0].startsWith("Washington")); // main countries first
  assert.ok(sleeps.length >= CAPITAL_NEWS.maxBatches - 1 && sleeps.every((ms) => ms >= CAPITAL_NEWS.pauseMs)); // polite spacing
  // At the cap a further call asks for nothing more.
  const before = calls.length;
  await runCapitalNews({ fetchBatch: async (p) => (calls.push(p), ok(p)), sleep: async () => {} });
  assert.equal(calls.length, before);

  resetCapitalNews();
  const failing = [];
  const rests = [];
  await runCapitalNews({
    fetchBatch: async (param) => (failing.push(param), { items: [], partial_failures: param.split(",").map(() => ({ code: "timeout" })) }),
    sleep: async (ms) => void rests.push(ms),
  });
  // Three failed batches in a row, a long cool-off, one more round, then it gives up for the visit.
  assert.equal(failing.length, CAPITAL_NEWS.maxFails * (1 + CAPITAL_NEWS.maxCoolOffs));
  assert.equal(rests.filter((ms) => ms === CAPITAL_NEWS.coolOffMs).length, CAPITAL_NEWS.maxCoolOffs);
  assert.equal(capitalStoriesSnapshot().stopped, true);
  const afterStop = failing.length;
  await runCapitalNews({ fetchBatch: async (p) => (failing.push(p), ok(p)), sleep: async () => {} });
  assert.equal(failing.length, afterStop); // and stays stopped for the visit

  resetCapitalNews();
  const waits = [];
  let n = 0;
  await runCapitalNews({
    fetchBatch: async (param) => ((n += 1) === 1 ? { items: [], partial_failures: param.split(",").map(() => ({ code: "rate_limited" })) } : ok(param)),
    sleep: async (ms) => void waits.push(ms),
    cfg: { ...CAPITAL_NEWS, maxBatches: 3 },
  });
  assert.equal(waits[0], CAPITAL_NEWS.backoffMs); // a rate-limited batch backs off first
  assert.equal(waits[1], CAPITAL_NEWS.pauseMs);
  assert.equal(batchOutcome({ items: [], partial_failures: [{ code: "x" }] }, 2).failed, false); // partly answered is not a failure
  assert.equal(batchOutcome({ items: [{}], partial_failures: [{ code: "x" }, { code: "y" }] }, 2).failed, false); // news came back
  resetCapitalNews();
});

test("capital news: a thrown request counts as a failed batch and an abort stops quietly", async () => {
  resetCapitalNews();
  let calls = 0;
  await runCapitalNews({
    fetchBatch: async () => {
      calls += 1;
      throw new Error("network down");
    },
    sleep: async () => {},
  });
  assert.equal(calls, CAPITAL_NEWS.maxFails * (1 + CAPITAL_NEWS.maxCoolOffs));
  resetCapitalNews();
  const ctrl = new AbortController();
  let seen = 0;
  await runCapitalNews({
    fetchBatch: async () => {
      seen += 1;
      ctrl.abort();
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    },
    sleep: async () => {},
    signal: ctrl.signal,
  });
  assert.equal(seen, 1);
  resetCapitalNews();
});

test("capital news: stories found are matched to their capital", async () => {
  resetCapitalNews();
  const first = capitalPlaces().slice(0, CAPITAL_NEWS.batchSize);
  const wash = first[0];
  await runCapitalNews({
    fetchBatch: async () => ({
      items: [{ id: "w1", title: "Storm", publisher: "BBC", published_at: "2026-11-01T00:00:00Z", lat: wash.lat + 0.1, lon: wash.lon, location_source: "saved_location", publisher_verified: true, severity: "amber" }],
      partial_failures: [],
    }),
    sleep: async () => {},
    cfg: { ...CAPITAL_NEWS, maxBatches: 1 },
  });
  const { stories } = capitalStoriesSnapshot();
  assert.equal(stories.length, 1);
  assert.equal(stories[0].place.id, wash.id);
  assert.equal(capitalMarkers(stories).find((m) => m.id === wash.id).tone, "amber");
  resetCapitalNews();
});
