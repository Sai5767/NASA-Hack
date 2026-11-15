# V2 Backend Handoff for Frontend Implementation

This document provides the complete backend handoff for the V2 frontend agent (`codex/v2-frontend`). It summarizes all new and extended endpoints, deterministic offline fixtures, minimal frontend API helpers, environment variable names, cache/degraded behaviors, and non-negotiable UI contract assumptions.

For full JSON request/response schemas and sample payloads, see [docs/V2_API_CONTRACT.md](V2_API_CONTRACT.md).

---

## 1. Summary of V2 Backend Routes

| Route | Method | Implementation | Purpose |
| --- | --- | --- | --- |
| `/api/trend` | `GET` | `backend/app/analysis.py` | Existing trend case-file payload extended with `case_signature` and `evidence_trace`. All existing keys are preserved unchanged. |
| `/api/health/details` | `GET` | `backend/app/resilience.py`, `backend/app/main.py` | Non-secret status, availability, and cache age for `nasa_power`, `planet_streams`, `ai_explain`, `news`, and `monthly_forecast`. Does not make outbound upstream calls. |
| `/api/monthly-frames` | `GET` | `backend/app/monthly.py` | Coarse local grid (`1x1` to `3x3`) of observed monthly values and anomalies (`1981`–present), with explicit grid resolution, provenance, and missing-cell handling. |
| `/api/monthly-forecast` | `GET` | `backend/app/monthly.py` | Backtested 1–3 month local forecast grid (`1x1` to `3x3`) for `T2M`, `PRECTOTCORR`, and `CLOUD_AMT` only. Withholds forecast frames when `eligible == false`. |
| `/api/explanations` | `POST` | `backend/app/explanations.py` | "Why might this be happening?" synthesis grounded in server-computed statistics (`case_signature` or `lat`/`lon`/`variable`/`start`/`end`), with science-domain citation filtering and curated fallback. |
| `/api/news` | `GET` | `backend/app/news.py` | Live news context (`news context, not scientific evidence`) for saved locations plus a fixed global rotation set, with deterministic `green`/`amber`/`red` severity and category rules. |

---

## 2. Minimal Frontend API Helpers (`frontend/src/api.js`)

The following minimal helper functions have been added to `frontend/src/api.js` (no presentation files were touched):

```js
import {
  fetchHealthDetails,
  fetchMonthlyFrames,
  fetchMonthlyForecast,
  fetchExplanation,
  fetchNews,
} from "./api.js";

// 1. Health & feature status
const health = await fetchHealthDetails(signal);

// 2. Observed monthly grid frames (side: 1..3, step: 0.5..5.0)
const monthlyFrames = await fetchMonthlyFrames(
  { lat: 33.45, lon: -112.07, variable: "T2M", start: 2015, end: 2024, side: 3, step: 2.0 },
  signal
);

// 3. Monthly forecast grid (supported: T2M, PRECTOTCORR, CLOUD_AMT; horizon_months: 1..3)
const monthlyForecast = await fetchMonthlyForecast(
  { lat: 33.45, lon: -112.07, variable: "T2M", start: 1981, end: 2024, side: 1, step: 2.0, horizon_months: 3 },
  signal
);

// 4. "Why might this be happening?" explanation
// Option A: Pass the signed case_signature returned by GET /api/trend (plus matching coordinates/variable/period)
// Option B: Pass { lat, lon, variable, start, end, question }
const explanation = await fetchExplanation(
  {
    case_signature: trendData.case_signature,
    lat: 33.45,
    lon: -112.07,
    variable: "T2M",
    start: 1981,
    end: 2024,
    question: "What local factors could amplify warming here?",
  },
  signal
);

// 5. Live news context (optional JSON-encoded saved_locations array + variable filter)
const news = await fetchNews(
  {
    variable: "T2M",
    saved_locations: JSON.stringify([{ name: "Phoenix, USA", lat: 33.45, lon: -112.07 }]),
    max_items: 12,
  },
  signal
);
```

---

## 3. Deterministic Offline Fixtures

Deterministic fixture payloads generated directly from the offline test suite live in:

- **`backend/tests/fixtures/v2_fixtures.json`**

