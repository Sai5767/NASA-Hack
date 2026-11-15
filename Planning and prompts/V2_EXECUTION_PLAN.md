# Trend Detective V2 — execution plan

## Purpose and agreed scope

V2 is a **hackathon demonstration** of Trend Detective. It must keep the existing core promise: select a place and an Earth-system variable, then explain what is changing, where, how much, and how reliable the trend is. V2 adds:

1. An optional, source-cited **"Why might this be happening?"** analysis after a trend has been calculated.
2. A clearer, visual evidence verdict for school-age users, with an expandable calculation trace for technical users.
3. A time slider below the globe for historical monthly data and, only when backtesting supports it, short-range forecast frames.
4. A local-only demo profile: a welcome/login-style screen, personalised interests, and saved locations. This is **not authentication** and never collects a password.
5. A new globe-first home screen: gentle rotating Earth, contextual live-news markers, account control at top-right, and a dashboard on the left.
6. A higher-quality, honest monthly forecaster for **temperature, rainfall, and cloud cover**.
7. A **Meteomatics** live-weather layer for current conditions and short-range operational weather guidance at saved locations.
8. Azure-ready reliability work so an outage gives a useful fallback rather than a broken screen.

## Non-negotiable product rules

- Keep the existing FastAPI + React/Vite architecture and the audited statistics. Do not rewrite the trend engine merely to add V2.
- Personal information, profile choices, saved locations, and watchlists stay in browser `localStorage`. There is no cloud account, database, password, or server-side profile record.
- `OPENAI_API_KEY` belongs only in the backend process environment or Azure application settings. It must never appear in a browser bundle, URL, source file, test snapshot, or log.
- Meteomatics credentials (an access token, or a username/password pair supported by the account) also belong only in backend/Azure application settings. Never call Meteomatics directly from the browser or expose its credential in a URL.
- The AI must **not** calculate a trend, p-value, forecast score, or severity rating. The backend produces the numeric evidence first; the AI only explains it in plain language from supplied facts and cited sources.
- “Why” means plausible explanations, associations, and published context — never proof of causation. Every answer must say this clearly.
- A prediction is shown only when it beats the seasonal-naive baseline in rolling backtests. If it does not, the app says so and does not animate invented future data.
- News is context, not climate evidence. A headline cannot make a trend significant or explain a trend on its own.
- Preserve `prefers-reduced-motion`, keyboard globe controls, high contrast, and the existing technical-detail path.

## What already exists and should be reused

| Existing capability | V2 decision |
| --- | --- |
| 19 monthly NASA POWER variables, plus GISTEMP, CO₂, sea ice and climate indices | Keep as the primary analysis catalogue. Do not unscientifically average data products. |
| Mann–Kendall, regression test, Sen slope, serial-correlation adjustment and false-discovery correction | Keep unchanged unless a reference-value test identifies a defect. Reuse their outputs in the new verdict card. |
| `reasons.py` curated explanations and the local explainer | Retain as no-key/offline fallback when an AI explanation is disabled or fails. |
| World time-lapse and interactive canvas globe | Extend its controls and layers; do not replace it with a map library. |
| Browser-only Personalise wizard, watchlist, saved interests | Evolve it into the demo account experience; do not add real auth. |
| Forecast lab with rolling backtests and conformal intervals | Reuse its evaluation discipline; add a separate monthly short-range path for the three chosen variables. |
| Meteomatics Weather API | Add as an optional, server-proxied current/short-range weather layer. It does not replace or average with NASA POWER. |

## Target user flows

### 1. First-run demo profile

The first screen is a lightweight `Welcome, Trend Detective` page. A user enters a display name only (or chooses `Demo Explorer`) and answers five concise questions:

1. **Places I care about** — choose or pin up to five locations.
2. **Earth systems I want to follow** — Heat, rain & water, clouds & sunlight, land & plants, wind & atmosphere, ice & oceans.
3. **What I want to do** — understand change, compare places, follow local conditions, or explore forecasts.
4. **How much detail** — simple, balanced, or technical.
5. **What should appear first** — trends, explain-why cards, forecast status, or local news/context.

