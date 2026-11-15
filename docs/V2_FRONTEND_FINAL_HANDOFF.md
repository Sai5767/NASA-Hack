# V2 Frontend Final Handoff (Agent 5: integration)

Written 2026-11-15. **Scope was cut by the owner mid-task:** only the code integration and the documents were done. The browser walkthrough, responsive checks (1440x900, 1024x768, 375x812), accessibility checks, colour-blind check, network/performance budget check and the demo journey (checklist 6a-6i) **have not been done yet**, and the test suites were **not re-run** after the integration edits. See section 6.

Git: the owner made a snapshot commit (`85bf1f3`, "V2 rebuild work in progress") while this step was running; it already contains the edits below. This agent ran no state-changing git command.

## 1. What this step changed

| Item | Files | Change |
| --- | --- | --- |
| 1. Verdict wiring | `frontend/src/App.jsx` | `VerdictSlot` gets `detailLevel={profile.prefs.detail}` (technical users open the evidence trace "With the numbers") and `onTrendRefreshed`. `onTrendRefreshed` is a `useCallback` that replaces `trend.data` and keeps `trend.key`, so a stale-signature refetch in the Why panel refreshes the dashboard without re-requesting. The same callback reaches `CaseFile` through `ExplorePanel`'s `detail.onTrendRefreshed`. |
| 2. Explore container | `frontend/src/App.jsx` | The inline `<div id="panel" role="tabpanel">…</div>` block is replaced by `<ExplorePanel …/>` (props exactly as in `docs/V2_INSIGHT_HANDOFF.md` §5). It keeps `id="panel"`, `role="tabpanel"`, `aria-labelledby="tab-{tab}"` and `key={tab}`, so the tab strip, skip link "Skip to results", keyboard tab handling and `lib/route.js` history are unchanged. App keeps every request, key and AbortController. Removed from App.jsx as now unused: the local `PinPrompt`/`ErrorCard`, the seven `*_STEPS` arrays (they live in `ExplorePanel.EXPLORE_STEPS`) and the imports of CaseFile, Duel, Events, Ledger, Loading, Scan, Sweep, Vitals, World and the default Archetypes export. |
| 3. World dots | `frontend/src/App.jsx` | `worldDots`: `failed: true` for `!p.ok`, `sign: "up" / "down"` only for significant sites (a not-significant site is grey and gets no notch). `lapseDots`: `failed: true` for `!p.ok`; `sign` from the anomaly's sign for that year. `<GlobeLegend sampleSites />` is shown as a Globe child whenever World survey, time-lapse or archetype dots are on; the duplicate "Sample sites, not a complete global map" line was removed from the three inline legends so it appears once. |
| 4. `/api/version` path | `backend/app/version.py`, `backend/app/main.py` (docstring), `backend/tests/test_version.py`, `app-common.ps1`, `docs/V2_API_CONTRACT.md` §8 | `root` (absolute local folder, contains the Windows user name) is no longer returned or stored. It is replaced by `root_id` = first 16 hex chars of SHA-256 of the lower-cased folder path without a trailing slash (`folder_id()`). The launcher's stale-server check (`Get-StaleReason`) now compares `root_id` with `Get-FolderId $root`; it still understands an older server that reports `root`. Verified by hand that Python and PowerShell give the same fingerprint for this folder. The version info was never logged, so nothing changed for logs. Test updated (`root_id` present, `root` absent, path in no value) plus one new normalisation test. The page (`lib/version.js`) never read `root`. |
| 7. Inventory | `DATA_SOURCES_APIS_AND_AI_MODELS.txt` | Rewritten from the code: actively used / optional-configured / internal models / bundled assets / reference only / planned-not-built / development assistants / setting names (names only). |
| 8. This file | `docs/V2_FRONTEND_FINAL_HANDOFF.md` | New. |

## 2. Changed files across all agents (since `471e3b9`)

123 files, +13 233 / −1 622 (`git diff --stat 471e3b9`).

