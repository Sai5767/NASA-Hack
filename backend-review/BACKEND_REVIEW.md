# Backend review: issues found, not fixed yet

Read-only review of `backend/` at commit `29a40c9`, done by two independent reviewers (A: API wiring and data sources; B: statistics, forecast, ML, news, explanations). Nothing in the code was changed.

- Test baseline: **266 passed, 1 failed** (Python 3.12.10, fastapi 0.115.6, httpx 0.28.1, starlette 0.41.3, pydantic 2.14.3). The failure is A3.
- Repro scripts are in [`repros/`](repros/). Run them with any Python that has `backend/requirements.txt` installed, e.g. `python backend-review/repros/a_repro_gzip.py`. They add `backend` to `sys.path` themselves.
  - `a_repro_gzip.py`: A1, A3
  - `a_repro_monthly.py`: A2, A5
  - `a_repro_threads.py`: A4, A6
  - `a_repro_api.py`: API validation checks
  - `b_repro1.py`: B2 (R2), B10 (R3), B5 (R4), B9 (R5), B8 (R7)
  - `b_repro2.py`: A6 (R6b), B6 (R8)
  - `b_repro3.py`: B1
- "Confirmed" means the reviewer ran a repro and saw the failure. A1, A3 and B1 were also re-run independently and reproduced.

## Summary

| ID | Severity | Area | Issue |
|---|---|---|---|
| A1 | **Critical** | resilience.py | Every gzip-compressed upstream reply fails (OpenAI explanations and news break live) |
| A2 | High | monthly.py | Monthly forecast frames mix different calendar months under one label |
| B1 | High | stats.py / analysis.py | Trend can be "significant" with slope 0, and outputs contradict each other |
| A3 | Medium | test_v2_resilience_and_trace.py | The one failing test: wrong on Windows clock resolution |
| A4 | Medium | main.py / caches | `/api/health/details` can 500 from a cross-thread dict race |
| A5 | Medium | monthly.py | `/api/monthly-forecast` blocks the event loop for over 1 s |
| A6 | Medium | analysis.py `grid_points` | Grid clamps instead of wrapping: duplicate cells near poles and the date line (found by both reviewers) |
| A7 | Medium | nasa_power.py | `NASA_POWER_MAX_CONCURRENCY` does not limit concurrency globally |
| B2 | Medium | analysis.py | Emergence year uses the unadjusted p-value |
| B3 | Medium | forecast.py | Forecast lab's held-out coverage is contaminated by model selection |
| B5 | Medium-low | news.py | News filter drops "flooding", "flooded", "storm" headlines |
| A8 | Low-medium | meteomatics.py | Live-weather cache can start at the previous UTC hour |
| A9 | Low | meteomatics.py | Malformed `METEOMATICS_BASE_URL` gives 500 instead of "unavailable" |
| A10 | Low | monthly.py | Inconsistent `calibration` object shape |
| A11 | Low | monthly.py | Dead quality-gate branch |
| A12 | Low | main.py | Year defaults frozen at import time |
| A13 | Low | main.py / version.py | `TD_VERSION` in `backend/.env` is ignored |
| A14 | Low | resilience.py | Rate limiter crashes with limit 0 |
| A15 | Low | resilience.py | Shared retry helper retries 429 and ignores Retry-After |
| A16 | Low (docs) | V2_BACKEND_HANDOFF.md | Backspace control character in the doc |
| B6 | Low | context.py | ENSO adjustment is not a partial regression |
| B7 | Low | streams.py | Planet-streams health never recorded; TTL setting has no effect |
| B8 | Low | ml.py / archetypes.py | Empty k-means cluster crashes `cluster_places` |
| B9 | Low | news.py | URL canonicalisation keeps `_hsenc` and drops ports |
| B10 | Low | stats.py | OLS "perfect line" test uses an absolute floor |
| B11 | Low | explanations.py | Citation dedup and dead-branch leftovers |

---

## A1 — CRITICAL — `request_with_resilience` breaks on every gzip/deflate-compressed reply

