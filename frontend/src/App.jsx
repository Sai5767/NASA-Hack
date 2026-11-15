import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArchetypes, fetchDuel, fetchGrid, fetchLedger, fetchPlaces, fetchSweep, fetchTrend, fetchVariables, fetchVersion, fetchVitals, fetchWorld } from "./api.js";
import { CLUSTER_COLORS, clusterGlyph, clusterName } from "./components/Archetypes.jsx";
import Briefing from "./components/Briefing.jsx";
import { AboutDialog, CasesDialog, GlossaryDialog } from "./components/Dialogs.jsx";
import { ExplainContext } from "./components/ExplainContext.js";
import Explainer from "./components/Explainer.jsx";
import Globe, { applyGlobePalette } from "./components/Globe.jsx";
import GlobeLegend from "./components/globe/GlobeLegend.jsx";
import { useGlobeLayers } from "./components/globe/useGlobeLayers.jsx";
import ExplorePanel from "./components/insight/ExplorePanel.jsx";
import ExploreTabs from "./components/insight/ExploreTabs.jsx";
import { VerdictSlot } from "./components/main/InsightSlots.jsx";
import { ForecastSlot, MainLayersProvider, MainStage, WeatherSlot } from "./components/main/MainLayers.jsx";
import AccountPanel from "./components/shell/AccountPanel.jsx";
import Dashboard, { DataPicker, PlaceSwitcher, RailGroup } from "./components/shell/Dashboard.jsx";
import { Drawer, ShellContext } from "./components/shell/Drawer.jsx";
import Onboarding from "./components/shell/Onboarding.jsx";
import { PinSwatch, SavePinForm } from "./components/shell/SavedPins.jsx";
import SignIn from "./components/shell/SignIn.jsx";
import TopBar from "./components/shell/TopBar.jsx";
import Vishwa from "./components/shell/Vishwa.jsx";
import { MOBILE_QUERY, REDUCED_QUERY, TABLET_QUERY, useMedia, useProfileStore } from "./components/shell/useShellState.js";
import Starfield from "./components/Starfield.jsx";
import { WorldLegend } from "./components/World.jsx";
import { CASES, FIRST_YEAR, LAST_FULL_YEAR } from "./lib/cases.js";
import { EVENTS, EVENT_BY_ID, KINDS } from "./lib/events.js";
import { clamp, formatPlace, round2 } from "./lib/format.js";
import { cellContains, nearestPlace } from "./lib/geo.js";
import { cellStylesShown, lapseDots, scanCells, worldDots } from "./lib/globeDots.js";
import { prepareLapse } from "./lib/lapse.js";
import {
  INTERESTS,
  addPlace,
  defaultView,
  hasPlace,
  interestById,
  interestOf,
  placeId,
  removePlace,
  setPrefs,
  stageOf,
  variablesFor,
  withAccount,
} from "./lib/profile.js";
import {
  addSavedPin,
  clearSavedPins,
  createResultCache,
  findSavedPin,
  loadSavedPins,
  newPinId,
  popPin,
  pushPin,
  removeSavedPin,
  saveSavedPins,
  savedPinMarkers,
  scanSummary,
} from "./lib/pins.js";
import { DEFAULT_EXPLORE_TAB, canCombine, flipDirection, hashFromRoute, historyMode, routeFromHash } from "./lib/route.js";
import { DATA_COLORS, DEFAULT_THEME, themeOf } from "./lib/theme.js";
import { compareVersions, describeVersion } from "./lib/version.js";

// Set at build time by vite.config.js from git; the analysis server reports its own through /api/version.
const PAGE_VERSION = {
  version: typeof __APP_VERSION__ === "undefined" ? "unknown" : __APP_VERSION__,
  dirty: typeof __APP_DIRTY__ === "undefined" ? false : __APP_DIRTY__,
};

// One theme ("mission"). Colours drawn by JavaScript (dots, pins, the globe) come from lib/theme.js; the CSS from theme.css.
const PALETTE = themeOf(DEFAULT_THEME);
const COLORS = { ...DATA_COLORS, ...PALETTE.colors };
applyGlobePalette(PALETTE.globe);

const EMPTY = { data: null, key: "", loading: false, error: "" };
const MAX_YEAR = new Date().getFullYear();

const PAGE_NAMES = { main: "Main", explore: "Explore" };

/** True when a key press is meant for a text field (Ctrl/Cmd+Z there undoes typing, not a pin). */
const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** The pin a scan request key describes (keys.grid order: variable, lat, lon, start, end, size, n). */
function pinFromGridKey(key) {
  const [variable, lat, lon, start, end, size, n] = String(key ?? "").split("|");
  const p = { variable, lat: Number(lat), lon: Number(lon), start: Number(start), end: Number(end) };
  if (!variable || ![p.lat, p.lon, p.start, p.end].every(Number.isFinite)) return null;
  return { params: p, cfg: { size: Number(size), n: Number(n) } };
}

const keys = {
  trend: (p) => [p.variable, p.lat, p.lon, p.start, p.end].join("|"),
  sweep: (p) => [p.lat, p.lon, p.start, p.end].join("|"),
  grid: (p, c) => [p.variable, p.lat, p.lon, p.start, p.end, c.size, c.n].join("|"),
  duel: (p, b) => [p.variable, p.lat, p.lon, b.lat, b.lon, p.start, p.end].join("|"),
  world: (w) => [w.variable, w.start, w.end].join("|"),
  vitals: (y) => [y.start, y.end].join("|"),
  archetypes: (y, k) => [y.start, y.end, k ?? "best"].join("|"),
  ledger: (y) => [y.start, y.end].join("|"),
};

const toDraftPatch = (patch) => {
  const out = {};
  if (patch.variable != null) out.variable = patch.variable;
  if (patch.lat != null) out.lat = Number(patch.lat).toFixed(2);
  if (patch.lon != null) out.lon = Number(patch.lon).toFixed(2);
  if (patch.start != null) out.start = String(patch.start);
  if (patch.end != null) out.end = String(patch.end);
  return out;
};

function parseDraft(d) {
  const lat = Number(d.lat);
  const lon = Number(d.lon);
  const start = Number.parseInt(d.start, 10);
  const end = Number.parseInt(d.end, 10);
  if (d.lat === "" || !Number.isFinite(lat) || lat < -90 || lat > 90) return { message: "Latitude must be a number from −90 to 90." };
  if (d.lon === "" || !Number.isFinite(lon) || lon < -180 || lon > 180) return { message: "Longitude must be a number from −180 to 180." };
  if (!Number.isFinite(start) || start < FIRST_YEAR) return { message: `The record starts in ${FIRST_YEAR}.` };
  if (!Number.isFinite(end) || end > MAX_YEAR) return { message: `The latest year available is ${MAX_YEAR}.` };
  if (end - start + 1 < 20) return { message: "Choose at least 20 years so a trend is meaningful." };
  return { value: { variable: d.variable, lat: round2(lat), lon: round2(lon), start, end } };
}

