import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDuel, fetchGrid, fetchSweep, fetchTrend, fetchVariables } from "./api.js";
import Boot from "./components/Boot.jsx";
import Briefing from "./components/Briefing.jsx";
import CaseFile from "./components/CaseFile.jsx";
import { AboutDialog, CasesDialog, GlossaryDialog, IntakeDialog } from "./components/Dialogs.jsx";
import Duel from "./components/Duel.jsx";
import Globe from "./components/Globe.jsx";
import Loading from "./components/Loading.jsx";
import Scan from "./components/Scan.jsx";
import SetupPanel from "./components/SetupPanel.jsx";
import Starfield from "./components/Starfield.jsx";
import Sweep from "./components/Sweep.jsx";
import { FIRST_YEAR, LAST_FULL_YEAR } from "./lib/cases.js";
import { clamp, formatP, formatPlace, round2, signed } from "./lib/format.js";
import { cellContains } from "./lib/geo.js";

const TABS = [
  { id: "investigate", label: "Case file", hint: "one place" },
  { id: "sweep", label: "Sweep", hint: "all variables" },
  { id: "scan", label: "Scan", hint: "a region" },
  { id: "duel", label: "Duel", hint: "two places" },
];

const COLORS = { up: "#ff6a5c", down: "#4da6ff", flat: "#8794b8", failed: "#5f6a8a", a: "#4dffd9", b: "#ff6bd5" };
const EMPTY = { data: null, key: "", loading: false, error: "" };
const MAX_YEAR = new Date().getFullYear();

const SWEEP_STEPS = ["Pulling 19 variables in one request…", "Removing the seasonal cycle from each…", "Running trend tests on all of them…", "Ranking by strength of evidence…"];
const SCAN_STEPS = ["Contacting NASA POWER…", "Analyzing each place on the grid…", "Applying false-discovery control…", "Measuring the spatial pattern…"];
const DUEL_STEPS = ["Fetching both places…", "Fitting both trends…", "Testing whether the rates differ…"];

