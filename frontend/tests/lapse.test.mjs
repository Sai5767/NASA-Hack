import assert from "node:assert/strict";
import test from "node:test";
import { intensity, mixHex, prepareLapse } from "../src/lib/lapse.js";

test("mixHex blends and clamps", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#102030", "#ffffff", -3), "#102030");
  assert.equal(mixHex("#102030", "#ffffff", 9), "#ffffff");
});

const place = (id, fn, from = 1981, to = 2020, ok = true) => ({
  id, ok, series: Array.from({ length: to - from + 1 }, (_, i) => [from + i, fn(from + i)]),
});

test("anomalies are measured from each site's own average", () => {
  const lapse = prepareLapse([place("a", (y) => 10 + (y - 1981)), place("b", (y) => 100 - (y - 1981) * 2)]);
  const meanA = 10 + 19.5;
  assert.ok(Math.abs(lapse.at("a", 1981) - (10 - meanA)) < 1e-9);
  assert.ok(lapse.at("a", 2020) > 0 && lapse.at("a", 1981) < 0);
  assert.ok(lapse.at("b", 1981) > 0 && lapse.at("b", 2020) < 0);
  assert.equal(lapse.at("a", 1900), null);
  assert.equal(lapse.at("zzz", 2000), null);
});

test("anomalies of each site average to zero", () => {
  const lapse = prepareLapse([place("a", (y) => Math.sin(y) * 3 + y * 0.1)]);
  const total = lapse.years.reduce((s, y) => s + lapse.at("a", y), 0);
  assert.ok(Math.abs(total) < 1e-6);
});

test("only years that most sites have are played, and failed sites are ignored", () => {
  const lapse = prepareLapse([
    place("a", (y) => y), place("b", (y) => y), place("c", (y) => y), place("d", (y) => y),
    place("late", (y) => y, 1995, 2020),          // starts late: must not shorten the play range
    place("bad", (y) => y, 1981, 2020, false),    // failed site
  ]);
  assert.equal(lapse.years[0], 1981);
  assert.equal(lapse.years.at(-1), 2020);
  assert.equal(lapse.at("bad", 2000), null);
});

test("scale is the 90th percentile of |anomaly|, and intensity is capped at 1", () => {
  // 40 years rising 0..39: mean 19.5, so |anomaly| is 0.5, 0.5, 1.5, 1.5 ... 19.5, 19.5 and the 90th percentile is 17.5
  const lapse = prepareLapse([place("a", (y) => y - 1981)]);
  assert.equal(lapse.scale, 17.5);
  assert.equal(intensity(1000, lapse.scale), 1);
  assert.equal(intensity(0, lapse.scale), 0);
  assert.ok(intensity(-0.5, 1) === 0.5);
});

test("an empty or unusable survey gives no years rather than crashing", () => {
  assert.deepEqual(prepareLapse([]).years, []);
  assert.deepEqual(prepareLapse([{ id: "x", ok: true, series: [[2000, 1]] }]).years, []);
});
