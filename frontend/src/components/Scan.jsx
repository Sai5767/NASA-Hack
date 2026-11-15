import { formatP, formatPlace, signed } from "../lib/format.js";
import { downloadText, scanCsv } from "../lib/csv.js";
import Sparkline from "./charts/Sparkline.jsx";
import { CorrectionSwatch, CorrectionTag, TrendArrow, TrendKey } from "./insight/Evidence.jsx";
import { rowDirection } from "./insight/logic.js";
import Term from "./Term.jsx";

const SIZES = [5, 10, 20, 30, 40];
const GRIDS = [3, 4, 5];

function CellCard({ cell, units, onOpen, onClear }) {
  return (
    <div className="scan-cell" role="region" aria-label={`Selected square ${formatPlace(cell.lat, cell.lon)}`}>
      <div className="cell-head">
        <b className="mono">{formatPlace(cell.lat, cell.lon)}</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClear} aria-label="Clear selection">✕</button>
      </div>
      {cell.ok ? (
        <>
          <p className="cell-rate">
            <TrendArrow dir={rowDirection(cell)} label={false} /> <span className="mono">{signed(cell.slope_per_decade)} {units} per decade</span>
          </p>
          <p><CorrectionTag row={cell} /></p>
          <details className="td-disclosure">
            <summary>See how we know</summary>
            <div className="td-disclosure-body">
              <p className="mono dim">
                <Term id="pvalue">p</Term> {formatP(cell.p_value)}
                {cell.signal_to_noise != null && <> · {Math.abs(cell.signal_to_noise).toFixed(1)}× normal swings</>}
              </p>
            </div>
          </details>
          <button type="button" className="btn btn-sm" onClick={() => onOpen(cell.lat, cell.lon)}>Open its case file ›</button>
        </>
      ) : (
        <p className="dim"><Term id="nodata">No data</Term>: {cell.message}</p>
      )}
    </div>
  );
}

function Extreme({ label, cell, units, onSelect, dir }) {
  if (!cell) return null;
  return (
    <button type="button" className="extreme" onClick={() => onSelect(cell)}>
      <span className="extreme-label"><span aria-hidden="true">{dir === "up" ? "▲" : "▼"}</span> {label}</span>
      <span className="mono">{signed(cell.slope_per_decade)} {units} per decade</span>
      <small className="mono faint">{formatPlace(cell.lat, cell.lon)}</small>
    </button>
  );
}

/**
 * Region scan controls and results. The squares themselves are drawn on the globe; the summary chips here use the same
 * encoding as those squares (owner item 6): solid outline = holds after correction, dashed = only before correction,
 * plain = no clear trend, hatch = no data. Monochrome only (no news red/amber/green).
 */
