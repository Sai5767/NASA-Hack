# Trend Detective V2 — copy/paste agent handoffs

Use the backend prompt first. Do not begin the frontend prompt until the backend agent has produced the named handoff artefacts and the project tests pass. Both agents work in the existing repository; neither may commit secrets, replace audited statistics, or claim a source is integrated without code and provenance.

## Shared acceptance context

- Repository: Trend Detective, Python/FastAPI backend in `backend/`; React/Vite frontend in `frontend/`.
- Start by reading `README.md`, `HANDOFF.md`, `docs/REQUIREMENTS.md`, `docs/STATS_AUDIT.md`, `docs/V2_EXECUTION_PLAN.md`, and `docs/V2_DATA_SOURCE_REGISTRY.md`.
- Preserve the existing NASA POWER trend engine, audits, local profile approach, custom canvas globe, and public source credits.
- Current baseline commands:

  ```powershell
  cd backend
  .venv\Scripts\activate
  pytest

  cd ..\frontend
  npm test
  npm run build
  ```

- Use a new branch named `codex/v2-backend` or `codex/v2-frontend` as appropriate. Do not merge to `main`.
- Treat all external input as untrusted. Do not log responses that may include keys. Keep `.env*` ignored.
- Make focused commits and update `HANDOFF.md` plus the API contract when the relevant work is finished.

---

## Prompt 1 — Gemini Argon 4: backend implementation

