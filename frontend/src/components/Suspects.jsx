import { useEffect, useState } from "react";
import { fetchSuspects } from "../api.js";
import { formatP, signed } from "../lib/format.js";
import Term from "./Term.jsx";

const VERDICT_WORD = { linked: "LINKED", possible: "POSSIBLE", not_linked: "ALIBI" };
const VERDICT_NOTE = {
  linked: "moves in step with this place, even after correcting for testing three patterns",
  possible: "a hint of a link, but not strong enough once three patterns are tested together",
  not_linked: "no reliable link found",
};

/** A -1 to +1 gauge with a fill growing from the center. */
function CorrelationBar({ r }) {
  const width = Math.abs(r) * 50;
  return (
    <div className="corr" role="img" aria-label={`Correlation ${r.toFixed(2)}`}>
      <i className="corr-mid" />
      <i
        className={`corr-fill ${r >= 0 ? "pos" : "neg"}`}
        style={r >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
      />
      <span className="corr-ends mono"><span>−1</span><span>0</span><span>+1</span></span>
    </div>
  );
}

function Suspect({ s, label, index }) {
  if (!s.ok) {
    return (
      <li className="suspect off reveal" style={{ "--d": `${index * 110}ms` }}>
        <b>{s.label}</b>
        <p className="dim small">Not enough overlapping years to test.</p>
      </li>
    );
  }
  const higher = s.r > 0;
  return (
    <li className={`suspect ${s.verdict} reveal`} style={{ "--d": `${index * 110}ms` }}>
      <div className="suspect-top">
        <b>{s.label}</b>
        <span className={`stamp-mini ${s.verdict}`}>{VERDICT_WORD[s.verdict]}</span>
      </div>
      <CorrelationBar r={s.r} />
      <p className="mono small">r = {signed(s.r, 2)} · explains {s.explained.toFixed(0)}% of the swings · p {formatP(s.p_value)}</p>
      <p className="small dim">
        {s.verdict === "not_linked"
          ? VERDICT_NOTE.not_linked
          : `${label} tends to run ${higher ? "higher" : "lower"} in ${s.high_phase} and ${higher ? "lower" : "higher"} in ${s.low_phase}. This pattern ${VERDICT_NOTE[s.verdict]}.`}
      </p>
    </li>
  );
}

function HeatRatio({ a, label }) {
  const max = Math.max(3, Math.ceil(a.ci_high + 0.3));
  const pct = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="ratio">
      <div className="ratio-head">
        <span className="ratio-big mono">{a.beta.toFixed(2)}×</span>
        <span className="dim small">
          <Term id="amplification">the global rate</Term>: for every 1 °C the planet warms, {label.toLowerCase()} here moved about{" "}
          <b>{a.beta.toFixed(2)} °C</b> (95% range {a.ci_low.toFixed(2)} to {a.ci_high.toFixed(2)}, R² {a.r2.toFixed(2)}, {a.n_years} years
          {a.autocorr_adjusted ? ", widened for year-to-year persistence" : ""}).
        </span>
      </div>
      <div className="gauge" aria-hidden="true">
        <i className="gauge-range" style={{ left: pct(a.ci_low), width: `calc(${pct(a.ci_high)} - ${pct(a.ci_low)})` }} />
        <i className="gauge-one" style={{ left: pct(1) }}><em>planet = 1×</em></i>
        <i className="gauge-dot" style={{ left: pct(a.beta) }} />
        <span className="gauge-ends mono"><span>0×</span><span>{max}×</span></span>
      </div>
    </div>
  );
}

/** The "why": which big climate patterns move with this place, and how it compares with independent data. */
export default function Suspects({ data }) {
  const { variable, location, period } = data;
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, data: null, error: "" });
    fetchSuspects(
      { variable: variable.id, lat: location.lat, lon: location.lon, start_year: period.start_year, end_year: period.end_year },
      controller.signal,
    )
      .then((d) => setState({ loading: false, data: d, error: "" }))
      .catch((e) => {
        if (e.name !== "AbortError") setState({ loading: false, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [variable.id, location.lat, location.lon, period.start_year, period.end_year]);

  const { loading, data: ctx, error } = state;
  const units = variable.units;

  return (
    <section className="card lineup">
      <div className="lineup-head">
        <h3>The suspect lineup</h3>
        <p className="dim small">
          Which big climate patterns move in step with this place from year to year? Moving together is a clue, not proof of cause.
        </p>
      </div>

      {loading && <p className="mono dim">Interviewing the suspects…</p>}
      {error && <p className="dim">The lineup is unavailable right now: {error}</p>}

      {ctx && (
        <>
          <ul className="suspects">
            {ctx.suspects.map((s, i) => (
              <Suspect key={s.id} s={s} label={variable.label} index={i} />
            ))}
          </ul>

          {ctx.enso_adjusted && (
            <div className="finding">
              <p className="eyebrow">The <Term id="enso">ENSO</Term> alibi check</p>
              <p>
                ENSO explains <b>{ctx.enso_adjusted.enso_share.toFixed(0)}%</b> of this place's year-to-year swings. With that removed, the
                trend is <b className="mono">{signed(ctx.enso_adjusted.slope_after)} {units}</b> per decade (95% range{" "}
                {signed(ctx.enso_adjusted.ci_low_after)} to {signed(ctx.enso_adjusted.ci_high_after)}), compared with{" "}
                <span className="mono">{signed(ctx.enso_adjusted.slope_before)}</span> before.{" "}
                {ctx.enso_adjusted.significant_after
                  ? "The trend survives: it is not just El Niño and La Niña."
                  : "The trend does not stand out statistically once ENSO is removed."}
              </p>
            </div>
          )}

          {ctx.amplification && (
            <div className="finding">
              <p className="eyebrow">Heat ratio</p>
              <HeatRatio a={ctx.amplification} label={variable.label} />
            </div>
          )}

          {ctx.zonal && (
            <div className="finding">
              <p className="eyebrow">Independent check · NASA GISTEMP</p>
              <p>
                GISTEMP (weather stations plus sea-surface measurements, a different method from the model-based data here) says the{" "}
                <b>{ctx.zonal.band_label}</b> band warmed <b className="mono">{signed(ctx.zonal.band_slope_per_decade)} °C</b> per decade
                over the same {ctx.zonal.n_years} years (95% range {signed(ctx.zonal.band_ci_low)} to {signed(ctx.zonal.band_ci_high)}). This
                point says <b className="mono">{signed(ctx.zonal.local_slope_per_decade)}</b>.{" "}
                {ctx.zonal.ranges_overlap
                  ? "The two ranges overlap: the independent sources agree within their uncertainty."
                  : "The ranges do not overlap. A latitude band is far larger than one grid cell, so some difference is expected, but the sources disagree here."}
              </p>
            </div>
          )}

          {ctx.errors.length > 0 && <p className="dim small">{ctx.errors.join(" ")}</p>}
          <p className="faint small">{ctx.caveat} Correlation p-values count only effectively independent years, so persistence in a series cannot inflate them.</p>
        </>
      )}
    </section>
  );
}
