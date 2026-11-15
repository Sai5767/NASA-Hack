# V3 "Quiet Earth" final handoff (branch v3-quiet-earth)

Nothing is committed beyond 57df145. Per the owner, test suites were NOT re-run in the final pass; `npm run build` (frontend) passes.

## What changed, per agent
- Backend: drift check only, no code change (342 tests passed at that time).
- Audit: docs/V3_AUDIT_REPORT.md.
- Design: tokens, Logo, docs/V3_QUIET_EARTH_VISUAL_SPEC.md.
- Shell: first-run welcome globe, rail, top bar, pin history/undo, saved pins, scan-active indicator, VISHWA credit.
- Charts: shared ChartViewer (expand, log/linear, units, range, export) and chart components.
- Globe: Earth rendering, rotation, coarse preview (public/coarse), timeline rail, news callouts, GlobeLegend, lib/globeDots.js, saved-pin rendering.
- Insight: Explore groups + ExploreTabs, split view (`also`), Ask tab, Ledger, Term/glossary, Explainer, Scan chips, World legend, Saved tab, verdict cards.
- Integration: App.jsx wiring (ExploreTabs, exploreAlso in route/history, open(id) for Duel+Scan together, ExplorePanel props setup/ask/saved, GlobeLegend/WorldLegend, archetype glyph legend, welcome globe controls off). SetupPanel is now an "Adjust" disclosure inside ExplorePanel.

## Owner PDF items 1-13
| # | Item | Status |
|---|------|--------|
| 1 | Plain-words World legend / baseline | Done (WorldLegend + Term) |
| 2 | Free-text question decides place/variable; Adjust disclosure | Done |
| 3 | Ask as its own tab | Done |
| 4 | Ledger units, "correction" defined, arrow meaning | Done |
| 5 | Ledger chips as filters | Done |
| 6 | Scan cell style matches chips; legend lists styles | Done (GlobeLegend scanStyles) |
| 7 | Expandable charts, log axis, units, export | Done (ChartViewer) |
| 8 | Terms explained on hover/click | Done |
| 9 | Pin undo | Done |
| 10 | Save pin with scan, colour, globe + Saved tab | Done |
| 11 | Explainer resizable, scrolls, chips less intrusive | Done |
| 12 | Scan-active indicator | Done |
| 13 | Duel + Scan combos, grouped tabs | Done |

## Credit
VISHWA = Validated Insights on Significant Hydro-climate and Weather Anomalies (vishwa.earth), credited in the shell footer.

## Verification pass (15 November 2026, after the first handoff)
- Frontend `npm test` (in `frontend/`): 127 tests, 127 pass, 0 fail. `npm run build`: passes (chunk-size warning only).
- Backend `python -m pytest -q` (in `backend/`, host Python 3.14, not the Docker 3.12 target): 342 passed.
- Restarted the local servers so :8000 serves the current code; `/api/monthly-frames` and `/api/news` now return 200.
- Real-browser walkthrough at 1440x900, 1024x768 and 375x812: sign-in, both onboarding questions, Main with the coarse
  preview, choosing Delhi (detailed local layer replaces the preview, slider reads "observed, NASA POWER"), no news list
  on Main, 0 `.card` boxes on Main, ~35 prose words on Main, no horizontal scroll at 375 px, bottom-sheet rail on phone,
  Explore groups (Place tools / Compare & context / Learn), Ask tab (a question picks place, variable and years; Adjust
  disclosure). The password is not in localStorage (keys: version, account, onboarding, places, interests, prefs).
- The news request for Delhi took 20 s (GDELT) and returned nothing, so no news marker or callout was seen live.

## Targeted final visual fix (15 November 2026, evening; prompt: Planning and prompts/frontend_plan_final.txt)
1. Welcome: about half of the Earth, low right (low centre on phones), behind sign-in and both questions. The form sits on the
   left (above the Earth on phones). Same real Globe renderer, base only, no country borders, no requests, draggable, rotation
   resumes after the usual short delay, still when reduced motion is on. Measured: 40% of the disc visible at 1024x768, 26% on
   375x812, no control over the planet at either size (shell.css `.welcome`, App.jsx `WelcomeEarth`, Globe `borders` prop).
