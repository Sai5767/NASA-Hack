import "../../styles/insight.css";
import { canCombine, tabLabel } from "../../lib/route.js";
import Archetypes from "../Archetypes.jsx";
import AskBox from "../AskBox.jsx";
import CaseFile from "../CaseFile.jsx";
import Duel from "../Duel.jsx";
import Events from "../Events.jsx";
import Ledger from "../Ledger.jsx";
import Loading from "../Loading.jsx";
import Scan from "../Scan.jsx";
import SetupPanel from "../SetupPanel.jsx";
import SavedPins from "../shell/SavedPins.jsx";
import Sweep from "../Sweep.jsx";
import Vitals from "../Vitals.jsx";
import World from "../World.jsx";

/** Rotating progress lines per tool. */
export const EXPLORE_STEPS = {
  sweep: ["Pulling 19 variables in one request…", "Removing the seasonal cycle from each…", "Running trend tests on all of them…", "Ranking by strength of evidence…"],
  scan: ["Contacting NASA POWER…", "Checking each place on the grid…", "Allowing for testing many places at once…", "Looking for a pattern between neighbours…"],
  duel: ["Fetching both places…", "Fitting both trends…", "Testing whether the rates differ…"],
  world: ["Asking NASA POWER about sample places around the world…", "Fitting a trend at each one…", "Allowing for testing many places at once…", "Placing the dots…"],
  archetypes: ["Fetching every variable at each sample place…", "Measuring each variable's change against its normal swings…", "Grouping similar patterns…", "Testing whether the groups are stable…"],
  ledger: ["Asking NASA POWER about every sample place…", "Testing all 19 variables at each…", "Allowing for over a thousand tests at once…", "Ranking by strength of evidence…", "Looking up published context…"],
  vitals: ["Reading NASA GISTEMP…", "Reading NOAA CO₂ and NSIDC sea ice…", "Testing each vital sign…", "Checking the climate rhythms…"],
};

/** Tools that work on the active pin: they get the "Adjust" disclosure. */
const PLACE_TOOLS = ["investigate", "sweep", "scan", "duel"];

/** App's one shared pin (owner item 13) wins over the per-tool props, so Duel and Scan side by side read the same state. */
function withShared(p) {
  const sh = p.shared;
  if (!sh) return p;
  const scan = { ...p.scan, ...(sh.scan ? { r: sh.scan.r ?? p.scan?.r, cfg: sh.scan.cfg ?? p.scan?.cfg, selected: sh.scan.selected ?? p.scan?.selected, onRun: sh.scan.onRun ?? p.scan?.onRun } : {}) };
  const duel = {
    ...p.duel,
    params: sh.params ?? p.duel?.params,
    pinB: sh.pinB ?? p.duel?.pinB ?? null,
    pickTarget: sh.pickTarget ?? p.duel?.pickTarget,
    onPickTarget: sh.onPickTarget ?? p.duel?.onPickTarget,
    onPlaceB: sh.onPinB ?? p.duel?.onPlaceB,
    data: sh.duel ? sh.duel.data : p.duel?.data,
    r: sh.duel?.r ?? p.duel?.r,
  };
  return { ...p, scan, duel, hasPin: p.hasPin ?? !!sh.params };
}

export function PinPrompt({ label, onAsk }) {
  return (
    <div className="xp-empty" role="status">
      <p className="xp-empty-title">Choose a place first</p>
      <p className="dim">Tap the globe{label ? ` to use ${label}` : ""}, or type a question in Ask.</p>
      {onAsk && <button type="button" className="btn btn-sm" onClick={onAsk}>Open Ask</button>}
    </div>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="xp-error" role="alert">
      <p className="xp-empty-title"><span aria-hidden="true">✕ </span>Something went wrong</p>
      <p className="dim">{message}</p>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Explore ▸ Learn: guided case files, glossary, the explainer and About. */
export function LearnPanel({ casesCount, onOpenCases, onOpenGlossary, onExplain, onOpenAbout }) {
  return (
    <section className="explore-learn">
      <h2 className="tool-title">How the evidence works</h2>
      <ul className="learn-list">
        <li><button type="button" className="btn" onClick={onOpenCases}>Open a guided case</button><span className="faint">{casesCount} worked investigations</span></li>
        <li><button type="button" className="btn" onClick={onOpenGlossary}>Glossary</button><span className="faint">every term in plain words</span></li>
        <li><button type="button" className="btn" onClick={() => onExplain?.(null)}>Ask the explainer</button><span className="faint">questions about the methods</span></li>
        <li><button type="button" className="btn" onClick={onOpenAbout}>About &amp; credits</button><span className="faint">data sources and licences</span></li>
      </ul>
    </section>
  );
}

/**
 * The Explore tool panel. Renders the primary tool and, when `also` names a compatible tool (lib/route.js
 * canCombine), that tool beside it: split view on desktop, stacked on narrow screens. Both share App's one active pin
 * and params. It fetches nothing itself; App keeps every request, key and AbortController.
 *
 * Props (all from App.jsx state; `r` results are { data, loading, error, key }):
 *   tab, also, onCloseAlso()      primary tool, optional second tool and its close action
 *   shared   App's one shared pin { params, pinB, place, pickTarget, onPickTarget, onPinB, scan, duel, history, saved }
 *            (overrides the matching scan/duel props; "saved" renders shell/SavedPins from shared.saved)
 *   saved    optional extras for the Saved tool { note, onDismissNote, variables, activeId }
 *   hasPin, serverDown, onRetry()
 *   setup    SetupPanel props { variables, draft, onDraft, onVariable, onApply, onPlace, disabled, message } (optional)
 *   ask      { places, variables, currentVariable, current, onInvestigate, onAsk, disabled }
 *   onOpenAsk()                   optional: the empty-state "Open Ask" action
 *   detail   { r: trend, fresh, view, onView, onGo, onEvent, watched, onToggleWatch, focusSection, onTrendRefreshed }
 *   sweep    { r, selected, onOpen }
 *   scan     { r: grid, cfg, onCfg, onRun, stale, selected, onSelect, onOpenCell }
 *   duel     { r, data (already key-checked), params, pinB, pickTarget, onPickTarget, onPlaceB, onSwap, onRun, caseNames }
 *   world    { mode, onMode, r: world, archetypes, onOpen, lapse, lapseYears, onLapse, onChooseK }
 *   vitals   { r }   ledger { r, onOpen, variables }   events { selectedId, onSelect, onOpenCase, onOpenVitals }
 *   learn    { casesCount, onOpenCases, onOpenGlossary, onExplain, onOpenAbout }
 */
export default function ExplorePanel(raw) {
  const props = withShared(raw);
  const { tab, also = null, onCloseAlso, hasPin, setup } = props;
  const second = also && canCombine(tab, also).ok ? also : null;
  const showSetup = setup && (PLACE_TOOLS.includes(tab) || PLACE_TOOLS.includes(second));

  return (
    <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className={`explore-panel card-swap${second ? " is-split" : ""}`} key={`${tab}+${second ?? ""}`}>
      {showSetup && <SetupPanel {...setup} open={!hasPin} />}
      {second ? (
        <div className="explore-split">
          <div className="explore-col" aria-label={tabLabel(tab)}>
            <ToolBody id={tab} {...props} />
          </div>
          <div className="explore-col explore-col--side" aria-label={`${tabLabel(second)}, open alongside`}>
            <div className="explore-col-head">
              <span className="faint">Alongside</span>
              {onCloseAlso && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onCloseAlso} aria-label={`Close ${tabLabel(second)}`}>✕</button>
              )}
            </div>
            <ToolBody id={second} {...props} />
          </div>
        </div>
      ) : (
        <ToolBody id={tab} {...props} />
      )}
    </div>
  );
}

