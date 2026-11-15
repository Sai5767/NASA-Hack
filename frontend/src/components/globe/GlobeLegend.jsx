/**
 * The stage legend (spec 3.8): only rows for layers that are on. On a narrow stage it collapses to a "Key" button.
 * Break values are the display scale (the largest loaded anomaly), printed with the unit.
 */
import { useState } from "react";
import { legendSwatches, rampFor } from "../../lib/ramp.js";
import { GRID_SHORT_NOTE } from "../../lib/globeFrames.js";
import { SEVERITY_NOTE } from "../../lib/globeNews.js";

const num = (v) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`);

export default function GlobeLegend({ timeline, showField, showForecast, showNews, showLive, sampleSites = false }) {
  const [open, setOpen] = useState(false);
  if (!showField && !showNews && !showLive && !sampleSites) return null;
  const ramp = rampFor(timeline?.variable);
  const sw = legendSwatches(ramp, timeline?.scale ?? null);
  const units = timeline?.units ?? "";
  return (
    <div className={`gl-legend${open ? " is-open" : ""}`}>
      <button type="button" className="gl-legend-key btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Key</button>
      <div className="gl-legend-body mono">
        {sampleSites && <p className="gl-legend-line">Sample sites, not a complete global map</p>}
        {showField && timeline && (
          <>
            <p className="gl-legend-title">{(timeline.variable?.label ?? "").toUpperCase()} · vs each cell's own monthly normal{units ? ` (${units})` : ""}</p>
            <div className="gl-legend-ramp">
              <span>{num(sw.low)} ▼</span>
              {sw.tokens.map((t) => <i key={t} style={{ background: `var(${t})` }} />)}
              <span>▲ {num(sw.high)}</span>
            </div>
            <p className="gl-legend-words"><span>{ramp.below}</span><span>{ramp.above}</span></p>
            <p className="gl-legend-row">
              <i className="gl-sw-missing" aria-hidden="true" /> No data
              {showForecast && <><i className="gl-sw-forecast" aria-hidden="true" /> Forecast — not observed data</>}
            </p>
          </>
        )}
        {showNews && <p className="gl-legend-row"><span aria-hidden="true">▲</span> News (attention label, not a warning)</p>}
        {showNews && <p className="gl-legend-note">{SEVERITY_NOTE}</p>}
        {showLive && <p className="gl-legend-row"><span className="gl-sw-live" aria-hidden="true">◔</span> Live weather point (Meteomatics)</p>}
        {showField && <p className="gl-legend-note">{GRID_SHORT_NOTE}</p>}
      </div>
    </div>
  );
}