2. Main: the blue limb is one token (`--earth-atmosphere-rgb` plus the new `--earth-atmosphere-alpha: 0.18`), drawn by the same
   renderer on Welcome and Main, behind data layers, markers and callouts. No other blue was added.
3. News cycle: exactly one automatic callout at a time (`lib/newsCycle.js`, pure and tested), saved places first, then ten fixed
   showcase cities (`lib/showcaseCities.js`, batches of at most five, one batch at a time, ~6 s apart, none before onboarding
   ends). Eligible only on the visible hemisphere away from the limb with room for the box; dwell 5.2 s, 0.9 s gap, least
   recently shown first, 24 s rest per story. Hover, focus, click, drag, timeline movement or an open drawer takes over at once;
   the cycle resumes ~1.1 s after the interaction ends. Reduced motion: no automatic cycling, markers stay keyboard-focusable.
   Callouts avoid the timeline and the globe controls. Entrance: leader grows, then the callout glides 8 px outward in 200 ms.
   Tests: frontend/tests/news-cycle.test.mjs (10 tests). Front-end tests 137/137, build passes.
   Browser check of the cycle used a TEST-ONLY synthetic /api/news response injected in the page (the real provider was
   rate-limiting); it proved the mechanics (max one callout, takeover in ~140 ms, resume ~1.3 s after release, limb close,
   reduced motion, detail drawer text) but is not evidence of real stories. Not captured: screenshots or a recording.

## Full feature test (15 November 2026, real browser, local backend)
Passed: month slider (arrows, PageUp/PageDown = 12, Home/End, playback stops at the end, aria-valuetext), rotation pause/resume, help and Key,
evidence drawer (five questions, Plain words/With the numbers, Esc), forecast gate then forecast months on the slider labelled Forecast,
"How good is it?", Save pin (stored in td-saved-pins-v1, no password anywhere), Saved tab (Open/Unpin), pin undo (Ctrl+Z and the button),
all Explore tabs render (Case file, Sweep, Scan, Saved, Duel, World, Vitals, Ledger, Events, Ask, Learn), Ledger filter chips and units,
Scan (16 squares, chips, "Scan active" flag), Duel + Scan split view (`with=scan`), incompatible pairs disabled with a reason,
Ask, term pop-ups, chart viewer (log/linear with a reason when values are zero or below, °C/°F/K, range, PNG and CSV, Esc returns focus),
Explainer (move, expand, Suggestions disclosure, close), Account (places, interests, reduce motion, export/import, reset),
browser Back/Forward, logo to Main, reduce motion (sets data-motion, persisted), Why panel (curated fallback when no key; no request on load).
Fixed: at 320 px the Explore button overlapped Account in the top bar; the wordmark is now visually hidden under 400 px
(frontend/src/styles/layout.css) and stays as the link's accessible name. Front-end tests 127/127 and the build pass after the fix.
Could not test: live news callouts (GDELT returned HTTP 429 and timeouts), live weather and OpenAI explanations (no keys),
Scan/Saved pin with a stored scan after reload, import of a profile file, screen reader, 200% zoom.

## Not done / unverified
- Browser checks still missing: news callouts and expanded news (no live data returned), Saved tab, Duel+Scan split view,
  pin undo, Esc and browser Back/Forward from every view, 200% zoom, screen-reader pass, reduced motion, low/no-network,
  colour-blind check, and a Docker/Python 3.12 backend run. Backend tests were run on the host Python only.
- A few controls inside the timeline Details disclosure are 30 px tall on phone (above the 24 px WCAG minimum).
- News detail opens in the shell drawer (MainStage default); not a separate focus panel.
- Bundle is ~698 kB (chunk-size warning only).

## Owner-only steps
1. Choose `OPENAI_EXPLANATION_MODEL`.
2. Run real OpenAI and Meteomatics smoke tests with live keys.
3. Set `TD_TRUSTED_PROXY_HOPS` on Azure.
4. Restart local servers with STOP.bat then START.bat so :8000 serves the new endpoints.
