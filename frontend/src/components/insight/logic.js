/**
 * Pure display logic for the evidence verdict, the "How did we test this?" trace and the manual "Why might this be
 * happening?" panel (docs/V2_FABLE_VISUAL_SPEC.md 5.5–5.7, docs/V2_API_CONTRACT.md 1 and 4).
 *
 * Science rule: every number here is a backend value. These helpers only choose which backend value to show, pick words
 * and CSS classes for it, and format it for reading. Nothing recalculates a slope, an interval, a p-value, a grade, a
 * verdict or forecast eligibility. No React, no DOM, so `node --test` covers it directly.
 */
import { formatP, signed, sig } from "../../lib/format.js";

// ---------------------------------------------------------------------------------------------------------- strings

/** S3: always visible in the Why panel, in every state. */
export const WHY_DISCLAIMER = "These are possible explanations, not proof that one cause created this local trend.";
/** S12: the evidence drawer's header note. */
export const SERVER_NOTE = "Every number here was calculated on the server. This page only displays it.";
export const WHY_BUTTON = "Why might this be happening?";
export const HOW_BUTTON = "How did we test this?";
/** The backend's own limit on the optional follow-up question (ExplanationRequest.question max_length). */
export const QUESTION_MAX = 240;

/** The four verdict codes in ladder order, with the fallback label used only when the backend sent none. */
export const VERDICT_CODES = ["strong_evidence", "some_evidence", "no_clear_evidence", "insufficient_data"];
export const VERDICT_FALLBACK_LABELS = {
  strong_evidence: "Strong evidence of a trend",
  some_evidence: "Some evidence — investigate carefully",
  no_clear_evidence: "No clear evidence yet",
  insufficient_data: "Not enough data to tell",
};
const TIER_OF = { strong_evidence: 3, some_evidence: 2, no_clear_evidence: 1, insufficient_data: 0 };

// ---------------------------------------------------------------------------------------------------------- verdict

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Everything the verdict card shows, chosen from `evidence_trace` (falling back to the V1 `stats` block for the same
 * backend values when a field is absent). Returns null when the response has no verdict at all.
 */
export function verdictView(trend) {
  const trace = trend?.evidence_trace;
  const v = trace?.verdict;
  if (!v || !VERDICT_CODES.includes(v.code)) return null;
  const code = v.code;
  const tier = Number.isInteger(v.tier) ? v.tier : TIER_OF[code];
  const si = trace.slope_and_interval ?? {};
  const st = trend.stats ?? {};
  const comp = trace.completeness ?? {};
  const units = si.units ?? trend.variable?.units ?? "";
  const sign = v.sign ?? st.sign ?? null;

  let direction = null;
  if (code === "strong_evidence" || code === "some_evidence") {
    if (sign === "up") direction = { kind: "up", glyph: "▲", text: "Rising" };
    else if (sign === "down") direction = { kind: "down", glyph: "▼", text: "Falling" };
  } else if (code === "no_clear_evidence") {
    direction = { kind: "flat", glyph: "◆", text: "No clear direction" };
  }

  const slope = num(si.slope_per_decade) ?? num(st.slope_per_decade);
  const low = num(si.ci_low_per_decade) ?? num(st.ci_low_per_decade);
  const high = num(si.ci_high_per_decade) ?? num(st.ci_high_per_decade);
  const total = num(si.total_change) ?? num(st.total_change);
  const level = num(si.confidence_level) ?? 0.95;
  const years = num(comp.years_used) ?? num(trend.quality?.years_used);
  const start = comp.start_year ?? trend.period?.start_year;
  const end = comp.end_year ?? trend.period?.end_year;

  const insufficient = code === "insufficient_data";
  return {
    code,
    tier,
    label: v.label || VERDICT_FALLBACK_LABELS[code],
    summary: v.summary ?? trend.summary ?? "",
    direction,
    /** "full" for strong/some, "estimate" (dimmed, prefixed "Best estimate") for no clear evidence, null when withheld. */
    rateStyle: insufficient ? null : code === "no_clear_evidence" ? "estimate" : "full",
    rate: slope == null ? null : { text: `${signed(slope, 3)} ${units} per decade`, slope, units },
    range:
      low == null || high == null
        ? null
        : `${Math.round(level * 100)}% range ${signed(low, 3)} to ${signed(high, 3)}${total == null ? "" : ` · about ${signed(total, 3)} ${units} in total`}`,
    period: start != null && end != null ? `${start}–${end}` : "",
    years,
    source: comp.source ?? "NASA POWER",
    insufficientText: insufficient
      ? `${years ?? 0} complete years found; at least ${comp.min_years_required ?? 20} are needed.`
      : "",
    ladder: Array.isArray(v.ladder) && v.ladder.length ? v.ladder : VERDICT_CODES.map((c) => ({ code: c, label: VERDICT_FALLBACK_LABELS[c], tier: TIER_OF[c] })),
    canAskWhy: canExplain(trend),
  };
}