The profile is stored as a versioned `td-profile-v2` object in `localStorage`. The Account button opens a panel to edit, reset, export, or import it. “Log out” only clears that browser’s local profile after confirmation; it does not imply a remote session.

### 2. Home globe and news context

The home screen has a rotating orthographic globe at centre/right, dashboard at left, compact account button top-right, and a bottom timeline rail. It only preloads the user’s saved locations plus a small, fixed set of globally distributed news queries; it must not run a world survey on page load.

News markers contain a headline, publisher, publication time, source link, broad category, approximate location, and a status colour:

- **Green:** informational or low-urgency science/environment context.
- **Amber:** weather, environmental disruption, or event worth watching.
- **Red:** a major reported hazard or emergency.

The colour is a transparent editorial triage label, not an official emergency rating. A marker must say “news context” and link to its original article. Markers rotate with the globe, fade as new ones enter view, and must stop moving under reduced-motion preferences.

### 3. Investigate → visual verdict → optional why

After a user chooses a variable, place, and period:

1. The backend fetches and analyses the series.
2. The overview presents a large evidence badge rather than leading with a p-value:
   - **Strong evidence of a trend**
   - **Some evidence — investigate carefully**
   - **No clear evidence yet**
   - **Not enough data to tell**
3. The card still gives direction, rate, data period and data source. It never hides uncertainty.
4. `See the evidence` expands plain-language test steps and then exact values (sample size, Sen slope/interval, Mann–Kendall result, adjusted regression result, raw p-value and correction status). The animation is explanatory only; all calculations were already executed on the server.
5. `Why might this be happening?` calls the backend AI route. It is disabled until a successful trend exists.
6. The response shows a short answer, 2–4 possible drivers, key limitations, and clickable citations. It begins with “Possible explanations, not proof of cause.” If unavailable, show the existing curated explanation or a precise unavailable state.

### 4. Timeline and forecast animation

The bottom globe rail has month labels, scrubber, play/pause, speed, source status, and a clear `Observed` / `Forecast` boundary.

- **Historical mode:** monthly anomalies for the selected variable. The globe layer is a labelled, coarse analysis grid around the user’s chosen area, not a falsely precise global satellite image.
- **Live weather mode:** server-proxied Meteomatics conditions and its short-range forecast, at the resolution and horizon the team’s Meteomatics subscription supports. Use the documented `t_2m:C`, `precip_1h:mm`, and `total_cloud_cover:p` parameter families (plus wind only if useful). Label every frame `Meteomatics weather forecast`, with fetch time, provider and model/source information when available. Do not describe this as a NASA observation or a custom ML prediction.
- **Climate forecast mode:** up to the next three months for air temperature (`T2M`), rainfall (`PRECTOTCORR`), and cloud cover (`CLOUD_AMT`) only. These backtested internal forecast frames are visually distinct (for example, dashed border and `Trend Detective climate forecast` label).
- **Quality gate:** forecast frames are unavailable if the selected model fails to beat seasonal-naive on rolling 1-, 2-, and 3-month backtests, required coverage is poor, data are too sparse, or a grid cell fails. The historical animation continues and the UI says why forecasts are withheld.

The UI must not put hourly Meteomatics weather values on the same scale as monthly NASA POWER anomalies. It uses separate layers/time controls and a clear hand-off in the interface.

## Architecture and contracts

### Storage and secrets

```text
Browser
  localStorage: profile, saved locations, preferences, small response cache
  sessionStorage: harmless UI session state only

FastAPI service (Azure App Service / container)
  in-memory bounded TTL cache: public NASA/news/AI responses
  environment: OPENAI_API_KEY, OPENAI_EXPLANATION_MODEL, NEWS_PROVIDER settings,
               METEOMATICS credentials/settings
  no user database and no user-profile persistence
```

Use an Azure deployment slot or staging service for the final smoke test. Azure settings, not files, hold secrets. The app must boot and run gracefully without `OPENAI_API_KEY` or a live news provider.

