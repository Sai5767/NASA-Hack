# Trend Detective: what was done, in plain words

## What it is
A website for the NASA Space Apps challenge "Be an Earth System Trend Detective". You pick a place on Earth and something to measure
(temperature, rainfall, sunshine...). It uses real NASA data to answer four questions:

1. **What** is changing?
2. **Where**?
3. **How much**?
4. **Is it real**, or just luck? (This is called *statistical significance*.)

It has two parts: a **backend** (Python, does the maths and fetches NASA data) and a **front-end** (React, the website you see).

## What it can do now
- Spin a 3D globe, click anywhere, and get a case file for that spot.
- **Overview** page with the four answers; **Detail** page with all the evidence.
- Compare every measurement at one place, a whole region, or two places side by side.
- Survey 68 places worldwide, and play it as a **year-by-year time-lapse**.
- **Ledger**: about 1,200 trends ranked by how sure we are, with a short "why might this be happening" for the solid ones.
- **Events**: 15 real heat waves, droughts and floods, checked against the data.
- **Forecast**: a small machine-learning model that predicts the next 5 years and says honestly when it can't.
- **Explainer**: click any dotted word to see what it means.
- **Home page**: save places to a watchlist, answer 5 questions and get suggestions that fit you. Stays on your computer.
- Two colour themes (Nebula, Classic).

## What was done in the last sessions
| Task | Result |
| --- | --- |
| Put the project on GitHub | Done: `Sai5767/NASA-Hack` (private) |
| Machine learning | Forecasts, grouping places that behave alike, "what drives it" |
| One-click start | Double-click `START.bat` to run, `STOP.bat` to stop |
| Clean-up | Fixed out-of-date notes, added `.gitattributes`, README, notes for other people |
| **Checked the maths** | Compared every formula with trusted science libraries. Found and fixed 3 problems (see below) |
| Your To Do list | All items built: overview/detail, finance-style home, explainer, events, ledger, time-lapse, new colours, question list |
| "I get the old version" | Found an old second copy of the project; `START.bat` now always replaces stale servers and shows the version |
| Usage report | `AI-usage-report.pdf`: which AI models were used and how many tokens |

**The maths fixes:** one confidence range was off by one step; the check for "years that resemble each other" was too lenient
(false alarms about 10% instead of the intended 5%, now 4-7%); the two-place comparison now uses a better test.

## How to use it
1. Double-click **`START.bat`** in `C:\Users\mahas\Documents\NASA-Hack`. The first run installs what it needs.
2. The page opens at http://127.0.0.1:5173. The footer shows the version (a short code like `d29529a`; it changes with every update).
3. Double-click **`STOP.bat`** when finished.

## Where things are
- `backend/` the maths and data; `frontend/` the website; `docs/` explanations; `tools/` the maths checks.
- `HANDOFF.md` notes for anyone (or any AI) taking over. `README.md` the full guide.
- Everything is on GitHub `main`, same as your laptop. Quality checks: 203 backend + 63 front-end tests pass.

## Still yours to decide
- **Publish online** (free hosting is prepared, but needs your account). The Docker file was never run.
- Make the GitHub repo **public**, and choose a **licence**.
- Delete `Test_yuvraj.txt` (a teammate's test file).
- The old folder `NASA-Hack - Copy` is out of date and left alone. Starting from it runs old code.
- The competition submission itself: video, slides, form. (The official rules page could not be read.)

## Honest limits
- Data come from a NASA computer model on a grid about 50 km wide, from 1981. It misses very local events.
- A trend shows *that* something changed, not *why*. The "why" notes are background from published science.
- The explainer is a written knowledge base, not an AI chatbot.

## Words explained
- **Trend**: a steady rise or fall over many years. **p-value**: how often luck alone would look this strong (small = unlikely luck).
- **Backtest**: testing a forecast on past years it never saw. **Reanalysis**: a weather model corrected with real observations.
