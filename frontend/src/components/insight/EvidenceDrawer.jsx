import { useId, useState } from "react";
import "../../styles/insight.css";
import { StateCard } from "../shell/ui.jsx";
import { SERVER_NOTE, technicalBlocks, traceChecks, traceSteps, verdictView } from "./logic.js";

function ValueTable({ rows, caption }) {
  if (!rows.length) return null;
  return (
    <table className="ev-values mono">
      {caption && <caption className="sr-only">{caption}</caption>}
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "How did we test this?" (spec 5.6): each backend `evidence_trace` step in plain words, then — for technical users —
 * its method name and the exact values the server reported. The body of the shell's drawer, or an inline section.
 *
 * Props:
 *   data          the /api/trend response (or null while it loads)
 *   loading, error  the trend request state when opened before the trend arrived
 *   defaultView   "plain" | "numbers" (from the profile's detail level: technical → "numbers")
 *   onOpenDetail()  optional: "See full statistical detail" (Explore ▸ Detail)
 *   showHeader    show the place · variable · period line (default true)
 */
export default function EvidenceDrawer({ data, loading, error, defaultView = "plain", onOpenDetail, showHeader = true }) {
  const [view, setView] = useState(defaultView === "numbers" ? "numbers" : "plain");
  const groupId = useId();
  const numbers = view === "numbers";

  if (loading && !data) return <StateCard kind="loading" title="Checking the evidence…">Waiting for the analysis server.</StateCard>;
  if (error && !data) return <StateCard kind="error" title="We couldn't load the evidence">{error}</StateCard>;
  if (!data) return null;

  const trace = data.evidence_trace;
  const v = verdictView(data);
  const steps = traceSteps(trace);
  const checks = traceChecks(trace, data);
  const blocks = numbers ? technicalBlocks(trace) : [];
  const caveats = trace?.caveats ?? data.caveats ?? [];
  const place = data.location ? `${Number(data.location.lat).toFixed(2)}, ${Number(data.location.lon).toFixed(2)}` : "";

  return (
    <div className="ev-drawer">
      {showHeader && (
        <p className="ev-drawer-sub">
          {[data.variable?.label, place, data.period ? `${data.period.start_year}–${data.period.end_year}` : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="ev-server-note"><span aria-hidden="true">ⓘ </span>{SERVER_NOTE}</p>

      <div className="seg ev-view" role="group" aria-label="How much detail" id={groupId}>
        <button type="button" className={!numbers ? "on" : ""} aria-pressed={!numbers} onClick={() => setView("plain")}>Plain words</button>
        <button type="button" className={numbers ? "on" : ""} aria-pressed={numbers} onClick={() => setView("numbers")}>With the numbers</button>
      </div>

      {steps.length === 0 ? (
        <StateCard kind="empty" title="The step-by-step trace isn't available for this result">
          {v?.summary ?? data.summary}
        </StateCard>
      ) : (
        <ol className="ev-steps">
          {steps.map((s) => (
            <li key={s.id} className="ev-step">
              <span className="ev-step-n mono" aria-hidden="true">{s.n}</span>
              <div className="ev-step-body">
                <h3 className="ev-step-title"><span className="sr-only">Step {s.n}: </span>{s.title}</h3>
                {s.plain && <p className="ev-step-plain">{s.plain}</p>}
                {(s.method || s.rows.length > 0) && (
                  <details className="td-disclosure ev-step-more" open={numbers} key={`${s.id}-${view}`}>
                    <summary>Method and values</summary>
                    <div className="td-disclosure-body">
                      {s.method && <p className="ev-method">{s.method}</p>}
                      <ValueTable rows={s.rows} caption={`Values reported for step ${s.n}`} />
                    </div>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {numbers && blocks.length > 0 && (
        <section className="ev-block-list" aria-label="Technical detail">
          {blocks.map((b) => (
            <div key={b.id} className="ev-block">
              <h3 className="ev-block-title">{b.title}</h3>
              {b.method && <p className="ev-method">{b.method}</p>}
              {b.note && <p className="ev-note">{b.note}</p>}
              <ValueTable rows={b.rows} caption={b.title} />
            </div>
          ))}
        </section>
      )}

      {checks.items.length > 0 && (
        <section className="ev-section">
          <h3 className="ev-section-title">Checks <span className="mono">{checks.passed} of {checks.total} passed</span></h3>
          <ul className="ev-checks">
            {checks.items.map((c) => (
              <li key={c.id ?? c.label} className={c.passed ? "pass" : "fail"}>
                <span className="ev-check-mark" aria-hidden="true">{c.passed ? "✓" : "✕"}</span>
                <span>
                  <b>{c.label}</b> <span className="ev-check-word">{c.passed ? "Passed" : "Not passed"}</span>
                  {c.detail && <small className="mono">{c.detail}</small>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v && (
        <section className="ev-section">
          <h3 className="ev-section-title">Where this result sits</h3>
          <ol className="ev-ladder">
            {v.ladder.map((r) => (
              <li key={r.code} className={r.code === v.code ? "here" : ""} aria-current={r.code === v.code ? "true" : undefined}>
                <span className="ev-ladder-mark" aria-hidden="true">{r.code === v.code ? "▶" : ""}</span>
                {r.label}
                {r.code === v.code && <span className="sr-only"> (this result)</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {caveats.length > 0 && (
        <section className="ev-section">
          <h3 className="ev-section-title">Caveats</h3>
          <ul className="ev-caveats">{caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}

      <p className="td-source">
        Source:{" "}
        <a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer">
          {trace?.completeness?.source ?? "NASA Langley Research Center (LaRC) POWER Project"} ↗
        </a>
      </p>
      {onOpenDetail && (
        <button type="button" className="linklike" onClick={onOpenDetail}>See full statistical detail ▸</button>
      )}
    </div>
  );
}