- **File:** `backend/app/resilience.py` lines 505–522.
- **What is wrong:** The streaming download already decompresses the body. The code then builds a new `httpx.Response` that still carries the upstream `content-encoding` header, so httpx decompresses the plain bytes a second time and raises `DecodingError`.
- **Root cause:**
  ```python
  async for chunk in streamed.aiter_bytes():   # aiter_bytes() yields DECODED bytes
      ...
  return httpx.Response(status_code=streamed.status_code,
                        headers=streamed.headers,          # still says content-encoding: gzip
                        content=b"".join(chunks), request=streamed.request)
  ```
  - `httpx.Response(content=...)` runs the decoder named in `content-encoding`, which fails on already-decoded bytes.
  - `DecodingError` subclasses `httpx.HTTPError`, so it lands in `except httpx.HTTPError` (lines 586–595) as code `http_error`, not retryable.
  - httpx sends `Accept-Encoding: gzip, deflate` by default; OpenAI and GDELT normally compress.
- **Who is affected:** `explanations.py:773` (OpenAI), `news.py:523` (GDELT), `news.py:556` (json_feed). Every live AI explanation falls back with `fallback_reason: "http_error"`; every news fetch becomes a partial failure.
- **Reproduce (confirmed):** `a_repro_gzip.py` sends `gzip.compress(b'{"ok": true}')` with `content-encoding: gzip` through `httpx.MockTransport`. Observed: `UpstreamServiceError http_error ... Error -3 while decompressing data: incorrect header check`. Expected: status 200, `.json() == {"ok": True}`.
- **Why tests pass:** `test_real_http_path_returns_small_responses_normally` (`test_v2_resilience_and_trace.py:232`) sends an uncompressed body; news and explanation tests mock above this layer.
- **Fix direction:** Keep `aiter_bytes()` so the 4 MB cap counts decompressed bytes (zip-bomb protection). Build the returned Response with headers copied minus `content-encoding` and `content-length`. Add a test sending a gzip body through `_client_serving` (`test_v2_resilience_and_trace.py:226`).

## A2 — HIGH — Monthly forecast frames can mix different calendar months under one label

- **File:** `backend/app/monthly.py` lines 873–886, 930–932, 973–1016 (trailing trim at 334–336).
- **What is wrong:** Each cell's training series ends at its own last valid month after trailing missing months are trimmed. Frame `h` takes its label from the centre cell but fills every cell from `ev["forecasts"][h_idx]`. If some cells end a month earlier, the frame labelled "2025-01" holds their 2024-12 forecast.
- **Root cause:**
  ```python
  ref_fc = primary_eval["forecasts"][h_idx]
  for c, ev in zip(cell_records, cell_evals):
      fc = ev["forecasts"][h_idx]          # no check that fc["month"] == ref_fc["month"]
  ```
  The 5% missing-month allowance (`MAX_MISSING_FRACTION`) lets a missing final month pass the quality gate.
- **Reproduce (confirmed):** `a_repro_monthly.py`: 3×3 grid at (33.45, -112.07), 1981–2024, northern row's `202412` set to None. Response is `eligible: true`; frames[0] labelled "2025-01"; cells r2_c0..r2_c2 have forecasts `['2024-12','2025-01','2025-02']`, other rows `['2025-01','2025-02','2025-03']`.
- **Fix direction:** Truncate every cell to the common (earliest) last month before evaluating, or withhold with a new reason_code such as `misaligned_cells`. Also assert in the frame loop that every `fc["month"] == ref_fc["month"]`. A new reason_code must also go in `docs/V2_API_CONTRACT.md` §3, `docs/V2_BACKEND_HANDOFF.md` §5, and a test in `test_v2_monthly.py`.

## B1 — HIGH — A trend can be "significant" with a slope of exactly 0, and the outputs contradict each other