### New API surface

The backend agent writes an explicit schema document and tests before the frontend consumes these routes. Names may only change with a matching schema update.

| Route | Purpose | Key response requirement |
| --- | --- | --- |
| `GET /api/trend` *(extended)* | Existing point trend analysis | Add a stable `evidence_trace` object; do not remove existing fields. |
| `POST /api/explanations` | AI-assisted explanation for a server-generated trend | Return `{status, summary, drivers, limitations, citations, generated_at, fallback}`. Never return unverified uncited claims. |
| `GET /api/news` | News context near selected/saved locations | Return `{items, fetched_at, stale, provider, partial_failures}`; every item has a canonical article URL and approximate coordinates. |
| `GET /api/monthly-frames` | Observed timeline grid around one selected location | Return coarse monthly fields, actual source/provenance, missing-cell information, and limits. |
| `GET /api/monthly-forecast` | Backtested 1–3 month forecast frames | Return forecast only with per-variable/model metrics and explicit `eligible`; otherwise a reason. |
| `GET /api/live-weather` | Meteomatics current and short-range weather for one saved/selected location | Return provider, provider parameter, provider/model metadata where available, fetched/valid times, units, `stale`, and feature availability. |
| `GET /api/health/details` | Non-secret dependency health for diagnostics | Report source status, cache age, and feature availability; never include keys or raw upstream errors. |

`POST /api/explanations` receives only a short user question plus a small, backend-generated `case_id`/request signature. It must reconstruct all statistical facts on the server or verify a signed/cached analysis result. Do not trust arbitrary values supplied by the browser.

### Meteomatics integration design

Meteomatics is a complementary operational weather source, not a long-record climate-trend source. Its API accepts time, parameter and coordinate queries and provides historic, current and forecast weather data; the example URL supplied by the team is a Berlin 2-metre-temperature request. The adapter must request JSON, not the sample HTML format.

Create a `MeteomaticsProvider` behind a weather-provider interface. It maps the V2 cards and animation to this small initial set:

| App field | Meteomatics parameter | Intended V2 use |
| --- | --- | --- |
| Air temperature | `t_2m:C` | Current card and hourly/short-range weather frames |
| Precipitation | `precip_1h:mm` | Hourly rain amount/forecast frames |
| Cloud cover | `total_cloud_cover:p` | Current sky condition/forecast frames |

The backend, never the browser, authenticates with the account’s supported access token or username/password mechanism. It applies coordinate/range/interval limits, explicit connection and read timeouts, bounded retries for transient failures, response-size limits, and a short TTL cache (for example 5 minutes for current conditions and 15–30 minutes for forecast). The response normalises provider details and never forwards credentials or unfiltered upstream errors.

If credentials are absent, invalid, rate-limited, or the provider is unavailable, return feature availability plus a precise non-secret reason. The home screen hides/disables live weather gracefully; NASA POWER historical analysis, local profile and internal forecast remain usable. Never substitute NASA POWER monthly data for a current Meteomatics reading without changing the visible source label.

### AI explanation design

Use the OpenAI Responses API server-side. The current official API supports the hosted `web_search` tool and returns URL citations; the UI must render those citations as prominent links. Restrict research to a documented allow-list of scientific/official domains where feasible (`nasa.gov`, `earthdata.nasa.gov`, `noaa.gov`, `nsidc.org`, `ipcc.ch`, journal/publisher domains). Cache by analysis signature for 24 hours and rate-limit per browser/IP.

The system instruction must require the model to:

- use only the supplied computed facts plus retrieved cited evidence;
- distinguish measured local trend, mechanism, correlation, and broader scientific context;
- say when the evidence does not support a local explanation;
- never invent a citation, numerical result, event, or confidence;
- return structured JSON validated on the server; and
- decline medical, emergency, legal, or personalised risk advice.

If key, quota, search, schema validation, or citation validation fails, return the curated `reasons.py` response where available; otherwise return `No explanation is available for this case yet.` This is a successful, honest degraded state.

### News provider design

