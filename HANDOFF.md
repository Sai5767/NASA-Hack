# HANDOFF: working notes for whoever continues this project

Read this first if you are an agent (or person) taking over. Keep it current: update the checklist in the same commit as the work.

## Situation

- Project: **Trend Detective**, an entry for the 2026 NASA Space Apps Challenge "Be an Earth System Trend Detective".
  Python/FastAPI backend (`backend/`) + React/Vite front-end (`frontend/`). See `README.md` for what exists.
- `main` on GitHub is stable (merge target). All new work from the **To Do** file is on branch **`feature/todo-list`**.
  Do not merge to `main` unless the project owner says so. Push the branch often; it is the backup.
- Owner's standing rules: work only inside this folder (and GitHub only when asked); keep everything accurate and keyless
  (no API keys); be unique and fun but statistically honest; credits are limited, so be economical.

## How to run and verify

```bash
START.bat                         # Windows one-click start (backend :8000, front-end :5173); STOP.bat to stop
cd backend && .venv\Scripts\activate && pytest      # all backend tests must pass (run as separate commands in PowerShell)
cd frontend && npm test && npm run build            # front-end unit tests and a production build must pass
```

Environment gotchas: Windows PowerShell 5.1 (no `&&`); git pushes work with the stored credentials; commit with
`git commit -F <file>` (here-strings to `git commit -F -` fail in 5.1). End commit messages with the
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer if an AI wrote the change.

## The To Do list (from the `To Do` file) and how each item is interpreted

