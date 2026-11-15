/**
 * The VISHWA credit (the company behind Trend Detective). Monochrome, small. Hover, focus or tap shows the acronym's
 * expansion with the letters V-I-S-H-W-A emphasised. Links to https://vishwa.earth in a new tab.
 */
export const VISHWA_URL = "https://vishwa.earth";
export const VISHWA_EXPANSION = "Validated Insights on Significant Hydro-climate and Weather Anomalies";

const WORDS = ["Validated", "Insights", "on", "Significant", "Hydro-climate", "and", "Weather", "Anomalies"];
const KEY = new Set(["Validated", "Insights", "Significant", "Hydro-climate", "Weather", "Anomalies"]);

export default function Vishwa({ prefix = "", className = "" }) {
  return (
    <span className={`vishwa ${className}`.trim()}>
      {prefix && <span className="vishwa-prefix">{prefix}{" "}</span>}
      <a className="vishwa-link" href={VISHWA_URL} target="_blank" rel="noopener noreferrer" aria-label={`VISHWA: ${VISHWA_EXPANSION} (opens vishwa.earth in a new tab)`}>
        VISHWA
      </a>
      <span className="vishwa-pop" role="tooltip" aria-hidden="true">
        {WORDS.map((w, i) => (
          <span key={i}>
            {KEY.has(w) ? <><b>{w[0]}</b>{w.slice(1)}</> : w}
            {i < WORDS.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </span>
  );
}