/** The Why button exists only after a valid analysis: a signed case whose verdict is not "Not enough data to tell". */
export function canExplain(trend) {
  const code = trend?.evidence_trace?.verdict?.code;
  return typeof trend?.case_signature === "string" && trend.case_signature.length > 0 && !!code && code !== "insufficient_data";
}

// ---------------------------------------------------------------------------------------------------------- trace

const KEY_LABELS = {
  years_used: "Complete years used",
  years_requested: "Years requested",
  valid_months: "Valid months",
  expected_months: "Expected months",
  start_year: "First year",
  end_year: "Last year",
  slope_per_year: "Slope per year",
  slope_per_decade: "Slope per decade",
  ci_low_per_decade: "95% interval, low (per decade)",
  ci_high_per_decade: "95% interval, high (per decade)",
  total_change: "Total change",
  units: "Units",
  lag1_r1: "Lag-1 autocorrelation (r1)",
  variance_factor: "Variance inflation factor",
  adjusted: "Adjusted for persistence",
  raw_p_value: "Raw p-value",
  adjusted_p_value: "Adjusted p-value",
  p_value: "p-value",
  mann_kendall_s: "Mann–Kendall S",
  mann_kendall_z: "Mann–Kendall z",
  s: "S statistic",
  z: "z score",
  ols_t: "Regression t",
  ols_df: "Regression degrees of freedom",
  ols_p_value: "Regression p-value",
  alpha: "Significance level (alpha)",
  significant: "Significant",
  tests_agree: "Both tests agree",
  verdict_code: "Verdict code",
  verdict_label: "Verdict",
  grade_code: "Grade code",
  checks_passed: "Checks passed",
  checks_total: "Checks in total",
  month_agreement: "Months sharing the direction",
  months_tested: "Calendar months tested",
  months_significant_fdr: "Months significant after FDR",
  effective_df: "Effective degrees of freedom",
  se_per_decade: "Standard error per decade",
  t: "t statistic",
  df: "Degrees of freedom",
  r2: "R²",
  confidence_level: "Confidence level",
  span_years: "Span (years)",
  mean_value: "Mean value",
  percent_of_mean: "Percent of mean",
  noise_sd: "Year-to-year noise (SD)",
  signal_to_noise: "Signal-to-noise ratio",
  direction: "Direction",
  sign: "Sign",
  primary_test_scope: "Primary test scope",
  primary_p_fdr_adjusted: "Primary p-value FDR-adjusted",
  calendar_months_fdr_applied: "FDR applied to calendar months",
  calendar_months_tested: "Calendar months tested",
  calendar_months_significant_fdr: "Calendar months significant after FDR",
  min_months_per_year: "Months required per year",
  min_years_required: "Years required",
  source: "Source",
  method: "Method",
};

/** "years_used" → "Complete years used"; unknown keys are de-snaked and capitalised. */
export function humanKey(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const s = String(key).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const isPKey = (key) => /(^|_)p(_value)?$|p_value/.test(String(key));

/** A backend value as text, unchanged in meaning: p-values via formatP, other numbers to 4 significant digits. */
export function formatValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (isPKey(key)) return formatP(value);
    if (Number.isInteger(value)) return String(value);
    return sig(value, 4);
  }
  if (Array.isArray(value)) {
    if (value.length > 6 && value.every((x) => typeof x === "number")) return `${value.length} values (${value[0]} … ${value[value.length - 1]})`;
    return value.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Key/value rows for a flat backend object, skipping nested objects (they get their own table). */
export function valueRows(obj, skip = []) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([k, v]) => !skip.includes(k) && (v === null || typeof v !== "object" || Array.isArray(v)))
    .map(([k, v]) => ({ key: k, label: humanKey(k), value: formatValue(k, v) }));
}

/** The backend's evidence_trace.steps, in step order, ready to render. Empty when the trace has no steps. */
export function traceSteps(trace) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  return [...steps]
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
    .map((s, i) => ({
      n: s.step ?? i + 1,
      id: s.id ?? `step-${i + 1}`,
      title: s.title ?? `Step ${i + 1}`,
      plain: s.plain_explanation ?? "",
      method: s.method_label ?? "",
      rows: valueRows(s.values),
    }));
}