- **Files:** `backend/app/stats.py` 278–282; `backend/app/analysis.py` 252 (sign), 300 (`_summary`), 376/381 (checks); `backend/app/explanations.py` 404 and 812.
- **What is wrong:** With many tied values (zeros in snowfall, desert rain), Mann–Kendall can be significant while Sen's slope is exactly 0. The result then has `significant: true` with `direction: "no significant trend"` and `sign: "flat"`. The summary says "no statistically significant trend … 95% range 0 to 0", yet the "mk" check passes, the grade is "weak", the verdict `some_evidence`, and the explanation says "no statistically significant trend".
- **Root cause:**
  ```python
  significant = p_value < alpha
  if not significant or sens == 0:
      direction = "no significant trend"      # but significant stays True
  ```
  - `analysis._summary` branches on `mk.significant and mk.sens_slope != 0`.
  - `checks["mk"]`, `_grade` and `map_verdict` use `mk.significant` alone.
  - `full_sign = 0`, so the "ols", "months" and "noise" checks all fail even though OLS is significant and positive.
  - `explanations.generate_explanation` line 812 gates only on `stats["significant"]` (would send to the AI); `_build_curated_fallback` line 404 gates on `not significant or sign not in ("up","down")`.
  - Ledger, sweep, grid and world views count `significant` / `significant_fdr` rows with `sign == "flat"`; `reason_for(..., "flat")` returns the default text "The data show a trend…".
- **Reproduce (confirmed, re-run):** `b_repro3.py`. 44 years: 24 zeros, then 10 zeros + 10 values in 0.1–0.8 shuffled (seed 0); `analyze_series("PRECSNOLAND", 45, 10, monthly, 1981, 2024)`. Observed: p = 0.0109, `significant=True`, slope 0.0, `direction="no significant trend"`, `sign="flat"`, grade weak 1/5, verdict `some_evidence`, checks `mk=True` and all others False, OLS p = 0.009 slope +0.079/decade. Expected: one consistent decision.
- **Fix direction:** Pick one rule and apply it everywhere: e.g. `significant = p < alpha and sens != 0`, or keep `significant` and derive `direction`/`sign` from the sign of S instead of Sen's slope. Make `analysis._summary`, `_grade`, `checks`, `explanations` 404/812 and the ledger/sweep/world/grid counts agree. Add a test with heavy ties and zero median slope. Optionally a tie-aware slope so zero-inflated series don't give a 0–0 interval.

## A3 — MEDIUM — The known failing test is wrong on Windows clock resolution

- **Test:** `test_v2_resilience_and_trace.py::test_bounded_ttl_cache_respects_ttl_lru_and_stale_lookup`, lines 73–78 (fails at 74). **Code:** `backend/app/resilience.py:323–325`.
- **What is wrong:** The test assumes `ttl_override=0.0` expires a just-written entry. The code treats it as stale only when `age > ttl`:
  ```python
  age = max(0.0, time.monotonic() - mono_ts)
  ttl = self.ttl_seconds if ttl_override is None else float(ttl_override)
  is_stale = age > ttl
  ```
- **Root cause:** On Windows `time.monotonic()` is GetTickCount64 with 0.015625 s resolution. `put()` and `get()` happen in the same tick, so `age == 0.0` and `0.0 > 0.0` is False; 1 comes back. Passes on Linux. Also `ttl_override` skips the `max(1.0, ...)` clamp the constructor applies (line 311).
- **Production impact:** none; real TTLs are 60 s or more.
- **Reproduce (confirmed, re-run):** `a_repro_gzip.py` prints `get with ttl 0: 1` and the clock info.
- **Fix direction:** Make the test deterministic: monkeypatch `app.resilience.time.monotonic` to move forward after `put`, or backdate the entry as `test_v2_meteomatics.py:288` does. Optionally also `is_stale = ttl <= 0 or age > ttl` in the code; if so, give `nasa_power._cache_get` (line 160, same `>` comparison) the same treatment.

## A4 — MEDIUM — `/api/health/details` can return 500 from a cross-thread dict race

