# Trend Detective: Earth system case files

An entry for the **2026 NASA Space Apps Challenge, "Be an Earth System Trend Detective"**.

Pick any place on Earth and an Earth-system variable. Trend Detective pulls decades of NASA data, then answers the challenge's
four questions: **what** is changing, **where**, **how much**, and **is it statistically significant**. Then it goes further: it shows
how much to trust the answer, what climate patterns move with it, and whether independent records agree.

- **Backend:** Python, FastAPI. All statistics are hand-written (no SciPy) and checked against published reference values.
- **Front-end:** React, Vite, a custom canvas globe and hand-built SVG charts. No chart or map library, no external map tiles.

## Brief coverage

How the app meets each part of the challenge text.

| Challenge text | What the app does |
| --- | --- |
| Select variables measured by Earth science missions or produced by Earth science models | **19 variables** from NASA POWER (MERRA-2 reanalysis, satellite-based radiation) in 5 groups, plus **7 planet-wide streams** (see below). Choose from a dropdown, **Guided intake**, the **Ask the detective** box, or let **Sweep** rank every variable at a place |
| Visualize how they change over time | Annual averages, monthly anomalies with the seasonal cycle removed, a 12-month average, "climate stripes", a 12-month fingerprint |
| **What** is changing | Sweep (all variables ranked), World survey, Planet vitals |
| **Where** it is changing | Drop a pin anywhere, region **Scan** (grid on the globe, area-weighted regional average, opposite-trend banner), **World survey** of 68 sample sites, **Duel** of two places |
| **How much** | Sen's slope per decade with a 95% range, total change, percent of average, **signal vs noise** (change compared with normal year-to-year swings) |
| Is it **significant** | Mann–Kendall test, regression t-test, serial-correlation adjustment, false-discovery control, and a transparent five-check **evidence grade** |
| Objective 1: identify variables | Sweep, intake, search box, variable descriptions |
| Objective 2: data for a region | Point, grid scan with regional composite, world sample |
| Objective 3: long time series | 1981 to the last complete year for places; 1958+ for CO₂, 1979+ for sea ice |
| Objective 4: rate and significance | Sen's slope + CI, Mann–Kendall, t-test, all shown side by side |
| Audience: students and the public | Plain-language definitions on hover and in a glossary; detective framing |
| Ask a few questions, then find variables | **Guided intake** (2 questions) and **Ask the detective** (type "is Phoenix getting hotter?") |
| Demonstration examples to watch | **11 guided cases** with briefings and animated reveals (a replay button re-runs the reveal) |
| Identify data likely to show trends in particular areas | Sweep and **World survey** |
| Seasonal cycle should be removed | Monthly anomalies; per-month trend fingerprint |
| Longer records can make a trend significant | **Emergence chart**: how the evidence builds as years are added |
| Trends can be non-linear; linear is a good start | Linear trends, plus a **shape check** (steady ramp vs step change, Pettitt test) that warns when a line misleads |
| Beyond the brief | Backtested **forecasts** with calibrated bands, **archetype clustering** of places, and a **predictability** model (see Machine learning); a trend **ledger**, real-world **events**, a world **time-lapse**, a built-in **explainer**. Full cross-reference: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) |

### Data streams

| Stream | Source | Used for |
| --- | --- | --- |
| 19 monthly variables at any point | NASA POWER (NASA LaRC) | Everything place-based |
| Global surface temperature | NASA GISS GISTEMP v4 | Planet vitals, **heat ratio**, independent zonal cross-check |
| GISTEMP by latitude band | NASA GISS | "Independent check" for air temperature |
| Atmospheric CO₂ | NOAA Global Monitoring Laboratory | Planet vitals |
| Arctic and Antarctic sea-ice extent | NSIDC Sea Ice Index (satellite microwave) | Planet vitals |
| ENSO, Pacific Decadal Oscillation, North Atlantic Oscillation | NOAA CPC and NCEI | **Suspect lineup**, ENSO-adjusted trend, rhythm status |

Not used, and why: NASA's Hydrology Data Rods (the request now returns a web page, not data) and Earthdata/Giovanni/AppEEARS
(they need a login). Direct satellite-instrument series (MODIS, OMI, AIRS, GPM) are therefore a known gap.

