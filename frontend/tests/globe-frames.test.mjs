import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  atPlayEnd, buildTimeline, cellHalf, cellTip, coverageBadge, defaultIndex, dwellFor, expectedCells, fadeMsFor, fieldCells,
  forecastStatus, framesQuery, gridExtent, isAdjacent, isForecastIndex, meanReadout, nextPlayIndex, railCaption, REDUCED_SPEEDS,
  sliderText, stepIndex, tableRows, trackBars, transitionPlan,
} from "../src/lib/globeFrames.js";
import { classify, legendSwatches, rampFor, scaleFor, tokenFor } from "../src/lib/ramp.js";
import { mixLinear } from "../src/lib/tokens.js";
import { createMemoCache } from "../src/lib/memoCache.js";

const FX = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/v2_fixtures.json", import.meta.url), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

test("observed frames come first, forecast frames only when eligible === true", () => {
  const obsOnly = buildTimeline(FX.monthly_frames);
  assert.equal(obsOnly.observedCount, 12);
  assert.equal(obsOnly.forecastCount, 0);
  const withF = buildTimeline(FX.monthly_frames, FX.monthly_forecast_eligible);
  assert.equal(withF.forecastCount, 3);
  assert.deepEqual(withF.frames.map((f) => f.kind), [...Array(12).fill("observed"), ...Array(3).fill("forecast")]);
  assert.equal(withF.frames[12].badge, "Forecast — not observed data");
  const withheld = buildTimeline(FX.monthly_frames, FX.monthly_forecast_withheld);
  assert.equal(withheld.forecastCount, 0);
  // A response that is not exactly eligible === true never contributes frames, even if frames are present.
  const sneaky = { ...clone(FX.monthly_forecast_eligible), eligible: "true" };
  assert.equal(buildTimeline(FX.monthly_frames, sneaky).forecastCount, 0);
  // Mislabelled frames are filtered by kind.
  const mixed = clone(FX.monthly_frames);
  mixed.frames[0].kind = "forecast";
  assert.equal(buildTimeline(mixed).observedCount, 11);
  assert.equal(buildTimeline(null), null);
});

test("forecast status maps eligible, withheld (reason verbatim), loading, error and idle", () => {
  assert.equal(forecastStatus(null).kind, "idle");
  assert.equal(forecastStatus({ loading: true }).kind, "loading");
  assert.equal(forecastStatus({ error: "boom" }).kind, "error");
  const e = forecastStatus({ data: FX.monthly_forecast_eligible });
  assert.equal(e.kind, "eligible");
  assert.equal(e.first, "Jan 2025");
  assert.equal(e.last, "Mar 2025");
  const w = forecastStatus({ data: FX.monthly_forecast_withheld });
  assert.equal(w.kind, "withheld");
  assert.equal(w.reason, FX.monthly_forecast_withheld.reason);
  assert.equal(w.reasonCode, "unsupported_variable");
  assert.equal(forecastStatus({ data: { ...clone(FX.monthly_forecast_eligible), frames: [] } }).kind, "withheld");
});

test("play stops at the last observed month and never runs into the forecast", () => {
  const tl = buildTimeline(FX.monthly_frames, FX.monthly_forecast_eligible);
  assert.equal(defaultIndex(tl), 11);
  assert.equal(nextPlayIndex(tl, 0), 1);
  assert.equal(nextPlayIndex(tl, 10), 11);
  assert.equal(nextPlayIndex(tl, 11), null);
  assert.ok(atPlayEnd(tl, 11));
  // Stepping into the forecast is explicit, and playing inside it stops at its end.
  assert.equal(stepIndex(tl, 11, 1), 12);
  assert.ok(isForecastIndex(tl, 12));
  assert.ok(!isForecastIndex(tl, 11));
  assert.equal(nextPlayIndex(tl, 12), 13);
  assert.equal(nextPlayIndex(tl, 14), null);
  assert.equal(stepIndex(tl, 14, 12), 14);
  assert.equal(stepIndex(tl, 0, -12), 0);
});

test("trailing months with no data are not the default or the end of play", () => {
  const fr = clone(FX.monthly_frames);
  for (const f of fr.frames.slice(10)) {
    f.valid_cells = 0;
    f.missing_cells = f.cells.length;
    f.mean_value = null;
    f.mean_anomaly = null;
    for (const c of f.cells) Object.assign(c, { value: null, anomaly: null, missing: true });
  }
  const tl = buildTimeline(fr);
  assert.equal(tl.lastObserved, 9);
  assert.equal(nextPlayIndex(tl, 9), null);
  assert.equal(meanReadout(tl.frames[11], tl.units), "No data this month");
  assert.equal(stepIndex(tl, 9, 1), 10); // still reachable by stepping
});

