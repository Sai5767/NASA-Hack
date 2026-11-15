import "../../styles/insight.css";
import Term from "../Term.jsx";
import { EvidenceMeter, HowSure, TrendArrow } from "./Evidence.jsx";
import { HOW_BUTTON, WHY_BUTTON, verdictView } from "./logic.js";

export { EvidenceMeter };

/** The one plain sentence under a verdict, built only from backend values (direction, rate, units, period). */
export function verdictSentence(v) {
  if (!v) return "";
  if (!v.rateStyle) return v.insufficientText;
  const rate = v.rate ? `${v.rate.text}` : "";
  if (v.code === "no_clear_evidence") return rate ? `Best estimate ${rate}, but it could be chance${v.period ? ` (${v.period})` : ""}.` : "";
  const word = v.direction?.kind === "up" ? "Rising" : v.direction?.kind === "down" ? "Falling" : "Changing";
  return `${word} about ${rate}${v.period ? `, ${v.period}` : ""}.`;
}

/**
 * The evidence verdict (plan 6B, 7). Monochrome: direction is ▲ ▼ –, strength is filled marks ("How sure are we?"),
 * the headline is plain ("Clear change" / "No clear change yet"), and the backend's own label, range and p-values
 * stay one level deeper behind "See how we know". Nothing here computes a statistic.
 *
 * Props:
 *   data          the /api/trend response
 *   compact       Main: verdict + one sentence + "See how we know" only
 *   eyebrow       optional heading text
 *   onHowTested() open "See how we know"
 *   onWhy()       open "Why might this be happening?" (only after an actual trend, only on request)
 *   whyOpen       aria-expanded for an inline Why toggle
 *   headingLevel  2 (default) or 3
 */
export default function VerdictCard({ data, compact = false, eyebrow, onHowTested, onWhy, whyOpen, headingLevel = 2 }) {
  const v = verdictView(data);
  const H = headingLevel === 3 ? "h3" : "h2";
  if (!v) {
    // A response without evidence_trace: show the V1 grade label only, never an invented verdict.
    return (
      <section className="ev-card ev-card--unknown" aria-label="Evidence verdict">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <H className="ev-label">{data?.grade?.label ?? "Evidence not available"}</H>
        {onHowTested && (
          <div className="ev-actions">
            <button type="button" className="linklike ev-how" onClick={onHowTested}>{HOW_BUTTON} ›</button>
          </div>
        )}
      </section>
    );
  }
  const trendShown = v.code === "strong_evidence" || v.code === "some_evidence";
  const dir = trendShown ? v.direction?.kind ?? "flat" : "flat";

  return (
    <section className={`ev-card ev-card--${v.code}${compact ? " ev-card--compact" : ""}`} aria-label={`Evidence verdict: ${v.plain}`}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="ev-top">
        <span className={`ev-glyph ev-glyph--${dir}`} aria-hidden="true">{trendShown ? v.direction?.glyph ?? "–" : "–"}</span>
        <div className="ev-head">
          <H className="ev-label">{v.plain}</H>
          {trendShown && <TrendArrow dir={dir} className="ev-dirword" />}
        </div>
      </div>

      <p className="ev-sentence">{verdictSentence(v)}</p>

      {compact ? (
        <p className="ev-howsure-line">
          <EvidenceMeter tier={v.tier} code={v.code} size="sm" />
          <span className="ev-howsure-text">{v.label}</span>
        </p>
      ) : (
        <>
          <HowSure tier={v.tier} code={v.code} />
          <p className="ev-backend-label">{v.label}</p>
          {v.rateStyle && v.range && (
            <p className="ev-range mono">
              <Term id="ci">{v.range.split(" range ")[0]} range</Term> {v.range.split(" range ").slice(1).join(" range ")}
            </p>
          )}
          <p className="ev-meta mono">{[v.period, v.years != null ? `${v.years} complete years` : "", v.source].filter(Boolean).join(" · ")}</p>
          {v.summary && <p className="ev-summary">{v.summary}</p>}
        </>
      )}

      {(onHowTested || (onWhy && v.canAskWhy && trendShown)) && (
        <div className="ev-actions">
          {onHowTested && <button type="button" className="linklike ev-how" onClick={onHowTested}>{HOW_BUTTON} ›</button>}
          {onWhy && v.canAskWhy && trendShown && (
            <button type="button" className="linklike ev-why" onClick={onWhy} aria-expanded={whyOpen}>
              {WHY_BUTTON}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
