// Chart viewer logic (owner item 7): unit conversions, log-axis guard, spec conversion and chart CSV.
import assert from "node:assert/strict";
import { test } from "node:test";

import { chartSpec, convertSpec, logAxisGuard, logScale, logTicks, slugify, specYValues } from "../src/lib/chart.js";
import { chartCsv } from "../src/lib/csv.js";
import { convertSlope, convertValue, converter, isApproximate, parseUnit, unitLabel, unitOptions } from "../src/lib/units.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("temperature: absolute values use the full affine conversion", () => {
  close(convertValue(0, "°C", "°F"), 32);
  close(convertValue(100, "°C", "°F"), 212);
  close(convertValue(-40, "°C", "°F"), -40);
  close(convertValue(0, "°C", "K"), 273.15);
  close(convertValue(32, "°F", "°C"), 0);
  close(convertValue(273.15, "K", "°F"), 32);
});

test("temperature: differences and slopes use the scale factor only (no +32 offset)", () => {
  close(convertValue(1, "°C", "°F", { delta: true }), 1.8);
  close(convertValue(-0.5, "°C", "K", { delta: true }), -0.5);
  close(convertSlope(0.25, "°C", "°F"), 0.45);
  close(convertSlope(0.25, "°C", "K"), 0.25);
});

test("rain, sunlight, wind and pressure are scale-only conversions", () => {
  close(convertValue(1, "mm/day", "mm/month"), 30.44);
  close(convertValue(25.4, "mm/day", "in/day"), 1);
  close(convertValue(100, "W/m²", "kWh/m²/day"), 2.4);
  close(convertValue(1, "kWh/m²/day", "MJ/m²/day"), 3.6);
  close(convertValue(18, "MJ/m²/day", "W/m²"), 18 / 0.0864);
  close(convertValue(10, "m/s", "km/h"), 36);
  close(convertValue(0.44704, "m/s", "mph"), 1);
  close(convertValue(101.325, "kPa", "hPa"), 1013.25);
  // delta and absolute agree when there is no offset
  close(convertSlope(2, "m/s", "km/h"), convertValue(2, "m/s", "km/h"));
});

test("mm/month is flagged approximate; exact conversions are not", () => {
  assert.equal(isApproximate("mm/day", "mm/month"), true);
  assert.equal(isApproximate("mm/day", "in/day"), false);
  assert.equal(isApproximate("°C", "°F"), false);
});

test("unknown or mismatched units never convert", () => {
  assert.deepEqual(unitOptions("%"), []);
  assert.deepEqual(unitOptions("0–1"), []);
  assert.deepEqual(unitOptions("z-score"), []);
  assert.equal(converter("°C", "m/s")(5), 5);
  assert.equal(converter("%", "°F")(5), 5);
  assert.equal(convertValue(null, "°C", "°F"), null);
});

test("backend spellings and qualified units are recognised", () => {
  assert.equal(parseUnit("°C").id, "°C");
  assert.equal(parseUnit("MJ/m²/day").id, "MJ/m²/day");
  assert.equal(parseUnit("W/m^2").id, "W/m²");
  const q = parseUnit("°C vs 1951–1980");
  assert.equal(q.id, "°C");
  assert.equal(unitLabel("°C vs 1951–1980", "°F"), "°F vs 1951–1980");
  assert.deepEqual(unitOptions("°C").map((u) => u.id), ["°C", "°F", "K"]);
  assert.deepEqual(unitOptions("kPa").map((u) => u.id), ["kPa", "hPa"]);
});

test("log-axis guard disables log for any value at or below zero, with a plain reason", () => {
  assert.equal(logAxisGuard([1, 2, 3]).ok, true);
  const zero = logAxisGuard([0, 1, 2]);
  assert.equal(zero.ok, false);
  assert.match(zero.reason, /above zero/);
  assert.match(zero.reason, /1 plotted value is/);
  const neg = logAxisGuard([-1, -2, 3]);
  assert.equal(neg.ok, false);
  assert.match(neg.reason, /2 plotted values are/);
  assert.equal(logAxisGuard([null, NaN]).ok, false);
  assert.equal(logAxisGuard([null, 4, NaN]).ok, true, "gaps are ignored");
});

test("log scale and ticks", () => {
  const s = logScale(1, 100, 0, 200);
  close(s(10), 100);
  close(s.invert(100), 10);
  assert.deepEqual(logTicks(1, 1000), [1, 10, 100, 1000]);
  assert.ok(logTicks(2, 40).includes(10));
});

test("convertSpec converts plotted values only; notes and x stay untouched", () => {
  const spec = chartSpec({
    title: "Test",
    unit: "°C",
    series: [
      { id: "a", label: "A", type: "line", data: [{ x: 2000, y: 10, note: "p 0.030" }] },
      { id: "b", label: "Band", type: "band", data: [{ x: 2000, lo: 9, hi: 11 }] },
    ],
  });
  const f = convertSpec(spec, "°F");
  close(f.series[0].data[0].y, 50);
  close(f.series[1].data[0].lo, 48.2);
  assert.equal(f.series[0].data[0].note, "p 0.030");
  assert.equal(f.series[0].data[0].x, 2000);
  assert.equal(f.unit, "°F");
  const anomalies = convertSpec({ ...spec, delta: true }, "°F");
  close(anomalies.series[0].data[0].y, 18, 1e-9);
  assert.deepEqual(specYValues(spec).sort((a, b) => a - b), [9, 10, 11]);
  const z = chartSpec({ title: "z", unit: "z-score", convertible: false, series: [{ id: "z", label: "z", type: "line", data: [{ x: 1, y: 2 }] }] });
  assert.equal(convertSpec(z, "°F"), z);
});

test("chart CSV notes the unit, conversion and source", () => {
  const spec = chartSpec({
    title: "Air temperature, Paris",
    source: "NASA POWER",
    unit: "°F",
    series: [{ id: "a", label: "Yearly average", type: "line", data: [{ x: 2000, y: 50, label: "2000" }, { x: 2001, y: 51 }] }],
  });
  const csv = chartCsv(spec, { originalUnit: "°C" });
  assert.match(csv, /# Source: NASA POWER/);
  assert.match(csv, /# Units: °F/);
  assert.match(csv, /Converted for display from °C/);
  assert.match(csv, /Year,Yearly average\n2000,50\n2001,51$/);
  assert.equal(slugify("Air temperature, Paris: yearly averages"), "air-temperature-paris-yearly-averages");
  assert.equal(slugify("°°°"), "chart");
});
