import { useEffect, useState } from "react";
import { caseFileCsv, downloadText } from "../lib/csv.js";
import { arrow, formatP, formatPlace, signed } from "../lib/format.js";
import { noiseSentence, shapeSub, shapeWord } from "../lib/words.js";
import { Count, Metric, Verdict } from "./CaseParts.jsx";
import Emergence from "./charts/Emergence.jsx";
import Fingerprint from "./charts/Fingerprint.jsx";
import Stripes from "./charts/Stripes.jsx";
import TrendChart from "./charts/TrendChart.jsx";
import ForecastLab from "./ForecastLab.jsx";
import InView from "./InView.jsx";
import Overview from "./Overview.jsx";
import Suspects from "./Suspects.jsx";
import Term from "./Term.jsx";

/** The collapsible groups of the Detail view, in reading order. */
const SECTIONS = [
  { id: "record", title: "The record", hint: "trend chart and climate stripes" },
  { id: "pattern", title: "Seasons and timing", hint: "fingerprint, and when the evidence emerged" },
  { id: "evidence", title: "Evidence locker", hint: "five checks, two tests, trimming the ends" },
  { id: "rhythms", title: "What moves with it", hint: "climate rhythms, heat ratio, independent check" },
  { id: "forecast", title: "Forecast lab", hint: "machine-learning backtest and five-year outlook" },
  { id: "notes", title: "Detective's notes", hint: "caveats" },
];
const OPEN_AT_FIRST = { record: true, evidence: true };

function Fold({ id, title, hint, open, onToggle, children }) {
  return (
    <details id={`fold-${id}`} className="fold" open={open} onToggle={(e) => onToggle(id, e.currentTarget.open)}>
      <summary>
        <span>
          <b>{title}</b> <small className="dim">{hint}</small>
        </span>
        <i aria-hidden="true" />
      </summary>
      {open && <div className="fold-body">{children}</div>}
    </details>
  );
}

export default function CaseFile({ data, view, onView, onGo, watched, onToggleWatch, focusSection }) {
  const [play, setPlay] = useState(0);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(OPEN_AT_FIRST);
  const [scrollTo, setScrollTo] = useState(null);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link to share the case:", window.location.href);
    }
  };

  const goDetail = (id) => {
    onView("detail");
    setOpen((o) => ({ ...o, [id]: true }));
    setScrollTo(id);
  };

  useEffect(() => {
    if (focusSection) goDetail(focusSection.id);
  }, [focusSection?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scrollTo || view !== "detail") return undefined;
    const aim = (behavior) => document.getElementById(`fold-${scrollTo}`)?.scrollIntoView({ behavior, block: "start" });
    const first = setTimeout(() => aim("smooth"), 80);
    // The section's content mounts after it opens and can shift the page, so re-aim once it has settled.
    const second = setTimeout(() => {
      aim("auto");
      setScrollTo(null);
    }, 700);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [scrollTo, view]);

  const toggle = (id, isOpen) => setOpen((o) => (o[id] === isOpen ? o : { ...o, [id]: isOpen }));

  const { variable, location, period, quality, stats, ols, grade, annual, checks, robustness, caveats, fingerprint, month_agreement: agreement, emergence } = data;
  const units = variable.units;
  const tone = stats.significant ? stats.sign : "flat";
  const coverage = Math.min(100, Math.round((quality.valid_months / Math.max(1, quality.expected_months)) * 100));
  const trimmed = robustness.filter((w) => w.same_direction).length;

  const sectionBody = {
    record: (
      <InView minHeight={380}>
        <section className="card chart-card">
          <h3>The record</h3>
          <TrendChart data={data} />
          <Stripes annual={annual} units={units} />
        </section>
      </InView>
    ),
    pattern: (
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
    ),
    evidence: (
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
    ),
    rhythms: (
      <InView minHeight={300}>
        <Suspects data={data} />
      </InView>
    ),
    forecast: (
      <InView minHeight={420}>
        <ForecastLab data={data} />
      </InView>
    ),
    notes: (
      <section className="card notes">
        <h3>Detective's notes</h3>
        <ul>
          {caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="dim mono credit">Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program.</p>
      </section>
    ),
  };

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
          <button type="button" className={`btn btn-sm${watched ? " on" : ""}`} onClick={onToggleWatch} aria-pressed={watched} title="Keep this place and variable on your home watchlist">
            {watched ? "★ Watching" : "☆ Watch"}
          </button>
          <button type="button" className="btn btn-sm" onClick={copyLink}>{copied ? "✓ Copied" : "⧉ Link"}</button>
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

      <div className="seg view-switch" role="group" aria-label="Level of detail">
        <button type="button" className={view === "overview" ? "on" : ""} onClick={() => onView("overview")}>Overview</button>
        <button type="button" className={view === "detail" ? "on" : ""} onClick={() => onView("detail")}>Detail</button>
      </div>

      {view === "overview" ? (
        <Overview data={data} onDetail={goDetail} onGo={onGo} />
      ) : (
        <>
          <Verdict data={data} />

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
            <Metric term="shape" label="Shape of the record" delay={750} sub={shapeSub(data.shape, units)}>
              <span className="shape-word">{shapeWord(data.shape)}</span>
            </Metric>
          </div>

          <nav className="jump" aria-label="Jump to a section">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className="chip" onClick={() => goDetail(s.id)}>{s.title}</button>
            ))}
          </nav>

          {SECTIONS.map((s) => (
            <Fold key={s.id} id={s.id} title={s.title} hint={s.hint} open={!!open[s.id]} onToggle={toggle}>
              {sectionBody[s.id]}
            </Fold>
          ))}
        </>
      )}
    </article>
  );
}
