# V2 Backend Repair Handoff (Phase 0)

What the Phase 0 backend repair changed, how each change is tested, what is still limited, and what only the owner can do. Written by Agent 0A (backend I/O, API and security), 2026-11-15. Agents 0B (statistics) and 0C (news, streams, ML) reported their API-visible changes to the integration lead; they are listed in section 4 so this is the single place to read. Review IDs refer to `backend-review/BACKEND_REVIEW.md`; item letters to the PHASE 0 section of `Planning and prompts/frontend_plan_final.txt`.

Nothing was committed. Every automated test is offline.

---

## 1. Result

- Full suite, Python 3.12.10 (the Docker target's version), Windows 11, from the repo root: **341 passed, 0 failed** (`python -m pytest backend -q -p no:cacheprovider`). Baseline before Phase 0: 266 passed, 1 failed (A3).
- The suite can no longer reach the network: `backend/tests/conftest.py` refuses every non-loopback connection and DNS lookup with an immediate `OSError` (`test_the_test_suite_cannot_reach_the_network`). A test that forgets to mock NASA POWER, OpenAI, Meteomatics or GDELT now fails at once instead of waiting.
- Repro scripts re-run after the fix: `a_repro_gzip.py` prints `OK 200 {'ok': True}` and `get with ttl 0: None`; `a_repro_monthly.py` shows every cell forecasting `2024-12, 2025-01, 2025-02`; `a_repro_threads.py` shows `cache_health RuntimeErrors: 0`.

---

## 2. Changes by item (Agent 0A)

| ID | What changed | Tests |
| --- | --- | --- |
| **A1** (critical) | `resilience.py`: the streamed body is read by `read_capped_body` (cap counts decoded bytes, so a gzip bomb is refused) and the rebuilt `httpx.Response` gets `decoded_headers()` (no `content-encoding` / `content-length` / `transfer-encoding`), so httpx no longer decodes plain bytes a second time. Error replies (>= 400) are not downloaded at all. | `test_gzip_and_deflate_upstream_replies_are_decoded_exactly_once`, `test_a_small_gzip_reply_that_inflates_past_the_cap_is_refused` (resilience); `test_real_http_path_sends_the_request_and_reads_a_gzip_reply` (explanations, full OpenAI path) |
| **A2** | `monthly.py` `build_monthly_forecast`: every cell is trimmed to the earliest common last month before any backtest; new `alignment` object; a defensive second check withholds with `reason_code: "misaligned_cells"` if forecast months still differed. | `test_cells_that_end_a_month_early_never_put_different_months_under_one_frame_label` |
| **A3** | Test made deterministic: it drives `time.monotonic` itself. Code: `BoundedTTLCache.get_entry` treats `ttl <= 0` as "nothing is fresh" (`is_stale = ttl <= 0 or age > ttl`); `nasa_power._cache_get` likewise. | `test_bounded_ttl_cache_respects_ttl_lru_and_stale_lookup` |
| **A4** | `main.py`: `/api/health/details` and `/api/version` are `async def`, so they run on the event loop (the thread that writes the caches). `BoundedTTLCache.stats()` and `nasa_power.cache_health()` iterate a snapshot copy. | `test_health_routes_run_on_the_event_loop_and_cache_stats_survive_concurrent_writes` |
| **A5** | `monthly.py`: all per-cell backtests run in one `asyncio.to_thread` call, so the event loop keeps serving other requests. | `test_monthly_forecast_runs_model_fitting_off_the_event_loop` |
| **A7** | `nasa_power.py`: one process-wide `LoopBoundSemaphore` sized by `NASA_POWER_MAX_CONCURRENCY` wraps every NASA POWER request (all routes, all visitors). Health reports `max_concurrency_scope: "process"`. `resilience.LoopBoundSemaphore` keeps one semaphore per event loop (weakly referenced), which also fixes the "bound to a different event loop" risk of the old module-level semaphore in `meteomatics.py`. | `test_nasa_power_concurrency_limit_is_global_across_requests`, `test_loop_bound_semaphore_works_across_event_loops` |
| **A8** | `meteomatics.py`: a cached reply is fresh only within the UTC hour it started in; any cached reply served (fresh or stale) is trimmed to start at the current hour and carries the caller's own rounded coordinates (`_serve_cached`). | `test_cached_weather_is_rebased_on_the_current_utc_hour` |
| **A9** | `meteomatics.py` `fetch_hourly`: an invalid `METEOMATICS_BASE_URL` becomes `UpstreamServiceError(code="misconfigured")`, so `/api/live-weather` returns 200 `status: "unavailable"` instead of 500. | `test_a_malformed_base_url_is_reported_unavailable_not_a_server_error` |
| **A10** | `monthly.py`: one `calibration` schema everywhere (`_empty_calibration`), with `n_test_origins` (distinct origins) and new `n_test_pairs` (scored pairs, the old meaning). A withheld grid response shows the failing cell's own `models`, `calibration` and `training_range`. | `test_calibration_has_one_shape_in_every_branch`, `test_a_failing_cell_reports_its_own_scoreboard_not_the_centre_cells` |
| **A11** | Won't-fix, justified: the `insufficient_backtest_origins` branch is kept as a documented defensive gate (comment in `monthly.py`, note in the contract). It cannot trigger with the current constants. | `test_the_backtest_origin_gate_is_documented_as_defensive` (fails if the constants change so that it could) |
| **A12** | `main.py`: every `end_year` default (and `/api/monthly-frames` `start_year`) is `None` in the signature and resolved from today's date per request (`_default_end_year`). | `test_default_end_year_follows_todays_date_not_the_import_date` |
| **A13** | `main.py`: `load_local_env()` is the first statement, before any other app module is imported, so `TD_VERSION` in `backend/.env` reaches `version.py`. | `test_backend_env_is_loaded_before_any_module_that_reads_settings_at_import`, `test_td_version_from_the_env_file_reaches_the_version_report` (fresh interpreter, no git) |
| **A14** | `SlidingWindowRateLimiter.check`: a limit of 0 or less denies without crashing; a bucket never holds more than `limit` timestamps; `max_keys` is at least 1. | `test_rate_limiter_with_a_zero_limit_denies_without_crashing_and_stays_bounded` |
| **A15** | `resilience.py`: 429 removed from `RETRYABLE_HTTP_STATUS` and never retried; `Retry-After` (seconds or HTTP date) is parsed into `UpstreamRateLimitError.retry_after_seconds` and passed to the explanation fallback; `response_too_large` is recorded in `HEALTH_REGISTRY`. Meteomatics 429 also carries `Retry-After`. | `test_request_with_resilience_handles_timeout_and_429`, `test_transient_5xx_is_still_retried_once_but_429_is_not`, `test_retry_after_parsing_is_bounded` |
| **A16** | `docs/V2_BACKEND_HANDOFF.md`: the two backspace bytes replaced with `` `backend/.env` `` and `` `backend/.env.example` ``. | `test_backend_docs_contain_no_control_characters` |
| **B11** | `explanations.py`: citations deduplicated on `url_match_key` (a duplicate id is mapped onto the first); citations computed from the drivers actually returned (at most 4); dead branches removed (a no-curated-match fallback keeps the caller's `status` and `fallback_reason`); `measured_facts` use 4 significant digits (`_sig`), so tiny slopes and p-values are not 0. `retry_after_seconds` is now always present (null when not limited). The significance gate before asking the AI also requires `sign` up/down (same rule as the fallback). | `test_citations_are_deduplicated_and_never_outlive_their_drivers`, `test_tiny_slopes_keep_significant_digits_in_measured_facts`, `test_a_case_with_no_curated_literature_keeps_the_callers_status` |
| **A** (web search) | `explanations.build_openai_request_body`: Responses API `web_search` tool (not `web_search_preview`) with `filters.allowed_domains` = the science allow-list collapsed to parent domains (20 entries; subdomains are included by the filter), `search_context_size` (`OPENAI_WEB_SEARCH_CONTEXT_SIZE`, default `low`), `max_tool_calls` (`OPENAI_MAX_TOOL_CALLS`, default 3, 0 omits it), `max_output_tokens` (`OPENAI_MAX_OUTPUT_TOKENS`, default 1400), `include: ["web_search_call.action.sources"]`, `store: false`. Pages in `web_search_call.action.sources` count as provenance for a citation (still domain-checked) but are not themselves listed. An `incomplete` reply is not used. **No model name is in the code:** `OPENAI_EXPLANATION_MODEL` defaults to unset, and live AI needs key and model (`status: "no_key"`, `fallback_reason: "missing_model"` otherwise). 24-hour cache by `(case_signature, normalised question)` checked before the rate limit; rate limit, no-key, rate-limited, invalid-response and no-evidence fallbacks unchanged. | `test_request_uses_the_current_web_search_tool_with_the_domain_filter`, `test_web_search_can_be_switched_off_and_tool_budget_omitted`, `test_no_model_name_is_built_in_so_a_key_without_a_model_falls_back`, `test_web_search_sources_count_as_provenance_but_are_not_listed_as_citations`, `test_an_incomplete_response_is_not_used`, `test_cached_answers_are_served_without_spending_rate_limit_or_calling_openai`, `test_no_openai_model_name_is_hard_coded_in_the_backend` |
| **B** (Meteomatics quota) | `meteomatics.py`: bounded per-visitor limiter (default 30 per 5 min, up to 2000 visitor buckets) and a whole-server budget (default 300 per hour), both the project's `SlidingWindowRateLimiter`, checked only on a cache miss and after the unconfigured check. Over quota: the cached reply for that place as `status: "stale"`, otherwise `status: "rate_limited"` with `retry_after_seconds`; neither contains a credential or upstream body and Meteomatics is not called. The real request is streamed (`_stream_get`) and refused as soon as it passes 512 KB. Visitor identity: `resilience.client_identity` (see section 3), also used for `/api/explanations`. Health reports the limits under `meteomatics.rate_limit`. | `test_per_visitor_quota_stops_upstream_calls_and_returns_a_safe_rate_limited_reply`, `test_a_rate_limited_visitor_still_gets_the_cached_reply_for_that_place`, `test_a_whole_server_budget_caps_meteomatics_calls_across_all_visitors`, `test_real_path_streams_and_refuses_an_oversize_body_without_a_length_header`, `test_real_path_sends_basic_auth_reads_gzip_and_never_reads_error_bodies`, `test_the_endpoint_keys_the_quota_on_the_trusted_visitor_address`, `test_client_identity_trusts_forwarded_for_only_as_configured`, `test_client_identity_reads_the_hop_count_from_the_environment`, `test_explanation_rate_limit_uses_the_trusted_visitor_address`, `test_health_reports_the_quota_settings_without_secrets` |
| **D** (offline, 3.12) | Network guard in `conftest.py`. The environment test (`test_the_app_starts_and_every_optional_feature_degrades_when_no_key_is_set`) uses `fake_power`; with the guard any NASA POWER call it might make fails immediately (it makes none). Suite verified on Python 3.12.10. | `test_the_test_suite_cannot_reach_the_network`, whole suite |
| 0B follow-up | `main.py` sweep, grid and world: `significant_fdr = flag and significant`, so a flat (zero-slope) row is never counted. | `test_a_flat_row_is_never_counted_as_fdr_significant` |

Files changed by Agent 0A: `backend/app/resilience.py`, `explanations.py`, `meteomatics.py`, `main.py`, `monthly.py`, `nasa_power.py`; `backend/.env.example`; `backend/tests/conftest.py`, `fixtures/v2_fixtures.json` (regenerated offline), `test_api.py`, `test_env_file.py`, `test_v2_resilience_and_trace.py`, `test_v2_explanations.py`, `test_v2_meteomatics.py`, `test_v2_monthly.py`, `test_v2_contract_fixtures.py`; `docs/V2_API_CONTRACT.md`, `docs/V2_BACKEND_HANDOFF.md`, this file. `env_file.py`, `version.py`, `deploy.py`, `places.py`, `requirements.txt` needed no change (every new setting matches an existing allowed prefix; no new dependency).

---

## 3. Proxy assumption (Azure) for visitor identity

- `TD_TRUSTED_PROXY_HOPS` (default `0`) is the number of reverse proxies in front of the app that append to `X-Forwarded-For`.
- `0`: the header is never read; the visitor is the TCP peer. Safe anywhere, but behind a proxy every visitor shares one allowance.
- Azure App Service (Linux or container): set `1`. Its front end appends the client address (as `ip:port`) as the last entry. The server takes the entry `hops` places from the right, strips the port and validates it as an IP; anything further left was written by the client and is ignored, so a visitor cannot choose their own key with a forged header. A missing, short or unparseable header falls back to the peer.
- If Azure Front Door or another CDN sits in front of App Service, that is one more hop: set `2`. Never set it higher than the real number of proxies.
- IPv6 visitors are grouped per /64.
- Uvicorn's own `--proxy-headers` handling is not relied on (it only trusts `127.0.0.1` by default, and the Dockerfile does not change that).

---

## 4. API contract changes (all recorded in `docs/V2_API_CONTRACT.md`, section 8; fixtures regenerated)

Agent 0A:
- `/api/monthly-forecast`: `alignment`; one calibration schema with `n_test_pairs`; `"misaligned_cells"`; withheld response describes the failing cell.
- `/api/explanations`: `retry_after_seconds` always present; `fallback_reason: "missing_model"`; significant-digit `measured_facts`; deduplicated citations.
- `/api/live-weather`: `status: "rate_limited"`; `retry_after_seconds` always present; hour-aligned cached replies; caller's own `location`.
- `/api/health/details`: `ai_explanations.key_present`, `model_configured`, `web_search_tool`, `search_context_size`, `max_tool_calls`, `max_output_tokens`, `search_filter_domains_count`, `model` null by default; `meteomatics.rate_limit`; `nasa_power.max_concurrency_scope`.
- Year defaults computed per request.

Agent 0B (statistics): `significant` false when Sen's slope is 0 (all routes); `significant_fdr` requires `significant` (ledger by 0B, sweep/grid/world by 0A); emergence p-values autocorrelation-adjusted, per-entry `significant`, `emergence.year` / `emergence_year` null unless the headline is significant; forecast lab `coverage.model`, `coverage.calibration_end_year`, out-of-sample `coverage.test`, replay `band_basis: "in_sample"`, top-level `replay_note`; `enso_adjusted.enso_share` is a partial R²; `grid_points` wraps longitude to [-180, 180) and shifts the window inside ±89.75 near a pole; fingerprint months with sign 0 are never significant. Details: `docs/STATS_AUDIT.md`.

Agent 0C: news `publisher_verified` (boolean, next to `publisher`, from `news.VERIFIED_PUBLISHER_DOMAINS`); news URLs keep non-default ports and bracketed IPv6, drop default ports, reject non-global IPs, strip `_hsenc`; relevance accepts inflections and bare "storm(s)", "evacuating" / "evacuee" are red; archetypes `k` is the actual cluster count plus `requested_k`; planet streams honour `STREAMS_CACHE_TTL_SECONDS`, record health, serve stale on refresh failure. The news fixture is now built by the real normaliser, with one verified and one unverified item.

---

## 5. Remaining limits

- **No real-service test.** The OpenAI and Meteomatics paths are exercised only against in-memory fakes that mimic the documented reply shapes. Section 6 is the owner's check.
- **`web_search` with JSON output.** The request asks for `text.format: json_object` together with the `web_search` tool. If the chosen model rejects that combination (HTTP 400, `fallback_reason: "http_400"`) or returns cut-off JSON, the server falls back to the curated text; the smoke test will show it. `max_tool_calls` and `include` are current Responses API parameters; if the account rejects `max_tool_calls`, set `OPENAI_MAX_TOOL_CALLS=0` to drop it.
- **Fallback answers are not cached** (only `ok` and `no_evidence` are), so a model that always fails validation costs one call per request, within the rate limit.
- **Monthly forecast** is now off the event loop but not cached; a 3 × 3 grid over 44 years still takes about 1 to 2 s of one worker thread per request. No in-flight de-duplication of identical NASA POWER fetches (A7 optional part).
- **Per-visitor limits are in-memory per process.** Several app instances each keep their own counters; the whole-server Meteomatics budget is per instance too. Set it with that in mind.
- **Python 3.15 / Windows async tests:** the Meteomatics async tests use the `anyio` pytest plugin (installed with `httpx`/`starlette`), asyncio backend only. They pass on Python 3.12 on Windows and are what the Docker image runs. Python 3.15 was not tested here.
- **A11** is kept as a defensive branch, not removed (see table).

---

## 6. Owner-only steps

### 6.1 Choose the low-cost model

1. In the OpenAI dashboard, pick a current low-cost model that your account can use with the Responses API **and** the `web_search` tool (check the model's page for "Web search" under tools and the pricing page for input, output and per-search cost).
2. Put its exact name in `OPENAI_EXPLANATION_MODEL` (local `backend/.env`, or an Azure App Setting). Nothing in the code names a model.
3. Keep `OPENAI_WEB_SEARCH_CONTEXT_SIZE` at `low` unless answers lack sources; keep `OPENAI_MAX_TOOL_CALLS` at 3 or lower.

### 6.2 Real-key OpenAI smoke test (one call)

1. Set `OPENAI_API_KEY` and `OPENAI_EXPLANATION_MODEL` (never paste the key into a chat, commit, screenshot or command history you share).
2. Start the backend: `cd backend; .venv\Scripts\activate; uvicorn app.main:app --port 8000`.
3. `GET http://localhost:8000/api/health/details`: `features.ai_explanations.configured` is `true`, `model` is your model, `web_search_tool` is `web_search`, and the key appears nowhere in the reply.
4. `GET /api/trend?variable=T2M&lat=70&lon=-150&start_year=1981&end_year=2024`, copy `case_signature`.
5. `POST /api/explanations` with `{"case_signature": "<it>", "question": "Why is the Arctic warming?"}`. Expect `status: "ok"`, `fallback: false`, at least one driver, every citation `https` on an allow-listed domain. If `status` is `"fallback"`, note `fallback_reason` (`http_400` / `http_401` / `validation_failed` / `rate_limited`) and see section 5.
6. Repeat the same POST: `cached: true`, and the OpenAI usage page shows only one call.
7. Search the server console output and the response for the key (or its last 6 characters): it must not appear.

### 6.3 Real-key Meteomatics smoke test (one call)

1. Set `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`; optionally lower `METEOMATICS_GLOBAL_RATE_LIMIT_MAX` below your plan's daily quota.
2. On Azure App Service also set `TD_TRUSTED_PROXY_HOPS=1` (2 if Front Door is in front).
3. `GET /api/live-weather?lat=52.52&lon=13.46&hours=6`: `status: "available"`, `series[0].time` is the current UTC hour, `current == series[0]`, no username or password anywhere in the reply.
4. Repeat within the same hour: same `fetched_at` (served from cache; no second Meteomatics call in your account log).
5. `GET /api/health/details`: `features.meteomatics.status` is `available`, `telemetry.last_status` is `healthy`, and no credential appears.
6. Check the console output for the username or password: neither may appear.