function ToolBody({ id, hasPin, serverDown, onRetry, onOpenAsk, ask, setup, shared, saved, detail, sweep, scan, duel, world, vitals, ledger, events, learn }) {
  const label = tabLabel(id);
  const result = (r, steps, title, render) =>
    r?.loading ? <Loading title={title} steps={steps} /> : r?.error ? <ErrorCard message={r.error} onRetry={onRetry} /> : r?.data ? render(r.data) : null;

  switch (id) {
    case "investigate":
      if (!hasPin) return serverDown ? <ErrorCard message="We can't reach the analysis server right now." onRetry={onRetry} /> : <PinPrompt label={label} onAsk={onOpenAsk} />;
      if (detail.r.loading || !detail.fresh) return <Loading title="Checking this place" />;
      if (detail.r.error) return <ErrorCard message={detail.r.error} onRetry={onRetry} />;
      return detail.r.data ? (
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
      ) : null;

    case "sweep":
      if (!hasPin) return <PinPrompt label={label} onAsk={onOpenAsk} />;
      return result(sweep.r, EXPLORE_STEPS.sweep, "Checking every variable", (d) => <Sweep key={sweep.r.key} data={d} selected={sweep.selected} onOpen={sweep.onOpen} />);

    case "scan":
      return (
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
      );

    case "duel":
      return (
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
      );

    case "world":
      return (
        <>
          <div className="seg world-switch" role="group" aria-label="World view">
            <button type="button" className={world.mode === "survey" ? "on" : ""} aria-pressed={world.mode === "survey"} onClick={() => world.onMode("survey")}>One variable</button>
            <button type="button" className={world.mode === "archetypes" ? "on" : ""} aria-pressed={world.mode === "archetypes"} onClick={() => world.onMode("archetypes")}>Places that change alike</button>
          </div>
          {world.mode === "survey" &&
            result(world.r, EXPLORE_STEPS.world, "Surveying the world", (d) => (
              <World key={world.r.key} data={d} onOpen={world.onOpen} lapse={world.lapse} lapseYears={world.lapseYears ?? []} onLapse={world.onLapse} />
            ))}
          {world.mode === "archetypes" &&
            result(world.archetypes, EXPLORE_STEPS.archetypes, "Grouping places", (d) =>
              d.ok ? <Archetypes data={d} onChooseK={world.onChooseK} onOpen={world.onOpen} /> : <ErrorCard message={d.message} />,
            )}
        </>
      );

    case "vitals":
      return result(vitals.r, EXPLORE_STEPS.vitals, "Reading the planet's vital signs", (d) => <Vitals key={vitals.r.key} data={d} />);

    case "ledger":
      return result(ledger.r, EXPLORE_STEPS.ledger, "Building the trend ledger", (d) => <Ledger key={ledger.r.key} data={d} onOpen={ledger.onOpen} variables={ledger.variables ?? ask?.variables} />);

    case "events":
      return <Events selectedId={events.selectedId} onSelect={events.onSelect} onOpenCase={events.onOpenCase} onOpenVitals={events.onOpenVitals} />;

    case "ask":
      return ask ? <AskBox {...ask} /> : <ErrorCard message="Ask is not available yet." />;

    case "saved": {
      const sv = { ...(shared?.saved ?? {}), ...(saved ?? {}) };
      return (
        <SavedPins
          pins={sv.pins ?? []}
          variables={sv.variables ?? setup?.variables ?? ask?.variables}
          note={sv.note}
          onDismissNote={sv.onDismissNote}
          activeId={sv.activeId ?? sv.here?.id ?? null}
          onOpen={sv.onOpen}
          onRemove={sv.onRemove}
        />
      );
    }

    case "learn":
      return <LearnPanel {...learn} />;

    default:
      return null;
  }
}
