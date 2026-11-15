# V2 Insight Handoff (Agent 4: evidence verdict, "How did we test this?", manual Why, Explore container)

Nothing committed. `npm test`: 91 passed, 0 failed (13 new in `frontend/tests/insight.test.mjs`). `npm run build`: OK (only the existing >500 kB chunk warning).

## Science boundaries kept

- Every number shown is a backend value from `/api/trend` (`evidence_trace`, `stats`) or `/api/explanations`. The browser only picks, words and formats it (`components/insight/logic.js`). No p-value, slope, interval, grade, verdict or eligibility is computed.
- The verdict card shows no p-value; p-values appear only in the trace's "With the numbers" view, via the existing `formatP`.
- Why is opt-in: no request until the user presses "Why might this be happening?"; the body is only `{ case_signature, question? }`; S3 disclaimer is always visible; a driver is rendered only with at least one https citation.

## Components (all new files under `frontend/src/components/insight/`)

| Export | File | Props | Mount |
| --- | --- | --- | --- |
| `VerdictSlot` | `VerdictSlot.jsx` (re-exported by `components/main/InsightSlots.jsx`, so App.jsx needs no change) | unchanged seam: `place, variable, trend {data,loading,error,key}, onRetry, onOpenDetail, openDrawer, closeDrawer`; optional new: `detailLevel` ("plain"/"balanced"/"technical"), `onTrendRefreshed(freshTrend)` | Dashboard slot "verdict" (already wired) |
| `VerdictCard` (default) | `VerdictCard.jsx` | `data, eyebrow?, onHowTested?, onWhy?, whyOpen?, headingLevel?` | Used by VerdictSlot and the case file |
| `EvidenceDrawer` (default) | `EvidenceDrawer.jsx` | `data, loading?, error?, defaultView ("plain"/"numbers"), onOpenDetail?, showHeader?` | Drawer body (id `evidence`) and inline in the case file |
| `WhyPanel` (default) | `WhyPanel.jsx` | `data, onTrendRefreshed?, autoStart=true` | Drawer body (id `why`) and inline in the case file |
| `useExplanation`, `useCountdown` | `useWhy.js` | hook: `(trend, { onTrendRefreshed })` → `{ phase, res, error, question, ask(q), cancel() }` | used by WhyPanel |
| `ExplorePanel` (default), `LearnPanel`, `PinPrompt`, `ErrorCard`, `EXPLORE_STEPS` | `ExplorePanel.jsx` | see below | optional replacement for App.jsx's inline tabpanel |

Styles: new `frontend/src/styles/insight.css`, imported by the components themselves (main.jsx unchanged). Tokens only.

### Drawers from the dashboard

VerdictSlot calls `openDrawer({ id: "evidence" | "why", title, eyebrow, render })`. Because the shell calls `render()` on every render, the drawers read the live trend through a ref, so a refetch updates an open drawer. "See full statistical detail" closes the drawer and calls `onOpenDetail`.

**Optional wiring for the lead (App.jsx, around the `<VerdictSlot …>` element):**
- `detailLevel={profile.prefs.detail}` so technical users open the trace "With the numbers".
- `onTrendRefreshed={(t) => setTrend((s) => ({ ...s, data: t }))}` (same key) so a stale-signature refetch also refreshes the dashboard. Without it the Why panel still works with the fresh trend internally.
- Same `onTrendRefreshed` can be passed to `<CaseFile>` (new optional prop).

## Job items

