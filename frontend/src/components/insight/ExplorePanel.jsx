import "../../styles/insight.css";
import Archetypes from "../Archetypes.jsx";
import CaseFile from "../CaseFile.jsx";
import Duel from "../Duel.jsx";
import Events from "../Events.jsx";
import Ledger from "../Ledger.jsx";
import Loading from "../Loading.jsx";
import Scan from "../Scan.jsx";
import Sweep from "../Sweep.jsx";
import Vitals from "../Vitals.jsx";
import World from "../World.jsx";

/** Rotating progress lines per tool (the same copy App.jsx uses today). */
export const EXPLORE_STEPS = {
  sweep: ["Pulling 19 variables in one request…", "Removing the seasonal cycle from each…", "Running trend tests on all of them…", "Ranking by strength of evidence…"],
  scan: ["Contacting NASA POWER…", "Analyzing each place on the grid…", "Applying false-discovery control…", "Measuring the spatial pattern…"],
  duel: ["Fetching both places…", "Fitting both trends…", "Testing whether the rates differ…"],
  world: ["Asking NASA POWER about sample places around the world…", "Fitting a trend at each one…", "Applying false-discovery control…", "Placing the dots…"],
  archetypes: ["Fetching every variable at each sample place…", "Measuring each variable's change against its normal swings…", "Clustering similar fingerprints…", "Testing whether the groups are stable…"],
  ledger: ["Asking NASA POWER about every sample place…", "Testing all 19 variables at each…", "Correcting over a thousand tests together…", "Ranking by strength of evidence…", "Looking up published context…"],
  vitals: ["Reading NASA GISTEMP…", "Reading NOAA CO₂ and NSIDC sea ice…", "Testing each vital sign…", "Checking the climate rhythms…"],
};

const TOOL_NAMES = { investigate: "Detail", sweep: "Sweep", scan: "Scan", duel: "Duel", world: "World", vitals: "Vitals", ledger: "Ledger", events: "Events", learn: "Learn" };

