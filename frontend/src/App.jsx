import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArchetypes, fetchDuel, fetchGrid, fetchLedger, fetchPlaces, fetchSweep, fetchTrend, fetchVariables, fetchVersion, fetchVitals, fetchWorld } from "./api.js";
import { CLUSTER_COLORS } from "./components/Archetypes.jsx";
import Briefing from "./components/Briefing.jsx";
import { AboutDialog, CasesDialog, GlossaryDialog } from "./components/Dialogs.jsx";
import { ExplainContext } from "./components/ExplainContext.js";
import Explainer from "./components/Explainer.jsx";
import Globe, { applyGlobePalette } from "./components/Globe.jsx";
import GlobeLegend from "./components/globe/GlobeLegend.jsx";
import ExplorePanel from "./components/insight/ExplorePanel.jsx";
import { VerdictSlot } from "./components/main/InsightSlots.jsx";
import { ForecastSlot, MainLayersProvider, MainStage, NewsSlot, WeatherSlot } from "./components/main/MainLayers.jsx";
import SetupPanel from "./components/SetupPanel.jsx";
import AccountPanel from "./components/shell/AccountPanel.jsx";
import Dashboard, { DataPicker, PlaceSwitcher, Slot } from "./components/shell/Dashboard.jsx";
import { Drawer, ShellContext } from "./components/shell/Drawer.jsx";
import Onboarding from "./components/shell/Onboarding.jsx";
import SignIn from "./components/shell/SignIn.jsx";
import TopBar, { Brand } from "./components/shell/TopBar.jsx";
import { MOBILE_QUERY, REDUCED_QUERY, TABLET_QUERY, useMedia, useProfileStore } from "./components/shell/useShellState.js";
import Starfield from "./components/Starfield.jsx";
import { CASES, FIRST_YEAR, LAST_FULL_YEAR } from "./lib/cases.js";
import { EVENTS, EVENT_BY_ID, KINDS } from "./lib/events.js";
import { clamp, formatP, formatPlace, round2, signed } from "./lib/format.js";
import { cellContains, nearestPlace } from "./lib/geo.js";
import { intensity, mixHex, prepareLapse } from "./lib/lapse.js";
import {
  INTERESTS,
  MAX_PLACES,
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
import { DEFAULT_EXPLORE_TAB, EXPLORE_TABS, flipDirection, hashFromRoute, historyMode, routeFromHash } from "./lib/route.js";
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

const PAGE_NAMES = { main: "Main dashboard", explore: "Explore" };

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

function scanCells(data) {
  const units = data.variable.units;
  const ok = data.cells.filter((c) => c.ok);
  const maxAbs = Math.max(...ok.map((c) => Math.abs(c.slope_per_decade)), 1e-9);
  return data.cells.map((c) => {
    const place = formatPlace(c.lat, c.lon);
    if (!c.ok) {
      return { lat: c.lat, lon: c.lon, fill: COLORS.failed, alpha: 0.16, stroke: "rgba(160,170,200,0.5)", strokeWidth: 1, dash: [3, 3], tip: `${place} · not analyzed` };
    }
    const color = c.slope_per_decade >= 0 ? COLORS.up : COLORS.down;
    const strength = Math.abs(c.slope_per_decade) / maxAbs;
    const status = c.significant_fdr ? "holds up after correction" : c.significant ? "significant, not after correction" : "no clear trend";
    return {
      lat: c.lat,
      lon: c.lon,
      fill: c.significant ? color : COLORS.flat,
      alpha: c.significant ? 0.26 + 0.5 * strength : 0.14,
      stroke: c.significant ? color : "rgba(150,165,205,0.4)",
      strokeWidth: c.significant_fdr ? 2.2 : 1,
      dash: c.significant && !c.significant_fdr ? [4, 3] : null,
      tip: `${place} · ${signed(c.slope_per_decade)} ${units}/decade · p ${formatP(c.p_value)} · ${status}`,
    };
  });
}

/** One dot per place in the world survey: color = direction, ring = survives correction, size = signal vs noise. */
function worldDots(data) {
  const units = data.variable.units;
  return data.places.map((p) => {
    if (!p.ok) {
      return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, color: COLORS.failed, r: 3.5, ring: false, failed: true, tip: `${p.name} · not measurable here` };
    }
    const color = p.significant ? (p.slope_per_decade >= 0 ? COLORS.up : COLORS.down) : COLORS.flat;
    const status = p.significant_fdr ? "holds up after correction" : p.significant ? "significant, not after correction" : "no clear trend";
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      color,
      r: 4 + Math.min(5, Math.abs(p.signal_to_noise ?? 0) * 1.6),
      ring: p.significant_fdr,
      sign: p.significant ? (p.slope_per_decade >= 0 ? "up" : "down") : undefined,
      failed: false,
      tip: `${p.name} · ${signed(p.slope_per_decade)} ${units}/decade · ${status}`,
    };
  });
}

