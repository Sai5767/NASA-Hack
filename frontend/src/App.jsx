import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArchetypes, fetchDuel, fetchGrid, fetchPlaces, fetchSweep, fetchTrend, fetchVariables, fetchVitals, fetchWorld } from "./api.js";
import Archetypes, { CLUSTER_COLORS } from "./components/Archetypes.jsx";
import Boot from "./components/Boot.jsx";
import Briefing from "./components/Briefing.jsx";
import CaseFile from "./components/CaseFile.jsx";
import { AboutDialog, CasesDialog, GlossaryDialog } from "./components/Dialogs.jsx";
import Duel from "./components/Duel.jsx";
import { ExplainContext } from "./components/ExplainContext.js";
import Explainer from "./components/Explainer.jsx";
import ForYou from "./components/ForYou.jsx";
import Globe from "./components/Globe.jsx";
import Home from "./components/Home.jsx";
import IntakeWizard from "./components/Intake.jsx";
import Loading from "./components/Loading.jsx";
import Scan from "./components/Scan.jsx";
import SetupPanel from "./components/SetupPanel.jsx";
import Starfield from "./components/Starfield.jsx";
import Sweep from "./components/Sweep.jsx";
import Vitals from "./components/Vitals.jsx";
import World from "./components/World.jsx";
import { useStoredState } from "./hooks.js";
import { CASES, FIRST_YEAR, LAST_FULL_YEAR, SURPRISES } from "./lib/cases.js";
import { clamp, formatP, formatPlace, round2, signed } from "./lib/format.js";
import { cellContains, nearestPlace } from "./lib/geo.js";
import { DEFAULT_PROFILE, addWatch, defaultView, hasWatch, removeWatch, suggest, toggleWatch } from "./lib/profile.js";
import { decodeState, encodeState } from "./lib/share.js";

const COLORS = { up: "#ff6a5c", down: "#4da6ff", flat: "#8794b8", failed: "#5f6a8a", a: "#4dffd9", b: "#ff6bd5" };
const EMPTY = { data: null, key: "", loading: false, error: "" };
const MAX_YEAR = new Date().getFullYear();

const SWEEP_STEPS = ["Pulling 19 variables in one request…", "Removing the seasonal cycle from each…", "Running trend tests on all of them…", "Ranking by strength of evidence…"];
const SCAN_STEPS = ["Contacting NASA POWER…", "Analyzing each place on the grid…", "Applying false-discovery control…", "Measuring the spatial pattern…"];
const DUEL_STEPS = ["Fetching both places…", "Fitting both trends…", "Testing whether the rates differ…"];
const WORLD_STEPS = ["Asking NASA POWER about sample places around the world…", "Fitting a trend at each one…", "Applying false-discovery control…", "Placing the dots…"];
const ARCH_STEPS = ["Fetching every variable at each sample place…", "Measuring each variable's change against its normal swings…", "Clustering similar fingerprints…", "Testing whether the groups are stable…"];
const VITALS_STEPS = ["Reading NASA GISTEMP…", "Reading NOAA CO₂ and NSIDC sea ice…", "Testing each vital sign…", "Checking the climate rhythms…"];

const keys = {
  trend: (p) => [p.variable, p.lat, p.lon, p.start, p.end].join("|"),
  sweep: (p) => [p.lat, p.lon, p.start, p.end].join("|"),
  grid: (p, c) => [p.variable, p.lat, p.lon, p.start, p.end, c.size, c.n].join("|"),
  duel: (p, b) => [p.variable, p.lat, p.lon, b.lat, b.lon, p.start, p.end].join("|"),
  world: (w) => [w.variable, w.start, w.end].join("|"),
  vitals: (y) => [y.start, y.end].join("|"),
  archetypes: (y, k) => [y.start, y.end, k ?? "best"].join("|"),
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
      return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, color: COLORS.failed, r: 3.5, ring: false, tip: `${p.name} · not measurable here` };
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
      tip: `${p.name} · ${signed(p.slope_per_decade)} ${units}/decade · ${status}`,
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