1. **Verdict** (`VerdictCard`, `logic.verdictView`): four states keyed on `evidence_trace.verdict.code`; label is the backend's text; meter `role="img"` "Evidence level N of 3"; direction chip (▲ Rising / ▼ Falling / ◆ No clear direction), rate per decade, 95% range + total change, period · complete years · source, summary. `no_clear_evidence` shows a dimmed "Best estimate"; `insufficient_data` shows "{years} complete years found; at least {min} are needed." and no Why button. Missing `evidence_trace` → V1 grade label only, never an invented verdict.
2. **How did we test this?** (`EvidenceDrawer`): S12 note; Plain words / With the numbers toggle; numbered steps from `evidence_trace.steps` (title, plain explanation, "Method and values" disclosure with humanised key/value table); in numbers mode the slope, Mann–Kendall, OLS, serial-correlation, tests-agree, FDR and completeness blocks; checks with ✓/✕ plus words; verdict ladder with the current rung; caveats; NASA POWER source link. Missing steps → "The step-by-step trace isn't available for this result".
3. **Why** (`WhyPanel` + `useExplanation`): uses new `api.requestExplanation` (keeps HTTP status). HTTP 422 whose detail names the case signature → refetch `/api/trend` for the same case → retry once (`logic.shouldRetryStale`); a 422 for the question text is not retried. Statuses: `ok` (Searched published science badge), `fallback`, `no_key` (+ "No AI key…" / "No AI model has been chosen…" for `missing_api_key` / `missing_model`), `rate_limited` (live countdown from `retry_after_seconds`; Ask disabled until it ends), `no_evidence` (two copies by `fallback_reason`; no drivers heading when empty), unknown status → treated as curated fallback. Measured trend listed under "What was measured", drivers under "Possible drivers", [n] chips link to numbered Sources (real anchors, `target=_blank rel="noopener noreferrer"`, domain shown). Optional follow-up question (240 chars = backend limit), manual submit only. AbortController cancels on a newer ask, a different case or unmount.
4. **Case file / contract fields**: CaseFile Overview and Detail lead with the new verdict card plus inline "How did we test this?" and "Why…" sections (old stamp Verdict kept only as fallback in Overview). Overview "Is it real?" now uses the backend verdict label and checks count, no raw p. Emergence note explains a null year when the headline is not significant (adjusted z noted). Forecast lab: coverage text names `coverage.calibration_end_year` and `coverage.model`; replays labelled "illustration, in-sample" with the backend `replay_note`; chart legend says "(in-sample illustration)". Archetypes shows a note when `requested_k` differs from `k`.
5. **Explore container** (`ExplorePanel`): renders the same tool cards App.jsx renders inline today (Detail/CaseFile, Sweep, Scan, Duel, World survey + archetypes — World/TimeLapse stay the Globe agent's components — Vitals, Ledger, Events, Learn). It fetches nothing; App keeps requests and keys. To adopt it, replace App.jsx's `<div id="panel" …>…</div>` block with:
   ```jsx
   <ExplorePanel
     tab={tab} hasPin={!!params} serverDown={variablesStatus === "error"} onRetry={retry}
     detail={{ r: trend, fresh: trendFresh, view, onView: (v) => { setViewPref(v); update((p) => setPrefs(p, { view: v })); }, onGo: goTool, onEvent: openEvent, watched, onToggleWatch: toggleCurrentWatch, focusSection: detailFocus }}
     sweep={{ r: sweep, selected: params?.variable, onOpen: openVariable }}
     scan={{ r: grid, cfg: scanCfg, onCfg: setScanCfg, onRun: runScan, stale: scanStale, selected: selectedCell, onSelect: setSelectedCell, onOpenCell: (lat, lon) => { commit({ lat, lon }); setExploreTab("investigate"); } }}
     duel={{ r: duel, data: duel.data && params && pinB && duel.key === keys.duel(params, pinB) ? duel.data : null, params, pinB, pickTarget, onPickTarget: setPickTarget, onPlaceB: (p) => setPinB({ lat: p.lat, lon: p.lon }), onSwap: swapPlaces, onRun: () => params && pinB && runDuel(params, pinB), caseNames: activeCase?.b ? { a: activeCase.a.name, b: activeCase.b.name } : null }}
     world={{ mode: worldMode, onMode: setWorldMode, r: world, archetypes, onOpen: openPlace, lapse, lapseYears: lapseData?.years ?? [], onLapse: setLapse, onChooseK: setArchK }}
     vitals={{ r: vitals }} ledger={{ r: ledger, onOpen: openLedgerRow }}
     events={{ selectedId: eventId, onSelect: (id) => { setEventId(id); const ev = EVENT_BY_ID[id]; if (ev) setFocus({ lat: ev.lat, lon: ev.lon, k: 1.5, nonce: Date.now() }); }, onOpenCase: openEventCase, onOpenVitals: () => setExploreTab("vitals") }}
     learn={{ casesCount: CASES.length, onOpenCases: () => setModal("cases"), onOpenGlossary: () => setModal("glossary"), onExplain: askExplainer, onOpenAbout: () => setModal("about") }}
   />
   ```
   The tab strip, globe column, SetupPanel and Briefing stay in App.jsx. Adopting it is optional: today's inline block keeps working.
6. **Degraded states**: verdict loading skeleton + StateCard, error with Try again, no place; trace loading/error/no steps; Why loading (slow text after 8 s), refreshing (stale signature), error with Try again, no_key, rate_limited, fallback, no_evidence, nothing-to-explain. Forecast lab already aborts on unmount.
7. **Tests**: `frontend/tests/insight.test.mjs` (fixtures from `backend/tests/fixtures/v2_fixtures.json`): verdict mapping for all four codes, no invented verdict, trace step order/formatting, check counts, technical blocks, payload shape (no forbidden fields, 240-char cap), stale-retry decision, refetch params, all explanation statuses incl. `missing_model`, citation/driver filtering and https guard, countdown, replay labelling.
8. Also (coordinator request): `hooks.js` `useReducedMotion` now honours `<html data-motion="reduced">` (via `lib/theme.js` `motionReduced()`) and watches the attribute with a MutationObserver.

## api.js

Appended one clearly marked block: `requestExplanation(payload, signal)` — like `fetchExplanation` but throws `Error` with `.status` and `.detail`. Existing exports unchanged. Also uses existing `fetchTrend` (stale refetch) and `fetchForecast` (forecast lab).

## Files

New: `components/insight/{logic.js,useWhy.js,VerdictCard.jsx,EvidenceDrawer.jsx,WhyPanel.jsx,VerdictSlot.jsx,ExplorePanel.jsx}`, `styles/insight.css`, `tests/insight.test.mjs`, this doc.
Changed: `components/main/InsightSlots.jsx` (now a re-export), `CaseFile.jsx`, `Overview.jsx`, `ForecastLab.jsx`, `Archetypes.jsx`, `charts/Emergence.jsx`, `charts/ForecastChart.jsx`, `hooks.js`, `api.js` (append only).

## Not done / limits

- App.jsx not edited (rule): `detailLevel`, `onTrendRefreshed` and `ExplorePanel` adoption are for the lead.
- Not run against a live backend or in a browser; components were server-rendered once with the fixtures to check they mount without errors.
- Toggling Overview ↔ Detail in the case file remounts the inline Why section (a re-ask is served from the backend's 24 h cache).