- **Files:** `backend/app/main.py:553` (`def health_details()` is sync, so FastAPI runs it in the threadpool); `backend/app/nasa_power.py:181` (`[... for k in _cache if k in _cache_timestamps]`); `backend/app/resilience.py:368` (`BoundedTTLCache.stats()` iterates `self._store.values()`, used by Meteomatics, news and explanation caches).
- **What is wrong:** The health handler iterates module-level OrderedDicts on a worker thread while the event-loop thread mutates them (`_cache_put`, `move_to_end`, `popitem`) → `RuntimeError: OrderedDict mutated during iteration` → HTTP 500.
- **Reproduce (confirmed):** `a_repro_threads.py`: one thread writes to nasa_power's cache while `cache_health()` runs 300 times on another; 6 RuntimeErrors.
- **Fix direction:** Simplest: make `health_details` (and `version`) `async def` so they run on the event loop. Also or instead: snapshot before iterating (`list(_cache.items())`, `list(self._store.values())`) or use a lock.

## A5 — MEDIUM — `/api/monthly-forecast` blocks the event loop for over a second

- **Files:** `backend/app/monthly.py:930` (synchronous `evaluate_monthly_series` per cell inside an async function); `backend/app/main.py:632–658` (no cap on the year span).
- **What is wrong:** All model fitting is pure-Python CPU work inside the async handler; every other request, including health checks, stalls meanwhile.
- **Reproduce (confirmed):** `a_repro_monthly.py`: 9 cells, 1981–2024 took 1.3 s inside `build_monthly_forecast`.
- **Fix direction:** Run per-cell evaluations with `await asyncio.to_thread(...)`. Consider caching per (variable, cell, years, horizons) and capping the training span.

## A6 — MEDIUM — `grid_points` clamps instead of wrapping (found by both reviewers; B4 merged here)

- **File:** `backend/app/analysis.py:744–755`. Used by `/api/grid` (`main.py:223`) and `/api/monthly-frames` / `/api/monthly-forecast` (`monthly.py:74`).
- **What is wrong:**
  ```python
  return [round(min(max(v, low), high), 4) for v in values]
  ```
  Near a pole, several rows collapse onto ±90 (identical duplicate cells). Longitudes past ±180 clamp to 180 instead of wrapping. Duplicates are counted twice in Benjamini–Hochberg, counts and the composite, and fed to Moran's I as identical neighbours on an equal-spacing grid, inflating "clustered".
- **Reproduce (confirmed):**
  - `grid_points(85, 0, 40, 5)` → 25 points, 20 unique; lats `[65, 75, 85, 90, 90]`.
  - `grid_points(88, 0, 10, 5)` → lat rows `83, 85.5, 88, 90, 90`.
  - `grid_points(0, 178, 10, 3)` → lons `173, 178, 180`; expected `173, 178, -177`.
  - Scripts: `a_repro_threads.py`, `b_repro2.py` section R6b.