function midpoint(a, b) {
  const rad = Math.PI / 180;
  const x = (Math.cos(a.lat * rad) * Math.cos(a.lon * rad) + Math.cos(b.lat * rad) * Math.cos(b.lon * rad)) / 2;
  const y = (Math.cos(a.lat * rad) * Math.sin(a.lon * rad) + Math.cos(b.lat * rad) * Math.sin(b.lon * rad)) / 2;
  const z = (Math.sin(a.lat * rad) + Math.sin(b.lat * rad)) / 2;
  return { lat: Math.atan2(z, Math.hypot(x, y)) / rad, lon: Math.atan2(y, x) / rad };
}

/** One dot per place, colored by the archetype (cluster) it belongs to. */
function archetypeDots(data) {
  return data.places.map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    color: CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length],
    r: 6,
    ring: false,
    tip: `${p.name} · ${clusterGlyph(p.cluster)} ${clusterName(p.cluster)} · twins: ${p.twins.map((t) => t.name).join(", ")}`,
  }));
}

/** Notices shown once under the top bar (and on the welcome screen): blocked storage, unreadable profile, V1 migration. */
function StorageNotice({ status, migrated, onDismiss }) {
  if (status === "blocked") {
    return (
      <div className="shell-strip warn" role="status">
        <b>Your browser is blocking storage.</b> Your choices will last only until this tab closes.
      </div>
    );
  }
  if (status === "corrupt") {
    return (
      <div className="shell-strip warn" role="status">
        <b>Your saved profile couldn't be read</b>, so a fresh one was started on this device.
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }
  if (migrated) {
    return (
      <div className="shell-strip info" role="status">
        Your places and interests from the previous version were brought over. Check them below.
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }
  return null;
}

/** The server's place list, used for place search. Loaded once; failure only disables search. */
function usePlaces() {
  const [state, setState] = useState({ places: [], status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchPlaces(controller.signal)
      .then((places) => setState({ places: Array.isArray(places) ? places : [], status: "ready" }))
      .catch((e) => e.name !== "AbortError" && setState({ places: [], status: "error" }));
    return () => controller.abort();
  }, []);
  return state;
}

/**
 * The base-only welcome Earth: the real Globe renderer with no data, news, live weather, pins or picking, rotating
 * slowly behind sign-in and onboarding, cropped so about half of it enters the screen (see .welcome-globe in shell.css).
 * Decorative (hidden from assistive tech, out of the tab order, no country borders); it makes no request. It can still be
 * dragged with a pointer; the form sits above it and stays usable.
 */
function WelcomeEarth({ focus, reduced }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelectorAll("[tabindex]").forEach((el) => el.setAttribute("tabindex", "-1"));
  }, []);
  return (
    <div className="welcome-globe" ref={ref} aria-hidden="true">
      <Globe idleSpin={!reduced} focus={focus} reducedMotion={reduced} controls={false} borders={false} glow="welcome" />
    </div>
  );
}

/**
 * News loads automatically once the workspace is open (onboarding is done) and the user has saved places: the layer
 * then fetches news for those saved places only and shows it as globe markers. There is no news list on Main.
 */
