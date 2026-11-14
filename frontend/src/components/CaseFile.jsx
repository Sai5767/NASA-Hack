import { useState } from "react";
import { useCountUp, useTypewriter } from "../hooks.js";
import { arrow, formatP, formatPlace, signed } from "../lib/format.js";
import { caseFileCsv, downloadText } from "../lib/csv.js";
import Emergence from "./charts/Emergence.jsx";
import Fingerprint from "./charts/Fingerprint.jsx";
import Stripes from "./charts/Stripes.jsx";
import TrendChart from "./charts/TrendChart.jsx";
import InView from "./InView.jsx";
import Term from "./Term.jsx";

const STAMP_WORDS = { strong: "STRONG TREND", moderate: "LIKELY TREND", weak: "FAINT SIGNAL", none: "INCONCLUSIVE" };

function Count({ value, format, delay = 0 }) {
  const v = useCountUp(value, { duration: 1200, delay });
  return <>{format(v)}</>;
}

function Typed({ text, delay = 0, speed = 8 }) {
  const [shown, done, skip] = useTypewriter(text, { speed, delay });
  return (
    <p className="typed" onClick={skip} title={done ? undefined : "Click to skip"}>
      {shown}
      {!done && <span className="caret">▍</span>}
    </p>
  );
}

function Metric({ term, label, delay, tone = "", sub, children }) {
  return (
    <div className={`metric ${tone} reveal`} style={{ "--d": `${delay}ms` }}>
      <span className="metric-label">{term ? <Term id={term}>{label}</Term> : label}</span>
      <span className="metric-value mono">{children}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

function Stamp({ grade, stats }) {
  const sub = stats.significant ? (stats.sign === "up" ? "▲ RISING" : "▼ FALLING") : "— NO CLEAR DIRECTION";
  return (
    <div className={`stamp stamp-${grade.code}`} style={{ "--d": "2500ms" }} aria-label={`${grade.label}. ${sub}`}>
      <span className="stamp-word">{STAMP_WORDS[grade.code]}</span>
      <span className="stamp-sub">{sub}</span>
      <span className="stamp-score">{grade.passed}/{grade.total} CHECKS</span>
    </div>
  );
}

function noiseSentence(snr) {
  if (snr == null) return "no variation to compare";
  const x = Math.abs(snr);
  if (x >= 2) return "clearly larger than a normal year-to-year swing";
  if (x >= 1) return "larger than a normal year-to-year swing";
  return "smaller than a normal swing: easy for natural variability to hide";
}

export default function CaseFile({ data }) {
  const [play, setPlay] = useState(0);
  const { variable, location, period, quality, stats, ols, grade, summary, annual, checks, robustness, caveats, fingerprint, month_agreement: agreement, emergence } = data;
  const units = variable.units;
  const tone = stats.significant ? stats.sign : "flat";
  const coverage = Math.min(100, Math.round((quality.valid_months / Math.max(1, quality.expected_months)) * 100));
  const trimmed = robustness.filter((w) => w.same_direction).length;

  return (
    <article className="casefile" key={play}>
      <header className="card cf-head reveal">
        <div>
          <p className="eyebrow">Case file</p>
          <h2>{variable.label}</h2>
          <p className="mono dim cf-meta">
            {formatPlace(location.lat, location.lon)} · {period.start_year}–{period.end_year} · {quality.years_used} complete years · {coverage}% of months
          </p>
        </div>
        <div className="cf-actions">
          <button type="button" className="btn btn-sm" onClick={() => setPlay((n) => n + 1)}>▶ Replay</button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => downloadText(`trend-detective_${variable.id}_${location.lat}_${location.lon}.csv`, caseFileCsv(data))}
          >
            ⤓ CSV
          </button>
        </div>
      </header>

      <section className={`card hud-card verdict ${tone} reveal`} style={{ "--d": "80ms" }}>
        <Stamp grade={grade} stats={stats} />
        <div className="verdict-text">
          <p className="eyebrow">Verdict</p>
          <Typed text={summary} delay={300} />
          <p className="verdict-hint dim">{variable.description}</p>
        </div>
      </section>

      <div className="metrics">
        <Metric term="sens" label="Rate of change" delay={350} tone={tone} sub={<>95% range <b className="mono">{signed(stats.ci_low_per_decade)}</b> to <b className="mono">{signed(stats.ci_high_per_decade)}</b></>}>
          <Count value={stats.slope_per_decade} format={(v) => signed(v, 3)} delay={500} />
          <small>{units} / decade</small>
        </Metric>
        <Metric label="Total change" delay={450} tone={tone} sub={<>over {stats.span_years} years{stats.percent_of_mean != null && <> · <b className="mono">{signed(stats.percent_of_mean, 3)}%</b> of the average</>}</>}>
          <Count value={stats.total_change} format={(v) => signed(v, 3)} delay={600} />
          <small>{units}</small>
        </Metric>
        <Metric term="snr" label="Signal vs noise" delay={550} sub={noiseSentence(stats.signal_to_noise)}>
          {stats.signal_to_noise == null ? "—" : <><Count value={Math.abs(stats.signal_to_noise)} format={(v) => v.toFixed(1)} delay={700} />×</>}
          <small>year-to-year swing</small>
        </Metric>
        <Metric
          term="pvalue"
          label="Evidence (p-value)"
          delay={650}
          sub={stats.autocorr.adjusted
            ? <>adjusted for year-to-year correlation (unadjusted {formatP(stats.p_naive)})</>
            : <>regression t-test: <b className="mono">{formatP(ols.p_value)}</b></>}
        >
          <Count value={stats.p_value} format={(v) => (stats.p_value < 0.001 ? "< 0.001" : v.toFixed(3))} delay={800} />
          <small>{stats.significant ? "significant" : "not significant"}</small>
        </Metric>
      </div>

      <InView minHeight={380}>
        <section className="card chart-card">
          <h3>The record</h3>
          <TrendChart data={data} />
          <Stripes annual={annual} units={units} />
        </section>
      </InView>

      <InView minHeight={320}>
        <section className="card duo">
          <div>
            <h3><Term id="fingerprint">Trend fingerprint</Term></h3>
            <Fingerprint rows={fingerprint} agreement={agreement} units={units} />
          </div>
          <div>
            <h3><Term id="emergence">When the evidence emerged</Term></h3>
            <Emergence series={emergence.series} year={emergence.year} />
          </div>
        </section>
      </InView>

      <InView minHeight={300}>
        <section className="card locker">
          <div className="locker-head">
            <h3><Term id="grade">Evidence locker</Term></h3>
            <span className={`grade-pill grade-${grade.code}`}>{grade.label} · {grade.passed}/{grade.total}</span>
          </div>
          <ul className="checks">
            {checks.map((c, i) => (
              <li key={c.id} className={`${c.passed ? "pass" : "fail"} reveal-slide`} style={{ "--d": `${i * 120}ms` }}>
                <span className="mark" aria-hidden="true">{c.passed ? "✓" : "✕"}</span>
                <div>
                  <b>{c.label}</b>
                  <small className="mono">{c.detail}</small>
                </div>
                <span className="sr-only">{c.passed ? "passed" : "not passed"}</span>
              </li>
            ))}
          </ul>

          <table className="tests">
            <thead>
              <tr><th>Test</th><th>Rate per decade</th><th>95% range</th><th>p</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><Term id="mk">Mann–Kendall</Term> + <Term id="sens">Sen</Term></td>
                <td className="mono">{signed(stats.slope_per_decade)}</td>
                <td className="mono">{signed(stats.ci_low_per_decade)} to {signed(stats.ci_high_per_decade)}</td>
                <td className="mono">{formatP(stats.p_value)}</td>
              </tr>
              <tr>
                <td><Term id="ttest">Linear regression</Term></td>
                <td className="mono">{signed(ols.slope_per_decade)}</td>
                <td className="mono">{signed(ols.ci_low_per_decade)} to {signed(ols.ci_high_per_decade)}</td>
                <td className="mono">{formatP(ols.p_value)}</td>
              </tr>
            </tbody>
          </table>

          {robustness.length > 0 && (
            <div className="robust">
              <h4>Does trimming the ends change the story? <span className="dim">({trimmed} of {robustness.length} keep the direction)</span></h4>
              <ul>
                {robustness.map((w) => (
                  <li key={w.label}>
                    <span className={w.same_direction ? "ok" : "bad"}>{arrow(w.same_direction ? stats.sign : stats.sign === "up" ? "down" : "up")}</span>
                    <span>{w.label} <span className="dim mono">({w.start_year}–{w.end_year})</span></span>
                    <span className="mono">{signed(w.slope_per_decade)} {units}/dec</span>
                    <span className={`mono ${w.significant ? "ok" : "dim"}`}>p {formatP(w.p_value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </InView>

      <section className="card notes">
        <h3>Detective's notes</h3>
        <ul>
          {caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="dim mono credit">Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program.</p>
      </section>
    </article>
  );
}
