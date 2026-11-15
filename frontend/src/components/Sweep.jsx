import { useMemo, useState } from "react";
import { formatPlace, signed } from "../lib/format.js";
import { downloadText, sweepCsv } from "../lib/csv.js";
import Sparkline from "./charts/Sparkline.jsx";
import { GradeMeter } from "./insight/Evidence.jsx";
import Term from "./Term.jsx";

const GRADE_SHORT = { strong: "Strong", moderate: "Some", weak: "Weak", none: "No clear change" };

function SnrBar({ value }) {
  if (value == null) return <span className="snr dim">—</span>;
  const width = Math.min(1, Math.abs(value) / 4) * 100;
  return (
    <span className="snr" title={`${Math.abs(value).toFixed(1)}× the typical year-to-year swing`}>
      <span className="snr-track">
        <i style={{ width: `${width}%` }} />
        <b style={{ left: "25%" }} />
      </span>
      <span className="mono">{Math.abs(value).toFixed(1)}×</span>
    </span>
  );
}

/** Every variable at one place, ranked by strength of evidence. */
export default function Sweep({ data, selected, onOpen }) {
  const [group, setGroup] = useState("All");
  const groups = useMemo(() => ["All", ...new Set(data.rows.map((r) => r.group))], [data]);
  const analyzed = data.rows.filter((r) => r.ok && (group === "All" || r.group === group));
  const missing = data.rows.filter((r) => !r.ok);
  const { counts } = data;

  return (
    <section className="sweep">
      <header className="sweep-head">
        <h2 className="tool-title">What's changing at {formatPlace(data.location.lat, data.location.lon)}?</h2>
        <p className="tool-lead">
          {counts.strong_or_moderate} of {counts.analyzed} variables show strong or some evidence of change; {counts.significant_fdr}{" "}
          <Term id="holds">hold after correction</Term> (★). Ranked by evidence, then by <Term id="snr">change vs normal swings</Term>. Select a row
          to open its case file.
        </p>
        <div className="chips" role="group" aria-label="Filter by kind of variable">
          {groups.map((g) => (
            <button key={g} type="button" className={`chip${group === g ? " on" : ""}`} aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadText(`trend-detective_sweep_${data.location.lat}_${data.location.lon}.csv`, sweepCsv(data))}>Download CSV</button>
        </div>
      </header>

      <div className="sweep-table">
        <div className="sweep-cols mono" aria-hidden="true">
          <span>Variable</span><span>Shape</span><span>Per decade</span><span>Vs normal swings</span><span>How sure?</span>
        </div>
        <ul>
          {analyzed.map((row) => {
            const glyph = row.significant ? (row.sign === "up" ? "▲" : "▼") : "–";
            const color = row.significant ? "var(--text)" : "var(--text-faint)";
            return (
              <li key={row.id}>
                <button type="button" className={`sweep-row${selected === row.id ? " current" : ""}`} onClick={() => onOpen(row.id)}>
                  <span className="sw-main">
                    <span className="sw-group">{row.group}</span>
                    <b>{row.label}</b>
                  </span>
                  <Sparkline values={row.annual} color={color} delay={0} />
                  <span className="sw-rate mono">
                    <span aria-hidden="true">{glyph} </span>{signed(row.slope_per_decade)}
                    <small>{row.units}</small>
                  </span>
                  <SnrBar value={row.signal_to_noise} />
                  <span className="sw-grade">
                    <GradeMeter code={row.grade.code} />
                    <span className="sw-grade-word">{GRADE_SHORT[row.grade.code]}</span>
                    {row.significant_fdr && <span className="star" title="Holds after correction"> ★</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {missing.length > 0 && (
          <details className="sweep-missing">
            <summary>{missing.length} variable{missing.length === 1 ? "" : "s"} not measurable here</summary>
            <ul>
              {missing.map((r) => (
                <li key={r.id}><b>{r.label}</b>: <span className="dim">{r.message}</span></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