function AutoNews() {
  const L = useGlobeLayers();
  const count = L?.places?.length ?? 0;
  useEffect(() => {
    if (L && !L.newsWanted && count > 0) L.setNewsWanted(true);
  }, [L?.newsWanted, count]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Sign-in and the two onboarding questions over the welcome Earth. The workspace is not rendered behind it. */
function Welcome({ store, places, placesStatus }) {
  const { profile } = store;
  const stage = stageOf(profile);
  const [about, setAbout] = useState(false);
  const [focus, setFocus] = useState(null);
  const reduced = useMedia(REDUCED_QUERY) || profile.prefs.reduceMotion;
  const orient = useCallback((p) => p && setFocus({ lat: p.lat, lon: p.lon, k: 1.1, nonce: Date.now() }), []);
  return (
    <div className={`welcome welcome--${stage}`}>
      <Starfield />
      <WelcomeEarth focus={focus} reduced={reduced} />
      <StorageNotice status={store.status} migrated={false} onDismiss={store.dismissNotice} />
      <main className="welcome-main">
        <h1 className="sr-only">Trend Detective</h1>
        <div key={stage} className={stage === "signin" ? "welcome-surface" : "welcome-flow"}>
          {stage === "signin" ? (
            <SignIn onSignIn={(email) => store.update((p) => withAccount(p, email))} />
          ) : (
            <Onboarding
              profile={profile}
              places={places}
              placesStatus={placesStatus}
              onFocusPlace={orient}
              onFinish={(draft) => store.update({ ...draft, onboarding: "done" })}
              onSkip={(draft) => store.update({ ...draft, onboarding: "skipped" })}
            />
          )}
        </div>
      </main>
      <footer className="welcome-foot">
        Not endorsed by NASA · <button type="button" className="linklike" onClick={() => setAbout(true)}>About</button>
      </footer>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </div>
  );
}

export default function App() {
  const store = useProfileStore();
  const { places, status: placesStatus } = usePlaces();
  if (stageOf(store.profile) !== "app") return <Welcome store={store} places={places} placesStatus={placesStatus} />;
  return <Workspace store={store} places={places} placesStatus={placesStatus} />;
}

/** The signed-in app: top bar, Main (dashboard + globe + timeline) and Explore (the advanced tools). */
function Workspace({ store, places, placesStatus }) {
  const { profile, update } = store;
  const initial = useMemo(() => routeFromHash(window.location.hash), []);
  const [page, setPage] = useState(initial.page);
  const [exploreTab, setExploreTab] = useState(initial.page === "explore" ? initial.tab : DEFAULT_EXPLORE_TAB);
  const [exploreAlso, setExploreAlso] = useState(initial.page === "explore" ? initial.also ?? null : null);
  const tab = page === "main" ? "investigate" : exploreTab;
  // A tool is open when it is the primary tool or the second one beside it (Explore only).
  const open = (id) => tab === id || (page === "explore" && exploreAlso === id);
  const [flip, setFlip] = useState("none");
  const [announce, setAnnounce] = useState("");
  const [variables, setVariables] = useState([]);
  const [variablesStatus, setVariablesStatus] = useState("loading");
  const [draft, setDraft] = useState(() => ({
    variable: profile.prefs.variable,
    lat: "",
    lon: "",
    start: String(FIRST_YEAR),
    end: String(LAST_FULL_YEAR),
    ...(initial.params ? toDraftPatch(initial.params) : {}),
  }));
  const [params, setParams] = useState(initial.params);
  const [pinB, setPinB] = useState(initial.pinB);
  const [pickTarget, setPickTarget] = useState("A");
  const [scanCfg, setScanCfg] = useState({ size: 10, n: 4 });
  const [selectedCell, setSelectedCell] = useState(null);
  const [focus, setFocus] = useState(null);
  const [modeRequest, setModeRequest] = useState(null);
  const [modal, setModal] = useState(null);
  const [activeCase, setActiveCase] = useState(null);
  const [formMsg, setFormMsg] = useState("");
  const [trend, setTrend] = useState(EMPTY);
  const [sweep, setSweep] = useState(EMPTY);
  const [grid, setGrid] = useState(EMPTY);
  const [duel, setDuel] = useState(EMPTY);
  const [world, setWorld] = useState(EMPTY);
  const [vitals, setVitals] = useState(EMPTY);
  const [worldMode, setWorldMode] = useState("survey");
  const [archetypes, setArchetypes] = useState(EMPTY);
  const [archK, setArchK] = useState(null);
  const [ledger, setLedger] = useState(EMPTY);
  const [lapse, setLapse] = useState({ on: false, year: null, playing: false, speed: 500 });
  const [serverVersion, setServerVersion] = useState(null);
  const [viewPref, setViewPref] = useState(profile.prefs.view);
  const [detailFocus, setDetailFocus] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [explainer, setExplainer] = useState({ started: false, open: false, request: null });
  const [drawer, setDrawer] = useState(null); // { id, title, eyebrow, render } — single occupancy
  const [dashOpen, setDashOpen] = useState(false);
  const [dataType, setDataType] = useState(null);
  const [pinHistory, setPinHistory] = useState([]);
  const [savedPins, setSavedPins] = useState(() => loadSavedPins());
  const [savedNote, setSavedNote] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const resultCache = useRef(null);
  if (!resultCache.current) resultCache.current = createResultCache();
  const tablet = useMedia(TABLET_QUERY);
  const mobile = useMedia(MOBILE_QUERY);
  const compact = tablet || mobile; // the rail becomes a bottom sheet below 1200px
  const reducedMotion = useMedia(REDUCED_QUERY) || profile.prefs.reduceMotion;
  const askExplainer = useCallback((request) => setExplainer({ started: true, open: true, request: request ? { ...request, nonce: Date.now() } : null }), []);
  const explainTerm = useCallback((id) => askExplainer({ id }), [askExplainer]);
  const view = viewPref ?? defaultView(profile);

  const controllers = useRef({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const scanCfgRef = useRef(scanCfg);
  scanCfgRef.current = scanCfg;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const pinHistoryRef = useRef(pinHistory);
  pinHistoryRef.current = pinHistory;
  const autoScan = useRef(false);
  const resultsRef = useRef(null);
  const headingRef = useRef(null);
  const routeRef = useRef(null);
  const firstPage = useRef(true);

  useEffect(() => {
    // Only the light lookups load on start. No world survey, news, forecast or per-place request happens here.
    fetchVariables()
      .then((v) => {
        setVariables(v);
        setVariablesStatus("ready");
      })
      .catch(() => setVariablesStatus("error"));
    fetchVersion().then(setServerVersion).catch(() => setServerVersion(null));
    if (initial.params) setFocus({ lat: initial.params.lat, lon: initial.params.lon, k: 1.8, nonce: 1 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- URL / history (lib/route.js)

  useEffect(() => {
    const next = { page, tab, params, pinB, also: page === "explore" ? exploreAlso : null };
    const mode = historyMode(routeRef.current, next);
    routeRef.current = next;
    if (mode === "none") return;
    const hash = hashFromRoute(next);
    const url = window.location.pathname + window.location.search + (hash ? `#${hash}` : "");
    try {
      if (mode === "push") window.history.pushState({ td: 2 }, "", url);
      else window.history.replaceState({ td: 2 }, "", url);
    } catch {
      /* the URL is only a convenience */
    }
  }, [page, tab, params, pinB, exploreAlso]);

  useEffect(() => {
    const onPop = () => {
      const r = routeFromHash(window.location.hash);
      const kept = r.params ?? paramsRef.current; // a page without a place in its URL keeps the current place
      routeRef.current = { ...r, params: kept, pinB: r.tab === "duel" || r.also === "duel" ? r.pinB : null };
      setPage((prev) => {
        if (prev !== r.page) setFlip(flipDirection(prev, r.page));
        return r.page;
      });
      if (r.page === "explore") {
        setExploreTab(r.tab);
        setExploreAlso(r.also ?? null);
      }
      if (r.params) {
        setParams(r.params);
        setDraft((d) => ({ ...d, ...toDraftPatch(r.params) }));
      }
      if (r.tab === "duel" || r.also === "duel") setPinB(r.pinB);
      setDrawer(null);
      setDashOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goPage = useCallback(
    (next) => {
      setDrawer(null);
      setDashOpen(false);
      if (next === page) return;
      setFlip(flipDirection(page, next));
      setPage(next);
      if (next === "explore") setLapse((l) => ({ ...l, playing: false }));
    },
    [page],
  );
  const goTool = useCallback((t) => {
    setExploreTab(t);
    setExploreAlso((a) => (a && canCombine(t, a).ok ? a : null));
    setSelectedCell(null);
    setPage((prev) => {
      if (prev !== "explore") setFlip("forward");
      return "explore";
    });
  }, []);

  // After a page flip: focus the new page's heading, announce it, and start at the top (spec 4.7).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    setAnnounce(PAGE_NAMES[page]);
  }, [page]);

  // ---------------------------------------------------------------- analyses

  const worldParams = useMemo(
    () => ({ variable: params?.variable ?? draft.variable, start: params?.start ?? FIRST_YEAR, end: params?.end ?? LAST_FULL_YEAR }),
    [params, draft.variable],
  );
  const vitalsYears = useMemo(() => ({ start: params?.start ?? FIRST_YEAR, end: params?.end ?? LAST_FULL_YEAR }), [params]);

  // `cache: true` keeps completed results in memory (lib/pins.js) so undo, Saved ▸ Open and the scan indicator restore
  // a result without refetching. Errors are never cached.
  const run = useCallback(async (kind, key, setter, call, opts = {}) => {
    controllers.current[kind]?.abort();
    const cacheKey = `${kind}:${key}`;
    if (opts.cache) {
      const hit = resultCache.current.get(cacheKey);
      if (hit) {
        setter({ data: hit, key, loading: false, error: "" });
        return hit;
      }
    }
    const controller = new AbortController();
    controllers.current[kind] = controller;
    setter({ ...EMPTY, key, loading: true });
    try {
      const data = await call(controller.signal);
      if (opts.cache) resultCache.current.set(cacheKey, data);
      setter({ data, key, loading: false, error: "" });
      return data;
    } catch (e) {
      if (e.name === "AbortError") return null;
      setter({ data: null, key, loading: false, error: e.message });
      return null;
    }
  }, []);
  useEffect(() => () => Object.values(controllers.current).forEach((c) => c?.abort()), []);

  const runTrend = useCallback(
    (p) => run("trend", keys.trend(p), setTrend, (s) => fetchTrend({ variable: p.variable, lat: p.lat, lon: p.lon, start_year: p.start, end_year: p.end }, s), { cache: true }),
    [run],
  );
  // A stale-signature refetch inside the Why panel hands back the fresh trend for the same case; the key is unchanged.
  const onTrendRefreshed = useCallback((fresh) => {
    if (!fresh) return;
    if (paramsRef.current) resultCache.current.set(`trend:${keys.trend(paramsRef.current)}`, fresh);
    setTrend((s) => (s.data ? { ...s, data: fresh } : s));
  }, []);
  const runSweep = useCallback(
    (p) => run("sweep", keys.sweep(p), setSweep, (s) => fetchSweep({ lat: p.lat, lon: p.lon, start_year: p.start, end_year: p.end }, s)),
    [run],
  );
  const runDuel = useCallback(
    async (p, b) => {
      const data = await run("duel", keys.duel(p, b), setDuel, (s) =>
        fetchDuel({ variable: p.variable, lat_a: p.lat, lon_a: p.lon, lat_b: b.lat, lon_b: b.lon, start_year: p.start, end_year: p.end }, s),
      );
      if (data) {
        const mid = midpoint(p, b);
        setFocus({ lat: mid.lat, lon: mid.lon, k: 1.05, nonce: Date.now() });
      }
      return data;
    },
    [run],
  );
  const runWorld = useCallback(
    async (w) => {
      const data = await run("world", keys.world(w), setWorld, (s) => fetchWorld({ variable: w.variable, start_year: w.start, end_year: w.end }, s));
      if (data) {
        setModeRequest({ mode: "flat", nonce: Date.now() });
        setFocus({ lat: 18, lon: 10, k: 1.05, nonce: Date.now() + 1 });
      }
      return data;
    },
    [run],
  );
  const runVitals = useCallback((y) => run("vitals", keys.vitals(y), setVitals, (s) => fetchVitals({ start_year: y.start, end_year: y.end }, s)), [run]);
  const runLedger = useCallback((y) => run("ledger", keys.ledger(y), setLedger, (s) => fetchLedger({ start_year: y.start, end_year: y.end, limit: 1500 }, s)), [run]);
  const runArchetypes = useCallback(
    async (y, k) => {
      const data = await run("archetypes", keys.archetypes(y, k), setArchetypes, (s) =>
        fetchArchetypes({ start_year: y.start, end_year: y.end, ...(k ? { k } : {}) }, s),
      );
      if (data) {
        setModeRequest({ mode: "flat", nonce: Date.now() });
        setFocus({ lat: 18, lon: 10, k: 1.05, nonce: Date.now() + 1 });
      }
      return data;
    },
    [run],
  );
  const runScan = useCallback(async () => {
    if (!params) return null;
    const data = await run("grid", keys.grid(params, scanCfg), setGrid, (s) =>
      fetchGrid({ variable: params.variable, lat: params.lat, lon: params.lon, size: scanCfg.size, n: scanCfg.n, start_year: params.start, end_year: params.end }, s),
      { cache: true },
    );
    if (data) {
      setSelectedCell(null);
      setFocus({ lat: params.lat, lon: params.lon, k: clamp(70 / scanCfg.size, 1.2, 3.2), nonce: Date.now() });
    }
    return data;
  }, [params, scanCfg, run]);

  // Run whichever analysis the open page needs when the question changes. Main needs only the active place's trend;
  // the heavy Explore analyses (world survey, vitals, ledger, sweep, duel) run only while their Explore tool is open.
  useEffect(() => {
    if (page === "explore") {
      if (tab === "world" && worldMode === "survey" && world.key !== keys.world(worldParams)) runWorld(worldParams);
      if (tab === "world" && worldMode === "archetypes" && archetypes.key !== keys.archetypes(vitalsYears, archK)) runArchetypes(vitalsYears, archK);
      if (tab === "vitals" && vitals.key !== keys.vitals(vitalsYears)) runVitals(vitalsYears);
      if (tab === "ledger" && ledger.key !== keys.ledger(vitalsYears)) runLedger(vitalsYears);
    }
    if (!params) return;
    if (tab === "investigate" && trend.key !== keys.trend(params)) runTrend(params);
    if (page !== "explore") return;
    if (open("sweep") && sweep.key !== keys.sweep(params)) runSweep(params);
    if (open("duel") && pinB && duel.key !== keys.duel(params, pinB)) runDuel(params, pinB);
  }, [page, tab, exploreAlso, params, pinB, worldParams, vitalsYears, worldMode, archK]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open("scan") && autoScan.current && params) {
      autoScan.current = false;
      runScan();
    }
  }, [tab, exploreAlso, params, runScan]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open("duel") && !pinB) setPickTarget("B");
    if (!open("duel")) setPickTarget("A");
  }, [tab, exploreAlso, pinB]); // eslint-disable-line react-hooks/exhaustive-deps

  // On narrow screens the Explore results sit below the globe: bring them into view.
  useEffect(() => {
    if (page === "explore" && window.innerWidth <= 1000 && (trend.data || sweep.data || grid.data || duel.data || world.data || vitals.data || archetypes.data)) {
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }, [trend.data, sweep.data, grid.data, duel.data, world.data, vitals.data, archetypes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pin as it is now, for the undo history: its question, its scan settings and its scan result key (if held).
  const snapshotPin = useCallback(() => {
    const p = paramsRef.current;
    if (!p) return null;
    const cfg = scanCfgRef.current;
    const g = gridRef.current;
    const gridKey = g.data && g.key === keys.grid(p, cfg) ? g.key : null;
    return { params: { ...p }, scanCfg: { ...cfg }, gridKey };
  }, []);

  const commit = useCallback((patch, opts = {}) => {
    const prev = paramsRef.current;
    const moved = prev && ((patch.lat != null && patch.lat !== prev.lat) || (patch.lon != null && patch.lon !== prev.lon));
    if (moved && opts.history !== false) {
      const snap = snapshotPin();
      if (snap) setPinHistory((h) => pushPin(h, snap));
    }
    setParams((prev) => ({
      ...(prev ?? {
        variable: draftRef.current.variable,
        start: Number.parseInt(draftRef.current.start, 10) || FIRST_YEAR,
        end: Number.parseInt(draftRef.current.end, 10) || LAST_FULL_YEAR,
        lat: 0,
        lon: 0,
      }),
      ...patch,
    }));
    setDraft((d) => ({ ...d, ...toDraftPatch(patch) }));
    if (patch.lat != null && opts.fly !== false) setFocus({ lat: patch.lat, lon: patch.lon, k: opts.k, nonce: Date.now() });
  }, [snapshotPin]);

  // A scan result is "held" while it belongs to the active pin, on any page or tab (owner item 12). Its cells are drawn on
  // the Explore globe in Scan and in Duel, so Duel and Scan can be used together on the same pin (owner item 13).
  const gridHeld = !!grid.data && !!params && grid.key === keys.grid(params, scanCfg);
  const gridFresh = gridHeld && page === "explore" && (open("scan") || open("duel"));
  const cells = useMemo(() => (gridFresh ? scanCells(grid.data) : []), [gridFresh, grid.data]);
  const cellHalf = gridFresh ? grid.data.size / (grid.data.n - 1) / 2 : 0;
  const worldFresh = page === "explore" && tab === "world" && worldMode === "survey" && !!world.data && world.key === keys.world(worldParams);
  const archFresh =
    page === "explore" && tab === "world" && worldMode === "archetypes" && !!archetypes.data?.ok && archetypes.key === keys.archetypes(vitalsYears, archK);
  const lapseData = useMemo(() => (worldFresh ? prepareLapse(world.data.places) : null), [worldFresh, world.data]);
  useEffect(() => {
    if (!lapse.on || !lapse.playing || !lapseData) return undefined;
    const last = lapseData.years[lapseData.years.length - 1];
    const timer = setInterval(() => setLapse((l) => (l.year >= last ? { ...l, playing: false } : { ...l, year: l.year + 1 })), lapse.speed);
    return () => clearInterval(timer);
  }, [lapse.on, lapse.playing, lapse.speed, lapseData]);
  useEffect(() => {
    if (!worldFresh) setLapse((l) => (l.on ? { ...l, on: false, playing: false } : l));
  }, [worldFresh]);

  const eventDots = useMemo(
    () =>
      tab === "events"
        ? EVENTS.map((ev) => ({
            id: ev.id,
            name: ev.name,
            lat: ev.lat,
            lon: ev.lon,
            color: KINDS[ev.kind].color,
            r: ev.id === eventId ? 8 : 5.5,
            ring: ev.id === eventId,
            tip: `${ev.year} · ${ev.name}`,
            event: ev,
          }))
        : [],
    [tab, eventId],
  );
  const exploreDots = useMemo(() => {
    if (worldFresh) return lapse.on && lapseData ? lapseDots(world.data, lapseData, lapse.year) : worldDots(world.data);
    if (archFresh) return archetypeDots(archetypes.data);
    return eventDots;
  }, [worldFresh, archFresh, world.data, archetypes.data, eventDots, lapse.on, lapse.year, lapseData]);

  // ---------------------------------------------------------------- place / variable selection

  const placeNameFor = (lat, lon) => nearestPlace(places, lat, lon, 250)?.name ?? formatPlace(lat, lon);
  const activePlace = useMemo(() => {
    if (!params) return null;
    const id = placeId(params.lat, params.lon);
    const saved = profile.places.find((p) => p.id === id);
    return saved ? { ...saved, saved: true } : { id, name: placeNameFor(params.lat, params.lon), lat: params.lat, lon: params.lon, saved: false };
  }, [params?.lat, params?.lon, profile.places, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const variableId = params?.variable ?? draft.variable;
  const variableInfo = variables.find((v) => v.id === variableId) ?? null;

  // The data type shown in the picker: once the variable list arrives, the type of the current variable among the
  // user's chosen types. With no place in the URL and a remembered variable outside the chosen types, start on the
  // first chosen type's headline variable instead.
  useEffect(() => {
    if (dataType || !variables.length) return;
    const chosen = profile.interests;
    const inChosen = chosen.find((id) => variablesFor(id, variables).some((v) => v.id === variableId));
    if (inChosen) return setDataType(inChosen);
    if (chosen.length && !initial.params) {
      const first = interestById(chosen[0]);
      const list = variablesFor(first.id, variables);
      setDataType(first.id);
      const v = list.find((x) => x.id === first.first) ?? list[0];
      if (v) setDraft((d) => ({ ...d, variable: v.id }));
      return undefined;
    }
    setDataType(interestOf(variableId, variables, chosen) ?? INTERESTS[0].id);
    return undefined;
  }, [variables]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePick = (lat, lon) => {
    const la = round2(lat);
    const lo = round2(lon);
    if (gridFresh) {
      const hit = grid.data.cells.find((c) => cellContains(c, la, lo, cellHalf));
      if (hit) {
        setSelectedCell(hit);
        return;
      }
    }
    setActiveCase(null);
    setSelectedCell(null);
    if (open("duel") && pickTarget === "B") {
      setPinB({ lat: la, lon: lo });
      return;
    }
    commit({ lat: la, lon: lo });
    if (open("duel") && !pinB) setPickTarget("B");
  };

  const selectPlace = (p) => {
    setActiveCase(null);
    setSelectedCell(null);
    commit({ lat: p.lat, lon: p.lon, variable: variableId }, { k: 1.8 });
  };

  const chooseVariable = (id) => {
    if (!id) return;
    setDraft((d) => ({ ...d, variable: id }));
    if (params) commit({ variable: id }, { fly: false });
    if (id !== profile.prefs.variable) update((p) => setPrefs(p, { variable: id }));
  };

  const chooseDataType = (tid) => {
    setDataType(tid);
    const list = variablesFor(tid, variables);
    if (list.length && !list.some((v) => v.id === variableId)) {
      const first = interestById(tid)?.first;
      chooseVariable((list.find((v) => v.id === first) ?? list[0]).id);
    }
  };

  const openPlace = (place) => {
    setActiveCase(null);
    setSelectedCell(null);
    commit({ variable: worldParams.variable, lat: round2(place.lat), lon: round2(place.lon) });
    setExploreTab("investigate");
  };

  const applyDraft = () => {
    const parsed = parseDraft(draft);
    if (parsed.message) {
      setFormMsg(parsed.message);
      return;
    }
    setFormMsg("");
    setActiveCase(null);
    commit(parsed.value);
    if (tab === "investigate") runTrend(parsed.value);
    else if (tab === "sweep") runSweep(parsed.value);
    else if (open("duel") && pinB) runDuel(parsed.value, pinB);
  };

  const choosePlace = (place) => {
    setActiveCase(null);
    setSelectedCell(null);
    if (open("duel") && pickTarget === "B") setPinB({ lat: place.lat, lon: place.lon });
    else commit({ lat: place.lat, lon: place.lon });
  };

  const openVariable = (id) => {
    commit({ variable: id }, { fly: false });
    setExploreTab("investigate");
  };

  const openCase = (c) => {
    setModal(null);
    setActiveCase(c);
    setSelectedCell(null);
    setFormMsg("");
    if (c.a) {
      const p = { variable: c.variable, lat: c.a.lat, lon: c.a.lon, start: FIRST_YEAR, end: LAST_FULL_YEAR };
      setParams(p);
      setDraft({ variable: p.variable, lat: p.lat.toFixed(2), lon: p.lon.toFixed(2), start: String(p.start), end: String(p.end) });
      setPinB(c.b ? { lat: c.b.lat, lon: c.b.lon } : null);
      if (c.scan) {
        setScanCfg(c.scan);
        autoScan.current = true;
      }
      setFocus({ lat: p.lat, lon: p.lon, k: c.scan ? clamp(70 / c.scan.size, 1.2, 3.2) : 1.8, nonce: Date.now() });
    } else {
      // Planet-wide cases need no pin; keep any existing place and just set the variable.
      setDraft((d) => ({ ...d, variable: c.variable, start: String(FIRST_YEAR), end: String(LAST_FULL_YEAR) }));
      setParams((prev) => (prev ? { ...prev, variable: c.variable, start: FIRST_YEAR, end: LAST_FULL_YEAR } : prev));
    }
    if (c.tab === "world") setWorldMode(c.mode ?? "survey");
    goTool(c.tab);
  };

  const openAsk = (s) => {
    if (s.type === "place") {
      setActiveCase(null);
      setExploreTab("investigate");
      commit({ variable: s.variable, lat: s.place.lat, lon: s.place.lon });
      setFormMsg("");
    } else chooseVariable(s.variable);
  };

  const openEvent = (ev) => {
    setEventId(ev.id);
    goTool("events");
    setFocus({ lat: ev.lat, lon: ev.lon, k: 1.5, nonce: Date.now() });
  };

  const openEventCase = (ev) => {
    setActiveCase(null);
    commit({ variable: ev.variable, lat: ev.lat, lon: ev.lon });
    setExploreTab("investigate");
  };

  const openLedgerRow = (row) => {
    setActiveCase(null);
    if (row.kind === "planet") {
      setExploreTab("vitals");
      return;
    }
    commit({ variable: row.variable, lat: row.lat, lon: row.lon });
    setExploreTab("investigate");
  };

  // The case file's ☆ Watch button now saves the place to the profile (max five).
  const watched = !!params && hasPlace(profile, params.lat, params.lon);
  const toggleCurrentWatch = () => {
    if (!params) return;
    update((p) =>
      hasPlace(p, params.lat, params.lon) ? removePlace(p, placeId(params.lat, params.lon)) : addPlace(p, { name: placeNameFor(params.lat, params.lon), lat: params.lat, lon: params.lon }),
    );
  };

  const swapPlaces = () => {
    if (!pinB || !params) return;
    const a = { lat: params.lat, lon: params.lon };
    commit({ lat: pinB.lat, lon: pinB.lon }, { fly: false });
    setPinB(a);
  };

  // ---------------------------------------------------------------- pin history, saved pins, held scan (owner items 9, 10, 12)

  /** Make `p` the active pin again, with its scan restored from the in-memory cache when one is held (no refetch). */
  const restorePin = (p, cfg, gridKey) => {
    setActiveCase(null);
    setSelectedCell(null);
    setParams({ ...p });
    setDraft((d) => ({ ...d, ...toDraftPatch(p) }));
    if (cfg && Number.isFinite(cfg.size) && Number.isFinite(cfg.n)) setScanCfg({ size: cfg.size, n: cfg.n });
    const cached = gridKey ? resultCache.current.get(`grid:${gridKey}`) : null;
    if (cached) setGrid({ data: cached, key: gridKey, loading: false, error: "" });
    setFocus({ lat: p.lat, lon: p.lon, nonce: Date.now() });
  };

  const undoPin = () => {
    const { entry, history } = popPin(pinHistoryRef.current);
    if (!entry) return false;
    setPinHistory(history);
    restorePin(entry.params, entry.scanCfg, entry.gridKey);
    setAnnounce(`Back to the previous pin, ${placeNameFor(entry.params.lat, entry.params.lon)}`);
    return true;
  };
  const undoRef = useRef(undoPin);
  undoRef.current = undoPin;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      if (!pinHistoryRef.current.length) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const previousPin = pinHistory[pinHistory.length - 1]?.params ?? null;

  const persistPins = (next) => {
    const r = saveSavedPins(next);
    setSavedPins(r.pins);
    if (!r.ok) setSavedNote("Your browser is blocking storage, so saved pins last only until this tab closes.");
    else if (r.dropped) setSavedNote(`Storage was nearly full, so ${r.dropped === 1 ? "an older scan result was" : `${r.dropped} older scan results were`} removed. The pins are kept; those scans reload when opened.`);
  };
  const savedHere = findSavedPin(savedPins, params);
  const heldScan = () => (gridHeld ? { cfg: { ...scanCfg }, key: grid.key, summary: scanSummary(grid.data), data: grid.data } : null);
  const savePin = ({ label, color }) => {
    if (!params) return;
    persistPins(addSavedPin(savedPins, { id: savedHere?.id ?? newPinId(), label, color, ...params, savedAt: Date.now(), scan: heldScan() ?? savedHere?.scan ?? null }));
    setSavingPin(false);
    setAnnounce(`Saved pin ${label}`);
  };
  const unpin = (id) => persistPins(removeSavedPin(savedPins, id));
  const openSavedPin = (pin) => {
    const p = { variable: pin.variable, lat: pin.lat, lon: pin.lon, start: pin.start, end: pin.end };
    const snap = snapshotPin();
    if (snap && !(snap.params.lat === p.lat && snap.params.lon === p.lon)) setPinHistory((h) => pushPin(h, snap));
    let gridKey = null;
    if (pin.scan) {
      gridKey = keys.grid(p, pin.scan.cfg);
      if (pin.scan.data) resultCache.current.set(`grid:${gridKey}`, pin.scan.data);
      else autoScan.current = true; // payload was dropped to save space: run the scan again
    }
    restorePin(p, pin.scan?.cfg, gridKey);
    if (pin.scan) goTool("scan");
    else goPage("main");
  };
  // A scan that finishes for a saved pin is kept with that pin.
  useEffect(() => {
    if (!gridHeld || !savedHere || (savedHere.scan?.key === grid.key && savedHere.scan?.data)) return;
    persistPins(savedPins.map((p) => (p.id === savedHere.id ? { ...p, scan: heldScan() } : p)));
  }, [gridHeld, grid.key, savedHere?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Scan active · <place>" while any scan result is held; clicking it returns to that scan.
  const scanPin = grid.data ? pinFromGridKey(grid.key) : null;
  const scanActive = scanPin ? placeNameFor(scanPin.params.lat, scanPin.params.lon) : null;
  const returnToScan = () => {
    if (!scanPin) return;
    if (!gridHeld) {
      const snap = snapshotPin();
      if (snap) setPinHistory((h) => pushPin(h, snap));
      restorePin(scanPin.params, scanPin.cfg, grid.key);
    }
    goTool("scan");
  };

  const pinActions = (
    <div className="pin-actions">
      {savingPin && params ? (
        <SavePinForm defaultLabel={savedHere?.label ?? activePlace?.name ?? ""} pins={savedPins} onSave={savePin} onCancel={() => setSavingPin(false)} />
      ) : (
        <>
          {params && (
            savedHere ? (
              <span className="pin-saved"><PinSwatch color={savedHere.color} /> Saved as {savedHere.label}</span>
            ) : (
              <button type="button" className="linklike" onClick={() => setSavingPin(true)}>Save pin</button>
            )
          )}
          {previousPin && (
            <button type="button" className="linklike" onClick={undoPin} aria-keyshortcuts="Control+Z Meta+Z" title="Ctrl+Z / ⌘Z">
              Back to previous pin
            </button>
          )}
        </>
      )}
    </div>
  );

  const retry = () => {
    if (tab === "world") return worldMode === "archetypes" ? runArchetypes(vitalsYears, archK) : runWorld(worldParams);
    if (tab === "vitals") return runVitals(vitalsYears);
    if (tab === "ledger") return runLedger(vitalsYears);
    if (!params) return undefined;
    if (tab === "investigate") return runTrend(params);
    if (tab === "sweep") return runSweep(params);
    if (open("duel") && pinB) return runDuel(params, pinB);
    return undefined;
  };

  // ---------------------------------------------------------------- drawer slot

  const openDrawer = useCallback((d) => {
    setDashOpen(false);
    setDrawer(d);
  }, []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openAccount = () => (drawer?.id === "account" ? closeDrawer() : openDrawer({ id: "account", title: "Account" }));
  const shell = useMemo(() => ({ openDrawer, closeDrawer, drawerId: drawer?.id ?? null, reducedMotion, page }), [openDrawer, closeDrawer, drawer?.id, reducedMotion, page]);

  const resetAll = () => {
    Object.values(controllers.current).forEach((c) => c?.abort());
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
    clearSavedPins();
    store.reset();
  };

  // ---------------------------------------------------------------- render pieces

  const pinsFor = (withB) => [
    ...(params ? [{ lat: params.lat, lon: params.lon, color: COLORS.a, label: "A" }] : []),
    ...(withB && pinB ? [{ lat: pinB.lat, lon: pinB.lon, color: COLORS.b, label: "B", phase: 0.5 }] : []),
  ];
  const busy = trend.loading || sweep.loading || grid.loading || duel.loading || world.loading || vitals.loading || archetypes.loading || ledger.loading;
  const scanStale = !!params && !!grid.data && grid.key !== keys.grid(params, scanCfg);
  const briefingTab = activeCase?.tab;
  const trendFresh = !!params && trend.key === keys.trend(params);
  const mainTrend = trendFresh ? trend : params ? { ...EMPTY, loading: true } : EMPTY;
  const explainData = tab === "investigate" && trendFresh && trend.data ? trend.data : null;
  const versionWarn = compareVersions(PAGE_VERSION, serverVersion) === "different";
  const versionText = describeVersion(serverVersion ?? PAGE_VERSION);

  const savedDots = useMemo(
    () =>
      profile.places.map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        color: COLORS.a,
        r: 6,
        ring: activePlace?.id === p.id,
        tip: `${p.name} · one of your places`,
        place: p,
      })),
    [profile.places, activePlace?.id],
  );
  // Saved pins for the Globe agent to draw: [{ id, lat, lon, label, color, outline, colorId }].
  const savedMarkers = useMemo(() => savedPinMarkers(savedPins), [savedPins]);
  const pickSavedMarker = (m) => {
    const pin = savedPins.find((p) => p.id === (m?.id ?? m));
    if (pin) openSavedPin(pin);
  };
  const mainGlobeProps = {
    pins: pinsFor(false),
    dots: savedDots,
    onDotPick: (d) => d.place && selectPlace(d.place),
    savedPins: savedMarkers,
    onSavedPinPick: pickSavedMarker,
    focus,
    busy: trend.loading,
    // Spin whenever the user is not interacting; the Globe pauses for drag/hover/focus and its own pause button.
    idleSpin: !reducedMotion,
    onPick: handlePick,
  };
  const layerProps = {
    place: activePlace,
    variable: variableInfo,
    places: profile.places,
    interests: profile.interests,
    reducedMotion,
    page,
    openDrawer,
    closeDrawer,
  };
  const verdictText = trendFresh && trend.data ? trend.data.evidence_trace?.verdict?.label ?? trend.data.grade?.label : trend.loading ? "Checking…" : "";

  const mainPage = (
    <MainLayersProvider {...layerProps}>
      <AutoNews />
      <div className="main-page">
        <h1 className="sr-only" tabIndex={-1} ref={page === "main" ? headingRef : undefined}>Main</h1>

        <Dashboard
          sheet={compact}
          open={dashOpen}
          onOpen={() => setDashOpen(true)}
          onClose={() => setDashOpen(false)}
          peek={
            <>
              <b>{activePlace ? activePlace.name : "Choose a place"}</b>
              <span> · {variableInfo?.label ?? variableId}</span>
              {verdictText && <span> · {verdictText}</span>}
            </>
          }
          footer={
            <>
              <button type="button" className="linklike" onClick={() => setModal("about")}>Sources</button>
              <Vishwa />
            </>
          }
        >
          <RailGroup label="Place" name="place">
            <PlaceSwitcher
              places={profile.places}
              place={activePlace}
              onPlace={selectPlace}
              onAdd={() => openDrawer({ id: "account", title: "Account" })}
              actions={pinActions}
            />
          </RailGroup>
          <RailGroup label="Following" name="subject">
            <DataPicker
              interests={profile.interests}
              variables={variables}
              variablesStatus={variablesStatus}
              dataType={dataType}
              variableId={variableId}
              onDataType={chooseDataType}
              onVariable={chooseVariable}
            />
          </RailGroup>
          <RailGroup label="Snapshot" name="snapshot">
            <div className="rail-snapshot" data-slot="verdict">
              <VerdictSlot
                place={activePlace}
                variable={variableInfo}
                trend={mainTrend}
                onRetry={() => params && runTrend(params)}
                onOpenDetail={() => {
                  setViewPref("detail");
                  goTool("investigate");
                }}
                openDrawer={openDrawer}
                closeDrawer={closeDrawer}
                detailLevel={profile.prefs.detail}
                onTrendRefreshed={onTrendRefreshed}
              />
            </div>
            <div className="rail-row" data-slot="weather"><WeatherSlot {...layerProps} /></div>
            <div className="rail-row" data-slot="forecast"><ForecastSlot {...layerProps} /></div>
          </RailGroup>
        </Dashboard>

        <div className="main-stage">
          <MainStage {...layerProps} globeProps={mainGlobeProps} overlay={null} />
        </div>
      </div>
    </MainLayersProvider>
  );

  // One shared active pin for every Explore tool (owner item 13): Duel and Scan read the same pin A, pin B and held scan.
  const sharedPin = {
    params,
    pinB,
    place: activePlace,
    pickTarget,
    onPickTarget: setPickTarget,
    onPinB: (p) => setPinB(p ? { lat: p.lat, lon: p.lon } : null),
    scan: { held: gridHeld, r: grid, cfg: scanCfg, cells, cellHalf, selected: selectedCell, onRun: runScan },
    duel: { data: duel.data && params && pinB && duel.key === keys.duel(params, pinB) ? duel.data : null, r: duel },
    history: { canUndo: !!previousPin, previous: previousPin, onUndo: undoPin },
    saved: { pins: savedPins, here: savedHere, onSave: savePin, onOpen: openSavedPin, onRemove: unpin },
  };

  const explorePage = (
    <div className="explore-page">
      <header className="explore-head">
        <h1 tabIndex={-1} ref={page === "explore" ? headingRef : undefined}>Explore</h1>
        {tab !== "saved" && tab !== "ask" && pinActions}
      </header>
      <div className="explore-tabs-wrap">
        <ExploreTabs tab={exploreTab} also={exploreAlso} onTab={goTool} onAlso={setExploreAlso} scanActive={gridHeld} />
      </div>

      <div className="stage">
        <div className="globe-col">
          <Globe
            pins={pinsFor(open("duel"))}
            cells={cells}
            cellHalf={cellHalf}
            selectedCell={selectedCell}
            dots={exploreDots}
            onDotPick={(d) => (d.event ? openEvent(d.event) : openPlace(d))}
            savedPins={savedMarkers}
            onSavedPinPick={pickSavedMarker}
            focus={focus}
            modeRequest={modeRequest}
            busy={busy}
            idleSpin={!reducedMotion}
            onPick={handlePick}
          >
            {cells.length > 0 && <GlobeLegend scanStyles={cellStylesShown(cells)} />}
            {worldFresh && lapse.on && <div className="lapse-year" aria-live="polite">{lapse.year}</div>}
            {cells.length === 0 && archFresh && <GlobeLegend sampleSites />}
            {cells.length === 0 && worldFresh && exploreDots.length > 0 && (
              <WorldLegend mode={lapse.on ? "lapse" : "trend"} variable={world.data?.variable} />
            )}
            {cells.length === 0 && archFresh && (
              <ul className="globe-legend mono" aria-label="Map key">
                {archetypes.data.clusters.map((c) => (
                  <li key={c.id}><i className="round" style={{ background: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length] }} /> <span aria-hidden="true">{clusterGlyph(c.id)}</span> {clusterName(c.id)} · {c.size} places</li>
                ))}
                <li className="faint">hover a dot for its climate twins</li>
              </ul>
            )}
          </Globe>
        </div>

        <div className="console" ref={resultsRef}>
          {activeCase && briefingTab && tab !== "learn" && tab !== "saved" && tab !== "ask" && <Briefing key={activeCase.id} item={activeCase} onClose={() => setActiveCase(null)} />}

          <ExplorePanel
            tab={tab}
            also={page === "explore" ? exploreAlso : null}
            onCloseAlso={() => setExploreAlso(null)}
            shared={sharedPin}
            setup={{ variables, draft, onDraft: (patch) => setDraft((d) => ({ ...d, ...patch })), onVariable: chooseVariable, onApply: applyDraft, onPlace: choosePlace, disabled: busy || variables.length === 0, message: formMsg }}
            ask={{
              places,
              variables,
              currentVariable: draft.variable,
              current: params,
              onInvestigate: (p) => {
                setActiveCase(null);
                setFormMsg("");
                commit(p);
                setExploreTab("investigate");
              },
              onAsk: openAsk,
            }}
            onOpenAsk={() => goTool("ask")}
            saved={{ note: savedNote, onDismissNote: () => setSavedNote(""), variables }}
            hasPin={!!params}
            serverDown={variablesStatus === "error"}
            onRetry={retry}
            detail={{
              r: trend,
              fresh: trendFresh,
              view,
              onView: (v) => {
                setViewPref(v);
                update((p) => setPrefs(p, { view: v }));
              },
              onGo: goTool,
              onEvent: openEvent,
              watched,
              onToggleWatch: toggleCurrentWatch,
              focusSection: detailFocus,
              onTrendRefreshed,
            }}
            sweep={{ r: sweep, selected: params?.variable, onOpen: openVariable }}
            scan={{
              r: grid,
              cfg: scanCfg,
              onCfg: setScanCfg,
              onRun: runScan,
              stale: scanStale,
              selected: selectedCell,
              onSelect: setSelectedCell,
              onOpenCell: (lat, lon) => {
                commit({ lat, lon });
                setExploreTab("investigate");
              },
            }}
            duel={{
              r: duel,
              data: duel.data && params && pinB && duel.key === keys.duel(params, pinB) ? duel.data : null,
              params,
              pinB,
              pickTarget,
              onPickTarget: setPickTarget,
              onPlaceB: (p) => setPinB({ lat: p.lat, lon: p.lon }),
              onSwap: swapPlaces,
              onRun: () => params && pinB && runDuel(params, pinB),
              caseNames: activeCase?.b ? { a: activeCase.a.name, b: activeCase.b.name } : null,
            }}
            world={{ mode: worldMode, onMode: setWorldMode, r: world, archetypes, onOpen: openPlace, lapse, lapseYears: lapseData?.years ?? [], onLapse: setLapse, onChooseK: setArchK }}
            vitals={{ r: vitals }}
            ledger={{ r: ledger, onOpen: openLedgerRow, variables }}
            events={{
              selectedId: eventId,
              onSelect: (id) => {
                setEventId(id);
                const ev = EVENT_BY_ID[id];
                if (ev) setFocus({ lat: ev.lat, lon: ev.lon, k: 1.5, nonce: Date.now() });
              },
              onOpenCase: openEventCase,
              onOpenVitals: () => setExploreTab("vitals"),
            }}
            learn={{ casesCount: CASES.length, onOpenCases: () => setModal("cases"), onOpenGlossary: () => setModal("glossary"), onExplain: askExplainer, onOpenAbout: () => setModal("about") }}
          />
        </div>
      </div>

      <footer className="footer">
        <p>
          Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program; NASA GISS GISTEMP;
          NOAA GML, CPC and NCEI; NSIDC Sea Ice Index. Independent project, not endorsed by NASA.{" "}
          <button type="button" onClick={() => setModal("about")}>About & credits</button>
        </p>
        <p className="version">Version {versionText}</p>
      </footer>
    </div>
  );

  return (
    <ExplainContext.Provider value={explainTerm}>
      <ShellContext.Provider value={shell}>
        <div className={`app page-${page}`}>
          <Starfield />
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
            <defs>
              <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.7" />
              </filter>
            </defs>
          </svg>

          <nav className="skip-links" aria-label="Skip links">
            {page === "main" ? (
              <>
                <button type="button" onClick={() => focusInside("globe-stage")}>Skip to globe</button>
                <button type="button" onClick={() => focusInside("timeline")}>Skip to timeline</button>
              </>
            ) : (
              <button type="button" onClick={() => focusInside("panel")}>Skip to results</button>
            )}
          </nav>

          <TopBar
            page={page}
            onPage={goPage}
            accountLabel={profile.account?.label}
            accountOpen={drawer?.id === "account"}
            onAccount={openAccount}
            scanActive={page === "explore" && open("scan") ? null : scanActive}
            onScan={returnToScan}
          />
          {versionWarn && (
            <div className="shell-strip warn" role="alert">
              This page ({describeVersion(PAGE_VERSION)}) and the analysis server ({describeVersion(serverVersion)}) are different versions. Close this window,
              double-click STOP.bat, then START.bat.
            </div>
          )}
          <StorageNotice status={store.status} migrated={store.migrated} onDismiss={store.dismissNotice} />
          <p className="sr-only" aria-live="polite">{announce}</p>

          <main key={page} className={`page ${flip === "forward" ? "page-flip-forward" : flip === "back" ? "page-flip-back" : "page-fade"}`}>
            {page === "main" ? mainPage : explorePage}
          </main>

          {drawer && (
            <Drawer id={drawer.id} title={drawer.title} eyebrow={drawer.eyebrow} onClose={closeDrawer}>
              {drawer.id === "account" ? (
                <AccountPanel
                  profile={profile}
                  onChange={update}
                  places={places}
                  placesStatus={placesStatus}
                  storageStatus={store.status}
                  onReset={resetAll}
                  onAbout={() => {
                    closeDrawer();
                    setModal("about");
                  }}
                  version={versionText}
                />
              ) : (
                drawer.render?.()
              )}
            </Drawer>
          )}

          {modal === "cases" && <CasesDialog variables={variables} onOpen={openCase} onClose={() => setModal(null)} />}
          {modal === "glossary" && <GlossaryDialog onClose={() => setModal(null)} onExplain={(id) => { setModal(null); explainTerm(id); }} />}
          {modal === "about" && <AboutDialog onClose={() => setModal(null)} />}
          {explainer.started && (
            <Explainer request={explainer.request} data={explainData} open={explainer.open} onClose={() => setExplainer((s) => ({ ...s, open: false }))} />
          )}
        </div>
      </ShellContext.Provider>
    </ExplainContext.Provider>
  );
}

/** Move keyboard focus into a region: its first focusable element, else the region itself. */
function focusInside(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = el.querySelector('[tabindex="0"], button, [href], input, select, canvas[tabindex]') ?? el;
  if (!target.hasAttribute("tabindex") && target === el) el.setAttribute("tabindex", "-1");
  target.focus();
}

