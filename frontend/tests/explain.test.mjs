import assert from "node:assert/strict";
import test from "node:test";
import { GLOSSARY } from "../src/lib/glossary.js";
import { ENTRIES, answer, explainTerm, starters } from "../src/lib/explain.js";

const CASE = {
  variable: { label: "Air temperature", units: "°C" },
  stats: {
    significant: false, sign: "down", slope_per_decade: -0.128, total_change: -0.564, span_years: 44, p_value: 0.219, p_naive: 0.19,
    ci_low_per_decade: -0.316, ci_high_per_decade: 0.066, signal_to_noise: 0.4, autocorr: { r1: 0.2, adjusted: true, factor: 1.6 },
  },
  ols: { slope_per_decade: -0.12, p_value: 0.182 },
  grade: { code: "none", label: "Inconclusive", passed: 2, total: 5 },
  checks: [{ label: "The Mann–Kendall test is significant", passed: false }, { label: "Most calendar months move the same way", passed: true }],
  emergence: { year: null },
  shape: { label: "none", r2_line: 0.04, r2_step: 0.1 },
};

test("every glossary term has a deeper explanation", () => {
  for (const g of GLOSSARY) {
    const e = ENTRIES.find((x) => x.id === g.id);
    assert.ok(e.long.length >= 1, `${g.id} has no long text`);
    assert.ok(e.keys.length >= 1, `${g.id} has no search keys`);
  }
});

test("every follow-up points at a real entry", () => {
  const ids = new Set(ENTRIES.map((e) => e.id));
  for (const e of ENTRIES) for (const f of e.follow) assert.ok(ids.has(f), `${e.id} -> ${f}`);
});

test("a clicked term gets its numbers from the case on screen", () => {
  const r = explainTerm("pvalue", CASE);
  assert.equal(r.title, "p-value");
  assert.match(r.inCase, /0\.219/);
  assert.match(explainTerm("ci", CASE).inCase, /includes zero/);
  assert.match(explainTerm("grade", CASE).inCase, /2 of 5 checks/);
  assert.match(explainTerm("emergence", CASE).inCase, /never became lasting/);
});

test("context sentences are skipped, never wrong, when there is no case or the data are incomplete", () => {
  assert.equal(explainTerm("pvalue", null).inCase, null);
  assert.equal(explainTerm("pvalue", {}).inCase, null);
});

test("free text finds the right entry", () => {
  assert.equal(answer("what does significant mean?", null).id, "sig");
  assert.equal(answer("What is a p-value", null).id, "pvalue");
  assert.equal(answer("can I trust this", CASE).id, "trust");
  assert.equal(answer("does this prove climate change", null).id, "cause");
  assert.equal(answer("where does the data come from", null).id, "data");
  assert.equal(answer("tell me about serial correlation", null).id, "autocorr");
});

test("an unknown question gets an honest fallback with real topics, not a guess", () => {
  const r = answer("zzzz qqqq", CASE);
  assert.equal(r.id, null);
  assert.match(r.title, /do not know/);
  assert.ok(r.related.length >= 3);
});

test("related links never repeat the entry being explained", () => {
  const r = answer("p-value", null);
  assert.ok(!r.related.some((x) => x.id === r.id));
  assert.equal(new Set(r.related.map((x) => x.id)).size, r.related.length);
});

test("starter questions adapt to whether a case is open", () => {
  assert.ok(starters(CASE).includes("Explain this verdict"));
  assert.ok(!starters(null).includes("Explain this verdict"));
});