Top-level keys in `v2_fixtures.json`:
- `health_details`: Sample response from `GET /api/health/details`
- `trend_with_evidence_trace`: Sample response excerpt (`case_signature`, `evidence_trace`, `stats`, `PlainEnglish`) from `GET /api/trend`
- `monthly_frames`: Sample `2x2` grid response from `GET /api/monthly-frames`
- `monthly_forecast_eligible`: Sample eligible 3-month forecast from `GET /api/monthly-forecast` (`T2M`)
- `monthly_forecast_ineligible`: Sample withheld/ineligible response from `GET /api/monthly-forecast` (`WS10M`)
- `explanation_ai_grounded`: Sample OpenAI-grounded response from `POST /api/explanations`
- `explanation_fallback`: Sample keyless/fallback response from `POST /api/explanations`
- `news_live`: Sample populated response from `GET /api/news`
- `news_unavailable`: Sample empty/degraded response from `GET /api/news`

You can import or copy portions of `backend/tests/fixtures/v2_fixtures.json` in `frontend/tests/` to write deterministic unit tests for:
- Evidence-trace adapter and verdict ladder rendering
- Monthly frame scrubber and forecast eligibility / withheld state
- News severity badge (`green`, `amber`, `red`), category chips, and empty/unavailable fallback states
- Explanation modal states (`available`, `fallback`, unverified claims removed, rate-limited)

---

## 4. Environment Variable Reference (Names Only — Never Values)

The backend reads only environment variable names (with safe defaults when unset):

| Variable Name | Default | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | *(unset)* | Enables live OpenAI synthesis on `POST /api/explanations`. When unset, `POST /api/explanations` returns curated fallback (`status: "fallback"`) using `backend/app/reasons.py` and server-computed statistics. |
| `OPENAI_EXPLANATION_MODEL` | `gpt-4.1-mini` | Model identifier sent to the OpenAI Responses API. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL for OpenAI Responses API calls. |
| `OPENAI_TIMEOUT_SECONDS` | `12.0` | Strict timeout for OpenAI requests. |
| `OPENAI_WEB_SEARCH` | `true` | Enables `web_search_preview` tool for retrieving domain-allow-listed scientific citations. |
| `EXPLANATION_CACHE_TTL_SECONDS` | `86400` | 24-hour TTL for signature-keyed explanation cache. |
| `EXPLANATION_RATE_LIMIT_MAX` | `10` | Max uncached explanation syntheses per window per client IP. |
| `EXPLANATION_RATE_LIMIT_WINDOW_SECONDS` | `60` | Sliding window duration in seconds for explanation rate limiting. |
| `NEWS_PROVIDER` | `gdelt` | News adapter selection: `gdelt`, `json`, or `disabled`/`none`. |
| `NEWS_API_URL` | *(GDELT Doc 2.0 URL)* | Upstream endpoint URL for `gdelt` or `json` news provider. |
| `NEWS_API_KEY` | *(unset)* | Optional bearer token for `NEWS_PROVIDER=json` feeds. |
| `NEWS_TIMEOUT_SECONDS` | `8.0` | Strict timeout for upstream news provider requests. |
| `NEWS_CACHE_TTL_SECONDS` | `900` | 15-minute TTL for news responses. |
| `NASA_POWER_TIMEOUT_SECONDS` | `20.0` | Timeout per NASA POWER HTTP request. |
| `NASA_POWER_MAX_CONCURRENCY` | `6` | Bounded concurrency semaphore for NASA POWER fetches. |
| `NASA_POWER_CACHE_TTL_SECONDS` | `21600` | 6-hour TTL for in-memory NASA POWER monthly cache. |
| `STREAMS_TIMEOUT_SECONDS` | `20.0` | Timeout per planet stream HTTP request. |
| `STREAMS_CACHE_TTL_SECONDS` | `21600` | 6-hour TTL for in-memory planet stream cache. |
| `TD_CASE_SECRET` | *(ephemeral random)* | Secret key used for HMAC-SHA256 `case_signature` tokens. |
| `TD_ALLOWED_ORIGINS` | *(local dev ports)* | Comma-separated extra CORS origins; CORS allows `GET`, `POST`, and `OPTIONS`. |

---

## 5. Cache, Rate-Limit, and Feature-Degraded Behaviors

1. **NASA POWER & Planet Streams (`nasa_power.py`, `streams.py`)**
   - Bounded TTL in-memory cache (`21600s` default) with stale-entry retention (`86400s`).
   - If NASA POWER fails on a live request and a stale cached series exists for that grid cell, the backend serves the stale series rather than failing the request.
   - If no cache exists and upstream fails, the route returns HTTP `502` with a sanitized, non-secret `detail` string.
