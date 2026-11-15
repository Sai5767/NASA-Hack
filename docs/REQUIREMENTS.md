# Requirements: what the challenge asks, and where the app answers it

The To Do asked for the app's capabilities to be cross-referenced with what the competition actually requires, and for the
basic functionality to be redefined around that. This is that cross-reference. The challenge text is the one supplied for
*Be an Earth System Trend Detective* (2026 NASA Space Apps Challenge). The official rules page could not be read from the
machine used to build this, so submission rules (video, slides, forms, AI-use disclosure) are listed at the end as *unverified*.

## Basic functionality, redefined

The challenge asks for one thing at heart: **pick an Earth-system variable and a place, see how it changed over time, and
learn what is changing, where, how much, and whether the change is statistically significant.**

So the app now separates:

| | What | Where in the app |
| --- | --- | --- |
| **Essentials** | One variable over time at a place, every variable at a place, and a region | Tabs **Case file**, **Sweep**, **Scan**. A case file opens on an **Overview** that answers the four questions in four cards. |
| **Explore more** | Compare two places, survey the world, planet vital signs, rank every trend, major events | Tabs **Duel**, **World**, **Vitals**, **Ledger**, **Events** |
| **Detail** | The technical evidence behind any answer | The **Detail** view of a case file, in collapsible sections |

A first-time visitor can ignore everything under "Explore more" and still complete the whole challenge.

## Traceability matrix

Status: **Met** = required and delivered; **Beyond** = delivered and goes further than asked; **Gap** = not delivered.

| # | Challenge requirement | How the app meets it | Where | Status |
| - | --- | --- | --- | --- |
| 1 | Use variables measured by Earth science missions or produced by Earth science models | 19 monthly variables from NASA POWER (MERRA-2 reanalysis and satellite-based radiation) in 5 groups, plus global temperature (GISS), CO2 (NOAA), sea ice (NSIDC) and ENSO/PDO/NAO | Variable picker, Sweep, Vitals | Met |
| 2 | Visualize how variables change over time | Annual averages, monthly anomalies with the seasonal cycle removed, 12-month average, climate stripes, seasonal fingerprint, emergence chart, world time-lapse | Case file, World | Beyond |
| 3 | Answer **what** is changing | Sweep ranks all 19 variables at a place; Ledger ranks every trend measured | Sweep, Ledger | Met |
| 4 | Answer **where** it is changing | Pin anywhere on a globe or map; region Scan with area-weighted composite; World survey of 68 sites | Case file, Scan, World | Met |
| 5 | Answer **how much** | Rate per decade with a 95% range, total change, percent of the average, signal vs noise | Overview, Detail | Met |
| 6 | Answer whether it is **statistically significant** | Mann-Kendall and regression t-test, serial-correlation adjustment, false-discovery control, five-check evidence grade; audited against SciPy, pymannkendall and pyhomogeneity | Overview, Detail, `docs/STATS_AUDIT.md` | Met |
| 7 | Objective: identify variables that show trends | Sweep (one place), Ledger (everywhere), World survey (one variable) | Sweep, Ledger, World | Met |
| 8 | Objective: get data for a region | Point analysis, Scan grid with regional composite and Moran's I, World sample | Scan, World | Met |
| 9 | Objective: work with long time series | 1981 to the last complete year for places; CO2 from 1958; sea ice from 1979; GISTEMP from 1880 | All tabs | Met |
| 10 | Objective: estimate rate of change and significance | Sen's slope with interval, Mann-Kendall, regression, shown side by side | Detail, Evidence locker | Met |
| 11 | Audience: students and the public | Plain-language Overview, hover definitions that open a built-in **Explainer** with the case's own numbers, glossary, five-question **Personalise** wizard, Plain/Balanced/Technical levels | Everywhere | Beyond |
| 12 | Ask a few questions, then suggest variables | Personalise (five questions), Ask the detective (type "is Phoenix getting hotter?"), the **For you** pop-ups | Home | Met |
| 13 | Demonstration examples | 11 guided cases with briefings and animated reveals | Case files menu | Met |
| 14 | Identify data likely to show trends in particular areas | Sweep, World survey, Ledger | Sweep, World, Ledger | Met |
| 15 | The seasonal cycle should be removed | Monthly anomalies against each calendar month's own average | Detail, The record | Met |
| 16 | Longer records can make a trend significant | Emergence chart: how the evidence builds as years are added | Detail, Seasons and timing | Met |
| 17 | Trends can be non-linear; linear is a good start | Linear trend, plus a shape check (steady ramp vs step change, Pettitt test) that warns when a line misleads | Overview, Detail | Met |
| 18 | Link results to real-world context *(To Do)* | 15 curated geo-weather events as chart markers and an Events tab with a data check; Ledger rows carry sourced, hedged "why" notes | Events, Ledger | Beyond |
| 19 | Make predictions locally *(To Do)* | Forecast headline on the Overview and a full forecast lab: 8 models, rolling backtest, conformal bands. Pure Python, runs on the user's machine, no external model | Overview, Detail | Beyond |
| 20 | Free hosting and publishing *(To Do)* | Prepared (one-process mode, Dockerfile, `render.yaml`, `docs/DEPLOY.md`). **Not published**: needs the owner's account | `docs/DEPLOY.md` | Partial |

## Known gaps (stated, not hidden)

- **Direct satellite-instrument series** (MODIS, OMI, AIRS, GPM) are not used. NASA's Earthdata services need a login, and this
  app uses only keyless public sources. POWER is a model constrained by satellite and ground observations, which is why some
  variables are flagged model-derived.
- **Hydrology Data Rods** now return a web page, not data, so are not used.
- **Published online?** No. See `docs/DEPLOY.md`.
- **Official rules page** was unreadable, so these submission items are *unverified* and remain the team's to check: demo video
  (reportedly with English subtitles), slides, the submission form, and whether AI use must be disclosed (the README and the
  About dialog already disclose it; `AI-usage-report.pdf` lists the models used).

## Where the evidence lives

| Claim | Evidence |
| --- | --- |
| Statistics are correct | `docs/STATS_AUDIT.md`, `tools/stats_audit/`, `backend/tests/test_stats_reference.py` |
| Backend behaviour | `backend/tests/` (199 tests, all offline) |
| Front-end logic | `frontend/tests/` (60 tests) |
| Every question asked of the user | `docs/USER_QUESTIONS.md` |
| How to publish | `docs/DEPLOY.md` |
