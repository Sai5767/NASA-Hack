import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  QUESTION_MAX,
  VERDICT_FALLBACK_LABELS,
  WHY_DISCLAIMER,
  canExplain,
  cleanQuestion,
  explanationPayload,
  formatGenerated,
  formatValue,
  humanKey,
  replayBasisText,
  safeUrl,
  secondsLeft,
  shouldRetryStale,
  technicalBlocks,
  traceChecks,
  traceSteps,
  trendParamsOf,
  verdictView,
  whyContent,
  whyErrorMessage,
  whyStatus,
} from "../src/components/insight/logic.js";

const FIX = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/v2_fixtures.json", import.meta.url), "utf8"));
const TREND = FIX.trend_with_evidence_trace;
const clone = (x) => JSON.parse(JSON.stringify(x));

function withVerdict(code, extra = {}) {
  const t = clone(TREND);
  const rung = t.evidence_trace.verdict.ladder.find((r) => r.code === code);
  Object.assign(t.evidence_trace.verdict, { code, label: rung.label, tier: rung.tier }, extra);
  return t;
}

// ------------------------------------------------------------------------------------------------ verdict

test("the strong-evidence fixture leads with direction, rate, range, period and source (no p-value)", () => {
  const v = verdictView(TREND);
  const si = TREND.evidence_trace.slope_and_interval;
  assert.equal(v.code, "strong_evidence");
  assert.equal(v.tier, 3);
  assert.equal(v.label, "Strong evidence of a trend");
  assert.deepEqual(v.direction, { kind: "up", glyph: "▲", text: "Rising" });
  assert.equal(v.rateStyle, "full");
  assert.equal(v.rate.slope, si.slope_per_decade, "the slope is the backend value, untouched");
  assert.match(v.rate.text, /^\+0\.624 °C per decade$/);
  assert.match(v.range, /^95% range \+0\.581 to \+0\.657 · about \+2\.68 °C in total$/);
  assert.equal(v.period, "1981–2024");
  assert.equal(v.years, 44);
  assert.match(v.source, /NASA/);
  assert.equal(v.summary, TREND.evidence_trace.verdict.summary);
  for (const s of [v.rate.text, v.range, v.label]) assert.doesNotMatch(s, /\bp\s*[=<]/);
  assert.equal(v.canAskWhy, true);
});

test("the four verdict states keep the backend labels and map to the spec's card states", () => {
  const strong = verdictView(withVerdict("strong_evidence"));
  const some = verdictView(withVerdict("some_evidence", { sign: "down" }));
  const none = verdictView(withVerdict("no_clear_evidence"));
  const insufficient = verdictView(withVerdict("insufficient_data"));
  assert.equal(some.label, "Some evidence — investigate carefully");
  assert.deepEqual(some.direction, { kind: "down", glyph: "▼", text: "Falling" });
  assert.equal(none.label, "No clear evidence yet");
  assert.equal(none.direction.kind, "flat");
  assert.equal(none.rateStyle, "estimate", "no-clear-evidence shows the best estimate, dimmed");
  assert.equal(insufficient.label, "Not enough data to tell");
  assert.equal(insufficient.rateStyle, null, "no rate for insufficient data");
  assert.equal(insufficient.direction, null);
  assert.equal(insufficient.insufficientText, "44 complete years found; at least 20 are needed.");
  assert.deepEqual([strong.tier, some.tier, none.tier, insufficient.tier], [3, 2, 1, 0]);
  assert.equal(insufficient.canAskWhy, false, "no Why button without a valid analysis");
  assert.equal(none.canAskWhy, true, "no-clear-evidence may ask (the backend answers no_evidence)");
  assert.deepEqual(Object.values(VERDICT_FALLBACK_LABELS), TREND.evidence_trace.verdict.ladder.map((r) => r.label));
});

test("no verdict is invented when evidence_trace is missing or has an unknown code", () => {
  const t = clone(TREND);
  delete t.evidence_trace;
  assert.equal(verdictView(t), null);
  assert.equal(verdictView(withVerdict("strong_evidence", { code: "made_up" })), null);
  assert.equal(canExplain(t), false);
  assert.equal(canExplain({ ...clone(TREND), case_signature: "" }), false);
});