export function PinPrompt({ label }) {
  return (
    <div className="card prompt reveal">
      <p className="eyebrow">{label}</p>
      <h2>Drop a pin first</h2>
      <p className="dim">Click anywhere on the globe, type a place above, or choose a quick place in the setup panel.</p>
    </div>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="card error-card reveal" role="alert">
      <p className="eyebrow">The investigation hit a snag</p>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Explore ▸ Learn: guided case files, glossary, the step-by-step explainer and About. */
export function LearnPanel({ casesCount, onOpenCases, onOpenGlossary, onExplain, onOpenAbout }) {
  return (
    <section className="card learn-card explore-learn">
      <p className="eyebrow">Learn</p>
      <h2>How the evidence works</h2>
      <p className="dim">Guided case files, plain-language definitions and how Trend Detective checks a trend.</p>
      <ul className="learn-list">
        <li><button type="button" className="btn" onClick={onOpenCases}>Open a guided case file ▸</button><span className="faint small">{casesCount} worked investigations</span></li>
        <li><button type="button" className="btn" onClick={onOpenGlossary}>Detective's glossary</button><span className="faint small">p-values, trends, anomalies…</span></li>
        <li><button type="button" className="btn" onClick={() => onExplain?.(null)}>? Explain a term</button><span className="faint small">step-by-step explainer</span></li>
        <li><button type="button" className="btn" onClick={onOpenAbout}>About &amp; credits</button><span className="faint small">data sources and licences</span></li>
      </ul>
    </section>
  );
}

/**
 * The Explore tool panel (spec 1.9): renders the active tool's result card exactly as App.jsx does inline today, so the
 * shell can mount it as the tabpanel body. It fetches nothing itself; App keeps every request, key and AbortController.
 * (The case file's own Forecast lab and Why panel fetch on open, and cancel on unmount.)
 *
 * Props (all from App.jsx state; `r` results are { data, loading, error, key }):
 *   tab                       "investigate" | "sweep" | "scan" | "duel" | "world" | "vitals" | "ledger" | "events" | "learn"
 *   hasPin                    !!params
 *   serverDown                variablesStatus === "error"
 *   onRetry()
 *   detail   { r: trend, fresh: trendFresh, view, onView, onGo, onEvent, watched, onToggleWatch, focusSection, onTrendRefreshed }
 *   sweep    { r, selected: params.variable, onOpen }
 *   scan     { r: grid, cfg, onCfg, onRun, stale, selected, onSelect, onOpenCell }
 *   duel     { r, data (already key-checked), params, pinB, pickTarget, onPickTarget, onPlaceB, onSwap, onRun, caseNames }
 *   world    { mode, onMode, r: world, archetypes, onOpen, lapse, lapseYears, onLapse, onChooseK }
 *   vitals   { r }
 *   ledger   { r, onOpen }
 *   events   { selectedId, onSelect, onOpenCase, onOpenVitals }
 *   learn    { casesCount, onOpenCases, onOpenGlossary, onExplain, onOpenAbout }
 */
export default function ExplorePanel({ tab, hasPin, serverDown, onRetry, detail, sweep, scan, duel, world, vitals, ledger, events, learn }) {
  const label = TOOL_NAMES[tab] ?? "Explore";
  const result = (r, steps, title, render) =>
    r?.loading ? <Loading title={title} steps={steps} /> : r?.error ? <ErrorCard message={r.error} onRetry={onRetry} /> : r?.data ? render(r.data) : null;

  return (
    <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-stack card-swap" key={tab}>
      {tab === "investigate" &&
        (!hasPin ? (
          serverDown ? <ErrorCard message="Can't reach the analysis server. Is the backend running on port 8000?" /> : <PinPrompt label={label} />
        ) : detail.r.loading || !detail.fresh ? (
          <Loading title="Investigating" />
        ) : detail.r.error ? (
          <ErrorCard message={detail.r.error} onRetry={onRetry} />
        ) : detail.r.data ? (
          <CaseFile
            key={detail.r.key}
            data={detail.r.data}
            view={detail.view}
            onView={detail.onView}
            onGo={detail.onGo}
            onEvent={detail.onEvent}
            watched={detail.watched}
            onToggleWatch={detail.onToggleWatch}
            focusSection={detail.focusSection}
            onTrendRefreshed={detail.onTrendRefreshed}
          />
        ) : null)}

      {tab === "sweep" &&
        (!hasPin ? <PinPrompt label={label} /> : result(sweep.r, EXPLORE_STEPS.sweep, "Sweeping every variable", (d) => <Sweep key={sweep.r.key} data={d} selected={sweep.selected} onOpen={sweep.onOpen} />))}

      {tab === "scan" && (
        <>
          <Scan
            cfg={scan.cfg}
            onCfg={scan.onCfg}
            onRun={scan.onRun}
            loading={scan.r.loading}
            hasPin={hasPin}
            stale={scan.stale}
            data={scan.r.data}
            selected={scan.selected}
            onSelect={scan.onSelect}
            onOpenCell={scan.onOpenCell}
          />
          {scan.r.loading && <Loading title="Scanning the region" steps={EXPLORE_STEPS.scan} />}
          {scan.r.error && <ErrorCard message={scan.r.error} onRetry={scan.onRun} />}
        </>
      )}

      {tab === "duel" && (
        <>
          <Duel
            params={duel.params}
            pinB={duel.pinB}
            hasPin={hasPin}
            pickTarget={duel.pickTarget}
            onPickTarget={duel.onPickTarget}
            onPlaceB={duel.onPlaceB}
            onSwap={duel.onSwap}
            onRun={duel.onRun}
            data={duel.data}
            loading={duel.r.loading}
            caseNames={duel.caseNames}
          />
          {duel.r.loading && <Loading title="Comparing two places" steps={EXPLORE_STEPS.duel} />}
          {duel.r.error && <ErrorCard message={duel.r.error} onRetry={onRetry} />}
        </>
      )}

      {tab === "world" && (
        <>
          <div className="seg world-switch" role="group" aria-label="World view">
            <button type="button" className={world.mode === "survey" ? "on" : ""} aria-pressed={world.mode === "survey"} onClick={() => world.onMode("survey")}>One variable</button>
            <button type="button" className={world.mode === "archetypes" ? "on" : ""} aria-pressed={world.mode === "archetypes"} onClick={() => world.onMode("archetypes")}>All variables · archetypes</button>
          </div>
          {world.mode === "survey" &&
            result(world.r, EXPLORE_STEPS.world, "Surveying the world", (d) => (
              <World key={world.r.key} data={d} onOpen={world.onOpen} lapse={world.lapse} lapseYears={world.lapseYears ?? []} onLapse={world.onLapse} />
            ))}
          {world.mode === "archetypes" &&
            result(world.archetypes, EXPLORE_STEPS.archetypes, "Finding trend archetypes", (d) =>
              d.ok ? <Archetypes data={d} onChooseK={world.onChooseK} onOpen={world.onOpen} /> : <ErrorCard message={d.message} />,
            )}
        </>
      )}

      {tab === "vitals" && result(vitals.r, EXPLORE_STEPS.vitals, "Reading the planet's vital signs", (d) => <Vitals key={vitals.r.key} data={d} />)}

      {tab === "ledger" && result(ledger.r, EXPLORE_STEPS.ledger, "Building the trend ledger", (d) => <Ledger key={ledger.r.key} data={d} onOpen={ledger.onOpen} />)}

      {tab === "events" && <Events selectedId={events.selectedId} onSelect={events.onSelect} onOpenCase={events.onOpenCase} onOpenVitals={events.onOpenVitals} />}

      {tab === "learn" && <LearnPanel {...learn} />}
    </div>
  );
}