2. **Monthly Frames & Forecast (`monthly.py`)**
   - `GET /api/monthly-frames` fetches cells concurrently (`max_workers=6`). If a cell fails or has incomplete data for a month, `missing: true` and `value: null`, `anomaly: null` are returned for that cell/frame.
   - `GET /api/monthly-forecast` caches evaluations for 6 hours (`21600s`).
   - Unsupported variables (anything outside `T2M`, `PRECTOTCORR`, `CLOUD_AMT`), insufficient history (`< 120` complete months), or models that fail backtest skill (`skill_vs_seasonal_naive <= 0`) or split-conformal coverage (`< 0.72` on nominal `0.80`) return HTTP `200` with `eligible: false`, an explicit `reason`, and `frames: []`.
3. **Explanations (`explanations.py`)**
   - Cached by `case_signature` + normalized question for 24 hours (`86400s`). Cached hits bypass the rate limiter.
   - Uncached requests are rate-limited (`10` per `60s` per client IP); exceeding the limit returns HTTP `429`.
   - Client payloads containing `p_value`, `slope`, `stats`, `system_prompt`, or any undocumented key are rejected with HTTP `422` (`extra="forbid"`).
   - If `OPENAI_API_KEY` is missing or the upstream call fails/times out, the endpoint returns HTTP `200` with `status: "fallback"`, `fallback_used: true`, and a deterministic explanation grounded in `backend/app/reasons.py` and the verified case statistics.
   - Citations outside the scientific domain allow-list (`nasa.gov`, `noaa.gov`, `ipcc.ch`, `copernicus.eu`, `metoffice.gov.uk`, `wmo.int`, `nsidc.org`, `usgs.gov`, `nature.com`, `science.org`, `ametsoc.org`, `agu.org`, `iop.org`, `Cryosphere`/`BG`/`ACP`) are stripped automatically, and external-driver claims without surviving citations are removed and counted in `unverified_claims_removed`.
4. **Live News (`news.py`)**
   - Cached for 15 minutes (`900s`) with 6-hour stale fallback.
   - If the upstream news provider fails and a stale cache exists, returns `status: "stale"` with the last known valid items.
   - If no cache exists and upstream fails (or `NEWS_PROVIDER=disabled`), returns HTTP `200` with `status: "unavailable"` (or `"disabled"`), `items: []`, and a human-readable `message`. Never fabricates synthetic headlines.

---

## 6. Known Limits & What the Frontend Must Not Assume

- **Never assume `GET /api/monthly-forecast` returns frames.** Always check `response.eligible` (or `cell.eligible`). When `eligible === false`, `frames` is `[]` and the UI must display `response.reason` (or `cell.reason`) and disable forecast playback controls.
- **Never interpolate across missing grid cells.** In both `/api/monthly-frames` and `/api/monthly-forecast`, a cell with `missing === true` or `value === null` must be rendered as missing data (`No data`), never averaged from neighbors.
- **Never label coarse NASA POWER grid cells as city-block or street-level.** Always surface `grid.resolution_degrees` (`~0.5° × 0.625°`) and `provenance.spatial_resolution_note`.
- **Never send client-side statistics (`p_value`, `slope`, `stats`) to `POST /api/explanations`.** Send only `{ case_signature, lat, lon, variable, start, end, question }`. The backend will reject any extra fields with HTTP `422`.
- **Always distinguish observed frames from forecast frames.** Observed frames (`frame_type: "observed"`) and forecast frames (`frame_type: "forecast"`, `label: "Forecast — not observed data"`) must never share the same unlabelled timeline state.
- **Always display `disclaimer` on news items.** Every news panel or drawer must display `"news context, not scientific evidence"` (`response.disclaimer`) and treat `items: []` gracefully when `status` is `"unavailable"`, `"disabled"`, or `"empty"`.
- **Verdict ladder consistency.** Use `trend.evidence_trace.verdict` and `trend.evidence_trace.verdict_ladder` so the headline banner and the step-by-step Evidence Trace always show the exact same verdict label (`Strong trend`, `Moderate trend`, `Weak / emerging trend`, `No clear trend`, or `Insufficient data`).

---

## 7. Backend Verification Commands

```bash
# Run all 236 offline backend tests (199+ original + 33 V2 tests)
backend/.venv/bin/pytest backend/tests

# Run only the V2 test suites
backend/.venv/bin/pytest backend/tests/test_v2_*.py
```