| # | To Do item | Priority | Plan / acceptance |
| - | --- | --- | --- |
| 1 | Overview, then more detail | HIGH | Case file opens as an **Overview** (the challenge's four answers: what / where / how much / is it real, one chart, forecast headline). A **Detail** view holds the technical sections in collapsible groups. |
| 2 | Make sure the significance maths is correct | HIGH | Cross-check every test against a reference implementation (scipy etc. in a scratch environment, never a project dependency); fix bugs; add reference-value tests; write `docs/STATS_AUDIT.md`. |
| 3 | Google Finance style layout | med | Big globe in the middle on the home screen, a **watchlist** (saved place + variable with sparkline and trend), and pop-up **For you** suggestions chosen from the user's interests. Stored in `localStorage` only. |
| 4 | List of questions each user must be asked | med | `docs/USER_QUESTIONS.md`, and the Guided intake expanded to ask them (who you are, what matters, which places, how technical). Answers drive the home screen and default detail level. |
| 5 | Cross-reference features with the competition requirements; redefine basic functionality | med | `docs/REQUIREMENTS.md` traceability matrix. Core features (the required trio: variable over time at a place, rank variables, region) are visually separated from extras. |
| 6 | Hover explanations that link to a chatbot | med | Hover definitions exist (`Term`). Add "Explain more" which opens a built-in **explainer chat** (local, rule/glossary based; no external model or key) that answers using the current case's numbers. |
| 7 | Link to major geo-weather events, click for much more detail | med | Curated, accurate event catalogue (`frontend/src/lib/events.js`), markers on charts, an **Events** tab, and a detail view showing what the data show at that place and year. |
| 8 | List all trends ordered by p-value, with real-world reasoning | med | Backend `/api/ledger` (all variables x all sample places + planet streams, BH-corrected, ordered by evidence) and a **Ledger** tab; each row has a hedged, sourced "why" from a curated knowledge base (`backend/app/reasons.py`). |
| 9 | Animate the globe over time with timestamps | low | **Time-lapse** on the World survey: a year slider and play button colour each site by its yearly anomaly. |
| 10 | Change the overall colour scheme | low | New default palette via CSS variables, plus the original as a selectable "Classic" theme. |
| 11 | Future predictions locally (ML) | low | Forecast already exists (pure-Python, local). Surface a "next five years" headline in the Overview and document that all ML runs locally. |
| 12 | Use free hosting and publish | med | Cannot be finished without the owner's accounts. Prepare: one-process deployment (backend serves the built front-end), `Dockerfile`, `render.yaml`, `docs/DEPLOY.md`. **Do not publish** without the owner's explicit go-ahead. |

## Progress checklist (update as you go)

- [x] 0. Branch, this file, first push
- [x] 1. Significance maths audited (docs/STATS_AUDIT.md, tools/stats_audit/, backend/tests/test_stats_reference.py). Fixed: Sen CI rank, serial-correlation adjustment (bias-corrected, no gate, effective df in OLS), duel uses Welch t. 181 backend tests pass.
- [x] 2. Overview / Detail split (CaseFile.jsx, Overview.jsx; view persisted as `td-view`; verified in the browser)
- [x] 3. Finance-style home: watchlist (Watchlist.jsx), For you pop-ups on the globe (ForYou.jsx), Essentials vs Explore-more tabs, watchlist dots on the globe
- [x] 4. Question list (docs/USER_QUESTIONS.md) and the 5-question wizard (Intake.jsx, lib/profile.js, tests in frontend/tests/profile.test.mjs)
- [x] 5. Requirements matrix: `docs/REQUIREMENTS.md` (Essentials vs Explore more vs Detail, 20-row traceability, known gaps)
- [x] 6. Explainer chat and hover link: `lib/explain.js` (knowledge base + keyword matching, no AI model), `Explainer.jsx` (docked chat), `Term` is clickable via `ExplainContext`; "In this case" lines use the open case's numbers. Tests: `frontend/tests/explain.test.mjs`.
- [x] 7. Events: `lib/events.js` (15 curated events, `eventsNear`, `eventStats`, `describeEvent`), `Events.jsx` (list, detail, live evidence), markers on TrendChart, "events near here" strip, globe dots on the Events tab. Each event's evidence sentence is computed from live data and says honestly when the data do not show it (a Cape Town drought entry was dropped because this grid product barely captures it; replaced by Hurricane Harvey). Tests: `frontend/tests/events.test.mjs`.
- [x] 8. Trend ledger and reasons: backend `app/ledger.py` (`/api/ledger`: 68 places x 19 variables + 4 planet streams = 1,241 tests, one joint Benjamini-Hochberg correction, cached 6 h, ~36 s cold), `app/reasons.py` (hedged, sourced context; only attached to trends that survive correction), `Ledger.jsx` (filters, order by p / signal vs noise / size, expandable why). Tests: `backend/tests/test_ledger.py` (12). Known limit documented in docs/STATS_AUDIT.md: smooth curved records such as CO2 get very cautious p-values, so order by signal vs noise to compare strength.
- [x] 9. Time-lapse: `/api/world` now returns each site's yearly `series`; `lib/lapse.js` (anomaly vs the site's own average, 90th-percentile colour scale, `mixHex`), `TimeLapse.jsx` (play, pause, scrub, speed), year overlay and legend on the globe. Tests: `frontend/tests/lapse.test.mjs`; backend test extended.
- [x] 10. Colour scheme: new violet "Nebula" default plus the original as "Classic", switched live from the header (`td-theme`). CSS colours are tokens in `styles/theme.css` (`:root` and `:root[data-theme="classic"]`); other CSS points at them. JS-drawn colours (map dots, pins, globe, stars) come from `lib/theme.js`; the globe and starfield remount on change. Tests: `frontend/tests/theme.test.mjs`.
- [x] 11. Forecast headline in Overview (ForecastHeadline in Overview.jsx; all ML runs locally in pure Python)
- [x] 12. Hosting config and docs (NOT published; needs the owner's account): `backend/app/deploy.py` (CORS origins from `TD_ALLOWED_ORIGINS`, serves `frontend/dist` at `/`), `Dockerfile`, `.dockerignore`, `render.yaml`, `docs/DEPLOY.md`; `frontend/src/api.js` is same-origin in production. One-process mode was run and verified on port 8010; the Docker image has NOT been built (no Docker here). Tests: `backend/tests/test_deploy.py`.
- [ ] 13. Final: all tests green, README updated, branch pushed, merge-ready summary

## Notes for the next agent

(Add dated notes here: decisions, surprises, anything half-done.)
