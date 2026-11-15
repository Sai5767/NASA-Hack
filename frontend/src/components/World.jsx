import { formatP, signed } from "../lib/format.js";
import { downloadText, worldCsv } from "../lib/csv.js";
import Term from "./Term.jsx";
import TimeLapse from "./TimeLapse.jsx";

function Row({ p, units, onOpen, index }) {
  const color = p.slope_per_decade >= 0 ? "var(--up)" : "var(--down)";
  return (
    <li>
      <button type="button" className="world-row reveal-slide" style={{ "--d": `${index * 50}ms` }} onClick={() => onOpen(p)}>
        <span className="world-name"><b>{p.name}</b><small className="mono">{p.kind}</small></span>
        <span className="mono" style={{ color }}>
          {signed(p.slope_per_decade)}<small> {units}/dec</small>
        </span>
        <span className="mono dim small">{p.percent_of_mean != null ? `${signed(p.percent_of_mean, 3)}%` : ""}</span>
      </button>
    </li>
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
      <header className="card hud-card world-head reveal">
        <p className="eyebrow">World survey</p>
        <h2>Where is {variable.label.toLowerCase()} changing?</h2>
        <p className="dim">
          Across <b>{counts.analyzed}</b> sample places, <b className="up-text">{counts.rising}</b> are rising and <b className="down-text">{counts.falling}</b>{" "}
          falling after <Term id="fdr">false-discovery control</Term>; {counts.none} show no clear trend
          {counts.nominal_only > 0 ? ` and ${counts.nominal_only} are significant only before correction` : ""}. Hover the dots on the map
          (switch to <b>Map</b> to see all of them) and click one to open its case file.
        </p>
        <p className="faint small">{data.note}</p>
        <div className="chips">
          <button type="button" className="chip" onClick={() => downloadText(`trend-detective_world_${variable.id}.csv`, worldCsv(data))}>⤓ CSV</button>
        </div>
      </header>

      {lapse && <TimeLapse lapse={lapse} years={lapseYears} units={units} onChange={onLapse} />}

      <div className="world-lists">
        <div className="card world-col">
          <h3 className="up-text">Rising fastest</h3>
          <ul>
            {data.top_rising.length === 0 && <li className="dim small">None survive the correction.</li>}
            {data.top_rising.map((p, i) => <Row key={p.id} p={p} units={units} onOpen={onOpen} index={i} />)}
          </ul>
        </div>
        <div className="card world-col">
          <h3 className="down-text">Falling fastest</h3>
          <ul>
            {data.top_falling.length === 0 && <li className="dim small">None survive the correction.</li>}
            {data.top_falling.map((p, i) => <Row key={p.id} p={p} units={units} onOpen={onOpen} index={i} />)}
          </ul>
        </div>
      </div>

      <details className="card world-all">
        <summary>All {analyzed.length} analyzed places</summary>
        <ul>
          {analyzed.map((p) => (
            <li key={p.id}>
              <button type="button" className="world-row compact" onClick={() => onOpen(p)}>
                <span className="world-name"><b>{p.name}</b><small className="mono">{p.kind}</small></span>
                <span className="mono">{signed(p.slope_per_decade)}</span>
                <span className="mono dim small">p {formatP(p.p_value)}{p.significant_fdr ? " ★" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        {failed.length > 0 && (
          <p className="dim small">Not measurable here ({failed.length}): {failed.map((p) => p.name).join(", ")}. {failed[0].message}</p>
        )}
      </details>
    </section>
  );
}
