/**
 * The compact stage legend. By default: one title line, the ramp and its end labels for the main data layer.
 * Everything else (wording, other layers, the news key, caveats, the coarse-preview note) sits behind a small "i"
 * toggle. Only rows for layers that are on, and every cell style that is shown has a matching swatch. On a narrow
 * stage the whole legend collapses to a "Key" button. Data colours appear here (the one legend) and on the data layer
 * only. Break values are the display scale, printed with the unit.
 *
 * Props: timeline, variable, coarse ({ status, doc, label, note }), showField, showForecast, showNews, showLive,
 *        sampleSites, scanStyles (["holds","before","none","failed"] subset, see lib/globeDots.cellStylesShown),
 *        lapse (Explore time-lapse dots), savedPins.
 */
import { useId, useState } from "react";
import { legendSwatches, rampFor } from "../../lib/ramp.js";
import { GRID_SHORT_NOTE } from "../../lib/globeFrames.js";
import { COARSE_LABEL, COARSE_NOTE, coarseLegendTokens, coarseScale, coverageLabel } from "../../lib/coarsePreview.js";
import { CELL_STYLES } from "../../lib/globeDots.js";
import { SEVERITY_NOTE, UNVERIFIED_LABEL } from "../../lib/globeNews.js";

const num = (v) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`);

function Ramp({ tokens, low, high }) {
  return (
    <div className="gl-legend-ramp">
      {low != null && <span className="mono">{low}</span>}
      {tokens.map((t) => <i key={t} style={{ background: `var(${t})` }} />)}
      {high != null && <span className="mono">{high}</span>}
    </div>
  );
}

export default function GlobeLegend({
  timeline, variable, coarse, showField, showForecast, showNews, showLive, sampleSites = false, scanStyles = [], lapse = false,
  savedPins = [],
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const moreId = useId();
  const coarseOn = coarse?.status === "ready" && coarse.doc;
  const coarseMissing = variable && !showField && (coarse?.status === "unavailable" || coarse?.status === "loading");
  const any = showField || showNews || showLive || sampleSites || coarseOn || coarseMissing || scanStyles.length || lapse || savedPins.length;
  if (!any) return null;
  const ramp = rampFor(timeline?.variable ?? variable);
  const sw = legendSwatches(ramp, timeline?.scale ?? null);
  const units = timeline?.units ?? "";
  const cs = coarseOn ? coarseScale(coarse.doc.variable) : null;
  const unit = coarseOn ? coarse.doc.unit : "";
  const fieldMain = showField && !!timeline;
  const coarseMain = !fieldMain && !!cs;

  // The compact block: one title line, the ramp, its end labels.
  let main = null;
  if (fieldMain) {
    main = (
      <section className="gl-legend-group" aria-label="Detailed local data">
        <p className="gl-legend-title">Local data{units ? <span className="mono"> · {units}</span> : null}</p>
        <Ramp tokens={sw.tokens} low={sw.low == null ? null : num(sw.low)} high={sw.high == null ? null : num(sw.high)} />
        <p className="gl-legend-words"><span>{ramp.below}</span><span>{ramp.above}</span></p>
        {showForecast && <p className="gl-legend-row"><i className="gl-sw gl-sw-forecast" aria-hidden="true" /> Forecast, not observed</p>}
      </section>
    );
  } else if (coarseMain) {
    main = (
      <section className="gl-legend-group" aria-label={COARSE_LABEL}>
        <p className="gl-legend-title">Global preview{unit ? <span className="mono"> · {unit}</span> : null}</p>
        <Ramp tokens={coarseLegendTokens(coarse.doc.variable)} low={`${cs.lo}`} high={`${cs.hi}`} />
        <p className="gl-legend-words"><span>{cs.below}</span><span>{cs.above}</span></p>
      </section>
    );
  }

  const extra = (
    <>
      {sampleSites && <p className="gl-legend-line">Sample sites, not a complete global map</p>}

      {fieldMain && (
        <section className="gl-legend-group" aria-label="About the local data">
          <p className="gl-legend-words-full">{ramp.sentence}</p>
          <p className="gl-legend-row"><i className="gl-sw gl-sw-missing" aria-hidden="true" /> No data</p>
        </section>
      )}

      {coarseOn && (
        <section className={`gl-legend-group${fieldMain ? " is-secondary" : ""}`} aria-label={`About the ${COARSE_LABEL.toLowerCase()}`}>
          <p className="gl-legend-title">
            {COARSE_LABEL} · {COARSE_NOTE} · NASA POWER <span className="mono">{coverageLabel(coarse.doc)}</span>
          </p>
          <p className="gl-legend-note">
            Showing <span className="mono">{coarse.label}</span>
            {coarse.note ? ` · ${coarse.note}` : ""}
          </p>
        </section>
      )}
      {coarseMissing && (
        <p className="gl-legend-note">
          {coarse.status === "loading" ? "Loading the coarse global preview…" : "Coarse global preview unavailable for this variable"}
        </p>
      )}

      {scanStyles.length > 0 && (
        <section className="gl-legend-group" aria-label="Scan cells">
          <p className="gl-legend-row">
            <i className="gl-sw gl-sw-data" style={{ background: "var(--data-up)" }} aria-hidden="true" /> Rising
            <i className="gl-sw gl-sw-data" style={{ background: "var(--data-down)" }} aria-hidden="true" /> Falling
            <i className="gl-sw gl-sw-data" style={{ background: "var(--data-flat)" }} aria-hidden="true" /> No clear trend
          </p>
          {scanStyles.filter((s) => s !== "none").map((s) => (
            <p key={s} className="gl-legend-row">
              <i className={`gl-sw gl-sw-cell gl-sw-cell--${s}`} aria-hidden="true" /> {CELL_STYLES[s].label}
            </p>
          ))}
          {scanStyles.includes("none") && (
            <p className="gl-legend-row"><i className="gl-sw gl-sw-cell gl-sw-cell--none" aria-hidden="true" /> No outline: no clear trend</p>
          )}
        </section>
      )}

      {lapse && (
        <section className="gl-legend-group" aria-label="Time-lapse">
          <p className="gl-legend-row"><i className="gl-sw gl-sw-dot" style={{ background: "var(--data-up)" }} aria-hidden="true" /> Warmer or higher than this place usually is</p>
          <p className="gl-legend-row"><i className="gl-sw gl-sw-dot" style={{ background: "var(--data-down)" }} aria-hidden="true" /> Cooler or lower than this place usually is</p>
          <p className="gl-legend-row"><i className="gl-sw gl-sw-dot" style={{ background: "var(--data-flat)" }} aria-hidden="true" /> Near usual · stronger colour = more unusual</p>
        </section>
      )}

      {showNews && (
        <section className="gl-legend-group" aria-label="News context">
          <p className="gl-legend-row"><span aria-hidden="true">● ▲ ◆</span> News attention label, not a warning</p>
          <p className="gl-legend-row"><i className="gl-sw gl-sw-unverified" aria-hidden="true" /> {UNVERIFIED_LABEL}</p>
          <p className="gl-legend-note">{SEVERITY_NOTE}</p>
        </section>
      )}
      {savedPins.length > 0 && <p className="gl-legend-row"><i className="gl-sw gl-sw-pin" aria-hidden="true" /> Saved pin</p>}
      {showLive && <p className="gl-legend-row"><span className="gl-sw-live" aria-hidden="true">◔</span> Live weather point (Meteomatics)</p>}
      {fieldMain && <p className="gl-legend-note">{GRID_SHORT_NOTE}</p>}
    </>
  );

  return (
    <div className={`gl-legend${open ? " is-open" : ""}${main ? " is-compact" : ""}`}>
      <button type="button" className="gl-legend-key btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Key</button>
      <div className="gl-legend-body" role="group" aria-label="Map key">
        {main ? (
          <>
            <div className="gl-legend-head">
              {main}
              <button
                type="button"
                className="gl-legend-more"
                aria-expanded={more}
                aria-controls={moreId}
                aria-label={more ? "Hide the rest of the key" : "More about this key: other layers, news key and notes"}
                title={more ? "Less" : "More about this key"}
                onClick={() => setMore((m) => !m)}
              >
                <span aria-hidden="true">{more ? "×" : "i"}</span>
              </button>
            </div>
            <div id={moreId} className="gl-legend-extra" hidden={!more}>{extra}</div>
          </>
        ) : (
          extra
        )}
      </div>
    </div>
  );
}