/** Pass/fail list of the five evidence checks, with the backend's own counts. */
export function traceChecks(trace, trend) {
  const items = Array.isArray(trace?.checks) ? trace.checks : Array.isArray(trend?.checks) ? trend.checks : [];
  const grade = trace?.grade ?? trend?.grade ?? null;
  return {
    items: items.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? "", passed: !!c.passed })),
    passed: grade?.passed ?? items.filter((c) => c.passed).length,
    total: grade?.total ?? items.length,
  };
}

/** The labelled technical tables shown under "With the numbers". Only blocks the backend actually sent. */
export function technicalBlocks(trace) {
  if (!trace) return [];
  const out = [];
  const si = trace.slope_and_interval;
  if (si) out.push({ id: "slope", title: "Slope and interval", method: si.method ?? "", rows: valueRows(si, ["method"]) });
  const mk = trace.mann_kendall;
  if (mk) out.push({ id: "mk", title: "Mann–Kendall test", method: mk.method ?? "", rows: valueRows(mk, ["method"]) });
  const rs = trace.regression_and_serial_correlation;
  if (rs?.ols) out.push({ id: "ols", title: "Linear regression (OLS)", method: "Ordinary least squares with a Student-t test", rows: valueRows(rs.ols) });
  if (rs?.serial_correlation) {
    out.push({ id: "serial", title: "Serial correlation", method: rs.serial_correlation.method ?? "", rows: valueRows(rs.serial_correlation, ["method"]) });
  }
  if (rs && "tests_agree" in rs) out.push({ id: "agree", title: "Do the two tests agree?", method: "", rows: [{ key: "tests_agree", label: humanKey("tests_agree"), value: formatValue("tests_agree", rs.tests_agree) }] });
  const cs = trace.correction_status;
  if (cs) out.push({ id: "fdr", title: "Multiple-testing correction", method: cs.method ?? "", note: cs.explanation ?? "", rows: valueRows(cs, ["method", "explanation"]) });
  const comp = trace.completeness;
  if (comp) out.push({ id: "completeness", title: "Data completeness", method: "", rows: valueRows(comp) });
  return out;
}

// ---------------------------------------------------------------------------------------------------------- why

/**
 * The only body POST /api/explanations ever receives: the signed case plus an optional short question.
 * (The endpoint forbids extra fields; a client-side statistic would be refused with HTTP 422.)
 */
export function explanationPayload(trend, question) {
  const body = { case_signature: trend?.case_signature };
  const q = cleanQuestion(question);
  if (q) body.question = q;
  return body;
}

/** Collapse whitespace, strip control characters and cut to the backend's limit. Empty → "". */
export function cleanQuestion(question) {
  if (typeof question !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return question.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX);
}

/**
 * Decide whether a failed explanation request should refetch the trend and retry once: only HTTP 422 whose detail
 * names the case signature (stale or tampered token), and only on the first attempt. A 422 for the question text
 * (pydantic's array detail) is not retried: a new signature would not fix it.
 */
export function shouldRetryStale(error, attempt) {
  if (attempt !== 0 || !error || error.status !== 422) return false;
  const detail = error.detail;
  return typeof detail === "string" && /case_signature|signature/i.test(detail);
}

/** A plain message for a failed explanation request (never an upstream body or a status code). */
export function whyErrorMessage(error) {
  if (error?.status === 422 && !shouldRetryStale(error, 0)) return "That question couldn't be used. Try a shorter question in plain words.";
  return "We couldn't load explanations.";
}

