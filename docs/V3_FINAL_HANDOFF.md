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

## Capitals of every country, several popups at once (owner request, supersedes the two sections below)
The owner asked for popups out of the capitals of every country, with the key news, a green/amber/red border by severity,
smooth animation, several popups at the same time, click for a detailed overview, a darker Earth, a gradient glow, and a
sign-in screen with the form in the middle and the Earth as a semicircle on the bottom edge.
- Capitals: all 193 UN member states (`lib/capitals.js`, static hand-written geography, positions to about 0.1 degrees; the first
  52 are the main countries and are preferred). Not a live source; none of it is climate data.
- Several at once, never a crowd (`lib/newsCycle.js`, pure and tested): at most 4 open on a desktop and 2 on a phone, a new one
  opens only every ~1.3 s, each stays ~7 s. Priority: saved-place news, capitals with verified news, capitals with only unverified
  news, then the rest; least recently shown first; a long rest per capital. Popups avoid each other, the timeline and the controls.
  Hovering or focusing a popup FREEZES the set (nothing expires or opens) so it can be reached and clicked; drag, timeline moves,
  an open drawer or reduced motion close them all; the cycle resumes ~1.1 s after the interaction ends.
- News for every capital (`lib/capitalNews.js`): gradual and polite, not a flood: batches of at most 5, one at a time, 8 s apart,
  main countries first, at most 24 batches (120 capitals) per visit, a 60 s back-off when rate-limited, and it stops by itself after
  3 failed batches in a row. It starts only after onboarding and after the saved places have answered. The old ten-city showcase
  was removed (the capitals replace it). A capital with no news yet shows its geography card with a neutral border.
- Severity border: a verified story's popup has a green, amber or red BORDER (colour never fills the box; the box stays near-black);
  an unverified story is neutral, dashed and says "Unverified news context"; a capital with no story has a neutral border.
- Click a popup: opens the capital overview in the side drawer: position, Sun time, distance from the equator, a fixed fact where
  there is one, then every news story found for that capital (news context, not scientific evidence or an official warning).
- Earth: palette about 20% darker (tokens in theme.css, theme.js, tokens.js). Glow: a deep bright blue (`--earth-atmosphere-rgb:
  24, 112, 255`) drawn as a 13-stop ease-out radial gradient behind the planet, so it fades smoothly with no ring or banding.
  Main: alpha 0.85, reach 1.17 x radius; sign-in: alpha 0.6, reach 1.12 (separate tokens `--earth-atmosphere-*` and
  `--earth-atmosphere-*-welcome`).
- Keyboard and reduced-motion access: the map Key (button on the stage) has a "Capital cities" list of all 193; choosing one opens
  its overview, so capital information does not depend on catching a popup.
- Review fixes applied after an independent read-only review: popups that end up on top of another popup or the map key are
  closed on the next pass; the map key and the open capitals' dots count as obstacles; idle capital markers cost nothing (no
  per-frame writes, no compositor layer, not measured); a touch on a popup holds it for 3.5 s and popups stay 1.6x longer on a
  phone; the capital news runner rests five minutes after three failed batches and tries once more before giving up for the
  visit; a hover that can no longer receive its mouse-leave cannot freeze the cycle.
- Verified in a real browser (1440x900, 1024x768, 375x812): sign-in form centred with the Earth centred on the bottom edge
  (diameter = 100% of the width on a phone, 84% at 1024x768, 70% at 1440x900 where it is capped at 56% of the height); on Main up
  to four popups at once on a desktop, new ones about every 1.4 s, different capitals each time, none outside the stage, brief
  overlaps close within a pass; hover freezes the set and a click opens the overview; phone showed up to three at once and none
  outside the stage. The severity borders and the overview with a story were checked with a TEST-ONLY synthetic /api/news
  response injected into the page (the real provider was rate-limiting); that is not evidence of real stories.
- Tests: 143 front-end tests pass (new: tests/news-cycle.test.mjs); `npm run build` passes.
- Sign-in: form in the middle; the Earth is a semicircle standing on the bottom edge (diameter along the base: as wide as the
  screen when the screen is tall enough, otherwise 56% of the height). The two onboarding questions keep the earlier low-right /
  bottom-arc composition.
- Limits: with reduced motion nothing cycles, so capital popups are not shown; capital markers are hidden at rest and reached only
  through the popups. A GDELT outage or rate limit means no capital news; the geography popups still run.

## Capital-city popups on Main (15 November 2026, late) (earlier version, now superseded: single popup, 50 capitals)
As the Earth rotates, a popup with a leader line comes out of a capital city: 50 main countries across every inhabited continent
(`frontend/src/lib/capitals.js`, static hand-written geography, positions to about 0.01 degrees, nothing fetched).
- Not crowded: capitals share the SAME single-popup queue as the news (`lib/newsCycle.js`): exactly one automatic popup at a
  time, news and capitals take turns (capitals run alone when no news is available), the same dwell, gap, cooldown, limb and
  takeover rules. Capital dots stay hidden at rest; only the active one is drawn (neutral white, never a news colour).
- Details are derived or fixed, never invented: name, country (and "seat of government" / "executive capital" where a country
  has more than one), the position, and ONE more derived detail that alternates city by city (Sun time against Greenwich, or
  distance from the equator). A few cities add one well-known fixed fact (Reykjavik, Wellington, La Paz, Brasilia, Abuja,
  Islamabad, Canberra). Sun time is mean solar time (15 degrees = 1 hour), not the legal clock time.
- Decorative: the capital markers are aria-hidden and not clickable. They are illustration, not data, and are not a source for
  anything else in the app. With reduced motion nothing cycles, so capitals are not shown.
- Tests: 2 more in frontend/tests/news-cycle.test.mjs (data validity, derived text, alternation); front-end tests 139/139.
  Browser check at 1440x900 and 375x812: one popup at a time, always inside the stage, clear of the timeline, card height
  about 105-170 px.

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
