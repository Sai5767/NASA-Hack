# V3 audit report (read-only, 15 Nov 2026)

Mostly source-based; browser check only confirmed sign-in (violet button, faint grid, CSS limb, boxed card).

## 1. Visual violations (section 3)

Three disagreeing token sources (Design agent replaces with one):
- styles/theme.css:6-242 — violet --accent #b3a1ff/--accent-rgb (:37-40), blue --glow-rgb (:41), violet focus halo (:47), navy/blue globe palette (:50-58), pink --live #ff8fd6 + --glow-live (:118-119,:197), violet --verdict-strong/--verdict-some (:138-139), teal "wet" ramp (:72-75), --data-water #38bdf8 (:88), --type-* per-type tints on UI chips (:97-102), green/amber/red status used for generic UI (:129-135), blue-tinted blacks --bg-1 #0a0f1c…--surface-3 #1c2a47, --line-rgb 125,160,230, glass --panel/--panel-raised (:18-20), --globe-idle-resume-delay 8000ms (:232). body two radial blue gradients (:263-267); body::before 52px grid (:271-282); .card backdrop blur (:319-326); .hud-card violet brackets (:329-340); .eyebrow 11px uppercase violet mono (:342-348); .btn-primary violet glow (:369-377); .btn:hover violet ring; .chip.on/.seg .on/.linklike/.term underline accent; .field labels uppercase mono 12px (:400).
- lib/theme.js:10-27 — pin A violet, pin B pink, blue globe, accentRgb, DATA_COLORS up #ff7a5c / down #5ab4ff.
- lib/tokens.js:7-38 — duplicates incl. --accent/--live fallback.