## Features

- **Case file:** verdict stamp, rate of change with 95% range, total change, percent of average, signal vs noise, p-values, shape of the
  record, trend chart with confidence cone, trend stripes, a radial 12-month **fingerprint**, the emergence chart, an **evidence locker**
  of five checks, and a shareable link.
- **Suspect lineup:** which climate rhythms (ENSO, PDO, NAO) move in step with the place, tested with effective sample size and
  false-discovery control; **ENSO-adjusted trend**; **heat ratio** (degrees of local warming per degree of global warming);
  an **independent GISTEMP check**. These are correlations, never causes.
- **Sweep, Scan, Duel:** every variable at a place; a region on a grid; two places and a test of whether their trends differ.
- **World survey:** one variable at 68 sample sites on a flat map. Dot color = direction, ring = survives correction, size = signal vs noise.
- **Planet vitals:** global temperature, CO₂, Arctic and Antarctic sea ice get the same case-file engine; ENSO/PDO/NAO are shown as status readouts and
  deliberately not tested for a trend.
- **Machine learning** (see below): a **forecast lab** with a replay slider, **trend archetypes and climate twins**, and a cross-validated
  **predictability** model.
- **Overview and Detail:** a case file opens on an **Overview** that answers the challenge's four questions (what, where, how much, is it
  real) with one chart and a local forecast headline; the **Detail** view holds the evidence locker, seasonal fingerprint, climate-rhythm
  suspects and forecast lab in collapsible sections. The choice is remembered.
- **Home:** a **watchlist** of places with sparklines and trends, personalised **For you** pop-ups over the globe, and a five-question
  **Personalise** wizard ([docs/USER_QUESTIONS.md](docs/USER_QUESTIONS.md)). Everything about the user stays in the browser. Tabs are grouped
  into **Essentials** (Case file, Sweep, Scan) and **Explore more**.
- **Explainer:** click any dotted term for a fuller explanation, or ask a question. It is a curated, built-in knowledge base (no AI model, no
  network) and quotes the open case's own numbers.
- **Events:** 15 well-documented heat waves, droughts, floods and climate swings, shown as markers on case-file charts and in an Events tab
  that measures what the data actually show at that place and year, including when they show nothing.
- **Ledger:** every variable at every sample place plus the planet's vital signs (about 1,200 trends) corrected together for multiple testing and
  ranked, with sourced, hedged context on why each solid trend might exist. Order by p-value, signal vs noise, or size of change.
- **Time-lapse:** play the World survey year by year, each site coloured by how that year compared with its own average.
- **Themes:** the violet *Nebula* default and the original cyan *Classic*, switched live.
- **Shareable links** (the URL carries the whole question), CSV export, keyboard-accessible globe, `prefers-reduced-motion` respected,
  and an error screen instead of a blank page if something breaks.

## How the statistics work

- Yearly values come only from **complete 12-month years**, so seasons are never under-weighted.
- **Sen's slope** with a Gilbert (1987) 95% interval; **Mann–Kendall** with tie correction; a **regression t-test** (Student-t written from scratch).
- If neighboring years resemble each other (positive lag-1 autocorrelation, bias-corrected for short records), variance is inflated by
  `(1+φ)/(1−φ)` and the regression test uses the effective number of independent years. Simulation puts the false-alarm rate at 4–7% for a
  nominal 5% even with strongly persistent years (unadjusted: up to 39%). Both adjusted and unadjusted p-values are shown.
  Every statistic is audited against SciPy, pymannkendall and pyhomogeneity: see [docs/STATS_AUDIT.md](docs/STATS_AUDIT.md).
- **Benjamini–Hochberg** false-discovery control across scan cells, sweep variables, world sites, calendar months and the three rhythms.
- Rhythm correlations use linearly detrended series and the **effective number of independent years** (Bretherton et al., 1999).
- **Robustness:** the trend is re-tested after trimming 5 years from the start, the end, and both.
- **Shape check:** best step vs straight line (variance explained) plus the Pettitt change-point test.
- **Evidence grade** (strong / moderate / weak / none) comes from five visible checks.

## Machine learning

