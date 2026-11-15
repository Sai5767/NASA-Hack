import { formatP, signed } from "../lib/format.js";
import { downloadText, worldCsv } from "../lib/csv.js";
import { CorrectionTag, TrendKey } from "./insight/Evidence.jsx";
import Term from "./Term.jsx";
import TimeLapse from "./TimeLapse.jsx";

function Row({ p, units, onOpen, dir }) {
  return (
    <li>
      <button type="button" className="world-row" onClick={() => onOpen(p)}>
        <span className="world-name"><b>{p.name}</b><small className="faint">{p.kind}</small></span>
        <span className="mono">
          <span aria-hidden="true">{dir === "up" ? "▲" : "▼"} </span>{signed(p.slope_per_decade)}<small> {units} per decade</small>
        </span>
        <span className="mono dim">{p.percent_of_mean != null ? `${signed(p.percent_of_mean, 3)}%` : ""}</span>
      </button>
    </li>
  );
}

/**
 * The World map key in plain words (owner item 1). It replaces "the site's own average" with "warmer / cooler than
 * this place usually is in this month" and defines "usual" as the baseline. The dots use the data-scale tokens
 * (--data-up / --data-down / --data-flat), which are allowed on a data layer's legend only.
 *
 *   mode "lapse"  yearly departures from each site's baseline   mode "trend"  rising / falling / no clear trend
 */
export function WorldLegend({ mode = "trend", variable }) {
  const v = (variable?.label ?? "").toLowerCase();
  const isTemp = /temperature|heat/.test(v);
  const up = isTemp ? "warmer" : "higher";
  const down = isTemp ? "cooler" : "lower";
  if (mode === "lapse") {
    return (
      <ul className="globe-legend world-legend" aria-label="Map key">
        <li><i className="round" style={{ background: "var(--data-up)" }} /> {up} than this place <Term id="baseline">usually is</Term> in a year</li>
        <li><i className="round" style={{ background: "var(--data-down)" }} /> {down} than usual</li>
        <li><i className="round" style={{ background: "var(--data-flat)" }} /> close to usual · stronger colour = more unusual</li>
        <li className="faint"><Term id="samplesite">Sample sites</Term>, not a full map</li>
      </ul>
    );
  }
  return (
    <ul className="globe-legend world-legend" aria-label="Map key">
      <li><i className="round" style={{ background: "var(--data-up)" }} /> <span aria-hidden="true">▲</span> rising</li>
      <li><i className="round" style={{ background: "var(--data-down)" }} /> <span aria-hidden="true">▼</span> falling</li>
      <li><i className="round" style={{ background: "var(--data-flat)" }} /> <span aria-hidden="true">–</span> no clear trend</li>
      <li className="faint">ringed = <Term id="holds">holds after correction</Term> · bigger = stands out more from normal swings</li>
      <li className="faint"><Term id="samplesite">Sample sites</Term>, not a full map</li>
    </ul>
  );
}

/** One variable across every sample place. The dots themselves are drawn on the map. */
export default function World({ data, onOpen, lapse, lapseYears, onLapse }) {
  const { counts, variable } = data;
  const units = variable.units;
  const analyzed = data.places.filter((p) => p.ok).sort((a, b) => b.slope_per_decade - a.slope_per_decade);
  const failed = data.places.filter((p) => !p.ok);

  return (
    <section className="world">
      <header className="world-head">
        <h2 className="tool-title">Where is {variable.label.toLowerCase()} changing?</h2>
        <p className="tool-lead">
          Of <b>{counts.analyzed}</b> <Term id="samplesite">sample sites</Term>, <b>▲ {counts.rising}</b> are rising and <b>▼ {counts.falling}</b> falling
          (after <Term id="correction">correction</Term>); {counts.none} show no clear trend
          {counts.nominal_only > 0 ? <>, and {counts.nominal_only} are <Term id="beforeonly">only significant before correction</Term></> : null}.
        </p>
        <p className="world-sample-note">Sample sites, not a complete global map. Select a dot to open its case file.</p>
        <TrendKey />
        <div className="world-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadText(`trend-detective_world_${variable.id}.csv`, worldCsv(data))}>Download CSV</button>
        </div>
        {data.note && <p className="faint">{data.note}</p>}
      </header>

      {lapse && <TimeLapse lapse={lapse} years={lapseYears} units={units} onChange={onLapse} />}

      <div className="world-lists">
        <div className="world-col">
          <h3><span aria-hidden="true">▲</span> Rising fastest</h3>
          <ul>
            {data.top_rising.length === 0 && <li className="dim">None hold after correction.</li>}
            {data.top_rising.map((p) => <Row key={p.id} p={p} units={units} onOpen={onOpen} dir="up" />)}
          </ul>
        </div>
        <div className="world-col">
          <h3><span aria-hidden="true">▼</span> Falling fastest</h3>
          <ul>
            {data.top_falling.length === 0 && <li className="dim">None hold after correction.</li>}
            {data.top_falling.map((p) => <Row key={p.id} p={p} units={units} onOpen={onOpen} dir="down" />)}
          </ul>
        </div>
      </div>

      <details className="td-disclosure world-all">
        <summary>All {analyzed.length} sites, with the numbers</summary>
        <div className="td-disclosure-body">
          <ul>
            {analyzed.map((p) => (
              <li key={p.id}>
                <button type="button" className="world-row compact" onClick={() => onOpen(p)}>
                  <span className="world-name"><b>{p.name}</b><small className="faint">{p.kind}</small></span>
                  <span className="mono">{signed(p.slope_per_decade)} <small>{units}/decade</small></span>
                  <span className="mono dim">p {formatP(p.p_value)}</span>
                  <CorrectionTag row={p} term={false} />
                </button>
              </li>
            ))}
          </ul>
          {failed.length > 0 && (
            <p className="dim"><Term id="nodata">No data</Term> here ({failed.length}): {failed.map((p) => p.name).join(", ")}. {failed[0].message}</p>
          )}
        </div>
      </details>
    </section>
  );
}
