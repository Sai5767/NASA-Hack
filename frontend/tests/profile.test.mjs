import assert from "node:assert/strict";
import test from "node:test";
import { CASES } from "../src/lib/cases.js";
import { distanceKm, nearestPlace } from "../src/lib/geo.js";
import {
  DEFAULT_PROFILE,
  WATCH_LIMIT,
  addWatch,
  defaultView,
  hasWatch,
  removeWatch,
  suggest,
  toggleWatch,
  topicMatchesCase,
  TOPICS,
  watchId,
} from "../src/lib/profile.js";

test("technical users open on the detailed view, everyone else on the overview", () => {
  assert.equal(defaultView({ level: "technical" }), "detail");
  assert.equal(defaultView({ level: "plain" }), "overview");
  assert.equal(defaultView(DEFAULT_PROFILE), "overview");
  assert.equal(defaultView(null), "overview");
});

test("suggestions cross the user's topics with their places first", () => {
  const profile = { ...DEFAULT_PROFILE, interests: ["heat", "rain"], places: ["city", "desert"] };
  const out = suggest(profile, { limit: 5 });
  assert.equal(out.length, 5);
  assert.equal(out[0].id, "heat@city");
  assert.equal(out[0].kind, "place");
  assert.equal(out[0].open.variable, "T2M");
  assert.equal(Math.round(out[0].open.lat), 29);
  assert.deepEqual(out.slice(0, 4).map((s) => s.id), ["heat@city", "heat@desert", "rain@city", "rain@desert"]);
});

test("with no answers the suggestions are the guided starter cases, without duplicates", () => {
  const out = suggest(DEFAULT_PROFILE, { limit: 50 });
  assert.equal(out.length, CASES.length);
  assert.equal(new Set(out.map((s) => s.id)).size, out.length);
  assert.ok(out.every((s) => s.kind === "case"));
});

test("guided cases that match an interest come before the generic starters", () => {
  const out = suggest({ ...DEFAULT_PROFILE, interests: ["rain"] }, { limit: 3 });
  assert.ok(out.slice(0, 2).every((s) => s.case.variable === "PRECTOTCORR"));
});

test("the goal moves its case to the front", () => {
  const compare = suggest({ ...DEFAULT_PROFILE, goal: "compare" }, { limit: 3 });
  assert.equal(compare[0].case.tab, "duel");
  const forecast = suggest({ ...DEFAULT_PROFILE, goal: "forecast" }, { limit: 3 });
  assert.equal(forecast[0].case.id, "forecast");
});

test("the polar topic matches the polar cases by id", () => {
  const poles = TOPICS.find((t) => t.id === "poles");
  const matches = CASES.filter((c) => topicMatchesCase(poles, c)).map((c) => c.id).sort();
  assert.deepEqual(matches, ["alaska", "poles", "vitals"]);
});

test("watchlist: add is idempotent, ids merge near-identical spots, remove and toggle work", () => {
  const delhi = { variable: "T2M", lat: 28.61, lon: 77.2, name: "Delhi" };
  let list = addWatch([], delhi);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, watchId(delhi));
  list = addWatch(list, { ...delhi, lat: 28.64 }); // same 0.1 degree cell
  assert.equal(list.length, 1);
  list = addWatch(list, { variable: "PRECTOTCORR", lat: 28.61, lon: 77.2, name: "Delhi" });
  assert.equal(list.length, 2);
  assert.ok(hasWatch(list, delhi));
  list = removeWatch(list, watchId(delhi));
  assert.equal(list.length, 1);
  assert.ok(!hasWatch(list, delhi));
  assert.ok(hasWatch(toggleWatch(list, delhi), delhi));
  assert.ok(!hasWatch(toggleWatch(toggleWatch(list, delhi), delhi), delhi));
});

test("the watchlist is capped and keeps the newest items", () => {
  let list = [];
  for (let i = 0; i < WATCH_LIMIT + 3; i += 1) list = addWatch(list, { variable: "T2M", lat: i, lon: i, name: `p${i}` });
  assert.equal(list.length, WATCH_LIMIT);
  assert.equal(list[0].name, `p${WATCH_LIMIT + 2}`);
});

test("great-circle distance and nearest place", () => {
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 0.5);
  assert.ok(distanceKm(10, 20, 10, 20) < 1e-9);
  const places = [{ name: "A", lat: 28.6, lon: 77.2 }, { name: "B", lat: 0, lon: 0 }];
  assert.equal(nearestPlace(places, 28.9, 77.4)?.name, "A");
  assert.equal(nearestPlace(places, 60, 120), null);
});
