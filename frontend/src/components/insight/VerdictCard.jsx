import "../../styles/insight.css";
import { HOW_BUTTON, WHY_BUTTON, verdictView } from "./logic.js";

/** Three-bar evidence meter: filled bars = the backend's verdict tier. */
export function EvidenceMeter({ tier, code }) {
  return (
    <span className={`ev-meter ev-meter--${code}`} role="img" aria-label={`Evidence level ${tier} of 3`}>
      {[1, 2, 3].map((n) => <i key={n} className={n <= tier ? "on" : ""} />)}
    </span>
  );
}

/**
 * The evidence verdict card (spec 5.5): leads with direction, rate, period, source and uncertainty; no p-value here.
 * All four states are keyed on `evidence_trace.verdict.code`; the label is always the backend's own text.
 *
 * Props:
 *   data          the /api/trend response
 *   eyebrow       optional heading text (e.g. "Evidence check · Air temperature · Phoenix"); omitted → no heading
 *   onHowTested() open "How did we test this?" (drawer or inline section)
 *   onWhy()       open "Why might this be happening?"; the button is rendered only when the backend case allows it
 *   whyOpen       aria-expanded state for the Why button when it toggles an inline panel
 *   headingLevel  2 (default) or 3
 */
export default function VerdictCard({ data, eyebrow, onHowTested, onWhy, whyOpen, headingLevel = 2 }) {
  const v = verdictView(data);
  const H = headingLevel === 3 ? "h3" : "h2";
  if (!v) {
    // A response without evidence_trace: show the V1 grade label only, never an invented verdict.
    return (
      <section className="card ev-card ev-card--unknown" aria-label="Evidence verdict">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <H className="ev-label">{data?.grade?.label ?? "Evidence not available"}</H>
        {data?.summary && <p className="ev-summary">{data.summary}</p>}
        {onHowTested && (
          <div className="ev-actions">
            <button type="button" className="btn btn-sm" onClick={onHowTested}>{HOW_BUTTON}</button>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className={`card ev-card ev-card--${v.code}`} aria-label={`Evidence verdict: ${v.label}`}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="ev-top">
        <EvidenceMeter tier={v.tier} code={v.code} />
        <H className="ev-label">{v.label}</H>
      </div>

      {v.rateStyle && (
        <div className={`ev-rate ev-rate--${v.rateStyle}`}>
          {v.direction && (
            <span className={`ev-dir ev-dir--${v.direction.kind}`}>
              <span aria-hidden="true">{v.direction.glyph}</span> {v.direction.text}
            </span>
          )}
          {v.rate && (
            <span className="ev-slope mono">
              {v.rateStyle === "estimate" && <span className="ev-best">Best estimate </span>}
              {v.rate.text}
            </span>
          )}
        </div>
      )}
      {v.rateStyle && v.range && <p className="ev-range mono">{v.range}</p>}
      {!v.rateStyle && <p className="ev-insufficient">{v.insufficientText}</p>}

      <p className="ev-meta mono">
        {[v.period, v.years != null ? `${v.years} complete years` : "", v.source].filter(Boolean).join(" · ")}
      </p>

      {v.summary && <p className="ev-summary">{v.summary}</p>}

      {(onHowTested || (onWhy && v.canAskWhy)) && (
        <div className="ev-actions">
          {onHowTested && <button type="button" className="btn btn-sm" onClick={onHowTested}>{HOW_BUTTON}</button>}
          {onWhy && v.canAskWhy && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onWhy} aria-expanded={whyOpen}>
              {WHY_BUTTON}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