```text
You are the backend owner for V2 of the existing Trend Detective NASA Space Apps Challenge project. Implement the backend work in this repository; do not build a replacement application. Work independently but do not modify frontend presentation files except fixtures or a documented minimal integration helper.

Read these first, in full:
- README.md
- HANDOFF.md
- docs/REQUIREMENTS.md
- docs/STATS_AUDIT.md
- docs/V2_EXECUTION_PLAN.md
- docs/V2_DATA_SOURCE_REGISTRY.md

Core constraints:
1. Preserve FastAPI, the audited hand-written trend statistics, existing public-data behaviour, and backwards-compatible existing API fields.
2. There is no real account system or profile database. Profiles and saved locations stay in the browser. Do not add authentication, Supabase, passwords, or a server database.
3. Secrets are server-only environment variables. OPENAI_API_KEY and Meteomatics credentials must never reach frontend code, a response, logging, tests, a source file, or a commit. The application must work without either integration configured.
4. An AI explanation must never calculate/alter the trend, claim causation, invent citations, or make a risk/emergency decision. Statistics are server-produced facts. The AI produces a hedged, source-cited explanation of possible drivers only.
5. No blind averaging of overlapping scientific products. NASA POWER is the primary V2 point/monthly source; other listed resources are registry/reference candidates unless you implement a tested adapter and visible provenance.
6. All new external dependencies require timeout, bounded retry/concurrency, typed errors, a cache policy, an offline fake in tests, and a usable API response when unavailable.

Implement these deliverables in order.

A. Contract and resilience foundation
- Create docs/V2_API_CONTRACT.md containing request/response schemas and example payloads for every new/extended API below. It is the frontend handoff authority.
- Add a common dependency/client layer with configuration read from environment, strict timeouts, cancellation where possible, bounded concurrency, structured non-secret errors, and bounded TTL caching. Do not make the production deployment depend on writeable local disk.
- Extend GET /api/trend without removing existing fields. Add a stable evidence_trace sufficient for the UI to explain the actual calculation: complete years/months used, slope and interval, Mann–Kendall outcome, regression/serial-correlation adjustment outcome, raw p-value, correction status when applicable, evidence grade/checks, and caveats. Values must come from existing analysis results, never duplicate reimplementation.
- Add GET /api/health/details. It reports non-secret availability/cache age for NASA, AI explain feature, news feature and forecast feature. It must not invoke costly upstream calls just to respond.
- Update CORS deliberately for POST /api/explanations while retaining safe development/production origins.

B. Meteomatics live-weather integration
- Add a MeteomaticsProvider behind a provider interface plus GET /api/live-weather. The provider is a complement to NASA POWER, never an averaging/replacement layer for historical trend tests.
- Read credentials only from server environment settings. Support the account’s documented access-token or username/password authentication mechanism; do not embed credentials in endpoint URLs or send them to clients. Document variable names only, never values.
- Implement an initial narrow parameter map: air temperature `t_2m:C`, hourly precipitation `precip_1h:mm`, and total cloud cover `total_cloud_cover:p`. Request JSON, normalise units/valid times/source/model metadata, cap coordinates/ranges/intervals/response size, and return the original provider parameter plus V2 field label.
- Cache current results briefly and forecast results for a bounded short TTL. Handle missing credential, 401, 429, timeouts, malformed payload, unsupported range and stale-cache fallback with typed, non-secret responses. Tests must use a fake provider and prove no credential reaches a response or log fixture.
- Do not represent Meteomatics frames as NASA satellite observations or Trend Detective ML predictions. It is a separately labelled operational weather current/forecast layer.

C. Observed monthly grid and honest monthly forecast
- Implement GET /api/monthly-frames for a chosen location/variable/month range and a tightly limited local grid. It is an analysis grid around a selected place, not a fake global satellite raster. Return source/provenance, resolution, per-cell missingness, request coverage, and monthly observed values.
- Implement GET /api/monthly-forecast for T2M, PRECTOTCORR, and CLOUD_AMT only. Forecast one to three months per requested local-grid cell.
- Use rolling-origin backtests and a seasonal-naive baseline. Candidate models should include seasonal naive and at least two appropriate alternatives such as harmonic/damped trend and regularised autoregression. The selected model must be deterministic/reproducible. Return model name, per-horizon scores, calibration/coverage result, training record range, `eligible`, and an explicit reason whenever forecast is withheld.
- Never report forecast data as observed data. Never interpolate failed cells as actual observations. Cap grid size, requested history, concurrency, and response size to protect NASA POWER.
- Reuse the project’s no-heavy-ML-library approach unless a dependency is truly justified and documented. Quality means demonstrably better backtest performance, not a fashionable model name.

D. “Why might this be happening?” endpoint
- Add POST /api/explanations. The browser submits only a short optional question and an analysis request/signature. Recompute/verify/retrieve the analysis server-side; never accept client-supplied p-values, slopes, source facts, or arbitrary hidden prompt text.
- Use a backend-only OpenAI Responses API integration, configurable by OPENAI_API_KEY and OPENAI_EXPLANATION_MODEL. When live source research is enabled, use official/reputable science domain filtering where feasible and preserve the returned URL citations in a normalised response.
- Validate structured model output on the server. Response shape: status, summary, drivers[], limitations[], citations[], generated_at, fallback. Each driver must distinguish evidence type and use citations; unsubstantiated drivers must be removed rather than displayed.
- Provide an explicit system instruction enforcing: possible explanations not causation; supplied facts are authoritative; no invented facts/citations; say when evidence cannot explain the local trend; short high-school-friendly language; no medical/emergency/legal advice.
- Add 24-hour analysis-signature cache plus rate limiting. When unavailable, use the existing curated reasons.py content where available; otherwise return an honest unavailable/no-evidence response with HTTP success if the trend itself was valid.
- Do not make frontend compilation or ordinary local use require an OpenAI key.

E. Live-news context endpoint
- Create a NewsProvider interface and GET /api/news. Build one bounded default provider adapter suitable for a demo; keep provider specifics behind configuration so a later Azure service can replace it.
- News items must include: id, title, publisher, canonical URL, published time, category, deterministic severity (green/amber/red), lat/lon, coordinate precision/uncertainty, and a `news context, not scientific evidence` label.
- Query a small list of saved locations and a fixed global rotation set. Deduplicate, reject unusable URLs/dates, and do not scrape publisher HTML.
- Use deterministic keyword/category severity rules; do not let an LLM invent a disaster severity. Cache at least 15 minutes. On provider failure return last successful results marked stale or an honest empty result — never synthetic headlines.

F. Tests and handoff
- Add offline tests for all new endpoints, validation, quotas/missing-key paths, upstream timeout/malformed data, stale caches, forecast eligibility/non-eligibility, evidence trace consistency, structured AI output/citation rejection, and news de-duplication/severity/fallback.
- Run all existing backend tests plus the new tests. Do not change reference values unless you first prove a defect and update the stats audit.
- Update README and HANDOFF.md with new environment variables (names only), local behaviour, route overview and limitations.
- Produce docs/V2_BACKEND_HANDOFF.md. It must list: exact endpoint schemas, fixtures/test commands, environment variable names (not values), cache/feature-degraded behaviours, known limits, and anything the frontend must not assume.

At completion, report changed files, commands run/results, unresolved risks, and the exact handoff artefacts. Do not deploy to Azure or expose a key.
```