export default function Scan({ cfg, onCfg, onRun, loading, hasPin, stale, data, selected, onSelect, onOpenCell }) {
  const units = data?.variable.units ?? "";
  const m = data?.morans;
  const spatial = !m
    ? "Too few squares had data to look for a pattern."
    : m.p_value >= 0.05
      ? "No clear pattern: nearby squares don't change alike more than chance would."
      : m.pattern === "clustered"
        ? "Clustered: nearby squares tend to change the same way."
        : "Dispersed: neighbouring squares tend to change in opposite ways.";
  const holds = data ? (data.counts.increase ?? 0) + (data.counts.decrease ?? 0) : 0;
  const comp = data?.composite?.stats;

  return (
    <section className="scan">
      <div className="scan-controls">
        <h2 className="tool-title">Is the change the same all around?</h2>
        <p className="tool-lead">
          Tests a grid of <Term id="gridcell">squares</Term> around your pin. Each square on the globe is one place.
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
              {GRIDS.map((n) => <option key={n} value={n}>{n} × {n} ({n * n} squares)</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={loading || !hasPin}>
            {loading ? "Scanning…" : data ? "Scan again" : "Scan region"}
          </button>
        </div>
        {!hasPin && <p className="form-msg">Choose a place first. The scan is centred on it.</p>}
        {stale && data && <p className="form-msg">The place, variable, years or grid changed since this scan. Run it again.</p>}
      </div>

      {data && (
        <div className="scan-results">
          <div className="scan-title">
            <h3>{data.variable.label} <span className="faint mono">{units}</span>, {data.period.start_year}–{data.period.end_year}</h3>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadText(`trend-detective_scan_${data.variable.id}.csv`, scanCsv(data))}>Download CSV</button>
          </div>
          <p className="dim">{data.counts.analyzed} of {data.counts.total} squares checked.</p>

          <ul className="count-chips" aria-label="What the squares show">
            <li className="cc cc--holds">
              <CorrectionSwatch level="holds" />
              <span><b className="mono">{holds}</b> <Term id="holds">hold after correction</Term> <span className="faint">(▲ {data.counts.increase} · ▼ {data.counts.decrease})</span></span>
            </li>
            <li className="cc cc--before">
              <CorrectionSwatch level="before" />
              <span><b className="mono">{data.counts.nominal_only}</b> <Term id="beforeonly">only before correction</Term></span>
            </li>
            <li className="cc cc--none">
              <CorrectionSwatch level="none" />
              <span><b className="mono">{data.counts.none}</b> no clear trend</span>
            </li>
            {data.counts.failed > 0 && (
              <li className="cc cc--nodata">
                <CorrectionSwatch level="nodata" />
                <span><b className="mono">{data.counts.failed}</b> <Term id="nodata">no data</Term></span>
              </li>
            )}
          </ul>
          <p className="faint scan-keynote">Same outlines as the squares on the globe. Fill colour shows direction and size; ▲ rising, ▼ falling.</p>

          {data.composite && (
            <div className="composite">
              <div>
                <p className="composite-label">The region as a whole</p>
                <p className="composite-rate">
                  <TrendArrow dir={comp.significant ? comp.sign : "flat"} />{" "}
                  <span className="mono">{signed(comp.slope_per_decade)} <small>{units} per decade</small></span>
                </p>
                <p className="dim">
                  {comp.significant ? "A clear change across the area." : "No clear change across the area yet."} Average of {data.composite.n_cells} squares;{" "}
                  {Math.round(data.composite.agreeing_share * 100)}% of them change clearly in the same direction.
                </p>
                <details className="td-disclosure">
                  <summary>See how we know</summary>
                  <div className="td-disclosure-body">
                    <p className="mono dim">
                      <Term id="ci">95% range</Term> {signed(comp.ci_low_per_decade)} to {signed(comp.ci_high_per_decade)} {units} per decade ·{" "}
                      <Term id="pvalue">p</Term> {formatP(comp.p_value)} · area-weighted average
                    </p>
                  </div>
                </details>
              </div>
              <Sparkline values={data.composite.annual.map((a) => a.value)} width={150} height={48} expandable title={`${data.variable.label}, the region as a whole`} unit={units} years={data.composite.annual.map((a) => a.year)} source="NASA POWER" />
            </div>
          )}

          {data.opposite_trends && (
            <p className="scan-opposite">
              <b>Opposite trends in one region.</b> Some squares are clearly rising while others are clearly falling.
            </p>
          )}

          <div className="extremes">
            <Extreme label="Strongest rise" cell={data.strongest_increase} units={units} onSelect={onSelect} dir="up" />
            <Extreme label="Strongest fall" cell={data.strongest_decrease} units={units} onSelect={onSelect} dir="down" />
          </div>

          <div className="spatial">
            <p className="spatial-label"><Term id="spatial">Pattern between neighbours</Term></p>
            <p>{spatial}</p>
            {m && (
              <p className="mono dim">
                <Term id="moran">Moran's I</Term> = {m.i.toFixed(2)} (chance level {m.expected.toFixed(2)}), p {formatP(m.p_value)}, {m.cells_used} squares
              </p>
            )}
          </div>
          <TrendKey arrows={false} />
          <p className="faint">Select a square on the globe to inspect it.</p>
        </div>
      )}

      {selected && <CellCard cell={selected} units={units} onOpen={onOpenCell} onClear={() => onSelect(null)} />}
    </section>
  );
}