Create a provider interface rather than coupling the UI to one vendor. The default demo adapter may use a keyless source such as GDELT; a later Azure-configured provider can replace it. Do not scrape arbitrary publisher pages.

1. Query a bounded set of saved-location and global-region terms.
2. Deduplicate by canonical URL/title, reject items without a credible publisher URL or usable date, geocode only with an auditable method, and retain uncertainty when location is approximate.
3. Apply deterministic category and severity rules to title/description. Never ask an LLM to invent an emergency level.
4. Cache 15 minutes; serve the most recent successful cache marked `stale: true` after an upstream failure.
5. If no valid stories exist, show an empty-state message and retained saved-location markers — never synthetic headlines.

## Data-resource position

NASA POWER remains the shipped, keyless source for point/monthly V2 trend and forecast work. The separate source registry lists every resource the team supplied and tells future agents whether it is an in-app candidate, a validation/reference link, or deferred. V2 must not claim that a source is integrated until a tested adapter and in-product provenance label exist.

## Build sequence

### Phase 0 — protect the baseline

- Start from a clean branch prefixed `codex/`.
- Run the existing backend tests, frontend tests, and production build before any V2 work.
- Read `README.md`, `HANDOFF.md`, `docs/REQUIREMENTS.md`, `docs/STATS_AUDIT.md`, and `docs/V2_DATA_SOURCE_REGISTRY.md`.
- Add the API/schema and failure-mode documents before implementation.

**Exit gate:** baseline results recorded; no existing API response is broken; no secret is committed.

### Phase 1 — backend resilience and contract (Gemini)

- Centralise source clients behind adapters with timeout, retry, cancellation, bounded concurrency, cache age, and normalised error types.
- Add the Meteomatics adapter and `GET /api/live-weather` early, using server-only configuration and offline provider fixtures. Its successful response must preserve the requested parameter, units, valid time, fetch time, provider/model metadata when available, and stale state.
- Extend the trend response with an exact, testable evidence trace.
- Add `/api/health/details`, feature flags, and deterministic fixture data for all new external integrations.
- Add a local/ephemeral cache suitable for the demo. Do not introduce a profile database.

**Exit gate:** network failure tests show usable JSON error/fallback responses, never tracebacks or blank bodies.

### Phase 2 — monthly data and forecasting (Gemini)

- Build the **observed** monthly area grid first, limited to selected locations and a small fixed resolution.
- Implement a monthly forecaster for `T2M`, `PRECTOTCORR`, and `CLOUD_AMT` using rolling-origin tests. Candidate models should include seasonal-naive, damped trend/harmonic regression, and a regularised autoregressive candidate; use the winner only when it clears the defined quality gate.
- Produce calibration/coverage metrics and an eligibility reason on every response.
- Never fill missing grid cells with made-up observations; surface them as missing.

**Exit gate:** synthetic-series tests verify seasonality, trend, missing months, a hard-to-predict record, and a forecast that loses to seasonal-naive.

### Phase 3 — explain-why and news (Gemini)

- Implement the server-only OpenAI route, structured output validation, citation normalisation, cache, rate limit, and curated fallback.
- Implement the news-provider interface, one default adapter, stale cache behaviour, source URLs, deterministic severity labels, and empty state.
- Add tests that run fully offline via fake OpenAI/news clients.
- Add Meteomatics-specific tests for parameter mapping, normalisation, missing/invalid credentials, 401/429/timeout/malformed response, cache/stale fallback, and proof that no credential reaches an API response or log fixture.

**Exit gate:** the complete application runs without keys and shows clear unavailable/fallback states; keys remain server-side.

### Phase 4 — V2 shell and local account (Claude)

- Transform the current Personalise wizard into the welcome/demo-profile flow without adding password or server calls.
- Add a top-right Account panel with edit, reset, import/export, saved locations, and privacy copy.
- Use user interests to rank visible cards and choose which locations are fetched; never pretend this is a secure account.

**Exit gate:** a reload restores preferences; reset removes local profile after confirmation; no profile data appears in backend requests.

