# V2 Backend Handoff for the Frontend

For whoever builds the V2 frontend (`codex/v2-frontend`). Full request and response schemas, with example payloads, are in [V2_API_CONTRACT.md](V2_API_CONTRACT.md); this file covers how to call each route, the saved fixtures, the server settings, how every route degrades, and what the UI must not assume.

Every statement here was checked against the running code and live responses (2026-11-15). Where this file and `V2_API_CONTRACT.md` ever disagree, the code wins: report the mismatch.

---

## 1. Routes

| Route | Method | Code | Purpose |
| --- | --- | --- | --- |
| `/api/trend` | `GET` | `analysis.py` | The existing case file, now with `case_signature` and `evidence_trace`. Every earlier field is unchanged. |
| `/api/health/details` | `GET` | `main.py`, `resilience.py` | Non-secret status and cache age for `nasa_power`, `planet_streams`, `meteomatics`, `ai_explanations`, `news` and `monthly_forecast`. Never calls an upstream service. |
| `/api/monthly-frames` | `GET` | `monthly.py` | Observed monthly values on a small local grid (1×1 to 3×3 cells) around one place, with provenance and per-cell missingness. |
| `/api/monthly-forecast` | `GET` | `monthly.py` | Backtested 1 to 3 month forecast for `T2M`, `PRECTOTCORR` and `CLOUD_AMT` only, on the same kind of grid. Returns frames only when `eligible` is `true`. |
| `/api/explanations` | `POST` | `explanations.py` | "Why might this be happening?": source-cited possible explanations for a server-verified trend, with a curated fallback. |
| `/api/news` | `GET` | `news.py` | Environmental and weather news context near saved places (GDELT by default), with deterministic `green`/`amber`/`red` severity. |
| `/api/live-weather` | `GET` | `meteomatics.py` | Meteomatics hourly weather for one place, next 1 to 72 hours. A separate source from NASA data. |

---

## 2. Calling them from the frontend (`frontend/src/api.js`)

The helpers pass the object you give them straight through as the query string (GET) or JSON body (POST). **Use the parameter names below exactly**: an unknown query parameter is silently ignored by a GET route (you get defaults, not an error), and an unknown field in the POST body is rejected with HTTP 422.

```js
import {
  fetchHealthDetails, fetchMonthlyFrames, fetchMonthlyForecast,
  fetchExplanation, fetchNews, fetchLiveWeather, fetchTrend,
} from "./api.js";

// Server status for each feature (use it to hide or explain optional panels)
const health = await fetchHealthDetails(signal);

// Observed monthly frames. variable, lat, lon required. n = 1..3 cells per side, size = grid width in degrees (0..12).
// start_year/end_year: at most 10 years per request (default: the last 3 full years).
const frames = await fetchMonthlyFrames(
  { variable: "T2M", lat: 33.45, lon: -112.07, start_year: 2023, end_year: 2025, n: 3, size: 2.0 }, signal);

// Forecast. Always check forecast.eligible before using frames. horizons = 1..3 months.
const forecast = await fetchMonthlyForecast(
  { variable: "T2M", lat: 33.45, lon: -112.07, start_year: 1981, end_year: 2025, horizons: 3, n: 3, size: 2.0 }, signal);

// "Why might this be happening?" Send the signature from /api/trend, plus an optional short question (max 240 characters).
// Nothing else is accepted: no statistics, no hidden prompt text. (Or send variable, lat, lon, start_year, end_year instead.)
const trend = await fetchTrend({ variable: "T2M", lat: 33.45, lon: -112.07, start_year: 1981, end_year: 2025 }, signal);
const why = await fetchExplanation({ case_signature: trend.case_signature, question: "What could amplify warming here?" }, signal);

// News: locations = comma-separated place ids or "Name:lat:lon" entries (up to 5), limit = 1..50.
const news = await fetchNews({ locations: "delhi,phoenix,Home:51.5:-0.12", limit: 12 }, signal);

// Live weather: lat, lon required; hours = 1..72 (default 24).
const live = await fetchLiveWeather({ lat: 52.52, lon: 13.46, hours: 24 }, signal);
```

`case_signature` is signed by the server. A signature issued before a server restart stops verifying (HTTP 422) unless `TD_CASE_SECRET` is set; on a 422 from `/api/explanations`, request the trend again and retry once.

---

## 3. Saved fixtures (no network, no keys)