- **Backend (Agents 0A/0B/0C, + version fix here):** `backend/.env.example`; `backend/app/` analysis, archetypes, context, explanations, forecast, ledger, main, meteomatics, ml, monthly, nasa_power, news, resilience, stats, streams, version; `backend/tests/` conftest, fixtures/v2_fixtures.json, test_analysis, test_api, test_archetypes, test_context, test_env_file, test_forecast, test_grid, test_ledger, test_ml, test_stats, test_streams, test_v2_contract_fixtures, test_v2_explanations, test_v2_meteomatics, test_v2_monthly, test_v2_news, test_v2_resilience_and_trace, test_version; `backend-review/` (review + repro scripts, new).
- **Shell (Agent 2):** `App.jsx`, `main.jsx`, new `components/shell/*` (AccountPanel, Dashboard, Drawer, Onboarding, PlaceSearch, SignIn, TopBar, ui, useShellState), `components/main/{MainLayers,InsightSlots}.jsx` seams, `lib/route.js`, `lib/profile.js`, `lib/share.js`, `lib/theme.js`, `styles/{shell,layout,motion,panels,theme}.css`, `components/Modal.jsx`; deleted V1 `Boot`, `ForYou`, `Home`, `Intake`, `Watchlist`; tests `profile`, `route`, `theme`.
- **Globe (Agent 3):** `components/Globe.jsx`, `World.jsx`, `TimeLapse.jsx`, new `components/globe/*` (ForecastStatus, GlobeLegend, LiveGlyph, LiveWeatherCard, News, TimelineRail, fieldLayer, useGlobeLayers), `lib/{globeFrames,globeNews,liveWeather,memoCache,ramp,tokens}.js`, `styles/globe.css`; tests `globe-frames`, `globe-news-weather`.
- **Insight (Agent 4):** new `components/insight/*` (EvidenceDrawer, ExplorePanel, VerdictCard, VerdictSlot, WhyPanel, logic, useWhy), `CaseFile.jsx`, `Overview.jsx`, `ForecastLab.jsx`, `Archetypes.jsx`, `charts/{Emergence,ForecastChart}.jsx`, `hooks.js`, `api.js` (append only), `styles/insight.css`; test `insight`.
- **Docs:** `docs/V2_API_CONTRACT.md`, `V2_BACKEND_HANDOFF.md`, `STATS_AUDIT.md`, new `V2_BACKEND_REPAIR_HANDOFF.md`, `V2_FABLE_VISUAL_SPEC.md`, `V2_GLOBE_HANDOFF.md`, `V2_INSIGHT_HANDOFF.md`, this file; `DATA_SOURCES_APIS_AND_AI_MODELS.txt`; `Planning and prompts/frontend_plan_final.txt`; `app-common.ps1`.

## 3. Design decisions made here

- `ExplorePanel` adopted rather than keeping two copies of the tool rendering; behaviour is the same (the insight agent built it as a copy of the inline block).
- `onTrendRefreshed` keeps the existing `trend.key`, because the refetch is for the same case; changing the key would re-trigger the trend effect.
- World notches only on significant sites, matching the existing colour rule (grey = no clear trend has no direction).
- `root_id` fingerprint instead of simply deleting `root`, so the launcher keeps detecting a server started from another copy of the folder.

## 4. Test and build totals

- `npm run build` (frontend), after the integration edits: **OK**, built in 1.3 s; only the existing >500 kB chunk warning (JS 610 kB, 205 kB gzip). `frontend/dist` was rebuilt, so the one-process server on 127.0.0.1:8001 now serves this build.
- **Not re-run after these edits (owner instruction):** backend suite (baseline 341 passed; this step adds one test in `test_version.py` and changes another, so expect 342) and `npm test` (baseline 114 passed; no frontend test was changed).

## 5. API contract assumptions

- Unchanged from `docs/V2_API_CONTRACT.md`; the only API change in this step is `/api/version` `root` → `root_id` (documented in §8).
- The running dev API on 127.0.0.1:8000 and the server on 8001 were started before this change and still report `root` until restarted; the launcher accepts both.

## 6. Not done yet (needs a follow-up session)

- Browser check of the globe canvas: field cells, missing-data hatch, forecast hatch, news markers, live glyph, rotation pause, keyboard.
- Reduced motion (OS setting and the profile toggle).
- Responsive layouts at 1440x900, 1024x768 and 375x812.
- Accessibility: keyboard paths, focus visibility, ARIA on canvas alternatives, colour-blind sanity check of the palette.
- Performance: first-load network log against the request budget (expected on load: `/api/variables`, `/api/version`, `/api/places` only).
- Demo journey a–i with no keys (no-key/unconfigured states should look intentional).
- Re-run `pytest backend` and `npm test`.
- No agent has yet seen the new UI in a real browser (globe and insight agents could only server-render), so visual bugs are likely.

## 7. Unresolved risks

- Untested in a browser (above).
- OpenAI and Meteomatics real-key paths are tested only against fakes; `web_search` + JSON output may be rejected by some models (falls back honestly).
- Per-visitor limits are in-memory per process.
- Bundle is 610 kB (no code splitting).

## 8. Owner-only steps

1. Restart the local servers (`STOP.bat`, then `START.bat`) so the API serves `root_id`.
2. Choose `OPENAI_EXPLANATION_MODEL` and run the one-call OpenAI smoke test (`docs/V2_BACKEND_REPAIR_HANDOFF.md` §6.1–6.2).
3. Meteomatics one-call smoke test (§6.3); on Azure set `TD_TRUSTED_PROXY_HOPS=1` (2 behind Front Door).
4. Secrets only in Azure App Service application settings; afterwards confirm no secret appears in browser tools, source, logs or responses.
5. Commit the follow-up, deploy and merge only when you choose to.