/** Seconds left before a rate-limited request may be retried (whole seconds, never negative). */
export function secondsLeft(retryAfterSeconds, receivedAtMs, nowMs) {
  const s = Number(retryAfterSeconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(0, Math.ceil((receivedAtMs + s * 1000 - nowMs) / 1000));
}

/**
 * The banner for a /api/explanations response (spec 5.7 status table). `kind` is the backend status when it is one
 * of the five documented values, else "unknown" (rendered like a fallback, never as success).
 */
export function whyStatus(res) {
  const status = res?.status;
  const retry = Number.isFinite(res?.retry_after_seconds) ? res.retry_after_seconds : null;
  switch (status) {
    case "ok":
      return { kind: "ok", tone: "source", glyph: "", text: res.cached ? "Searched published science · saved answer" : "Searched published science", retryAfter: null };
    case "fallback":
      return { kind: "fallback", tone: "info", glyph: "📖︎", text: "The live search wasn't available, so this is our curated summary of published science.", retryAfter: retry };
    case "no_key":
      return {
        kind: "no_key",
        tone: "info",
        glyph: "⏻",
        text: "Live explanations aren't set up on this server. This is our curated summary of published science.",
        detail: res.fallback_reason === "missing_model" ? "No AI model has been chosen on this server yet." : res.fallback_reason === "missing_api_key" ? "No AI key is configured on this server." : "",
        retryAfter: null,
      };
    case "rate_limited":
      return {
        kind: "rate_limited",
        tone: "warn",
        glyph: "⧗",
        text: `Too many requests for now. Try again in about ${retry ?? 60} seconds. Meanwhile, here is our curated summary.`,
        retryAfter: retry ?? 60,
      };
    case "no_evidence":
      return {
        kind: "no_evidence",
        tone: "info",
        glyph: "○",
        text: res.fallback_reason === "no_significant_trend" ? "There isn't a clear trend here to explain yet." : "We couldn't find a substantiated explanation for this trend.",
        retryAfter: null,
      };
    default:
      return { kind: "unknown", tone: "info", glyph: "ⓘ", text: "This is our curated summary of published science.", retryAfter: retry };
  }
}

/** Only https links are rendered as anchors (the server already allow-lists domains; this is a second guard). */
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Drivers and sources ready to render. Each citation gets a stable number by its order in `citations` (then first
 * appearance in a driver). A driver without one rendered citation is dropped: the UI never shows an uncited driver.
 * The measured local trend is separated, so it is listed under "What was measured", never as a cause.
 */
export function whyContent(res) {
  const sources = [];
  const numberOf = new Map();
  const add = (c) => {
    if (!c?.id || numberOf.has(c.id)) return;
    const href = safeUrl(c.url);
    if (!href) return;
    numberOf.set(c.id, sources.length + 1);
    sources.push({ n: sources.length + 1, id: c.id, title: c.title || c.source_label || c.domain, label: c.source_label ?? "", domain: c.domain || hostOf(href), href });
  };
  (Array.isArray(res?.citations) ? res.citations : []).forEach(add);
  const drivers = Array.isArray(res?.drivers) ? res.drivers : [];
  drivers.forEach((d) => (Array.isArray(d.citations) ? d.citations : []).forEach(add));

  const shaped = drivers
    .map((d, i) => {
      const ids = [...new Set([...(d.citation_ids ?? []), ...(d.citations ?? []).map((c) => c.id)])].filter((id) => numberOf.has(id));
      return {
        key: `${i}-${d.title}`,
        title: d.title ?? "",
        explanation: d.explanation ?? "",
        confidence: d.confidence ?? "",
        measured: d.evidence_type === "measured_local_trend",
        badge: d.evidence_type === "measured_local_trend" ? "Measured here" : "Published science",
        cites: ids.map((id) => ({ id, n: numberOf.get(id) })),
      };
    })
    .filter((d) => d.cites.length > 0);

  return {
    summary: typeof res?.summary === "string" ? res.summary : "",
    measured: shaped.filter((d) => d.measured),
    drivers: shaped.filter((d) => !d.measured),
    limitations: Array.isArray(res?.limitations) ? res.limitations.filter((x) => typeof x === "string" && x) : [],
    sources: sources.filter((s) => shaped.some((d) => d.cites.some((c) => c.id === s.id))),
    disclaimer: WHY_DISCLAIMER,
    generatedAt: res?.generated_at ?? null,
    cached: !!res?.cached,
  };
}

function hostOf(href) {
  try {
    return new URL(href).hostname;
  } catch {
    return "";
  }
}

/** "2026-11-15T00:00:00Z" → "15 Nov 2026 00:00 UTC" (display only). */
export function formatGenerated(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** Trend request params rebuilt from a trend response, for the stale-signature refetch. */
export function trendParamsOf(trend) {
  if (!trend?.variable || !trend?.location || !trend?.period) return null;
  return {
    variable: trend.variable.id,
    lat: trend.location.lat,
    lon: trend.location.lon,
    start_year: trend.period.start_year,
    end_year: trend.period.end_year,
  };
}

// ---------------------------------------------------------------------------------------------------------- forecast lab

/** Replay label: replays are illustrations with today's band, never an out-of-sample test (backend band_basis). */
export function replayBasisText(replay, lab) {
  if (!replay) return "";
  if (replay.band_basis === "in_sample") return lab?.replay_note || "Replays use today's error band, so they illustrate the track record rather than test it.";
  return lab?.replay_note ?? "";
}