All of it is pure Python (no ML libraries), seeded, tested against known answers, and each piece reports how far to trust it.

- **Forecast lab (supervised learning, backtesting).** Eight models compete in a rolling-origin backtest: two naive baselines, three statistical trend
  models, a **ridge regression on past years**, and an ensemble. Each is trained only on data up to a past year and scored on the next 1–5 years.
  The winner forecasts the next five years. Its error band is a **split-conformal interval** built from its own backtest errors, and its coverage is
  re-checked on origins it was not calibrated on. If nothing beats the naive baseline, the app says the series is hard to forecast. A **replay slider**
  shows what the model would have predicted at an earlier year next to what actually happened.
- **Trend archetypes and climate twins (unsupervised learning).** Each of the 68 sample places gets a fingerprint: the signal-vs-noise of 15 variables,
  group-weighted so five temperature variables cannot dominate. **k-means** (k-means++ starts) groups them. The **silhouette score** and a bootstrap
  **stability** score (adjusted Rand index over resamples) are shown, and you can explore other numbers of archetypes. Cosine-similarity nearest
  neighbors give every place its **climate twins**.
- **Predictability (cross-validated ridge regression).** How much of a place's year-to-year swing do ENSO, PDO and NAO predict together, in years the model
  has not seen (leave-one-year-out), with permutation importance for each driver.

These are statistical extrapolation and pattern-finding on short records, not climate projections. On real data the checks behave sensibly: ENSO
predicts about 86% of the equatorial Pacific's yearly swings but essentially none of Iowa's; the forecast lab credits skill for Delhi's sunlight
and refuses to claim any for Sahel rainfall.

## Run it

**One click (Windows):** double-click **`START.bat`**. It needs Python 3.10+ and Node.js 18+ installed, and does the rest:
on the first run it creates the Python environment and installs the backend and front-end packages (about a minute), then it starts the
backend (port 8000) and front-end (port 5173) in two minimized windows and opens **http://127.0.0.1:5173** in your browser.
Double-clicking it again while the app is running just reopens the page. Double-click **`STOP.bat`** when you are finished; it closes
only the servers that were started from this folder.

For a desktop shortcut, right-click `START.bat` and choose Send to, then Desktop (create shortcut).

From a terminal the same thing is `.\START.bat` and `.\STOP.bat`. If a step fails, the window stays open and says what went wrong.

**You always get the current version.** `START.bat` asks any server already on ports 8000 and 5173 which version it is and which
folder it came from. If it is this folder's current code it is reused; if it is an older copy, a copy from another folder, or started
before the code last changed, `START.bat` stops it and starts a fresh one, then prints `Version: <commit>`. The footer of the app shows the
same version and warns if the page and the server disagree. `STOP.bat` also stops an older copy still holding the ports, and never
touches other programs. Keep a single copy of the project: a second folder (for example "NASA-Hack - Copy") has its own, older
launcher, and starting the app from it runs its older code.

Manual setup, for other systems or if you prefer separate terminals. **Libraries:** the Python ones are in `requirements.txt` (it points at
`backend/requirements.txt`, the one list `START.bat` and the Dockerfile also use), and the front-end ones are in `frontend/package.json`.
The commands below install both:

```bash
python -m venv backend/.venv
backend\.venv\Scripts\activate          # macOS/Linux: source backend/.venv/bin/activate
pip install -r requirements.txt
cd backend
uvicorn app.main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

(Running `pip install -r requirements.txt` from inside `backend/` works too.)

API docs: http://127.0.0.1:8000/docs

**Publishing.** After `npm run build` in `frontend/`, the API serves the built front-end too, so one process and one URL is all a host needs.
`Dockerfile` and `render.yaml` are provided. Nothing is published yet; see [docs/DEPLOY.md](docs/DEPLOY.md).

### Optional V2 environment variables

All core Earth-system analysis, evidence traces, and monthly grid/forecast endpoints work locally without any API keys. Optional environment variables configure V2 integrations and operational limits.

**Where to put them locally:** copy `backend/.env.example` to `backend/.env` and fill in your own values (`copy backend\.env.example backend\.env`). The backend reads real environment variables first and then fills in anything still unset from `backend/.env`; blank lines leave a feature off. `backend/.env` is ignored by Git and by Docker and must never be committed or uploaded. On Azure, enter the same names under App Service application settings instead (they always win over the file). Only the setting names below are ever read from the file.

- `OPENAI_API_KEY`, `OPENAI_EXPLANATION_MODEL` (default `gpt-4o-mini`), `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_SECONDS`, `OPENAI_WEB_SEARCH`: server-side OpenAI Responses API synthesis for `POST /api/explanations`. When `OPENAI_API_KEY` is unset, `/api/explanations` falls back cleanly to the curated knowledge base in `backend/app/reasons.py` and server-computed case statistics. Every citation must be a real, retrieved or supplied link on an allow-listed science domain.
- `NEWS_PROVIDER` (`gdelt`, `json_feed`, or `disabled`), `NEWS_API_URL`, `NEWS_API_KEY`, `NEWS_TIMEOUT_SECONDS`, `NEWS_CACHE_TTL_SECONDS`: live-news context adapter for `GET /api/news`. Defaults to GDELT Doc 2.0 JSON, keeps only stories about weather, climate or the environment, and degrades to an explicit unavailable/empty state if offline.
- `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` (plus optional `METEOMATICS_BASE_URL`, `METEOMATICS_TIMEOUT_SECONDS`, `METEOMATICS_CACHE_TTL_SECONDS`): server-side Meteomatics hourly weather for `GET /api/live-weather`. Unset, that route reports `unconfigured` and nothing else changes. Meteomatics is a separate source from NASA POWER and is never mixed with it; see [docs/V2_METEOMATICS_HANDOFF.md](docs/V2_METEOMATICS_HANDOFF.md).
- `NASA_POWER_TIMEOUT_SECONDS`, `NASA_POWER_MAX_CONCURRENCY`, `NASA_POWER_CACHE_TTL_SECONDS`, `STREAMS_TIMEOUT_SECONDS`, `STREAMS_CACHE_TTL_SECONDS`, `EXPLANATION_CACHE_TTL_SECONDS`, `EXPLANATION_RATE_LIMIT_MAX`, `EXPLANATION_RATE_LIMIT_WINDOW_SECONDS`, `TD_CASE_SECRET`, `TD_ALLOWED_ORIGINS`: resilience, cache TTL, rate-limiting, and CORS controls. Set only the **names** in the host's settings, never values in the repository. See [docs/V2_API_CONTRACT.md](docs/V2_API_CONTRACT.md) and [docs/V2_BACKEND_HANDOFF.md](docs/V2_BACKEND_HANDOFF.md) for the real defaults.

## Tests

```bash
cd backend
.venv\Scripts\activate
pytest
```

```bash
cd frontend
npm test
```

The backend suite runs offline: fake NASA POWER and planet-stream calls supply synthetic series with known seasonal cycles and trends.
Parsers are tested on samples copied from the real files, and a failing stream is shown not to break the others.

## Project layout

```
START.bat       one-click start and stop on Windows (with STOP.bat, start-app.ps1, stop-app.ps1)
requirements.txt  the Python libraries (points at backend/requirements.txt); front-end libraries are in frontend/package.json
backend/app/    nasa_power.py  streams.py  stats.py  analysis.py  context.py  planet.py  places.py  morans.py  main.py
                ml.py (ridge, k-means, silhouette, stability)  forecast.py  archetypes.py
                ledger.py  reasons.py (the trend ledger and its sourced context)  deploy.py (one-process hosting)
                resilience.py  monthly.py  explanations.py  news.py  meteomatics.py
                (V2: resilience, monthly frames/forecasts, AI explain, news, Meteomatics live weather)
backend/tests/  reference-value, pipeline, parser, ledger, V2 contract and API tests (267, all offline)
frontend/src/   components/ (Globe, CaseFile, Overview, Home, Watchlist, Intake, Explainer, Events, Ledger, TimeLapse, charts/…)
                lib/ (profile, explain, events, lapse, theme …)  styles/
frontend/tests/ logic tests (63)
docs/           STATS_AUDIT.md  REQUIREMENTS.md  USER_QUESTIONS.md  DEPLOY.md
                V2_API_CONTRACT.md  V2_BACKEND_HANDOFF.md  V2_METEOMATICS_HANDOFF.md