`backend/tests/fixtures/v2_fixtures.json` holds one deterministic response for every route and the main degraded states. They are produced by the offline test suite and checked by `backend/tests/test_v2_contract_fixtures.py`.

| Fixture key | Route and state |
| --- | --- |
| `trend_with_evidence_trace` | `/api/trend`: `case_signature` and `evidence_trace` plus the main existing blocks |
| `monthly_frames` | `/api/monthly-frames`: a 2×2 grid, observed frames |
| `monthly_forecast_eligible` | `/api/monthly-forecast`: eligible `T2M`, three forecast frames |
| `monthly_forecast_withheld` | `/api/monthly-forecast`: withheld (`unsupported_variable`), `frames: []` |
| `explanations_ok` / `explanations_fallback` | `/api/explanations`: live-AI answer shape, and the curated-fallback shape |
| `news` | `/api/news`: two items |
| `health_details` | `/api/health/details` |
| `live_weather_unconfigured` / `live_weather_available` | `/api/live-weather`: no credentials, and a three-hour reply with one `null` value |

Use them for frontend unit tests and while the API is unavailable. The `explanations_ok` fixture reuses the fallback text with `status: "ok"`: it is a shape sample, not a real model answer.

---

## 4. Server settings (names and real defaults; values are never shown or logged)

All optional. With none set, the app runs fully: trends, monthly frames and forecast, curated explanations, and news (GDELT needs no key).

| Name | Default | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Turns on live AI explanations. Unset: `/api/explanations` answers from the curated text (`status: "no_key"`). |
| `OPENAI_EXPLANATION_MODEL` | `gpt-4o-mini` | Model name sent to the Responses API. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1/responses` | Full Responses API URL. |
| `OPENAI_TIMEOUT_SECONDS` | `20` (2 to 45) | Timeout for one OpenAI call. |
| `OPENAI_WEB_SEARCH` | `true` | Lets the model search the web; its citations must come from what it retrieved. |
| `EXPLANATION_CACHE_TTL_SECONDS` | `86400` | Cache of verified explanations, per case and question. |
| `EXPLANATION_RATE_LIMIT_MAX` / `EXPLANATION_RATE_LIMIT_WINDOW_SECONDS` | `15` / `300` | Live AI calls allowed per client address per window. |
| `NEWS_PROVIDER` | `gdelt` | `gdelt`, `json_feed` (also `azure`, `custom`), or `disabled`. |
| `NEWS_API_URL`, `NEWS_API_KEY` | GDELT URL, unset | Endpoint and optional key for a `json_feed` provider. |
| `NEWS_TIMEOUT_SECONDS` | `12` (2 to 30) | Timeout for one news request. The whole `/api/news` call also has a fixed 20-second budget. |
| `NEWS_CACHE_TTL_SECONDS` | `900` (minimum 900) | News cache. |
| `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` | unset | Turns on `/api/live-weather`. Both are required. |
| `METEOMATICS_BASE_URL` | `https://api.meteomatics.com` | Provider URL. |
| `METEOMATICS_TIMEOUT_SECONDS` / `METEOMATICS_CACHE_TTL_SECONDS` | `10` / `900` | Timeout and cache for live weather. |
| `NASA_POWER_TIMEOUT_SECONDS` | `30` (2 to 60) | Timeout per NASA POWER request. |
| `NASA_POWER_MAX_CONCURRENCY` | `3` (1 to 8) | Parallel NASA requests. |
| `NASA_POWER_CACHE_TTL_SECONDS` | `21600` | NASA series cache (a stale entry is used only if a refresh fails). |
| `STREAMS_TIMEOUT_SECONDS` / `STREAMS_CACHE_TTL_SECONDS` | `30` / `43200` | Planet streams (GISTEMP, CO₂, sea ice, climate rhythms). |
| `TD_CASE_SECRET` | random per process | Signs `case_signature`. Set it on any host that restarts or runs more than one instance. |
| `TD_ALLOWED_ORIGINS` | local dev ports | Extra browser origins allowed by CORS (GET, POST, OPTIONS). |

---

## 5. How each route degrades