// ------------------------------------------------------------------------------------------------ trace

test("trace steps come out in order with plain words, method names and humanised backend values", () => {
  const steps = traceSteps(TREND.evidence_trace);
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3, 4, 5]);
  assert.equal(steps[0].title, "Count complete 12-month years");
  assert.match(steps[0].plain, /44 complete 12-month years/);
  assert.match(steps[1].method, /Theil–Sen/);
  const yrs = steps[0].rows.find((r) => r.key === "years_used");
  assert.deepEqual(yrs, { key: "years_used", label: "Complete years used", value: "44" });
  const p = steps[3].rows.find((r) => r.key === "p_value");
  assert.equal(p.value, "< 0.001", "p-values use the existing formatP");
  assert.equal(steps[3].rows.find((r) => r.key === "significant").value, "Yes");
  const shuffled = { steps: [...TREND.evidence_trace.steps].reverse() };
  assert.deepEqual(traceSteps(shuffled).map((s) => s.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(traceSteps({}), []);
  assert.deepEqual(traceSteps(null), []);
});

test("values are formatted for reading only, never changed in meaning", () => {
  assert.equal(formatValue("slope_per_decade", 0.6243487201275746), "0.6243");
  assert.equal(formatValue("raw_p_value", 0.0213), "0.021");
  assert.equal(formatValue("ols_p_value", 3.6e-32), "< 0.001");
  assert.equal(formatValue("adjusted", false), "No");
  assert.equal(formatValue("percent_of_mean", null), "—");
  assert.equal(formatValue("complete_years", [1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988]), "8 values (1981 … 1988)");
  assert.equal(humanKey("some_new_field"), "Some new field");
});

test("checks and technical blocks use the backend's own counts and blocks", () => {
  const c = traceChecks(TREND.evidence_trace, TREND);
  assert.equal(c.items.length, 5);
  assert.equal(c.passed, 5);
  assert.equal(c.total, 5);
  const ids = technicalBlocks(TREND.evidence_trace).map((b) => b.id);
  assert.deepEqual(ids, ["slope", "mk", "ols", "serial", "agree", "fdr", "completeness"]);
  const fdr = technicalBlocks(TREND.evidence_trace).find((b) => b.id === "fdr");
  assert.match(fdr.method, /Benjamini–Hochberg/);
  assert.equal(technicalBlocks(null).length, 0);
});

// ------------------------------------------------------------------------------------------------ why

test("the explanation request carries only the signed case and an optional short question", () => {
  assert.deepEqual(explanationPayload(TREND, ""), { case_signature: TREND.case_signature });
  assert.deepEqual(explanationPayload(TREND, "  Why\n so   fast? "), { case_signature: TREND.case_signature, question: "Why so fast?" });
  const body = explanationPayload(TREND, "x".repeat(500));
  assert.equal(body.question.length, QUESTION_MAX);
  assert.deepEqual(Object.keys(body).sort(), ["case_signature", "question"]);
  for (const forbidden of ["p_value", "slope", "stats", "system_prompt", "variable"]) assert.ok(!(forbidden in body));
  assert.equal(cleanQuestion(null), "");
});

test("only a 422 naming the case signature triggers the single refetch-and-retry", () => {
  const stale = { status: 422, detail: "Invalid case_signature verification code." };
  assert.equal(shouldRetryStale(stale, 0), true);
  assert.equal(shouldRetryStale(stale, 1), false, "retry once only");
  assert.equal(shouldRetryStale({ status: 422, detail: [{ loc: ["body", "question"], msg: "bad" }] }, 0), false, "question errors are not retried");
  assert.equal(shouldRetryStale({ status: 502, detail: "upstream" }, 0), false);
  assert.equal(shouldRetryStale({ status: 0, detail: null }, 0), false);
  assert.equal(shouldRetryStale(null, 0), false);
  assert.match(whyErrorMessage({ status: 422, detail: [] }), /question/);
  assert.equal(whyErrorMessage({ status: 500 }), "We couldn't load explanations.");
});

