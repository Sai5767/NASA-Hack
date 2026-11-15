import assert from "node:assert/strict";
import test from "node:test";
import { EVENTS, EVENT_BY_ID, KINDS, describeEvent, eventStats, eventsNear } from "../src/lib/events.js";

test("every event is complete and plausible", () => {
  const ids = new Set();
  for (const e of EVENTS) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.ok(KINDS[e.kind], `${e.id}: unknown kind`);
    assert.ok(e.lat >= -90 && e.lat <= 90 && e.lon >= -180 && e.lon <= 180, `${e.id}: bad coordinates`);
    assert.ok(e.from <= e.year && e.year <= e.to, `${e.id}: headline year outside its own range`);
    assert.ok(e.from >= 1981 && e.to <= new Date().getFullYear(), `${e.id}: outside the data record`);
    assert.ok(["up", "down"].includes(e.expect) && ["place", "global"].includes(e.scope));
    assert.ok(e.radiusKm >= 300 && e.radiusKm <= 3000);
    assert.ok(e.blurb.length > 80 && e.lookFor.length > 20 && e.sources.length >= 1, `${e.id}: thin text`);
    assert.match(e.variable, /^[A-Z0-9_]+$/);
  }
  assert.ok(EVENTS.length >= 12);
  assert.equal(EVENT_BY_ID["texas-2011"].variable, "PRECTOTCORR");
});

test("events near a place respect distance and the years on screen", () => {
  const period = { start_year: 1984, end_year: 2025 };
  const houston = eventsNear(30, -97, period).map((e) => e.id);
  assert.ok(houston.includes("texas-2011"));
  assert.ok(!houston.includes("europe-2003"));
  const late = eventsNear(30, -97, { start_year: 2015, end_year: 2025 }).map((e) => e.id); // 2011 and 2012 fall outside
  assert.ok(late.includes("harvey-2017"));
  assert.ok(!late.includes("texas-2011") && !late.includes("cornbelt-2012"));
  const years = eventsNear(0, -140, period).map((e) => e.year);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
});

const series = (fn, from = 1981, to = 2024) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, value: fn(from + i) }));

test("a clear event stands out: z-score, rank and wording", () => {
  const annual = series((y) => 10 + ((y * 7) % 5) * 0.1 + (y === 2011 ? -3 : 0));
  const stats = eventStats(annual, EVENT_BY_ID["texas-2011"]);
  assert.equal(stats.extremeYear, 2011);
  assert.equal(stats.rank, 1);
  assert.ok(stats.z < -5);
  assert.ok(stats.inExpectedDirection && stats.standsOut);
  assert.match(describeEvent(stats, EVENT_BY_ID["texas-2011"], "mm/day"), /ranks 1st lowest of 44 years.*stands out clearly/);
});

test("an event the data do not show is described honestly, not forced", () => {
  const annual = series((y) => 10 + ((y * 7) % 5) * 0.1 + (y === 2011 ? 0.4 : 0)); // wetter, not drier
  const e = EVENT_BY_ID["texas-2011"];
  const stats = eventStats(annual, e);
  assert.ok(!stats.inExpectedDirection && !stats.standsOut);
  assert.match(describeEvent(stats, e, "mm/day"), /did not move the way the event would suggest/);
});

test("multi-year events compare the whole span against the other years", () => {
  const e = EVENT_BY_ID["nino-2015"]; // 2015 and 2016, expects warm
  const annual = series((y) => 26 + ((y * 3) % 4) * 0.05 + (y >= 2015 && y <= 2016 ? 1 : 0));
  const stats = eventStats(annual, e);
  assert.ok(stats.standsOut);
  assert.match(describeEvent(stats, e, "°C"), /In 2015–2016 the average/);
});

test("too little record gives no stats and a clear sentence", () => {
  const e = EVENT_BY_ID["europe-2003"];
  assert.equal(eventStats(series((y) => y, 2000, 2006), e), null); // fewer than 8 comparison years
  assert.equal(eventStats(series((y) => y, 1981, 1995), e), null); // event years not in the record
  assert.match(describeEvent(null, e, "°C"), /does not cover enough years/);
});