Planning and prompts/  V2 plan, data-source registry, agent prompts, the To Do list and the manual process
tools/          stats_audit/ (reproducible audit against SciPy and friends; needs its own throwaway environment and requirements.txt)
Dockerfile  render.yaml    one-image, one-process hosting (prepared, not published)
HANDOFF.md      working notes for whoever continues the project
```

## More documentation

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): the challenge's requirements, and where the app answers each.
- [docs/STATS_AUDIT.md](docs/STATS_AUDIT.md): how the statistics were checked against reference libraries, and what was fixed.
- [docs/USER_QUESTIONS.md](docs/USER_QUESTIONS.md): every question the app asks, and what each answer changes.
- [docs/DEPLOY.md](docs/DEPLOY.md): publishing on free hosting.
- [docs/V2_API_CONTRACT.md](docs/V2_API_CONTRACT.md): V2 API request/response schemas and sample payloads.
- [docs/V2_BACKEND_HANDOFF.md](docs/V2_BACKEND_HANDOFF.md): V2 backend handoff notes, fixtures, and frontend contract rules.
- [docs/V2_METEOMATICS_HANDOFF.md](docs/V2_METEOMATICS_HANDOFF.md): the Meteomatics live-weather route, how to enable it, and its limits.
- [Planning and prompts/V2_EXECUTION_PLAN.md](Planning%20and%20prompts/V2_EXECUTION_PLAN.md) and [V2_DATA_SOURCE_REGISTRY.md](Planning%20and%20prompts/V2_DATA_SOURCE_REGISTRY.md): the V2 plan and the status of every data source.

## Credits and rules notes

- **Data:** NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program; NASA GISS GISTEMP;
  NOAA Global Monitoring Laboratory, Climate Prediction Center and NCEI; NSIDC Sea Ice Index (NOAA@NSIDC).
- **Optional live weather and news:** hourly operational weather from [Meteomatics](https://www.meteomatics.com/) (only when the owner configures
  an account; it is a separate source from the NASA climate analysis and is never mixed with it) and headline context from the
  [GDELT Project](https://www.gdeltproject.org/). Neither is affiliated with this project.
- **Map:** Natural Earth land and borders (public domain) via the `world-atlas` package. **Fonts:** Space Grotesk and JetBrains Mono
  (SIL Open Font License) via Fontsource. Both ship inside the app.
- This is an independent project. It is **not affiliated with or endorsed by NASA** and uses no NASA logos.
- **Team:** built together by **Yuvraj Singh** and **Sai** ([Sai5767](https://github.com/Sai5767)) for the 2026 NASA Space Apps Challenge.
  Every commit credits both of them.
- **AI assistance:** this project was built with the help of AI coding assistants (Claude, Gemini). If the competition asks teams to
  disclose AI use in the submission, mention it there.

## Honest limits

- Trends are straight-line summaries; the shape check flags steps and humps, but cycles and curved change are not modeled.
- NASA POWER is reanalysis on a grid about half a degree wide (`~0.5° × 0.625°`); cloud, radiation, soil and evaporation are flagged as model-derived.
  Monthly local grids (`GET /api/monthly-frames`, `GET /api/monthly-forecast`) represent coarse regional reanalysis cells, not street-level or city-block observations, and never interpolate across missing cells.
- Monthly forecasts (`GET /api/monthly-forecast`) are limited to `T2M`, `PRECTOTCORR`, and `CLOUD_AMT` over a 1–3 month horizon and are withheld whenever rolling-origin backtests fail to beat seasonal naive or meet split-conformal coverage.
- Live news (`GET /api/news`) is labelled as news context rather than scientific evidence, and AI explanations (`POST /api/explanations`) never compute or override p-values, slopes, or significance verdicts.
- GISTEMP bands are far larger than one grid cell, so the cross-check is a sanity check, not a match.
- A significant trend, or a linked climate pattern, shows direction or co-movement, not cause. A different start or end year can change the answer.
- The world survey uses 68 sample sites, not an evenly spaced or complete picture of the planet.