### Phase 5 — globe, dashboard, and timeline (Claude)

- Reuse the existing custom canvas globe. Add tasteful satellite-inspired shading/atmosphere only from permissible bundled or licensed assets, with data layers visibly separated from decorative imagery.
- Add location/news markers, controls, dashboard cards, bottom timeline rail, keyboard semantics, tooltips, and reduced-motion mode.
- Connect only to the documented backend contract; use fixtures while the API is unavailable.

**Exit gate:** no layout break at phone, tablet, or desktop widths; interaction works by mouse, touch, and keyboard; canvas does not spin when reduced motion is enabled.

### Phase 6 — explanatory experience and forecast animation (Claude)

- Build the evidence verdict ladder and expandable evidence trace.
- Add the optional “Why” panel with loading, citations, fallback, and retry states.
- Render observed versus forecast timeline frames, with a highly visible boundary and eligibility explanation.
- Label every data source and refresh timestamp; never label model output as observed satellite data.

**Exit gate:** all non-happy paths are intentionally designed, not console errors.

### Phase 7 — integration and Azure rehearsal (both, in order)

- Gemini publishes the locked API schema, fixtures, and a handoff note; Claude integrates and reports contract mismatches rather than patching undocumented assumptions.
- Run backend tests, frontend tests, production build, Docker build, and a one-process local smoke test.
- Deploy to an Azure staging slot with environment settings set outside the repository. Test without each optional dependency in turn.

**Exit gate:** verified desktop and phone demo; no key exposure; all source credits, limitations, and AI disclosure are visible.

## Failure-mode acceptance matrix

| Failure | Required behaviour |
| --- | --- |
| NASA/NOAA source timeout, 429, malformed response | Retry within a short bounded budget; use fresh/stale cache if available; otherwise show source-specific retry card while leaving prior result visible. |
| Partial grid failure | Render valid cells, visually identify missing cells, report coverage; do not interpolate them as data. |
| OpenAI key missing/quota/error/invalid JSON | Hide or disable live-AI button with a precise explanation; use curated reason if available. |
| Meteomatics credential missing/invalid, quota, timeout or malformed response | Disable or mark the live-weather layer unavailable, with no secret detail; retain historical NASA analysis and cached/stale weather only when clearly timestamped. |
| AI has no credible cited explanation | Say that the data establish a trend but cannot establish why. |
| News provider outage/no stories | Show stale news with timestamp or an honest empty state; no placeholders. |
| Forecast too short/poor backtest | Observed timeline remains available; forecast segment is disabled with a plain reason. |
| Browser storage denied/full | Keep a temporary in-memory session and disclose that preferences will not persist. |
| Slow device or long animation | Cap grid size, cancel stale requests, pause off-screen animation, respect reduced motion. |
| Invalid location/variable/date range | Validate client-side for usability and server-side for safety; show one actionable message. |
| Azure instance restart | App starts with empty cache but fully usable; profile remains local; no deployment relies on local server disk. |
| Dependency/API contract mismatch | Contract test and fixture test fail in CI/local verification before the UI ships. |

## Definition of done

V2 is demo-ready only when the following are true:

- A first-time visitor can create a local profile, save a location, choose an interest, and see a personalised home without an account service.
- A completed analysis has a visual significance verdict, plain-language explanation, expandable calculations, source and limitations.
- “Why?” has source links or honestly says why it cannot answer; it never asserts causal proof.
- Temperature, rainfall, and cloud cover support an observed monthly timeline and only show 1–3 forecast months when backtesting earns it.
- Meteomatics live temperature, hourly precipitation and cloud-cover data appear only when the backend provider is configured and available, with provider/time/source labels distinct from NASA history and internal forecasts.
- The globe has a clean rotating presentation, accessible controls, data/news provenance, and safe green/amber/red news context markers.
- Every new external dependency has a timeout, cache/fallback, offline test double, and visible degraded state.
- Existing statistical-reference tests, new backend tests, frontend tests, production build, Docker build, and Azure staging smoke test pass.