test("the refetch uses the same case parameters as the trend", () => {
  assert.deepEqual(trendParamsOf(TREND), { variable: "T2M", lat: TREND.location.lat, lon: TREND.location.lon, start_year: 1981, end_year: 2024 });
  assert.equal(trendParamsOf({}), null);
});

test("every explanation status is handled intentionally", () => {
  const ok = whyStatus(FIX.explanations_ok);
  assert.equal(ok.kind, "ok");
  const noKey = whyStatus(FIX.explanations_fallback);
  assert.equal(noKey.kind, "no_key");
  assert.match(noKey.text, /aren't set up on this server/);
  assert.match(noKey.detail, /key/);
  const noModel = whyStatus({ ...FIX.explanations_fallback, fallback_reason: "missing_model" });
  assert.equal(noModel.kind, "no_key");
  assert.match(noModel.detail, /model/);
  const fb = whyStatus({ ...FIX.explanations_fallback, status: "fallback", fallback_reason: "validation_failed" });
  assert.equal(fb.kind, "fallback");
  assert.match(fb.text, /curated summary/);
  const rl = whyStatus({ ...FIX.explanations_fallback, status: "rate_limited", retry_after_seconds: 42 });
  assert.equal(rl.kind, "rate_limited");
  assert.equal(rl.retryAfter, 42);
  assert.match(rl.text, /about 42 seconds/);
  const ne = whyStatus({ status: "no_evidence", fallback_reason: "no_significant_trend", drivers: [] });
  assert.equal(ne.text, "There isn't a clear trend here to explain yet.");
  assert.match(whyStatus({ status: "no_evidence", fallback_reason: null }).text, /substantiated/);
  assert.equal(whyStatus({ status: "surprise" }).kind, "unknown");
});

test("why content: measured trend kept apart, drivers always cited, sources numbered and https only", () => {
  const c = whyContent(FIX.explanations_ok);
  assert.equal(c.disclaimer, WHY_DISCLAIMER);
  assert.equal(c.disclaimer, "These are possible explanations, not proof that one cause created this local trend.");
  assert.equal(c.measured.length, 1);
  assert.equal(c.measured[0].badge, "Measured here");
  assert.ok(c.drivers.length >= 1);
  for (const d of [...c.measured, ...c.drivers]) assert.ok(d.cites.length > 0);
  assert.deepEqual(c.sources.map((s) => s.n), c.sources.map((_, i) => i + 1));
  for (const s of c.sources) assert.match(s.href, /^https:\/\//);

  const tampered = clone(FIX.explanations_ok);
  tampered.citations = [];
  tampered.drivers[1].citations = [{ id: "x", url: "javascript:alert(1)", title: "bad" }];
  tampered.drivers[1].citation_ids = ["x"];
  const t = whyContent(tampered);
  assert.equal(t.drivers.length, 0, "a driver whose only link is unsafe is not shown");
  assert.deepEqual(whyContent({ status: "no_evidence", drivers: [] }).drivers, []);
  assert.equal(safeUrl("http://example.org"), null);
  assert.equal(safeUrl("https://user:pw@nasa.gov/"), null);
  assert.equal(safeUrl("https://www.nasa.gov/x"), "https://www.nasa.gov/x");
});

test("rate-limit countdown and timestamps are plain display arithmetic", () => {
  assert.equal(secondsLeft(30, 1000, 1000), 30);
  assert.equal(secondsLeft(30, 1000, 21_500), 10);
  assert.equal(secondsLeft(30, 1000, 99_000), 0);
  assert.equal(secondsLeft(null, 0, 0), 0);
  assert.equal(formatGenerated("2026-11-15T00:00:00Z"), "15 Nov 2026 00:00 UTC");
  assert.equal(formatGenerated("nope"), "");
});

test("forecast-lab replays are labelled in-sample with the backend's note", () => {
  const lab = { replay_note: "Replays use the winning model and today's error band…" };
  assert.equal(replayBasisText({ band_basis: "in_sample" }, lab), lab.replay_note);
  assert.match(replayBasisText({ band_basis: "in_sample" }, {}), /illustrate/);
  assert.equal(replayBasisText(null, lab), "");
});