### Backend-to-frontend gate

Before passing the frontend prompt to Claude, check that these exist and are coherent:

- `docs/V2_API_CONTRACT.md`
- `docs/V2_BACKEND_HANDOFF.md`
- deterministic fixture responses for every new route
- backend tests passing with no API key or network access

---

## Prompt 2 — Claude Opus 5.5: frontend implementation

```text
You are the frontend owner for V2 of the existing Trend Detective NASA Space Apps Challenge application. Build on the React/Vite frontend already in this repository. Do not replace the FastAPI backend, rewrite the statistics, or invent an undocumented API. Use docs/V2_API_CONTRACT.md and docs/V2_BACKEND_HANDOFF.md as the contract; report any mismatch rather than silently guessing.

Read these first, in full:
- README.md
- HANDOFF.md
- docs/REQUIREMENTS.md
- docs/V2_EXECUTION_PLAN.md
- docs/V2_DATA_SOURCE_REGISTRY.md
- docs/V2_API_CONTRACT.md
- docs/V2_BACKEND_HANDOFF.md

Product intent:
The user opens a beautiful, legible Earth-system detective dashboard: a clean rotating globe, a left-side dashboard, location-linked news/context markers, a timeline below the globe, and an Account control in the top-right. The app must still be a scientifically honest trend-analysis tool for high-school users and curious adults.

Constraints:
1. Reuse the existing custom canvas Globe, React structure, theme system, data charts, accessibility patterns and reduced-motion support. Do not introduce an external map/chart platform just for visual flair.
2. The “account” is a local demo profile, not sign-in security. Do not create password fields, backend profile calls, Supabase, cookies, or a claim that data are stored securely in the cloud.
3. Never put OpenAI credentials or provider keys in frontend code. The frontend only calls the documented backend endpoint.
4. Do not imply causal certainty, a medical/emergency warning, that a forecast is observed satellite data, or that news determines a climate trend.
5. Every new loading, error, empty, stale, offline, and withheld-forecast state must have intentional visible copy.
6. Keep the existing required challenge journey obvious: choose a variable/place, see time series, rate, and statistical significance.

Implement in this order.

A. Local demo profile and account experience
- Build a first-run welcome flow. Ask five questions: display name/demo explorer, saved locations (up to five), Earth-system interests, primary goal, and detail level. Use interest choices derived from the existing data families: heat; rain & water; clouds & sunlight; land & plants; wind & atmosphere; ice & oceans.
- Store a versioned profile only in localStorage, with robust migration/default/reset when storage is denied or corrupted. Clearly say “Stored on this device for this demo.”
- Add a top-right Account control and account panel to edit choices, manage saved locations, reset profile after confirmation, and export/import profile JSON locally. An account must never make a network request.
- Make home suggestions and request prefetching depend on saved locations/interests. Avoid expensive background analysis outside selected places.

B. Globe-first dashboard and news context
- Refine the existing canvas globe into a polished rotating home view with an atmospheric, satellite-inspired look made from existing/correctly licensed visual primitives. Decorative appearance must never look like a live scientific raster.
- Add a responsive left dashboard with saved location status, recommended investigation, current trend/forecast summary where already available, and source freshness.
- Render documented news markers on the globe. Green/amber/red is labelled as news context/attention, links to source articles, includes date/publisher, and is visually distinct from trend/scan markers. Hover/focus provides an accessible card; click opens the source safely.
- Add a news unavailable/empty/stale mode. Stale results must visibly show their age. Do not show fake cards.
- Keep graceful rotation, but pause it during drag/keyboard interaction and honour prefers-reduced-motion.

C. Timeline, observed frames, forecast frames
- Add an accessible bottom timeline rail under the globe: monthly label, range scrubber, play/pause, speed, observed/forecast boundary, source/status legend and reduced-motion-safe controls.
- Drive observed frames from /api/monthly-frames. Render missing grid cells as visibly missing, not smoothed data.
- Add a separately selectable live-weather layer driven by /api/live-weather: Meteomatics current/short-range temperature, hourly precipitation and cloud cover. It needs provider name, original parameter, unit, valid/fetch time, stale state and a prominent `Meteomatics weather forecast — not NASA trend data` label. Do not put it on the NASA monthly-anomaly scale.
- Drive the longer-horizon internal climate forecast frames from /api/monthly-forecast only when `eligible` is true. These frames need a clearly different style, an explanation of model/backtest quality, and a prominent `Trend Detective climate forecast — not observed data` label.
- When forecast is not eligible, retain historical controls and explain exactly why the future frames are unavailable.

D. Evidence verdict and optional why panel
- Turn existing statistics into a clear visual ladder: Strong evidence of a trend; Some evidence — investigate carefully; No clear evidence yet; Not enough data to tell. Preserve actual direction, rate, source, period, uncertainty and limitations.
- Provide an expandable “How did we test this?”/“Show the calculations” section fed from `evidence_trace`. Explain plain-language steps first, then give exact values, formulas/method labels and correction status for technical users. It can animate the explanation, but must not pretend computations occur on the client.
- Add a “Why might this be happening?” action after valid analysis. Show loading, source-cited answer, possible drivers, limitations, citation links, server-curated fallback, no-key state, rate-limited state and no-evidence state. Include fixed copy: “These are possible explanations, not proof that one cause created this local trend.”
- Do not place the answer before the measured evidence; it is contextual detail after the case verdict.

E. Quality, tests and handoff
- Add unit tests for local-profile migration/reset, verdict mapping, evidence/why states, observed-vs-forecast labels, timeline logic, news marker state mapping, and reduced-motion behaviour where testable.
- Manually check keyboard navigation, focus visibility, screen-reader labels, mobile/tablet/desktop layouts, slow API response, cache-stale response and all missing feature configurations.
- Run frontend tests and production build. Update README/HANDOFF.md with the local-profile and V2 UI behaviour. Include source/AI disclosure and limitations in the UI.
- Produce docs/V2_FRONTEND_HANDOFF.md with changed components, contract dependencies, tests run/results, responsive/accessibility checks, remaining visual risks, and exact steps for an Azure staging smoke test.

At completion, report changed files, verification results, and any backend-contract issue. Do not deploy, change Azure configuration, or hide known limits.
```

## Final integration checklist

1. Read both handoff documents and compare all actual response fixtures against `V2_API_CONTRACT.md`.
2. Start with no `OPENAI_API_KEY` and no news configuration: verify local profile, trends, rationale fallback and empty-news state work.
3. Enable each optional dependency one at a time: Meteomatics, citations/AI, then news. Verify source labels, stale cache display, rate limits and no credential leakage.
4. Simulate NASA timeout, partial grid data, offline browser cache, malformed model response, no forecast skill, and slow mobile CPU.
5. Run `pytest`, `npm test`, `npm run build`, a Docker image build, and one-process local smoke test before Azure staging.
6. On Azure staging, set secrets only in application settings, verify same-origin API traffic, inspect browser bundle/network requests for secrets, and check phone + desktop.
7. Preserve a short demo path: open local profile → select saved place → investigate a trend → visual verdict → why with citations → timeline/forecast eligibility → globe news context.
