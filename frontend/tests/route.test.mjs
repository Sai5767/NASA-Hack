import assert from "node:assert/strict";
import test from "node:test";
import { EXPLORE_TABS, flipDirection, hashFromRoute, historyMode, routeFromHash } from "../src/lib/route.js";

const place = { variable: "T2M", lat: 33.45, lon: -112.07, start: 1981, end: 2024 };

test("a bare or invalid URL opens Main with nothing selected", () => {
  for (const h of ["", "#", "#t=investigate", "#garbage", "#v=T2M&lat=999&lon=0"]) {
    assert.deepEqual(routeFromHash(h), { page: "main", tab: "investigate", params: null, pinB: null }, h);
  }
});

test("Main and Explore routes round-trip through the hash, keeping the place and variable", () => {
  const routes = [
    { page: "main", tab: "investigate", params: place, pinB: null },
    { page: "explore", tab: "sweep", params: place, pinB: null },
    { page: "explore", tab: "duel", params: place, pinB: { lat: 0, lon: -160 } },
    { page: "explore", tab: "learn", params: null, pinB: null },
    { page: "explore", tab: "investigate", params: null, pinB: null },
  ];
  for (const r of routes) assert.deepEqual(routeFromHash(`#${hashFromRoute(r)}`), r);
  assert.equal(hashFromRoute({ page: "main", tab: "investigate", params: null, pinB: null }), "");
});

test("V1 shared links still open: a tool link goes to Explore, a case link to Main", () => {
  assert.equal(routeFromHash("#t=sweep&v=T2M&lat=10&lon=10").page, "explore");
  assert.equal(routeFromHash("#t=sweep&v=T2M&lat=10&lon=10").tab, "sweep");
  const main = routeFromHash("#t=investigate&v=T2M&lat=10&lon=10");
  assert.equal(main.page, "main");
  assert.equal(main.params.lat, 10);
  // A Main link that names a tool is normalised; a Duel pin outside the Duel is dropped.
  assert.equal(routeFromHash("#p=main&t=sweep").tab, "investigate");
  assert.equal(routeFromHash("#p=explore&t=sweep&blat=1&blon=2").pinB, null);
});

test("page and tool changes push history; parameter changes replace it", () => {
  const a = { page: "main", tab: "investigate", params: null, pinB: null };
  const withPlace = { ...a, params: place };
  const explore = { ...withPlace, page: "explore", tab: "investigate" };
  const sweep = { ...explore, tab: "sweep" };
  assert.equal(historyMode(null, a), "replace");
  assert.equal(historyMode(a, a), "none");
  assert.equal(historyMode(a, withPlace), "replace");
  assert.equal(historyMode(withPlace, explore), "push");
  assert.equal(historyMode(explore, sweep), "push");
  assert.equal(historyMode(sweep, { ...sweep, params: { ...place, variable: "PRECTOTCORR" } }), "replace");
  assert.equal(historyMode(sweep, withPlace), "push");
});

test("page-flip direction and the Explore tab list", () => {
  assert.equal(flipDirection("main", "explore"), "forward");
  assert.equal(flipDirection("explore", "main"), "back");
  assert.equal(flipDirection("main", "main"), "none");
  assert.deepEqual(EXPLORE_TABS.map((t) => t.label), ["Sweep", "Scan", "Duel", "World", "Vitals", "Ledger", "Events", "Detail", "Learn"]);
});