/** Time-lapse: each dot fades from grey toward red (above the site's own average) or blue (below) for the chosen year. */
function lapseDots(data, prepared, year) {
  const units = data.variable.units;
  return data.places.map((p) => {
    const base = { id: p.id, name: p.name, lat: p.lat, lon: p.lon, ring: false };
    if (!p.ok) return { ...base, color: COLORS.failed, r: 3.5, failed: true, tip: `${p.name} · not measurable here` };
    const a = prepared.at(p.id, year);
    if (a == null) return { ...base, color: COLORS.failed, r: 3, tip: `${p.name} · no value for ${year}` };
    const k = intensity(a, prepared.scale);
    return {
      ...base,
      color: mixHex(COLORS.flat, a >= 0 ? COLORS.up : COLORS.down, k),
      r: 4 + 5 * k,
      sign: a > 0 ? "up" : a < 0 ? "down" : undefined,
      tip: `${p.name} · ${year}: ${signed(a, 3)} ${units} vs its own average`,
    };
  });
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
    tip: `${p.name} · archetype ${p.cluster + 1} · twins: ${p.twins.map((t) => t.name).join(", ")}`,
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

/** Sign-in and the two onboarding questions, inside one centred frame. The dashboard is not rendered behind it. */
function Welcome({ store, places, placesStatus }) {
  const { profile } = store;
  const stage = stageOf(profile);
  const [about, setAbout] = useState(false);
  return (
    <div className="welcome">
      <Starfield accentRgb={PALETTE.accentRgb} />
      <div className="welcome-limb" aria-hidden="true" />
      <StorageNotice status={store.status} migrated={false} onDismiss={store.dismissNotice} />
      <main className="welcome-main">
        <header className="welcome-brand">
          <Brand as="h1" />
        </header>
        <div className={`welcome-card card${stage === "onboarding" ? " wide" : ""}`}>
          <div key={stage} className="card-swap">
            {stage === "signin" ? (
              <SignIn onSignIn={(email) => store.update((p) => withAccount(p, email))} />
            ) : (
              <Onboarding
                profile={profile}
                places={places}
                placesStatus={placesStatus}
                onFinish={(draft) => store.update({ ...draft, onboarding: "done" })}
                onSkip={(draft) => store.update({ ...draft, onboarding: "skipped" })}
              />
            )}
          </div>
        </div>
      </main>
      <footer className="welcome-foot faint small">
        Independent project, not endorsed by NASA. · <button type="button" className="linklike" onClick={() => setAbout(true)}>About</button>
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
  const tab = page === "main" ? "investigate" : exploreTab;
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
  const tablet = useMedia(TABLET_QUERY);
  const mobile = useMedia(MOBILE_QUERY);
  const reducedMotion = useMedia(REDUCED_QUERY) || profile.prefs.reduceMotion;
  const askExplainer = useCallback((request) => setExplainer({ started: true, open: true, request: request ? { ...request, nonce: Date.now() } : null }), []);
  const explainTerm = useCallback((id) => askExplainer({ id }), [askExplainer]);
  const view = viewPref ?? defaultView(profile);

  const controllers = useRef({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const paramsRef = useRef(params);
  paramsRef.current = params;
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
    const next = { page, tab, params, pinB };
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
  }, [page, tab, params, pinB]);

  useEffect(() => {
    const onPop = () => {
      const r = routeFromHash(window.location.hash);
      const kept = r.params ?? paramsRef.current; // a page without a place in its URL keeps the current place
      routeRef.current = { ...r, params: kept, pinB: r.tab === "duel" ? r.pinB : null };
      setPage((prev) => {
        if (prev !== r.page) setFlip(flipDirection(prev, r.page));
        return r.page;
      });
      if (r.page === "explore") setExploreTab(r.tab);
      if (r.params) {
        setParams(r.params);
        setDraft((d) => ({ ...d, ...toDraftPatch(r.params) }));
      }
      if (r.tab === "duel") setPinB(r.pinB);
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

  const run = useCallback(async (kind, key, setter, call) => {
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    setter({ ...EMPTY, key, loading: true });
    try {
      const data = await call(controller.signal);
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
    (p) => run("trend", keys.trend(p), setTrend, (s) => fetchTrend({ variable: p.variable, lat: p.lat, lon: p.lon, start_year: p.start, end_year: p.end }, s)),
    [run],
  );
  // A stale-signature refetch inside the Why panel hands back the fresh trend for the same case; the key is unchanged.
  const onTrendRefreshed = useCallback((fresh) => fresh && setTrend((s) => (s.data ? { ...s, data: fresh } : s)), []);
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
    if (tab === "sweep" && sweep.key !== keys.sweep(params)) runSweep(params);
    if (tab === "duel" && pinB && duel.key !== keys.duel(params, pinB)) runDuel(params, pinB);
  }, [page, tab, params, pinB, worldParams, vitalsYears, worldMode, archK]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "scan" && autoScan.current && params) {
      autoScan.current = false;
      runScan();
    }
  }, [tab, params, runScan]);

  useEffect(() => {
    if (tab === "duel" && !pinB) setPickTarget("B");
    if (tab !== "duel") setPickTarget("A");
  }, [tab, pinB]);

  // On narrow screens the Explore results sit below the globe: bring them into view.
  useEffect(() => {
    if (page === "explore" && window.innerWidth <= 1000 && (trend.data || sweep.data || grid.data || duel.data || world.data || vitals.data || archetypes.data)) {
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }, [trend.data, sweep.data, grid.data, duel.data, world.data, vitals.data, archetypes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((patch, opts = {}) => {
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
  }, []);

  const gridFresh = tab === "scan" && !!grid.data && !!params && grid.key === keys.grid(params, scanCfg);
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
    if (tab === "duel" && pickTarget === "B") {
      setPinB({ lat: la, lon: lo });
      return;
    }
    commit({ lat: la, lon: lo });
    if (tab === "duel" && !pinB) setPickTarget("B");
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
    else if (tab === "duel" && pinB) runDuel(parsed.value, pinB);
  };

  const choosePlace = (place) => {
    setActiveCase(null);
    setSelectedCell(null);
    if (tab === "duel" && pickTarget === "B") setPinB({ lat: place.lat, lon: place.lon });
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
  const saveActivePlace = () => activePlace && update((p) => addPlace(p, activePlace));

  const swapPlaces = () => {
    if (!pinB || !params) return;
    const a = { lat: params.lat, lon: params.lon };
    commit({ lat: pinB.lat, lon: pinB.lon }, { fly: false });
    setPinB(a);
  };

  const retry = () => {
    if (tab === "world") return worldMode === "archetypes" ? runArchetypes(vitalsYears, archK) : runWorld(worldParams);
    if (tab === "vitals") return runVitals(vitalsYears);
    if (tab === "ledger") return runLedger(vitalsYears);
    if (!params) return undefined;
    if (tab === "investigate") return runTrend(params);
    if (tab === "sweep") return runSweep(params);
    if (tab === "duel" && pinB) return runDuel(params, pinB);
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
  const mainGlobeProps = {
    pins: pinsFor(false),
    dots: savedDots,
    onDotPick: (d) => d.place && selectPlace(d.place),
    focus,
    busy: trend.loading,
    idleSpin: !params && !reducedMotion,
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
      <div className="main-page">
        <h1 className="sr-only" tabIndex={-1} ref={page === "main" ? headingRef : undefined}>Main dashboard</h1>

        {/* Tablet summary strip: the whole strip opens the dashboard drawer. */}
        <button type="button" className="summary-strip" onClick={() => setDashOpen(true)} aria-expanded={dashOpen} aria-controls="dashboard">
          <span className="summary-open mono">☰ Dashboard</span>
          <span className="summary-text">
            {activePlace ? activePlace.name : "No place chosen"} · {variableInfo?.label ?? variableId}
            {verdictText && <> · <b>{verdictText}</b></>}
          </span>
        </button>

        {/* Mobile place bar: native pickers for place and variable. */}
        <div className="place-bar">
          <label className="sr-only" htmlFor="pb-place">Place</label>
          <select
            id="pb-place"
            value={activePlace?.saved ? activePlace.id : activePlace ? "__here" : ""}
            onChange={(e) => {
              const p = profile.places.find((x) => x.id === e.target.value);
              if (p) selectPlace(p);
            }}
          >
            {!activePlace && <option value="">Choose a place</option>}
            {activePlace && !activePlace.saved && <option value="__here">{activePlace.name} (not saved)</option>}
            {profile.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="pb-var">Variable</label>
          <select id="pb-var" value={variableId} onChange={(e) => chooseVariable(e.target.value)} disabled={!variables.length}>
            {(profile.interests.length ? profile.interests : INTERESTS.map((i) => i.id)).map((tid) => (
              <optgroup key={tid} label={interestById(tid).label}>
                {variablesFor(tid, variables).map((v) => <option key={`${tid}-${v.id}`} value={v.id}>{v.label}</option>)}
              </optgroup>
            ))}
            {!variables.some((v) => v.id === variableId) && <option value={variableId}>{variableId}</option>}
          </select>
        </div>

        <Dashboard
          drawerMode={tablet}
          open={dashOpen}
          onClose={() => setDashOpen(false)}
          header={
            <>
              <PlaceSwitcher
                places={profile.places}
                place={activePlace}
                onPlace={selectPlace}
                onSave={saveActivePlace}
                canSave={profile.places.length < MAX_PLACES}
                onAdd={() => openDrawer({ id: "account", title: "Account" })}
              />
              <DataPicker
                interests={profile.interests}
                variables={variables}
                variablesStatus={variablesStatus}
                dataType={dataType}
                variableId={variableId}
                onDataType={chooseDataType}
                onVariable={chooseVariable}
              />
            </>
          }
          footer={
            <>
              <button type="button" className="linklike" onClick={() => setModal("about")}>Sources &amp; credits</button>
              <button type="button" className="linklike" onClick={() => goPage("explore")}>Open Explore ▸</button>
            </>
          }
        >
          <Slot name="verdict" index={1}>
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
          </Slot>
          <Slot name="weather" index={2}><WeatherSlot {...layerProps} /></Slot>
          <Slot name="forecast" index={3}><ForecastSlot {...layerProps} /></Slot>
          <Slot name="news" index={4}><NewsSlot {...layerProps} /></Slot>
        </Dashboard>

        <div className="main-stage">
          <MainStage {...layerProps} globeProps={mainGlobeProps} overlay={null} />
        </div>
      </div>
    </MainLayersProvider>
  );

  const onTabKey = (e) => {
    const ids = EXPLORE_TABS.map((t) => t.id);
    const i = ids.indexOf(exploreTab);
    let next = null;
    if (e.key === "ArrowRight") next = ids[(i + 1) % ids.length];
    if (e.key === "ArrowLeft") next = ids[(i - 1 + ids.length) % ids.length];
    if (e.key === "Home") next = ids[0];
    if (e.key === "End") next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    goTool(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  const explorePage = (
    <div className="explore-page">
      <header className="explore-head">
        <h1 tabIndex={-1} ref={page === "explore" ? headingRef : undefined}>Explore</h1>
        <p className="dim">Advanced tools for digging deeper</p>
      </header>
      <div className="explore-tabs-wrap">
        <div className="explore-tabs" role="tablist" aria-label="Explore tools" onKeyDown={onTabKey}>
          {EXPLORE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={exploreTab === t.id}
              aria-controls="panel"
              tabIndex={exploreTab === t.id ? 0 : -1}
              className={`tab${t.divider ? " tab-divided" : ""}`}
              onClick={() => goTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stage">
        <div className="globe-col">
          <Globe
            pins={pinsFor(tab === "duel")}
            cells={cells}
            cellHalf={cellHalf}
            selectedCell={selectedCell}
            dots={exploreDots}
            onDotPick={(d) => (d.event ? openEvent(d.event) : openPlace(d))}
            focus={focus}
            modeRequest={modeRequest}
            busy={busy}
            idleSpin={!params && tab === "world" && !reducedMotion}
            onPick={handlePick}
          >
            {cells.length > 0 && (
              <ul className="globe-legend mono" aria-label="Map key">
                <li><i style={{ background: COLORS.up }} /> significant rise</li>
                <li><i style={{ background: COLORS.down }} /> significant fall</li>
                <li><i style={{ background: COLORS.flat }} /> no clear trend</li>
                <li className="faint">solid outline = holds after correction</li>
              </ul>
            )}
            {worldFresh && lapse.on && <div className="lapse-year" aria-live="polite">{lapse.year}</div>}
            {cells.length === 0 && (worldFresh || archFresh) && <GlobeLegend sampleSites />}
            {cells.length === 0 && worldFresh && lapse.on && (
              <ul className="globe-legend mono" aria-label="Map key">
                <li><i className="round" style={{ background: COLORS.up }} /> above the site's own average</li>
                <li><i className="round" style={{ background: COLORS.down }} /> below it</li>
                <li><i className="round" style={{ background: COLORS.flat }} /> near it · stronger colour = more unusual</li>
              </ul>
            )}
            {cells.length === 0 && worldFresh && !lapse.on && exploreDots.length > 0 && (
              <ul className="globe-legend mono" aria-label="Map key">
                <li><i className="round" style={{ background: COLORS.up }} /> rising</li>
                <li><i className="round" style={{ background: COLORS.down }} /> falling</li>
                <li><i className="round" style={{ background: COLORS.flat }} /> no clear trend</li>
                <li className="faint">ringed = holds after correction · size = signal vs noise</li>
              </ul>
            )}
            {cells.length === 0 && archFresh && (
              <ul className="globe-legend mono" aria-label="Map key">
                {archetypes.data.clusters.map((c) => (
                  <li key={c.id}><i className="round" style={{ background: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length] }} /> archetype {c.id + 1} · {c.size} places</li>
                ))}
                <li className="faint">hover a dot for its climate twins</li>
              </ul>
            )}
          </Globe>
        </div>

        <div className="console" ref={resultsRef}>
          {tab !== "learn" && (
            <SetupPanel
              variables={variables}
              places={places}
              draft={draft}
              onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onVariable={chooseVariable}
              onApply={applyDraft}
              onPlace={choosePlace}
              onAsk={openAsk}
              disabled={busy || variables.length === 0}
              message={formMsg}
            />
          )}

          {activeCase && briefingTab && tab !== "learn" && <Briefing key={activeCase.id} item={activeCase} onClose={() => setActiveCase(null)} />}

          <ExplorePanel
            tab={tab}
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
            ledger={{ r: ledger, onOpen: openLedgerRow }}
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
          <Starfield accentRgb={PALETTE.accentRgb} />
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

          <TopBar page={page} onPage={goPage} accountLabel={profile.account?.label} accountOpen={drawer?.id === "account"} onAccount={openAccount} />
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