- **Fix direction:** Wrap longitude with `((v + 180) % 360) - 180`. For latitude, shift the window to fit inside ±90, or reject with 400/422 when it crosses a pole, or de-duplicate (if cells are dropped, pass None for them to Moran's I). `test_grid.py::test_grid_points_stay_within_valid_coordinates` only checks bounds; add checks for distinct points and longitude wrap.

## A7 — MEDIUM — `NASA_POWER_MAX_CONCURRENCY` does not do what the docs say

- **Docs:** `docs/V2_BACKEND_HANDOFF.md:103` says it controls "Parallel NASA requests".
- **Code:** `nasa_power.py:211–239` `_request` has no semaphore. `monthly.py:140` and `:827` create a new `asyncio.Semaphore(cfg.nasa_max_concurrency)` per request (limits only within one request). Other routes use hard-coded limits: `main.py:72` (`MAX_CONCURRENT_FETCHES = 3`), `main.py:69` (`MAX_WORLD_CONCURRENCY = 4`), plus `ledger.py` and `archetypes.py`.
- **Effect:** N concurrent users → N× parallel NASA calls; no dedup of identical in-flight fetches.
- **Fix direction:** Module-level semaphore in `nasa_power` (created lazily on the running loop) sized from config, used in `_request`. Optionally single-flight dedup keyed on the cache key. Otherwise correct the docs.

## B2 — MEDIUM — Emergence year uses the unadjusted p-value

- **File:** `backend/app/analysis.py` 159–171; call at 163: `z, p = mk_z_and_p(values[:k])`.
- **What is wrong:** The emergence series and year use the naive Mann–Kendall p-value (no serial-correlation inflation), while the headline, checks and grade use the adjusted one. For persistent series, `emergence.year` is set ("emerged in 2007") while `stats.significant` is False. Also exposed as `emergence_year` in `/api/sweep` (`main.py:176`) and Planet Vitals (`planet.py:62`).
- **Root cause:** `mk_z_and_p` (`stats.py` 218–223) skips `variance_factor_from_autocorr`; `_emergence` line 166 tests `series[-1]["p"] < ALPHA` on the naive value.
- **Reproduce (confirmed):** `b_repro1.py` section R2. AR(1), phi = 0.7, small trend, 40 years. Seed 0: p_adj 0.103, p_naive 0.033, `significant=False`, `emergence.year=2015`. Seed 3: p_adj 0.357, p_naive 0.006, year 2001.
- **Fix direction:** Compute emergence p-values the same way as the headline: call `mann_kendall(values[:k], times[:k]).p_value`, or apply `variance_factor_from_autocorr` per prefix. At minimum return `year=None` when `mk.significant` is False. Update `test_analysis.py` 36–37 if semantics change.

## B3 — MEDIUM — Forecast lab's held-out coverage is contaminated by model selection

- **File:** `backend/app/forecast.py` 196–217 (and 227–237 for replays).
- **What is wrong:** `best_id` is chosen by MAE over all backtest origins, including test origins (`o > cut`), then its coverage is scored on those same origins, so `coverage.test` is not out of sample. Replay bands use `q_all`, calibrated on errors that include the replays' own. Temporal leak: a calibration origin `o <= cut` with horizon h uses targets up to `cut + h - 1`, inside the test period.
- **Root cause:**
  ```python
  best = min(summary, key=lambda s: s["mae"])        # over all origins
  ...
  q_cal = conformal_quantile([e for o, e in rows if o <= cut])
  ```
- **Reproduce:** By code reading only; size of the optimism not measured.
- **Fix direction:** Select the model (and baseline) using only origins `<= cut`; score coverage on `> cut`. For calibration keep only rows where `o + h - 1 <= cut`. Label replay bands as in-sample or compute from origins before each replay. `test_forecast.py::test_conformal_bands_cover_close_to_the_nominal_rate_out_of_sample` should stay valid.

## B5 — MEDIUM-LOW — News filter drops common word forms

- **File:** `backend/app/news.py` 178–181 (`_word_regex`), 167–175 (`GENERIC_RELEVANCE_KEYWORDS`), 100–117 (red keywords).
- **What is wrong:** "Flooding swamps Delhi streets…", "Flooded homes evacuated in Sydney…", "Storm Ciaran batters London…" are judged not relevant and dropped. "evacuated" doesn't match "evacuate"/"evacuation", so it is not rated red. The GDELT query (line 513) searches "storm", so many fetched results are discarded.
- **Root cause:** Suffix group `(?:s|es)?(?![a-z0-9])` never matches "flooding"/"flooded"; "storm" appears only in compounds ("thunderstorm", "winter storm").
- **Reproduce (confirmed):** `b_repro1.py` section R4: `is_environmentally_relevant` returns False for the three headlines.
- **Fix direction:** Allow `(?:s|es|ed|ing)?` or list inflected forms explicitly; add "storm"/"storms" to relevance keywords. Keep "floodlights" excluded (`test_v2_news.py` line 190). Add tests for these headlines.

## A8 — LOW-MEDIUM — Live-weather cache ignores the hour

- **File:** `backend/app/meteomatics.py:482` (`cache_key = (round(norm_lat, 2), round(norm_lon, 2), int(hours))`) and 490–500.
- **What is wrong:** A reply fetched at 10:55 is served fresh until 11:10; after 11:00 its `request.start`, `series[0]` and `current` are the 10:00 row. Contract §7 says the series starts at the current UTC hour. The cached `location` is also the first caller's 4-decimal coordinates.
- **Reproduce:** Code reading only.
- **Fix direction:** Add `start_iso` (hour floor) to the cache key, or drop rows older than the current hour when serving from cache (fresh and stale). Rewrite `location` to the current caller's rounded coordinates.

## A9 — LOW — Malformed `METEOMATICS_BASE_URL` gives 500 instead of "unavailable"

- **File:** `backend/app/meteomatics.py:146–147` raises ValueError (called at 288); `fetch_live_weather` (556) catches only `UpstreamServiceError`; `main.py:598` has no handler.
- **Effect:** A base URL containing "@" makes `/api/live-weather` return 500, contradicting contract §7 ("always HTTP 200 when the query itself is valid").
- **Fix direction:** Convert the ValueError to `UpstreamServiceError(code="misconfigured")`, or validate in `load_config` / `meteomatics_configured`.

## A10 — LOW — Inconsistent `calibration` object shape in monthly forecast

- **File:** `backend/app/monthly.py` 560, 578, 593 use `{"nominal_coverage","empirical_coverage","n_test","passed"}`; 691–700 use `n_test_origins`, `min_required_coverage`, `interval_half_width_by_horizon`.
- **Effect:** `build_monthly_forecast:950` passes either shape to the client. `failed_ev["calibration"] or primary_eval["calibration"]` never falls back (dict always non-empty). `failed_ev["models"] or primary_eval["models"]` (949) shows the centre cell's scoreboard next to a different failing cell's reason. `n_test_origins` actually counts (origin, horizon) pairs.
- **Fix direction:** One calibration schema in every branch; don't substitute the primary cell's models/calibration for a different failing cell; rename or document `n_test_origins` in contract §3.

## A11 — LOW — Dead quality-gate branch

- **File:** `backend/app/monthly.py:583–596`. `max_origins = min(24, n - 72 - horizons)`; with n ≥ 120 (`MIN_FORECAST_MONTHS`, checked at 548) and horizons ≤ 3 this is always 24, so `insufficient_backtest_origins` can never be returned.
- **Fix direction:** Keep as a documented defensive branch, or make the threshold meaningful (the reason code is in the contract).

## A12 — LOW — Year query defaults frozen at import time

- **File:** `backend/app/main.py` 125, 143, 217, 331, 350, 367, 425, 439, 459, 475, 606, 607, 638.
- **What is wrong:** `Query(date.today().year - 1)` is evaluated once at import. A server running across New Year keeps last year's defaults, while `_check_years` (92) uses the live date.
- **Fix direction:** `Optional[int] = None` and resolve the default inside the handler.

## A13 — LOW — `TD_VERSION` from `backend/.env` is ignored

- **File:** `backend/app/main.py:67` vs `:77`. `from .version import VERSION` runs `read_version()` at import (`version.py:40`) before `load_local_env()` at line 77, so `TD_VERSION` in `.env` (allowed by `env_file.py:28`) never applies. No other module reads env at import.
- **Fix direction:** Call `load_local_env()` before the app imports (top of `main.py` or `app/__init__.py`), or compute VERSION lazily.

## A14 — LOW — `SlidingWindowRateLimiter` crashes with limit 0

- **File:** `backend/app/resilience.py:407–410`. With `limit=0`, `len([]) >= 0` is True, then `timestamps[0]` raises IndexError. Not reachable today (config clamps to ≥ 1 at line 157), but any direct caller with `max_requests=0` hits it.
- **Fix direction:** Guard empty `timestamps` (retry after the full window), or clamp `limit >= 1`.

## A15 — LOW — Shared retry helper retries 429 and ignores Retry-After

- **File:** `backend/app/resilience.py:466` and `535–537`. 429 is in `RETRYABLE_HTTP_STATUS`, so GDELT and OpenAI get one immediate retry after 0.4–0.5 s, spending quota. The latest commit fixed this for Meteomatics only (`meteomatics.py:386–388`). Also, `response_too_large` is raised without `HEALTH_REGISTRY.record_failure`.
- **Fix direction:** Remove 429 from the retry set (or honour Retry-After); record the failure for too-large replies; update `test_request_with_resilience_handles_timeout_and_429`.

## A16 — LOW (docs) — Control character in the backend handoff doc

- **File:** `docs/V2_BACKEND_HANDOFF.md:84`. "`backend/.env`" contains a literal backspace byte (0x08) where `\b` was intended; renders as "ackend/.env (copy ackend/.env.example".
- **Fix direction:** Replace with `backend/.env` and `backend/.env.example`.

## B6 — LOW — ENSO-adjusted trend is not a partial regression

- **File:** `backend/app/context.py` 100–120 (`fit = ols(y, d)`).
- **What is wrong:** The docstring says series are detrended, but `_enso_adjusted` regresses the trending local values on raw ONI. Drift that ONI shares with time is credited to ENSO, biasing `enso_share` and the adjusted slope.
- **Reproduce (confirmed):** `b_repro2.py` section R8. Local series with no ENSO dependence, ONI with small drift: ENSO coefficient 0.046 (raw) vs 0.027 (detrended); adjusted slope 0.2803 → 0.2793.
- **Fix direction:** Estimate the ENSO coefficient from `y ~ t + ONI`, or from the detrended pair (`linear_detrend` on both, as `_rhythm_link` does), then subtract `b*(oni - mean)`.

## B7 — LOW — Planet-streams health never recorded; TTL setting has no effect

- **File:** `backend/app/streams.py` 19, 211, 302–320.
- **What is wrong:** `cache_health()` reports `ttl_seconds = cfg.streams_cache_ttl_seconds`, but the cache uses hard-coded `TTL_SECONDS = 12*3600`. `HEALTH_REGISTRY.record_success/failure("planet_streams")` is never called (confirmed by grep), so `/api/health/details` always shows "available"/"idle" even when every fetch fails. No stale fallback when a refresh fails after TTL.
- **Fix direction:** Use `load_config().streams_cache_ttl_seconds` in `_fresh`; record success/failure in `fetch_text` / `get_monthly`; optionally serve stale data on refresh failure.

## B8 — LOW — Empty k-means cluster crashes `cluster_places`

- **Files:** `backend/app/ml.py` 127–143 (`_lloyd`); `backend/app/archetypes.py` 65–68 (`means = [... / len(members) ...]`).
- **What is wrong:** With fewer distinct points than k, an empty cluster is re-seeded on a duplicate point and stays empty; `cluster_places` divides by `len(members) == 0`.
- **Reproduce (confirmed):** `b_repro1.py` section R7: 9 identical vectors + 1 different, k = 3 → labels {0, 1}; `cluster_places(..., chosen_k=3)` raises ZeroDivisionError.
- **Fix direction:** Skip empty clusters in `cluster_places` (or report k as the number of distinct labels), or cap k at the number of distinct points in `kmeans`. Related: out-of-range `chosen_k` silently falls back to `best` (`archetypes.py` line 60), so the response `k` can differ from the requested one.

## B9 — LOW — URL canonicalisation keeps `_hsenc` and drops ports

- **File:** `backend/app/news.py` line 57 (`" _hsenc"` has a leading space) and line 359 (`host = parsed.netloc.lower().split(":")[0]`).
- **What is wrong:** Comparison is `k.lower().strip() not in _TRACKING_PARAMS`, so `_hsenc` is never stripped and duplicates aren't merged. `https://ex.com:8443/a` becomes `https://ex.com/a`. IPv6 hosts break.
- **Reproduce (confirmed):** `b_repro1.py` section R5.
- **Fix direction:** Fix the key to `"_hsenc"`; keep `parsed.port` when present; use `parsed.hostname` for host checks.

## B10 — LOW — OLS "perfect line" test uses an absolute floor

- **File:** `backend/app/stats.py` line 351: `if sse <= 1e-24 * max(syy, 1.0):`
- **What is wrong:** Noisy values around 1e-14 get se = 0 and p = 0 (declared significant); the same data ×1e14 gives p = 0.017. Latent: no current NASA POWER unit is that small.
- **Reproduce (confirmed):** `b_repro1.py` section R3.
- **Fix direction:** Relative test `sse <= 1e-24 * syy` (with syy > 0), or compare against `sum(v*v)`.

## B11 — LOW — Explanation validation leftovers

- **File:** `backend/app/explanations.py`.
  - **Citations not deduplicated:** `seen_urls` (595, 617) is filled but never checked. Annotation merging (580) compares exact URLs, so a `?utm_source=` link and the plain link become two citations. The contract promises a deduplicated array.
  - **Citations outlive drivers:** `used_citation_ids` is collected over all drivers (651) but only `drivers[:4]` are returned (678).
  - **Dead branches:** in `_build_curated_fallback`, `"no_evidence" if status == "ok" else status` (429) can't take the first branch; the `fallback_reason != "curated_fallback"` test (441) is dead.
  - **Rounding hides small slopes:** `_build_measured_facts` rounds slope and interval to 4 decimals (377–379), so a tiny significant slope prints "+0 … per decade" and is passed to the model as 0.
- **Fix direction:** Dedup on `url_match_key`; compute `ordered_citations` from the truncated driver list; remove or fix dead branches; format slopes with significant digits.

---

## Checked and found fine

- **Validation:** lat/lon/size/hours ranges reject NaN and inf with 422; unknown variable → 404; bad year range → 400; monthly-frames 10-year cap works.
- **Live weather:** unconfigured / stale / unavailable states match contract §7; Meteomatics credentials are redacted and never in the URL.
- **Config:** `case_signature` HMAC round-trips (including `-0.000`); `env_file.py` allow-list and "real environment wins" are correct; `deploy.py` CORS and static mount fine; `version.py` handles missing git; `requirements.txt` covers all third-party imports.
- **Monthly models:** seasonal-naive indexing, damped Holt, AR lag indexing, conformal quantile correct; `nasa_power` stale fallback and -999 / month-13 handling correct.
- **stats.py:** tie-corrected MK variance, continuity-corrected z, Sen interval ranks (match R `trend`), Marriott–Pope autocorrelation, t-distribution p-values, Benjamini–Hochberg, Pettitt, Bretherton effective n.
- **Other modules:** Moran's I formula and permutation p; no look-ahead inside forecast models; ridge standardisation refit per LOO fold; ARI and silhouette; ONI season mapping; `_rolling_12` centring; ledger single BH pass; `reasons.py` rule order.

## Suspected, not confirmed (no live network)

- NASA POWER may reject or truncate `end_year` = current year; if it returns 4xx, main maps it to 502 via PowerError (`nasa_power.py:232–234`) although it is a caller range problem.
- With default `end_year = current_year - 1`, "forecast" months (Jan–Mar this year) are already in the past.
- Forecast anomalies use full-period climatology; observed-frame anomalies use a 20-year climatology (`monthly.py:139` vs `744`), so they are on offset baselines if plotted together.
- Module-level `asyncio.Semaphore(4)` in `meteomatics.py:81` could hit "bound to a different event loop" under multiple loops (tests / multiple TestClients).
- `_rolling_12` assumes consecutive month stamps; a missing month key (not None) would make a window span more than 12 months.
- OLS with autocorrelation both inflates SE and shrinks df to n/factor − 2 (looks conservative; not re-simulated).
- With 5 saved locations, `MAX_TOTAL_QUERIES = 6` leaves only 1 of the 5 fixed global news places; the contract implies all 5 are always queried.