Hard-coded colours in components:
- App.jsx:111,121 rgba(160,170,200…) scan strokes; App.jsx:1145 Starfield accent RGB.
- Globe.jsx:23-30 palette defaults; :102,109,532,568,581,597 literal rgba/#fff; :122 drawRadar.
- Onboarding.jsx:46 pin #b3a1ff. Starfield.jsx:24-26 blue-white + violet stars.
- Archetypes.jsx multicolour CLUSTER_COLORS; lib/events.js KINDS 6 hex; charts/* (TrendChart, ForecastChart, DuelChart, Emergence) hex + var(--accent); Vitals.jsx accent ×2.

CSS files:
- panels.css: neon #5dffb0/#ffc24d stamps/grades (:94-96,136-156,321), gradient verdict top bar (:63-65), glowing metric bars (:111-112), loading/boot bars glow+scan (:44,324), pink/violet .target glows (:248-249), case-card lift+glow (:287-288), blur (:277).
- ml.css:12,29,33,55,63 #5dffb0 + swatch glow; extras.css:50,65 green.
- layout.css: blur (:18,:170), globe radial gradient + accent glow (:139-140), .globe-scan CRT lines (:152-156), HUD violet .hud-val (:160-177), accent selected tab (:212).
- overview.css:17,76,97 blur/accent; lapse.css:13 blur.
- shell.css: .welcome-limb gradient (:107-117), animated .td-scanbars (:89-92), Explore tab mask gradient (:390).
- globe.css: surface fallbacks #152038/#0e1524 (:15,28,50,65,167,176,190); pink --live ×10.
- motion.css: scanBar, pulseGlow, twinkle, drift, stamp glow keyframes (:3-23,68).

Cards/boxes: Dashboard.jsx:144 card dash-card header; :150-153 every slot card dash-card dash-slot (shell.css:229-236). hud-card brackets in Archetypes, Briefing, CaseParts, Duel×2, Events, Explainer, Loading, Scan, SetupPanel, Vitals, World. App.jsx:241 welcome-card card.

Typography: ~120 font-size < 15px (panels×45, insight×20, overview×11, extras×11, ml×9, ledger×8, globe×7, layout×6, theme×7); --fs-11/12/13 tokens; 24 uppercase rules; HUD 11.5px mono; TopBar.jsx:13 tagline telemetry; uppercase mono field labels.

Copy-heavy Main: App.jsx slots render VerdictSlot, WeatherSlot (LiveWeatherCard), ForecastSlot (ForecastStatus), NewsSlot (NewsList) all at once; Dashboard.jsx:84 hint text; place-empty card; footer links App.jsx:922-927; "Open Explore ▸"; TimelineRail.jsx:219-260 caption/source/reason/grid table; GlobeLegend notes (SEVERITY_NOTE, GRID_SHORT_NOTE); Globe.jsx:903 hint; version-warning strip.

## 2. Interaction and data flow

First run: App.jsx:228-263 Welcome = Starfield + .welcome-limb CSS + card; no real Globe (only optional pin map in Onboarding.jsx:44-49). fetchPlaces runs pre-sign-in (App.jsx:215-225) — public, acceptable. SignIn.jsx validates locally, setPassword("") before onSignIn(email); profile.js:85,114 masked email; sanitizeProfile allow-list — KEEP. Update DEMO_NOTE (SignIn.jsx:4) to brief wording. Onboarding two steps with Back/Skip; Q2 → "What would you like to follow?"; type-tile tints.

Main: Dashboard (left rail of cards) + MainStage + TimelineRail (MainLayers.jsx:40-89). Only fetchTrend for active place (App.jsx:516), AbortController + key cache (App.jsx:428-442) — KEEP. Tablet summary strip + drawer; mobile native selects (App.jsx:863-895). idleSpin on Main = !params && !reducedMotion (App.jsx:842) → once a place is chosen Earth never spins (bigger gap than 8 s).

Globe.jsx: IDLE_RESUME_MS = 8000 (:46); interacted() :283; spinAllowed (:338-354) blocks on field/liveGlyph/cardFor/flat/zoom>1.2 — must only stop for hover/focus/open callout/user pause. HUD CURSOR/PIN A (:862-867), Globe/Map + zoom groups (:869-885), hint (:903), scan overlay (:813). rotationPaused when any drawer open or playback (MainLayers.jsx:65). News markers DOM buttons repositioned per frame (placeOverlays :387-411) — good; hover card placed from markerPos at React render (:852-859): doesn't follow rotation, no leader, no outward growth. Base Earth = world-atlas countries-110m vector + blue halo + graticule.

Data layers (useGlobeLayers.jsx): /api/monthly-frames for active place+variable only, abort, 8-entry memo, 3-yr range; timeline/field via lib/globeFrames.js; cross-fade only in playback (fadeMs) — KEEP plumbing exactly. Forecast manual (requestForecast). Live weather only while card open or "Show on globe". No coarse whole-Earth preview.

News: loads only when NewsList scrolls into view (News.jsx:124-126 → setNewsWanted) or button; saved places only (locationsParam); markers at lead story lat/lon (globeNews.js:~194); verified/unverified glyph logic correct (newsCard :116-130) — KEEP. Removing NewsSlot removes the trigger → make newsWanted automatic once profile ready + saved places exist.

TimelineRail multi-row (:137-165, :167-208, :219-260). KEEP real input range, aria-valuetext, PageUp/Down/Home/End (:121-125), forecast divider logic.

Explore: ExplorePanel.jsx routes from route.js:10-20 (sweep, scan, duel, world, vitals, ledger, events, investigate→CaseFile, learn), one tool at a time. SetupPanel (with AskBox) above every tool (App.jsx:1049-1062). Per-tab fetches fetchWorld/fetchArchetypes/fetchVitals/fetchLedger/fetchSweep/fetchDuel/fetchGrid. Hash routing + history (App.jsx:352-387) — KEEP. Explainer = local KB, fixed card hud-card aside, starter chips always visible (Explainer.jsx:65-102).

api.js used: fetchVariables, fetchVersion, fetchPlaces, fetchTrend, fetchSweep, fetchGrid, fetchDuel, fetchWorld, fetchVitals, fetchArchetypes, fetchLedger, fetchMonthlyFrames, fetchMonthlyForecast, fetchLiveWeather, fetchNews, requestExplanation; fetchSuspects/fetchForecast in legacy CaseFile/ForecastLab; fetchExplanation/fetchHealthDetails look unused.

## 3. Owner feedback items (plan section 12)

1. "Site's own average": App.jsx:1024-1026 lapse legend, :153,167 tooltip, DuelChart :55,59. No "baseline" glossary entry. Move legend into World.jsx/GlobeLegend + add term.
2. lib/ask.js suggest() exists; AskBox only returns suggestions; SetupPanel.jsx:25-60 always shows lat/lon/variable/years. Need "Adjust" disclosure.
3. AskBox inside SetupPanel above all tools. Add `ask` to EXPLORE_TABS.
4. Ledger.jsx:19,100 "survives correction"/"nominal only" undefined; red/blue arrows ledger.css:7-8,14-15,31-32; no units; no <Term>.
5. Ledger.jsx:107 chips toggle variable filter; no label/tooltip/clear.
6. Scan cells App.jsx:104-127 scanCells (dash [4,3] = before-correction-only; failed dashed grey); legend App.jsx:1012-1018 omits dashed; summary chip .amber in Scan.jsx:~99. Move scanCells + legend out of App into F's globe helpers.
7. No ChartViewer. Charts: TrendChart, ForecastChart, DuelChart, Emergence, Fingerprint, Sparkline, Stripes, plus inline SVG in Vitals.jsx and Events.jsx. CSV only in CaseFile/Scan via lib/csv.js downloadText. No PNG/log/unit/range.
8. Term.jsx (hover pop + click → explainer) and lib/glossary.js (24 ids). Missing: baseline, correction (only fdr), forecast band, hatch/no data, sample site. <Term> unused in Ledger, Explainer, Main/insight, World legend, Events. Underline violet (theme.css:444).
9. No pin history. handlePick/commit (App.jsx:541-646) overwrite params. No lib/pins.js.
10. Only profile.places (max 5, no scan/colour) via addPlace; savedDots violet (App.jsx:821-835). Missing Saved tab, scan store, palette.
11. Explainer fixed aside (styles/explainer.css); not resizable/draggable; shared scroll; starter chips always shown.
12. grid state persists (App.jsx:303) but no indicator; gridFresh requires tab==="scan" (:556).
13. Tabs flat (route.js:10-20); ExplorePanel renders one tool; globe props chosen per tab (App.jsx:999-1011) → Duel+Scan needs composed pins + cells.

## 4. Coarse whole-Earth preview

/api/world (backend/app/main.py:375) is NOT suitable (68 gazetteer sites, analyze_point fan-out, annual only, slow cold). No gridded global data in repo.
Recommendation: offline build script (e.g. tools/coarse_preview/) fetching NASA POWER monthly for a coarse ~10°–15° grid for T2M, PRECTOTCORR, CLOUD_AMT over last 24–36 months, quantised to ~50–150 KB/variable in frontend/public/coarse/, recorded in DATA_SOURCES with retrieval date. Frontend loads instantly, renders blurred sphere-clipped lit texture labelled "Coarse global preview · approximate pattern · NASA POWER, <dates>", no stats; slider picks nearest month, labels last available; local field cells on top. Fallback: backend endpoint with disk cache warmed by owner. Do not use /api/world dots.

## 5. Ownership split (as adopted by the lead — see agent prompts)

- D: theme.css, motion.css, lib/theme.js, lib/tokens.js, shell/ui.jsx BrandMark/Logo, Starfield.jsx, index.html fonts.
- E: App.jsx (sole owner), shell/*, lib/profile.js, new lib/pins.js, styles/shell.css, styles/layout.css (non-globe rules), Dialogs.jsx.
- F: Globe.jsx, globe/*, main/MainLayers.jsx, lib/globeFrames.js, lib/globeNews.js, lib/ramp.js, lib/liveWeather.js, lib/lapse.js, lib/geo.js, new lib/globeDots.js, styles/globe.css (+ .globe/.hud rules moved from layout.css), coarse preview script/asset.
- G: insight/*, main/InsightSlots.jsx, lib/route.js, legacy tools (CaseFile, CaseParts, Sweep, Scan, Duel, World, Vitals, Ledger, Events, Archetypes, Overview, Suspects, ForecastLab, Briefing, SetupPanel, AskBox, Explainer, Term, Loading, TimeLapse), lib/glossary.js, explain.js, ask.js, cases.js, events.js, words.js, styles panels/insight/ledger/explainer/extras/ml/overview/events/lapse.css.
- J: components/charts/*, lib/chart.js, styles/charts.css, new ChartViewer + useChartViewer, lib/csv.js.

Conflict hotspots: App.jsx (E only); theme.css (D only; others request); layout.css (.globe/.hud → globe.css under F); route.js (G owns, E reviews).
