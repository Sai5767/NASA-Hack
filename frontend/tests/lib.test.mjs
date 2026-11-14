// Run with: npm test   (uses Node's built-in test runner, no extra dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";

import { divergingColor, linearScale, niceTicks, sectorPath } from "../src/lib/chart.js";
import { caseFileCsv, scanCsv, sweepCsv } from "../src/lib/csv.js";
import { arrow, formatLat, formatLon, formatP, round2, sig, signed, wrapLon } from "../src/lib/format.js";
import { cellContains, cellRing } from "../src/lib/geo.js";

// ---------------------------------------------------------------- formatting

test("sig keeps about three significant digits without exponent noise", () => {
  assert.equal(sig(0.41703296), "0.417");
  assert.equal(sig(1234.5), "1230");
  assert.equal(sig(0), "0");
  assert.equal(sig(0.0000123), "0.0000123");
  assert.equal(sig(NaN), "—");
  assert.equal(sig(null), "—");
});

test("signed adds a plus only for positive values", () => {
  assert.equal(signed(0.417), "+0.417");
  assert.equal(signed(-0.417), "-0.417");
  assert.equal(signed(0), "0");
});

test("formatP never prints a misleading zero", () => {
  assert.equal(formatP(0.0004), "< 0.001");
  assert.equal(formatP(0.0301), "0.030");
  assert.equal(formatP(1), "1.000");
  assert.equal(formatP(null), "—");
});

test("latitude and longitude use hemisphere letters", () => {
  assert.equal(formatLat(42), "42.00°N");
  assert.equal(formatLat(-3.1), "3.10°S");
  assert.equal(formatLon(-93.6), "93.60°W");
  assert.equal(formatLon(2), "2.00°E");
});

test("wrapLon folds any longitude into [-180, 180)", () => {
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  assert.equal(wrapLon(0), 0);
  assert.equal(wrapLon(540), -180);
});

test("round2 and arrow", () => {
  assert.equal(round2(12.3456), 12.35);
  assert.equal(arrow("up"), "▲");
  assert.equal(arrow("down"), "▼");
  assert.equal(arrow("flat"), "▬");
});

// ---------------------------------------------------------------- chart helpers

test("niceTicks returns round, ordered values inside the range", () => {
  const ticks = niceTicks(0.3, 9.7, 5);
  assert.deepEqual(ticks, [2, 4, 6, 8]);
  assert.deepEqual(niceTicks(-1, 1, 4), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(niceTicks(5, 5), [5]);
  for (const t of niceTicks(1981, 2025, 5)) assert.ok(t >= 1981 && t <= 2025);
});

test("linearScale maps and inverts", () => {
  const s = linearScale(0, 10, 100, 300);
  assert.equal(s(0), 100);
  assert.equal(s(10), 300);
  assert.equal(s(5), 200);
  assert.equal(s.invert(250), 7.5);
  const flipped = linearScale(0, 1, 50, 0); // y axes run upward
  assert.equal(flipped(1), 0);
});

test("divergingColor is blue below zero, red above, neutral at zero", () => {
  const parse = (c) => c.match(/\d+/g).map(Number);
  const [rN, gN, bN] = parse(divergingColor(0, 1));
  const [rUp] = parse(divergingColor(1, 1));
  const [, , bDown] = parse(divergingColor(-1, 1));
  assert.ok(rUp > rN, "positive is redder than neutral");
  assert.ok(bDown > bN, "negative is bluer than neutral");
  assert.equal(divergingColor(5, 0), "rgb(60,70,100)");
  assert.deepEqual(parse(divergingColor(99, 1)), parse(divergingColor(1, 1)), "values clamp at the extremes");
});

test("sectorPath produces a closed shape", () => {
  const d = sectorPath(150, 150, 40, 100, -12, 12);
  assert.ok(d.startsWith("M"));
  assert.ok(d.endsWith("Z"));
  assert.equal((d.match(/A/g) ?? []).length, 2);
});

// ---------------------------------------------------------------- geometry

test("cellRing is closed and clockwise on the map (what d3-geo expects)", () => {
  const ring = cellRing(40, -100, 5);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  // Shoelace area in lon/lat: negative means clockwise when y points north.
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  assert.ok(twice < 0, "ring must be clockwise");
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  assert.equal(Math.min(...lons), -105);
  assert.equal(Math.max(...lons), -95);
  assert.equal(Math.min(...lats), 35);
  assert.equal(Math.max(...lats), 45);
});

test("cellRing stays within valid latitudes near the pole", () => {
  const ring = cellRing(88, 0, 5);
  assert.ok(Math.max(...ring.map((p) => p[1])) <= 90);
});

test("cellContains handles the antimeridian", () => {
  const cell = { lat: 0, lon: 179 };
  assert.ok(cellContains(cell, 1, -179, 3));
  assert.ok(!cellContains(cell, 1, -170, 3));
  assert.ok(!cellContains(cell, 10, 179, 3));
});

// ---------------------------------------------------------------- CSV export

const sample = {
  variable: { id: "T2M", label: "Air temperature", units: "°C" },
  location: { lat: 42, lon: -93.6 },
  period: { start_year: 1981, end_year: 2025 },
  stats: { n_years: 45, slope_per_decade: 0.418, ci_low_per_decade: 0.166, ci_high_per_decade: 0.678, p_value: 0.003, p_naive: 0.003 },
  ols: { p_value: 0.002 },
  grade: { label: "Moderate evidence", passed: 4, total: 5 },
  annual: [{ year: 1981, value: 8.1 }, { year: 1982, value: 8.4 }],
};

test("case file CSV has a commented header and one row per year", () => {
  const lines = caseFileCsv(sample).split("\n");
  assert.ok(lines[0].startsWith("# Trend Detective"));
  assert.ok(lines.some((l) => l.includes("NASA Langley Research Center")));
  assert.ok(lines.some((l) => l.startsWith("year,")));
  assert.equal(lines.at(-2), "1981,8.1");
  assert.equal(lines.at(-1), "1982,8.4");
});

test("CSV fields with commas or quotes are escaped", () => {
  const csv = sweepCsv({
    location: { lat: 1, lon: 2 },
    period: { start_year: 1981, end_year: 2025 },
    rows: [{ ok: true, label: 'Wind, "2 m"', units: "m/s", slope_per_decade: 1, ci_low_per_decade: 0, ci_high_per_decade: 2, total_change: 4, percent_of_mean: null, signal_to_noise: 2, p_value: 0.01, significant: true, significant_fdr: true, grade: { label: "Strong evidence" } }],
  });
  assert.ok(csv.includes('"Wind, ""2 m"""'));
});

test("scan CSV keeps failed places with their reason", () => {
  const csv = scanCsv({
    variable: { label: "Evaporation" },
    period: { start_year: 1981, end_year: 2025 },
    cells: [{ ok: false, lat: 0, lon: -160, message: "only measured over land" }],
  });
  assert.ok(csv.includes("0,-160,,,,,,only measured over land"));
});