const keys = {
  trend: (p) => [p.variable, p.lat, p.lon, p.start, p.end].join("|"),
  sweep: (p) => [p.lat, p.lon, p.start, p.end].join("|"),
  grid: (p, c) => [p.variable, p.lat, p.lon, p.start, p.end, c.size, c.n].join("|"),
  duel: (p, b) => [p.variable, p.lat, p.lon, b.lat, b.lon, p.start, p.end].join("|"),
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

function seenBoot() {
  try {
    return sessionStorage.getItem("td-boot") === "1";
  } catch {
    return false;
  }
}

function Hero({ onCases, onIntake }) {
  return (
    <section className="card hud-card hero reveal">
      <p className="eyebrow">Earth system case files</p>
      <h2>
        Is it changing? <span>Where?</span> By how much? <span>Is it real?</span>
      </h2>
      <p className="dim">
        Pick any spot on Earth and a variable. Trend Detective gathers {LAST_FULL_YEAR - FIRST_YEAR + 1} years of NASA data, measures the
        change, and tells you how much to trust it.
      </p>
      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={onCases}>Open a case file ▸</button>
        <button type="button" className="btn" onClick={onIntake}>Guided intake</button>
      </div>
      <p className="faint small">…or click anywhere on the globe to drop a pin and start investigating.</p>
      <ul className="hero-stats mono">
        <li><b>19</b> Earth-system variables</li>
        <li><b>{LAST_FULL_YEAR - FIRST_YEAR + 1}</b> years of monthly data</li>
        <li><b>5</b> evidence checks</li>
        <li><b>4</b> ways to investigate</li>
      </ul>
    </section>
  );
}

function PinPrompt({ label }) {
  return (
    <div className="card hud-card prompt reveal">
      <p className="eyebrow">{label}</p>
      <h2>Drop a pin first</h2>
      <p className="dim">Click anywhere on the globe, or choose a quick place in the setup panel above.</p>
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
  const [booting, setBooting] = useState(() => !seenBoot() && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [variables, setVariables] = useState([]);
  const [tab, setTab] = useState("investigate");
  const [draft, setDraft] = useState({ variable: "T2M", lat: "", lon: "", start: String(FIRST_YEAR), end: String(LAST_FULL_YEAR) });
  const [params, setParams] = useState(null);
  const [pinB, setPinB] = useState(null);
  const [pickTarget, setPickTarget] = useState("A");
  const [scanCfg, setScanCfg] = useState({ size: 10, n: 4 });
  const [selectedCell, setSelectedCell] = useState(null);
  const [focus, setFocus] = useState(null);
  const [modal, setModal] = useState(null);
  const [activeCase, setActiveCase] = useState(null);
  const [formMsg, setFormMsg] = useState("");
  const [trend, setTrend] = useState(EMPTY);
  const [sweep, setSweep] = useState(EMPTY);
  const [grid, setGrid] = useState(EMPTY);
  const [duel, setDuel] = useState(EMPTY);

  const controllers = useRef({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const autoScan = useRef(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    fetchVariables().then(setVariables).catch((e) => setTrend({ ...EMPTY, error: e.message }));
  }, []);

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
    if (!params) return;
    if (tab === "investigate" && trend.key !== keys.trend(params)) runTrend(params);
    if (tab === "sweep" && sweep.key !== keys.sweep(params)) runSweep(params);
    if (tab === "duel" && pinB && duel.key !== keys.duel(params, pinB)) runDuel(params, pinB);
  }, [tab, params, pinB]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (window.innerWidth <= 1000 && (trend.data || sweep.data || grid.data || duel.data)) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [trend.data, sweep.data, grid.data, duel.data]);

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
    const p = { variable: c.variable, lat: c.a.lat, lon: c.a.lon, start: FIRST_YEAR, end: LAST_FULL_YEAR };
    setModal(null);
    setActiveCase(c);
    setParams(p);
    setDraft({ variable: p.variable, lat: p.lat.toFixed(2), lon: p.lon.toFixed(2), start: String(p.start), end: String(p.end) });
    setPinB(c.b ? { lat: c.b.lat, lon: c.b.lon } : null);
    setSelectedCell(null);
    setFormMsg("");
    if (c.scan) {
      setScanCfg(c.scan);
      autoScan.current = true;
    }
    setTab(c.tab);
    setFocus({ lat: p.lat, lon: p.lon, k: c.scan ? clamp(70 / c.scan.size, 1.2, 3.2) : 1.8, nonce: Date.now() });
  };

  const openIntake = ({ variable, lat, lon, name, own }) => {
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
    void name;
  };

  const swapPlaces = () => {
    if (!pinB || !params) return;
    const a = { lat: params.lat, lon: params.lon };
    commit({ lat: pinB.lat, lon: pinB.lon }, { fly: false });
    setPinB(a);
  };

  const retry = () => {
    if (!params) return;
    if (tab === "investigate") runTrend(params);
    else if (tab === "sweep") runSweep(params);
    else if (tab === "duel" && pinB) runDuel(params, pinB);
  };

  const pins = [
    ...(params ? [{ lat: params.lat, lon: params.lon, color: COLORS.a, label: "A" }] : []),
    ...(tab === "duel" && pinB ? [{ lat: pinB.lat, lon: pinB.lon, color: COLORS.b, label: "B", phase: 0.5 }] : []),
  ];
  const busy = trend.loading || sweep.loading || grid.loading || duel.loading;
  const scanStale = !!params && !!grid.data && grid.key !== keys.grid(params, scanCfg);
  const briefingTab = activeCase?.tab;

  return (
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
            <p>EARTH SYSTEM CASE FILES · NASA POWER DATA</p>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <button type="button" className="btn btn-sm" onClick={() => setModal("intake")}>✦ Guided intake</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("cases")}>Case files</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("glossary")}>Glossary</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal("about")}>About</button>
        </nav>
      </header>

      <main className="stage">
        <div className="globe-col">
          <Globe
            pins={pins}
            cells={cells}
            cellHalf={cellHalf}
            selectedCell={selectedCell}
            focus={focus}
            busy={busy}
            idleSpin={!params}
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
          </Globe>
        </div>

        <div className="console" ref={resultsRef}>
          <div className="tabs" role="tablist" aria-label="Investigation mode">
            {TABS.map((t) => (
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
            ))}
          </div>

          <SetupPanel
            variables={variables}
            draft={draft}
            onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onVariable={chooseVariable}
            onApply={applyDraft}
            onPlace={choosePlace}
            disabled={busy || variables.length === 0}
            message={formMsg}
          />

          {activeCase && briefingTab && <Briefing key={activeCase.id} item={activeCase} onClose={() => setActiveCase(null)} />}

          <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-stack">
            {tab === "investigate" &&
              (!params ? (
                trend.error ? <ErrorCard message={trend.error} /> : <Hero onCases={() => setModal("cases")} onIntake={() => setModal("intake")} />
              ) : trend.loading ? (
                <Loading title="Investigating" />
              ) : trend.error ? (
                <ErrorCard message={trend.error} onRetry={retry} />
              ) : trend.data ? (
                <CaseFile key={trend.key} data={trend.data} />
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
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>
          Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program. Independent
          project, not endorsed by NASA. <button type="button" onClick={() => setModal("about")}>About & credits</button>
        </p>
      </footer>

      {modal === "cases" && <CasesDialog variables={variables} onOpen={openCase} onClose={() => setModal(null)} />}
      {modal === "intake" && <IntakeDialog variables={variables} onOpen={openIntake} onClose={() => setModal(null)} />}
      {modal === "glossary" && <GlossaryDialog onClose={() => setModal(null)} />}
      {modal === "about" && <AboutDialog onClose={() => setModal(null)} />}
    </div>
  );
}