| Situation | What the UI receives |
| --- | --- |
| NASA POWER slow or down | `/api/trend` and friends return HTTP 502 with a short, non-secret `detail` string, unless every series needed is still in the cache, in which case the older cached data is used silently. |
| `/api/monthly-frames`: a cell fails or has gaps | HTTP 200. Failed or missing cells and months are `missing: true` with `value: null`; `coverage` says how many cells succeeded. Nothing is interpolated. |
| `/api/monthly-forecast` not earned | HTTP 200 with `eligible: false`, a `reason_code`, a plain `reason`, `frames: []`. Reasons: unsupported variable, too little history, constant series, too few backtest origins, too many gaps, a grid cell failed, no skill over seasonal-naive, or poor interval coverage. |
| No OpenAI key | `/api/explanations` returns HTTP 200, `status: "no_key"`, curated drivers and citations. |
| AI call failed, or the answer failed validation | HTTP 200, `status: "fallback"`, curated text. `fallback_reason` is a code such as `timeout`, `rate_limited`, `invalid_json`, `http_500`, `validation_failed`. |
| Too many AI calls | HTTP 200, `status: "rate_limited"`, `retry_after_seconds`, curated text. (Not HTTP 429.) |
| Trend not significant | HTTP 200, `status: "no_evidence"`, `drivers: []`. The AI is never asked to invent reasons for a trend that is not there. |
| News provider slow or failing | HTTP 200. `items` may be empty or partial; `partial_failures` lists each location with a code (`timeout`, `rate_limited`, …); `stale: true` with the last good items if the cache holds some; otherwise `empty_reason`. Never placeholder headlines. |
| No Meteomatics credentials | HTTP 200, `available: false`, `status: "unconfigured"`. |
| Meteomatics fails | `status: "stale"` with the last good series, or `status: "unavailable"` with a plain `reason`. |
| Place or period cannot be analysed (too few complete years, land-only variable over ocean) | HTTP 422 with a plain `detail` message. |
| Bad parameters | HTTP 422 (FastAPI validation of types and ranges), HTTP 400 for an invalid or too-short year range, HTTP 404 for an unknown variable. |

---

## 6. Known limits, and what the frontend must not assume

- **Check `eligible`.** A forecast response can exist with no frames. Show `reason`, keep the observed timeline, and disable forecast playback.
- **Forecast is withheld if any one grid cell fails the gate**, even when others pass (rainfall around Delhi is a real example). That is by design: no mixed grid.
- **Never interpolate** a missing cell. Draw it as missing.
- **Never call a grid cell a city or street.** NASA POWER cells are about 0.5° × 0.625°. Show `grid` and `provenance`.
- **Label forecast frames** with their `badge` ("Forecast — not observed data") and never put them on the same unlabelled scale as observed frames.
- **The first `/api/news` request can take up to 20 seconds.** Call it lazily and show a loading state. Results are cached for 15 minutes.
- **News severity is editorial triage**, not an official rating: red = reported emergency, amber = a weather phrase such as "flood warning", green = otherwise. Always show `label` ("news context, not scientific evidence"), date, publisher and link.
- **Live weather is not NASA data and not the monthly forecast.** Show its `label` and `source_note`. `available: false` is a normal state.
- **Do not send statistics to `/api/explanations`.** Only `case_signature` (or variable, place and years) and an optional `question`.
- **Use the server's verdict.** `evidence_trace.verdict.label` is one of "Strong evidence of a trend", "Some evidence — investigate carefully", "No clear evidence yet", "Not enough data to tell"; `evidence_trace.verdict.ladder` lists all four. When the server cannot analyse a place (too few complete years of data, a land-only variable over ocean, a variable that does not vary) `/api/trend` returns HTTP 422 with a plain `detail` message, not a verdict: show it as "Not enough data to tell" with that message. A year range shorter than 20 years is HTTP 400.
- **Rate limiting is per client address as the server sees it.** Behind a proxy that does not forward the visitor's address, all visitors share one allowance.
- **Not run against the real services:** the live OpenAI call and the Meteomatics call have only been tested against offline fakes (no keys were available). Before a demo, run each once with a real key and check the result. Developers report that combining OpenAI's web-search tool with structured or JSON output can cut the JSON short or leave the citation list empty; the server validates everything and falls back to the curated text in those cases, so the feature degrades instead of breaking, but you may see `fallback_reason: "validation_failed"` more than expected.
- **Forecast model choice has a mild optimism bias:** the best of four candidate models is picked and then tested against the baseline on the same backtest. The safeguards (must win at every horizon, 1.5% margin, held-out coverage) reduce it; they do not remove it.

---

## 7. Verification

```powershell
cd backend
.venv\Scripts\activate
pytest                      # the whole offline suite (no keys, no network)
pytest tests/test_v2_*.py   # only the V2 tests
```