test("adjacency: consecutive calendar months of the same kind only", () => {
  const tl = buildTimeline(FX.monthly_frames, FX.monthly_forecast_eligible);
  assert.ok(isAdjacent(tl.frames[0], tl.frames[1]));
  assert.ok(!isAdjacent(tl.frames[0], tl.frames[2]));
  assert.ok(!isAdjacent(tl.frames[11], tl.frames[12]), "Dec 2024 observed -> Jan 2025 forecast is a hard cut");
  assert.ok(isAdjacent(tl.frames[12], tl.frames[13]));
  assert.ok(!isAdjacent(tl.frames[11], tl.frames[0]), "Replay wrap is a hard cut");
});

test("transition plan never carries colour through a gap", () => {
  const fr = clone(FX.monthly_frames);
  const [a, b] = fr.frames;
  Object.assign(b.cells[1], { value: null, anomaly: null, missing: true });
  Object.assign(a.cells[2], { value: null, anomaly: null, missing: true });
  Object.assign(a.cells[3], { value: null, anomaly: null, missing: true });
  Object.assign(b.cells[3], { value: null, anomaly: null, missing: true });
  const plan = transitionPlan(a, b);
  assert.equal(plan.get(b.cells[0].cell_id), "tween");
  assert.equal(plan.get(b.cells[1].cell_id), "fadeOut");
  assert.equal(plan.get(b.cells[2].cell_id), "fadeIn");
  assert.equal(plan.get(b.cells[3].cell_id), "none");
  // Non-adjacent: everything is a hard cut.
  const far = transitionPlan(fr.frames[0], fr.frames[5]);
  assert.ok([...far.values()].every((m) => m === "cut" || m === "none"));
  const tl = buildTimeline(FX.monthly_frames, FX.monthly_forecast_eligible);
  assert.ok([...transitionPlan(tl.frames[11], tl.frames[12]).values()].every((m) => m === "cut"));
  assert.ok([...transitionPlan(null, tl.frames[0]).values()].every((m) => m === "cut"));
});

test("cross-fade length is min(0.6 x dwell, 360 ms) and zero with reduced motion", () => {
  assert.deepEqual([0.5, 1, 2, 4].map((s) => fadeMsFor(s)), [360, 360, 180, 90]);
  assert.deepEqual([0.5, 1, 2, 4].map(dwellFor), [1200, 600, 300, 150]);
  assert.equal(fadeMsFor(1, true), 0);
  assert.deepEqual(REDUCED_SPEEDS.map((s) => s.id), [0.5, 1]);
});

test("missing and failed cells are never coloured or given a value", () => {
  const fr = clone(FX.monthly_frames);
  Object.assign(fr.frames[0].cells[1], { value: null, anomaly: null, missing: true });
  fr.cells[2].ok = false;
  const tl = buildTimeline(fr);
  const cells = fieldCells(tl, tl.frames[0]);
  assert.equal(cells[1].state, "missing");
  assert.equal(cells[1].token, null);
  assert.equal(cells[1].alpha, 0);
  assert.match(cells[1].tip, /No data for this cell this month/);
  assert.equal(cells[2].state, "failed");
  assert.equal(cells[2].token, null);
  assert.match(cells[2].tip, /could not be loaded/);
  assert.equal(cells[0].state, "valid");
  assert.match(cells[0].token, /^--data-(warm|cool)-\d$|^--data-neutral$/);
  const rows = tableRows(tl, tl.frames[0]);
  const flat = rows.flatMap((r) => r.cells);
  assert.equal(flat.find((c) => c.id === fr.frames[0].cells[1].cell_id).text, "Missing");
  assert.equal(coverageBadge(fr.frames[0], fr.grid), null); // the frame's own missing_cells counter (0) is trusted
  assert.equal(coverageBadge({ ...fr.frames[0], missing_cells: 2 }, { total_cells: 9 }), "2 of 9 cells missing");
});