function seenBoot() {
  try {
    return sessionStorage.getItem("td-boot") === "1";
  } catch {
    return false;
  }
}

function PinPrompt({ label }) {
  return (
    <div className="card hud-card prompt reveal">
      <p className="eyebrow">{label}</p>
      <h2>Drop a pin first</h2>
      <p className="dim">Click anywhere on the globe, type a place above, or choose a quick place in the setup panel.</p>
    </div>
  );
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="card error-card reveal" role="alert">
      <p className="eyebrow">The investigation hit a snag</p>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export default function App() {
  const initial = useMemo(() => decodeState(window.location.hash), []);
  const [booting, setBooting] = useState(() => !initial && !seenBoot() && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [variables, setVariables] = useState([]);
  const [places, setPlaces] = useState([]);
  const [tab, setTab] = useState(initial?.tab ?? "investigate");
  const [draft, setDraft] = useState(() => ({
    variable: "T2M",
    lat: "",
    lon: "",
    start: String(FIRST_YEAR),
    end: String(LAST_FULL_YEAR),
    ...(initial?.params ? toDraftPatch(initial.params) : {}),
  }));
  const [params, setParams] = useState(initial?.params ?? null);
  const [pinB, setPinB] = useState(initial?.pinB ?? null);
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
  const [storedProfile, setProfile] = useStoredState("td-profile", DEFAULT_PROFILE);
  const [watch, setWatch] = useStoredState("td-watch", []);
  const [viewPref, setViewPref] = useStoredState("td-view", null);
  const [detailFocus, setDetailFocus] = useState(null);
  const [forYouOpen, setForYouOpen] = useState(true);
  const [explainer, setExplainer] = useState({ started: false, open: false, request: null });
  const askExplainer = useCallback((request) => setExplainer({ started: true, open: true, request: request ? { ...request, nonce: Date.now() } : null }), []);
  const explainTerm = useCallback((id) => askExplainer({ id }), [askExplainer]);
  const profile = useMemo(() => ({ ...DEFAULT_PROFILE, ...storedProfile }), [storedProfile]);
  const view = viewPref ?? defaultView(profile);
  const home = tab === "investigate" && !params;
  const forYouItems = useMemo(() => suggest(profile, { limit: 3 }), [profile]);

  const controllers = useRef({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const autoScan = useRef(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    fetchVariables().then(setVariables).catch((e) => setTrend({ ...EMPTY, error: e.message }));
    fetchPlaces().then(setPlaces).catch(() => setPlaces([]));
    if (initial?.params) setFocus({ lat: initial.params.lat, lon: initial.params.lon, k: 1.8, nonce: 1 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL in step with the question so a copied link reopens the same case.
  useEffect(() => {
    try {
      const hash = params || tab !== "investigate" ? encodeState({ tab, params, pinB: tab === "duel" ? pinB : null }) : "";
      window.history.replaceState(null, "", window.location.pathname + window.location.search + (hash ? `#${hash}` : ""));
    } catch {
      /* the URL is only a convenience */
    }
  }, [tab, params, pinB]);

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

  const runTrend = useCallback(
    (p) => run("trend", keys.trend(p), setTrend, (s) => fetchTrend({ variable: p.variable, lat: p.lat, lon: p.lon, start_year: p.start, end_year: p.end }, s)),
    [run],
  );
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

  // Run whichever analysis the open tab needs when the question changes.
  useEffect(() => {
    if (tab === "world" && worldMode === "survey" && world.key !== keys.world(worldParams)) runWorld(worldParams);
    if (tab === "world" && worldMode === "archetypes" && archetypes.key !== keys.archetypes(vitalsYears, archK)) runArchetypes(vitalsYears, archK);
    if (tab === "vitals" && vitals.key !== keys.vitals(vitalsYears)) runVitals(vitalsYears);
    if (!params) return;
    if (tab === "investigate" && trend.key !== keys.trend(params)) runTrend(params);
    if (tab === "sweep" && sweep.key !== keys.sweep(params)) runSweep(params);
    if (tab === "duel" && pinB && duel.key !== keys.duel(params, pinB)) runDuel(params, pinB);
  }, [tab, params, pinB, worldParams, vitalsYears, worldMode, archK]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // On narrow screens the results sit below the globe: bring them into view.
  useEffect(() => {
    if (window.innerWidth <= 1000 && (trend.data || sweep.data || grid.data || duel.data || world.data || vitals.data || archetypes.data)) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [trend.data, sweep.data, grid.data, duel.data, world.data, vitals.data, archetypes.data]);

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
  const worldFresh = tab === "world" && worldMode === "survey" && !!world.data && world.key === keys.world(worldParams);
  const archFresh =
    tab === "world" && worldMode === "archetypes" && !!archetypes.data?.ok && archetypes.key === keys.archetypes(vitalsYears, archK);
  const watchDots = useMemo(
    () =>
      home
        ? watch.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lon: w.lon, color: COLORS.a, r: 6, ring: true, tip: `${w.name} · on your watchlist`, watch: w }))
        : [],
    [home, watch],
  );
  const dots = useMemo(() => {
    if (worldFresh) return worldDots(world.data);
    if (archFresh) return archetypeDots(archetypes.data);
    return watchDots;
  }, [worldFresh, archFresh, world.data, archetypes.data, watchDots]);

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

  const openPlace = (place) => {
    setActiveCase(null);
    setSelectedCell(null);
    commit({ variable: worldParams.variable, lat: round2(place.lat), lon: round2(place.lon) });
    setTab("investigate");
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

  const chooseVariable = (id) => {
    setDraft((d) => ({ ...d, variable: id }));
    if (params) commit({ variable: id }, { fly: false });
  };

  const choosePlace = (place) => {
    setActiveCase(null);
    setSelectedCell(null);
    if (tab === "duel" && pickTarget === "B") setPinB({ lat: place.lat, lon: place.lon });
    else commit({ lat: place.lat, lon: place.lon });
  };

  const openVariable = (id) => {
    commit({ variable: id }, { fly: false });
    setTab("investigate");
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
    setTab(c.tab);
  };

  const openIntake = ({ variable, lat, lon, own }) => {
    setModal(null);
    setActiveCase(null);
    setTab("investigate");
    if (own) {
      setDraft((d) => ({ ...d, variable }));
      if (params) commit({ variable }, { fly: false });
      return;
    }
    commit({ variable, lat, lon });
    setFormMsg("");
  };

  const openAsk = (s) => {
    if (s.type === "place") openIntake({ variable: s.variable, lat: s.place.lat, lon: s.place.lon });
    else chooseVariable(s.variable);
  };

  const openWatch = (w) => {
    setActiveCase(null);
    setSelectedCell(null);
    commit({ variable: w.variable, lat: w.lat, lon: w.lon });
    setTab("investigate");
  };

  const placeNameFor = (lat, lon) => nearestPlace(places, lat, lon, 250)?.name ?? formatPlace(lat, lon);
  const watchItem = params ? { variable: params.variable, lat: params.lat, lon: params.lon, name: placeNameFor(params.lat, params.lon) } : null;
  const watched = !!watchItem && hasWatch(watch, watchItem);
  const toggleCurrentWatch = () => watchItem && setWatch((list) => toggleWatch(list, watchItem));

  const openSuggestion = (s) => {
    if (s.kind === "case") openCase(s.case);
    else openIntake(s.open);
  };

  const surprise = () => {
    const pick = SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
    openIntake({ variable: pick.variable, lat: pick.lat, lon: pick.lon });
  };

  /** Save the answers, seed the watchlist from them, then do what the user said they wanted to do first. */
  const finishIntake = (answers) => {
    const next = { ...answers, done: true };
    setProfile(next);
    setViewPref(null); // let the chosen level of detail decide the starting view again
    setForYouOpen(true);
    const picks = suggest(next, { limit: 6 });
    setWatch((list) => (list.length ? list : picks.filter((s) => s.kind === "place").slice(0, 3).reverse().reduce((acc, s) => addWatch(acc, s.open), [])));
    setModal(null);
    if (next.goal === "check") {
      setTimeout(() => document.getElementById("ask-input")?.focus(), 150);
      return;
    }
    if (next.goal === "learn") {
      setModal("glossary");
      return;
    }
    const wanted = next.goal === "compare" ? CASES.find((c) => c.tab === "duel") : next.goal === "forecast" ? CASES.find((c) => c.id === "forecast") : null;
    if (wanted) {
      openCase(wanted);
      if (next.goal === "forecast") {
        setViewPref("detail");
        setDetailFocus({ id: "forecast", nonce: Date.now() });
      }
      return;
    }
    if (picks[0]) openSuggestion(picks[0]);
  };

  const swapPlaces = () => {
    if (!pinB || !params) return;
    const a = { lat: params.lat, lon: params.lon };
    commit({ lat: pinB.lat, lon: pinB.lon }, { fly: false });
    setPinB(a);
  };

  const retry = () => {
    if (tab === "world") return worldMode === "archetypes" ? runArchetypes(vitalsYears, archK) : runWorld(worldParams);
    if (tab === "vitals") return runVitals(vitalsYears);
    if (!params) return undefined;
    if (tab === "investigate") return runTrend(params);
    if (tab === "sweep") return runSweep(params);
    if (tab === "duel" && pinB) return runDuel(params, pinB);
    return undefined;
  };

  const pins = [
    ...(params ? [{ lat: params.lat, lon: params.lon, color: COLORS.a, label: "A" }] : []),
    ...(tab === "duel" && pinB ? [{ lat: pinB.lat, lon: pinB.lon, color: COLORS.b, label: "B", phase: 0.5 }] : []),
  ];
  const busy = trend.loading || sweep.loading || grid.loading || duel.loading || world.loading || vitals.loading || archetypes.loading;
  const scanStale = !!params && !!grid.data && grid.key !== keys.grid(params, scanCfg);
  const briefingTab = activeCase?.tab;
  // Essentials are the challenge's required trio: one variable over time at a place, every variable at a place, a region.
  const tabs = [
    { id: "investigate", label: "Case file", hint: "one place", core: true },
    { id: "sweep", label: "Sweep", hint: "all variables", core: true },
    { id: "scan", label: "Scan", hint: "a region", core: true },
    { id: "duel", label: "Duel", hint: "two places" },
    { id: "world", label: "World", hint: places.length ? `${places.length} sites` : "sample sites" },
    { id: "vitals", label: "Vitals", hint: "the planet" },
  ];
  const renderTab = (t) => (
    <button
      key={t.id}
      type="button"
      role="tab"
      id={`tab-${t.id}`}
      aria-selected={tab === t.id}
      aria-controls="panel"
      className="tab"
      onClick={() => { setTab(t.id); setSelectedCell(null); }}
    >
      <b>{t.label}</b>
      <small>{t.hint}</small>
    </button>
  );

  const explainData = tab === "investigate" && params && trend.data && trend.key === keys.trend(params) ? trend.data : null;

  return (
    <ExplainContext.Provider value={explainTerm}>
    <div className="app">
      <Starfield />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
        <defs>
          <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.7" />
          </filter>
        </defs>
      </svg>

      {booting && <Boot onDone={() => { try { sessionStorage.setItem("td-boot", "1"); } catch { /* storage unavailable */ } setBooting(false); }} />}

      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="22" cy="22" r="15" fill="none" stroke="#4dffd9" strokeWidth="2.4" />
            <path d="M11 28 L17 22 L22 25 L32 14" fill="none" stroke="#4dffd9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="33" y1="33" x2="44" y2="44" stroke="#4dffd9" strokeWidth="3.4" strokeLinecap="round" />
          </svg>
          <div>
            <h1>Trend <span>Detective</span></h1>
            <p>EARTH SYSTEM CASE FILES · NASA, NOAA &amp; NSIDC DATA</p>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <button type="button" className="btn btn-sm" onClick={() => setModal("intake")}>✦ Personalise</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("cases")}>Case files</button>
          <button type="button" className="btn btn-sm" onClick={() => askExplainer(null)}>? Explain</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("glossary")}>Glossary</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("about")}>About</button>
        </nav>
      </header>

      <main className={`stage${home ? " home" : ""}`}>
        <div className="globe-col">
          <Globe
            pins={pins}
            cells={cells}
            cellHalf={cellHalf}
            selectedCell={selectedCell}
            dots={dots}
            onDotPick={(d) => (d.watch ? openWatch(d.watch) : openPlace(d))}
            focus={focus}
            modeRequest={modeRequest}
            busy={busy}
            idleSpin={!params}
            onPick={handlePick}
          >
            {home && forYouOpen && forYouItems.length > 0 && (
              <ForYou items={forYouItems} personal={profile.done} onOpen={openSuggestion} onClose={() => setForYouOpen(false)} />
            )}
            {cells.length > 0 && (
              <ul className="globe-legend mono" aria-label="Map key">
                <li><i style={{ background: COLORS.up }} /> significant rise</li>
                <li><i style={{ background: COLORS.down }} /> significant fall</li>
                <li><i style={{ background: COLORS.flat }} /> no clear trend</li>
                <li className="faint">solid outline = holds after correction</li>
              </ul>
            )}
            {cells.length === 0 && worldFresh && dots.length > 0 && (
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
          <div className="tab-groups">
            <div className="tab-group">
              <span className="tab-group-label">Essentials</span>
              <div className="tabs" role="tablist" aria-label="Essential investigations">{tabs.filter((t) => t.core).map(renderTab)}</div>
            </div>
            <div className="tab-group">
              <span className="tab-group-label">Explore more</span>
              <div className="tabs more" role="tablist" aria-label="More ways to investigate">{tabs.filter((t) => !t.core).map(renderTab)}</div>
            </div>
          </div>

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

          {activeCase && briefingTab && <Briefing key={activeCase.id} item={activeCase} onClose={() => setActiveCase(null)} />}

          <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-stack">
            {tab === "investigate" &&
              (!params ? (
                trend.error ? (
                  <ErrorCard message={trend.error} />
                ) : (
                  <Home
                    placeCount={places.length}
                    profile={profile}
                    watch={watch}
                    variables={variables}
                    onCases={() => setModal("cases")}
                    onIntake={() => setModal("intake")}
                    onOpenWatch={openWatch}
                    onRemoveWatch={(id) => setWatch((list) => removeWatch(list, id))}
                  />
                )
              ) : trend.loading ? (
                <Loading title="Investigating" />
              ) : trend.error ? (
                <ErrorCard message={trend.error} onRetry={retry} />
              ) : trend.data ? (
                <CaseFile
                  key={trend.key}
                  data={trend.data}
                  view={view}
                  onView={setViewPref}
                  onGo={(t) => { setTab(t); setSelectedCell(null); }}
                  watched={watched}
                  onToggleWatch={toggleCurrentWatch}
                  focusSection={detailFocus}
                />
              ) : null)}

            {tab === "sweep" &&
              (!params ? (
                <PinPrompt label="Sweep" />
              ) : sweep.loading ? (
                <Loading title="Sweeping every variable" steps={SWEEP_STEPS} />
              ) : sweep.error ? (
                <ErrorCard message={sweep.error} onRetry={retry} />
              ) : sweep.data ? (
                <Sweep key={sweep.key} data={sweep.data} selected={params.variable} onOpen={openVariable} />
              ) : null)}

            {tab === "scan" && (
              <>
                <Scan
                  cfg={scanCfg}
                  onCfg={setScanCfg}
                  onRun={runScan}
                  loading={grid.loading}
                  hasPin={!!params}
                  stale={scanStale}
                  data={grid.data}
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                  onOpenCell={(lat, lon) => { commit({ lat, lon }); setTab("investigate"); }}
                />
                {grid.loading && <Loading title="Scanning the region" steps={SCAN_STEPS} />}
                {grid.error && <ErrorCard message={grid.error} onRetry={runScan} />}
              </>
            )}

            {tab === "duel" && (
              <>
                <Duel
                  params={params}
                  pinB={pinB}
                  hasPin={!!params}
                  pickTarget={pickTarget}
                  onPickTarget={setPickTarget}
                  onPlaceB={(p) => setPinB({ lat: p.lat, lon: p.lon })}
                  onSwap={swapPlaces}
                  onRun={() => params && pinB && runDuel(params, pinB)}
                  data={duel.data && params && pinB && duel.key === keys.duel(params, pinB) ? duel.data : null}
                  loading={duel.loading}
                  caseNames={activeCase?.b ? { a: activeCase.a.name, b: activeCase.b.name } : null}
                />
                {duel.loading && <Loading title="Comparing two places" steps={DUEL_STEPS} />}
                {duel.error && <ErrorCard message={duel.error} onRetry={retry} />}
              </>
            )}

            {tab === "world" && (
              <>
                <div className="seg world-switch" role="group" aria-label="World view">
                  <button type="button" className={worldMode === "survey" ? "on" : ""} onClick={() => setWorldMode("survey")}>One variable</button>
                  <button type="button" className={worldMode === "archetypes" ? "on" : ""} onClick={() => setWorldMode("archetypes")}>All variables · archetypes</button>
                </div>
                {worldMode === "survey" &&
                  (world.loading ? (
                    <Loading title="Surveying the world" steps={WORLD_STEPS} />
                  ) : world.error ? (
                    <ErrorCard message={world.error} onRetry={retry} />
                  ) : world.data ? (
                    <World key={world.key} data={world.data} onOpen={openPlace} />
                  ) : null)}
                {worldMode === "archetypes" &&
                  (archetypes.loading ? (
                    <Loading title="Finding trend archetypes" steps={ARCH_STEPS} />
                  ) : archetypes.error ? (
                    <ErrorCard message={archetypes.error} onRetry={retry} />
                  ) : archetypes.data?.ok ? (
                    <Archetypes data={archetypes.data} onChooseK={setArchK} onOpen={openPlace} />
                  ) : archetypes.data ? (
                    <ErrorCard message={archetypes.data.message} />
                  ) : null)}
              </>
            )}

            {tab === "vitals" &&
              (vitals.loading ? (
                <Loading title="Reading the planet's vital signs" steps={VITALS_STEPS} />
              ) : vitals.error ? (
                <ErrorCard message={vitals.error} onRetry={retry} />
              ) : vitals.data ? (
                <Vitals key={vitals.key} data={vitals.data} />
              ) : null)}
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>
          Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program; NASA GISS GISTEMP;
          NOAA GML, CPC and NCEI; NSIDC Sea Ice Index. Independent project, not endorsed by NASA.{" "}
          <button type="button" onClick={() => setModal("about")}>About & credits</button>
        </p>
      </footer>

      {modal === "cases" && <CasesDialog variables={variables} onOpen={openCase} onClose={() => setModal(null)} />}
      {modal === "intake" && <IntakeWizard initial={profile} onFinish={finishIntake} onSurprise={surprise} onClose={() => setModal(null)} />}
      {modal === "glossary" && <GlossaryDialog onClose={() => setModal(null)} onExplain={(id) => { setModal(null); explainTerm(id); }} />}
      {modal === "about" && <AboutDialog onClose={() => setModal(null)} />}
      {explainer.started && (
        <Explainer request={explainer.request} data={explainData} open={explainer.open} onClose={() => setExplainer((s) => ({ ...s, open: false }))} />
      )}
    </div>
    </ExplainContext.Provider>
  );
}
