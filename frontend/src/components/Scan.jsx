import { formatP, formatPlace, signed } from "../lib/format.js";
import { downloadText, scanCsv } from "../lib/csv.js";
import Term from "./Term.jsx";

const SIZES = [5, 10, 20, 30, 40];
const GRIDS = [3, 4, 5];

function CellCard({ cell, units, onOpen, onClear }) {
  return (
    <div className="card cell-card reveal-pop">
      <div className="cell-head">
        <b className="mono">{formatPlace(cell.lat, cell.lon)}</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClear} aria-label="Clear selection">✕</button>
      </div>
      {cell.ok ? (
        <>
          <p className="mono cell-rate" style={{ color: cell.significant ? (cell.slope_per_decade > 0 ? "var(--up)" : "var(--down)") : "var(--text-dim)" }}>
            {signed(cell.slope_per_decade)} {units} / decade
          </p>
          <p className="dim">
            p {formatP(cell.p_value)} ·{" "}
            {cell.significant_fdr ? "holds up after correcting for testing many places" : cell.significant ? "significant on its own, but not after correcting for testing many places" : "not significant"}
            {cell.signal_to_noise != null && <> · {Math.abs(cell.signal_to_noise).toFixed(1)}× normal swings</>}
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen(cell.lat, cell.lon)}>Open full case file ▸</button>
        </>
      ) : (
        <p className="dim">{cell.message}</p>
      )}
    </div>
  );
}

function Extreme({ label, cell, units, onSelect, tone }) {
  if (!cell) return null;
  return (
    <button type="button" className={`extreme ${tone}`} onClick={() => onSelect(cell)}>
      <span className="eyebrow">{label}</span>
      <span className="mono">{signed(cell.slope_per_decade)} {units}/decade</span>
      <small className="mono">{formatPlace(cell.lat, cell.lon)}</small>
    </button>
  );
}

/** Region scan controls and results. The colored cells themselves are drawn on the globe. */
export default function Scan({ cfg, onCfg, onRun, loading, hasPin, stale, data, selected, onSelect, onOpenCell }) {
  const units = data?.variable.units ?? "";
  const m = data?.morans;
  const spatial = !m
    ? "Too few points had data to test whether neighbors share a trend."
    : m.p_value >= 0.05
      ? "No clear spatial pattern: nearby places do not share trends more than chance would predict."
      : m.pattern === "clustered"
        ? "Clustered: nearby places tend to trend in the same direction."
        : "Dispersed: neighboring places tend to trend in opposite directions.";

  return (
    <section className="scan">
      <div className="card hud-card scan-controls reveal">
        <p className="eyebrow">Region scan</p>
        <h2>Is the change the same everywhere?</h2>
        <p className="dim">
          Tests a grid of points around the pin. Each colored square on the globe is one place. Because many places are tested at
          once, results are also checked with <Term id="fdr">false-discovery control</Term>.
        </p>
        <div className="scan-grid">
          <label className="field">
            Area width
            <select value={cfg.size} onChange={(e) => onCfg({ ...cfg, size: Number(e.target.value) })}>
              {SIZES.map((s) => <option key={s} value={s}>{s}° across</option>)}
            </select>
          </label>
          <label className="field">
            Grid
            <select value={cfg.n} onChange={(e) => onCfg({ ...cfg, n: Number(e.target.value) })}>
              {GRIDS.map((n) => <option key={n} value={n}>{n} × {n} ({n * n} places)</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={loading || !hasPin}>
            {loading ? "Scanning…" : "Scan region ▸"}
          </button>
        </div>
        {!hasPin && <p className="form-msg">Drop a pin on the globe first. The scan is centered on it.</p>}
        {stale && data && <p className="form-msg">The pin, variable, years or grid changed since this scan. Run it again.</p>}
      </div>

      {data && (
        <div className="card scan-results reveal" style={{ "--d": "60ms" }}>
          <div className="scan-title">
            <h3>{data.variable.label}, {data.period.start_year}–{data.period.end_year}</h3>
            <button type="button" className="btn btn-sm" onClick={() => downloadText(`trend-detective_scan_${data.variable.id}.csv`, scanCsv(data))}>⤓ CSV</button>
          </div>
          <p className="dim">{data.counts.analyzed} of {data.counts.total} places analyzed.</p>

          <ul className="count-chips">
            <li className="up"><b>{data.counts.increase}</b> rising</li>
            <li className="down"><b>{data.counts.decrease}</b> falling</li>
            <li className="amber"><b>{data.counts.nominal_only}</b> significant only before correction</li>
            <li><b>{data.counts.none}</b> no clear trend</li>
            {data.counts.failed > 0 && <li className="faint"><b>{data.counts.failed}</b> not analyzed</li>}
          </ul>

          {data.opposite_trends && (
            <div className="banner opposite reveal-pop">
              <b>Opposite trends in one region.</b> Some places here are significantly rising while others are significantly falling:
              the same variable can move in opposite directions even when one process drives both.
            </div>
          )}

          <div className="extremes">
            <Extreme label="Strongest rise" cell={data.strongest_increase} units={units} onSelect={onSelect} tone="up" />
            <Extreme label="Strongest fall" cell={data.strongest_decrease} units={units} onSelect={onSelect} tone="down" />
          </div>

          <div className="spatial">
            <p className="eyebrow"><Term id="moran">Spatial pattern</Term></p>
            <p>{spatial}</p>
            {m && <p className="mono dim">Moran's I = {m.i.toFixed(2)} (chance level {m.expected.toFixed(2)}), p {formatP(m.p_value)}, {m.cells_used} places</p>}
          </div>
          <p className="faint small">Click a square on the globe to inspect it.</p>
        </div>
      )}

      {selected && <CellCard cell={selected} units={units} onOpen={onOpenCell} onClear={() => onSelect(null)} />}
    </section>
  );
}
