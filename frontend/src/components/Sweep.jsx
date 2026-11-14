import { useMemo, useState } from "react";
import { formatPlace, signed } from "../lib/format.js";
import { downloadText, sweepCsv } from "../lib/csv.js";
import Sparkline from "./charts/Sparkline.jsx";
import Term from "./Term.jsx";

const GRADE_SHORT = { strong: "Strong", moderate: "Moderate", weak: "Weak", none: "None" };

function SnrBar({ value }) {
  if (value == null) return <span className="snr dim">—</span>;
  const width = Math.min(1, Math.abs(value) / 4) * 100;
  return (
    <span className="snr" title={`${Math.abs(value).toFixed(1)}× the typical year-to-year swing`}>
      <span className="snr-track">
        <i className={value >= 0 ? "up" : "down"} style={{ width: `${width}%` }} />
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
      <header className="card sweep-head reveal">
        <p className="eyebrow">Sweep</p>
        <h2>What's moving at {formatPlace(data.location.lat, data.location.lon)}?</h2>
        <p className="dim">
          {counts.strong_or_moderate} of {counts.analyzed} variables show strong or moderate evidence of a trend ·{" "}
          {counts.significant} are significant, {counts.significant_fdr} of them after <Term id="fdr">false-discovery control</Term>{" "}
          (★). Ranked by evidence, then by <Term id="snr">signal vs noise</Term>. Click a row to open its case file.
        </p>
        <div className="chips" role="group" aria-label="Filter by group">
          {groups.map((g) => (
            <button key={g} type="button" className={`chip${group === g ? " on" : ""}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
          <button type="button" className="chip" onClick={() => downloadText(`trend-detective_sweep_${data.location.lat}_${data.location.lon}.csv`, sweepCsv(data))}>⤓ CSV</button>
        </div>
      </header>

      <div className="card sweep-table">
        <div className="sweep-cols mono" aria-hidden="true">
          <span>variable</span><span>shape</span><span>per decade</span><span>vs normal swing</span><span>evidence</span>
        </div>
        <ul>
          {analyzed.map((row, i) => {
            const color = row.significant ? (row.sign === "up" ? "var(--up)" : "var(--down)") : "var(--flat)";
            return (
              <li key={row.id}>
                <button type="button" className={`sweep-row reveal-slide${selected === row.id ? " current" : ""}`} style={{ "--d": `${i * 45}ms` }} onClick={() => onOpen(row.id)}>
                  <span className="sw-main">
                    <span className="sw-group">{row.group}</span>
                    <b>{row.label}</b>
                  </span>
                  <Sparkline values={row.annual} color={color} delay={i * 45 + 200} />
                  <span className="sw-rate mono" style={{ color }}>
                    {signed(row.slope_per_decade)}
                    <small>{row.units}</small>
                  </span>
                  <SnrBar value={row.signal_to_noise} />
                  <span className={`sw-grade grade-${row.grade.code}`}>
                    {GRADE_SHORT[row.grade.code]}
                    {row.significant_fdr && <span className="star" title="Survives false-discovery control"> ★</span>}
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