test("observed and forecast cells are distinct; forecast reuses the observed scale", () => {
  const tl = buildTimeline(FX.monthly_frames, FX.monthly_forecast_eligible);
  const obs = fieldCells(tl, tl.frames[0]);
  const fc = fieldCells(tl, tl.frames[12]);
  assert.ok(obs.every((c) => c.kind === "observed"));
  assert.ok(fc.every((c) => c.kind === "forecast" && c.alpha === 0.55));
  assert.equal(tl.scale, scaleFor(FX.monthly_frames.frames));
  assert.match(cellTip(FX.monthly_forecast_eligible.frames[0].cells[0], FX.monthly_forecast_eligible.frames[0], { units: "°C" }), /range 11\.81 to 12\.91 °C · Forecast — not observed data$/);
  assert.match(cellTip(FX.monthly_frames.frames[0].cells[0], FX.monthly_frames.frames[0], { units: "°C" }), /Jan 2024 · 11\.3 °C · \+0\.8 °C vs its own January normal · Observed \(NASA POWER\)$/);
  assert.match(railCaption(tl, tl.frames[12]), /^Statistical forecast from NASA POWER history · not observed/);
  assert.match(railCaption(tl, tl.frames[0]), /Coarse local grid, not a global satellite image$/);
});

test("readouts and slider text come from the frame's own mean_anomaly", () => {
  const f = FX.monthly_frames.frames[0];
  assert.equal(meanReadout(f, "°C"), "▲ +0.7 °C vs normal");
  assert.equal(sliderText(f, "°C"), "January 2024, observed, NASA POWER, mean plus 0.7 degrees Celsius versus normal");
  assert.match(sliderText(FX.monthly_forecast_eligible.frames[0], "°C"), /forecast, not observed/);
});

test("ramp classes, legend and scale", () => {
  assert.equal(rampFor({ id: "T2M", group: "Heat" }).id, "thermal");
  assert.equal(rampFor({ id: "PRECTOTCORR", group: "Water" }).id, "water");
  assert.equal(rampFor({ id: "CLOUD_AMT", group: "Sun & clouds" }).id, "cloud");
  assert.equal(rampFor({ id: "WS2M", group: "Wind & pressure" }).id, "other");
  assert.equal(classify(null, 2), null);
  assert.deepEqual(classify(0.05, 1), { side: "neutral", step: 0 });
  assert.deepEqual(classify(1, 1), { side: "pos", step: 4 });
  assert.deepEqual(classify(-5, 1), { side: "neg", step: 4 }); // beyond the scale clamps
  assert.deepEqual(classify(0.15, 1), { side: "pos", step: 1 });
  assert.equal(tokenFor({ side: "neg", step: 2 }, rampFor({ group: "Water" })), "--data-dry-2");
  const lg = legendSwatches(rampFor({ group: "Heat" }), 2.4);
  assert.equal(lg.tokens.length, 9);
  assert.equal(lg.tokens[4], "--data-neutral");
  assert.equal(lg.low, -2.4);
  assert.equal(scaleFor([]), null);
  const bars = trackBars(buildTimeline(FX.monthly_frames));
  assert.equal(bars.length, 12);
  assert.ok(bars.every((b) => b.h >= 0 && b.h <= 1));
});

test("grid geometry and request params", () => {
  assert.equal(cellHalf({ n: 3, size_degrees: 2 }), 0.5);
  assert.equal(cellHalf({ n: 2, size_degrees: 2 }), 1);
  assert.equal(cellHalf({ n: 1, size_degrees: 2 }), 1);
  const ext = gridExtent([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], 0.5);
  assert.deepEqual([ext.south, ext.north, ext.west, ext.east], [-0.5, 1.5, -0.5, 1.5]);
  assert.equal(expectedCells({ lat: 10, lon: 20 }).length, 9);
  const q = framesQuery({ lat: 33.45, lon: -112.07 }, { id: "T2M" }, 3, new Date(Date.UTC(2026, 10, 15)));
  assert.deepEqual(q, { variable: "T2M", lat: "33.4500", lon: "-112.0700", start_year: 2023, end_year: 2025 });
  assert.equal(framesQuery({ lat: 0, lon: 0 }, { id: "T2M" }, 50, new Date(Date.UTC(2026, 0, 1))).start_year, 2016); // max 10 years
});

test("linear-RGB colour tween and the bounded memory cache", () => {
  assert.equal(mixLinear("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixLinear("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixLinear("#000000", "#ffffff", 9), "#ffffff");
  let t = 0;
  const c = createMemoCache({ max: 2, ttlMs: 100, now: () => t });
  c.set("a", 1);
  c.set("b", 2);
  c.get("a");
  c.set("c", 3);
  assert.equal(c.get("b"), undefined, "least recently used evicted");
  assert.equal(c.get("a"), 1);
  t = 500;
  assert.equal(c.get("a"), undefined, "expired");
  assert.ok(c.size <= 2);
});
