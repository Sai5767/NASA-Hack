# Trend Detective: Earth system case files

An entry for the **2026 NASA Space Apps Challenge, "Be an Earth System Trend Detective"**.

Pick any place on Earth and an Earth-system variable. Trend Detective pulls decades of NASA data, then answers the challenge's
four questions: **what** is changing, **where**, **how much**, and **is it statistically significant**. Then it shows how much
to trust the answer.

- **Data:** NASA POWER monthly point data, 1981 onward. Free, no API key.
- **Backend:** Python, FastAPI. All statistics are hand-written (no SciPy) and checked against published reference values.
- **Front-end:** React, Vite, a custom canvas globe and hand-built SVG charts. No chart or map library, no external tiles.

## How it meets the challenge

| Challenge objective | What the app does |
| --- | --- |
| Identify variables worth investigating | 19 variables in 5 groups with plain-language definitions; **Sweep** ranks every variable at a place by strength of evidence; **Guided intake** picks a variable from a few questions |
| Acquire data for a region | Drop a pin anywhere, **scan** a grid of up to 25 places, or **duel** two places |
| Generate and visualize a long time series | Annual averages, monthly anomalies (seasonal cycle removed), a 12-month average, and "climate stripes" |
| Rate of change and significance | **Sen's slope** with a 95% interval, **Mann–Kendall** test, and a **regression t-test**, shown side by side |

The challenge's optional considerations are covered too: simple definitions (hover any dotted term, or open the glossary), six
demonstration cases with briefings, seasonal-cycle removal, and an **emergence** chart showing how the evidence builds as years are added.

## Features

- **Case file:** verdict stamp, rate of change with 95% range, total change, percent of average (where meaningful),
  **signal vs noise**, p-values, trend chart with confidence cone, trend stripes, a radial 12-month **fingerprint**, the
  emergence chart, and an **evidence locker** of five transparent checks that produce an evidence grade.
- **Sweep:** all variables at one place, ranked, with sparklines.
- **Scan:** colored cells on the globe, false-discovery control, strongest rise and fall, a banner when **opposite trends** occur
  in the same region, and Moran's I for spatial pattern.
- **Duel:** two places, one variable, and a test of whether their trends really differ.
- **Cases and intake:** guided demonstrations that pose a question and let the data answer.
- **Export:** CSV for case files, sweeps and scans.
- Keyboard accessible (the globe takes arrow keys, `+`/`-`, Enter), screen-reader labels, and `prefers-reduced-motion` is respected.

## How the statistics work

- Yearly values come only from **complete 12-month years**, so seasons are never under-weighted.
- **Sen's slope** (median of pairwise slopes) with a Gilbert (1987) 95% interval; **Mann–Kendall** with tie correction.
- A **regression t-test** (Student-t implemented from scratch) is a second opinion.
- If neighboring years resemble each other (significant positive lag-1 autocorrelation), variance is inflated by `(1+r)/(1−r)`
  so chance trends are not overstated. Both the adjusted and unadjusted p-values are shown.
- **Benjamini–Hochberg** false-discovery control is applied across scan cells, sweep variables and the 12 calendar months.
- **Robustness:** the trend is re-tested after trimming 5 years from the start, the end, and both.
- **Evidence grade** (strong / moderate / weak / none) comes from five visible checks: Mann–Kendall significant, regression
  agrees, most months agree, survives trimming, and change larger than normal year-to-year swings.

## Run it

Windows PowerShell, from this folder:

```bash
powershell -ExecutionPolicy Bypass -File .\start-app.ps1
```

It opens the backend (port 8000) and front-end (port 5173) in their own windows. Then open **http://127.0.0.1:5173**.

Manual setup:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

API docs: http://127.0.0.1:8000/docs

## Tests

```bash
cd backend && .venv\Scripts\activate && pytest
```

```bash
cd frontend && npm test
```

The backend suite runs offline: a fake NASA POWER call supplies synthetic series with a known seasonal cycle and trend.

## Project layout

```
backend/app/    nasa_power.py (data + variables)  stats.py (tests)  analysis.py (case file)  morans.py  main.py (API)
backend/tests/  reference-value, pipeline and API tests
frontend/src/   components/ (Globe, CaseFile, Sweep, Scan, Duel, charts/…)  lib/  styles/
```

## Credits and rules notes

- **Data:** NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program.
- **Map:** Natural Earth land and borders (public domain) via the `world-atlas` package. **Fonts:** Space Grotesk and JetBrains Mono
  (SIL Open Font License) via Fontsource. Both ship inside the app; the only network calls are to NASA POWER.
- This is an independent project. It is **not affiliated with or endorsed by NASA** and uses no NASA logos.
- **AI assistance:** this project was built with the help of an AI coding assistant (Claude). If the competition asks teams to
  disclose AI use in the submission, mention it there.

## Honest limits

- Trends are straight-line summaries; cycles, sudden jumps and curved change are not modeled. Some series are humps or steps, and the
  app says so through lower evidence grades and wider ranges.
- NASA POWER is reanalysis on a grid about half a degree wide; cloud, radiation, soil and evaporation are flagged as model-derived.
- A significant trend shows direction, not cause, and a different start or end year can change the answer.
