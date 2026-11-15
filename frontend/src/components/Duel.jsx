import { formatP, formatPlace, signed } from "../lib/format.js";
import { INTAKE_PLACES } from "../lib/cases.js";
import DuelChart from "./charts/DuelChart.jsx";
import { GradeMeter, TrendArrow } from "./insight/Evidence.jsx";
import InView from "./InView.jsx";
import Term from "./Term.jsx";

function Contender({ id, res, units }) {
  const s = res.stats;
  return (
    <div className={`contender contender--${id.toLowerCase()}`}>
      <p className="contender-id">Place {id}</p>
      <b className="mono">{formatPlace(res.location.lat, res.location.lon)}</b>
      <p className="contender-rate">
        <TrendArrow dir={s.significant ? s.sign : "flat"} label={false} /> <span className="mono">{signed(s.slope_per_decade)} <small>{units} per decade</small></span>
      </p>
      <p className="contender-sure"><GradeMeter code={res.grade.code} /> <span className="dim">{res.grade.label}</span></p>
      <p className="mono dim"><Term id="ci">95% range</Term> {signed(s.ci_low_per_decade)} to {signed(s.ci_high_per_decade)} · p {formatP(s.p_value)}</p>
    </div>
  );
}

/** Two places, one variable: are their trends really different? Shares pin A with the other tools (owner item 13). */
export default function Duel({ params, pinB, pickTarget, onPickTarget, onPlaceB, onSwap, onRun, data, loading, hasPin, caseNames }) {
  const diff = data?.difference;
  const units = data?.variable.units ?? "";

  return (
    <section className="duel">
      <div className="duel-pick">
        <h2 className="tool-title">Do two places change at different rates?</h2>
        <p className="tool-lead">Choose which place to set, then tap the globe.</p>
        <div className="duel-targets" role="group" aria-label="Which place the next globe tap sets">
          <button type="button" className={`target a${pickTarget === "A" ? " on" : ""}`} onClick={() => onPickTarget("A")} aria-pressed={pickTarget === "A"}>
            <span className="target-id">Place A</span>
            <b className="mono">{hasPin ? formatPlace(params.lat, params.lon) : "tap the globe"}</b>
            {caseNames?.a && <small>{caseNames.a}</small>}
          </button>
          <button type="button" className="btn btn-sm btn-ghost swap" onClick={onSwap} disabled={!pinB || !hasPin} aria-label="Swap places A and B">⇄</button>
          <button type="button" className={`target b${pickTarget === "B" ? " on" : ""}`} onClick={() => onPickTarget("B")} aria-pressed={pickTarget === "B"}>
            <span className="target-id">Place B</span>
            <b className="mono">{pinB ? formatPlace(pinB.lat, pinB.lon) : "tap the globe"}</b>
            {caseNames?.b && <small>{caseNames.b}</small>}
          </button>
        </div>
        <div className="presets" aria-label="Quick places for B">
          <span className="dim">Quick place B:</span>
          {INTAKE_PLACES.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => onPlaceB?.(p)}>{p.label}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={loading || !hasPin || !pinB}>
          {loading ? "Comparing…" : "Compare"}
        </button>
      </div>

      {data && (
        <div className="duel-results">
          <div className={`duel-verdict ${diff.significant ? "diff" : "same"}`}>
            <p className="duel-verdict-label">{diff.significant ? "Different rates" : "No clear difference yet"}</p>
            <p className="mono duel-gap">Gap {signed(diff.slope_diff_per_decade)} {units} per decade</p>
            <p>{diff.text}</p>
            <details className="td-disclosure">
              <summary>See how we know</summary>
              <div className="td-disclosure-body">
                <p className="mono dim"><Term id="pvalue">p</Term> {formatP(diff.p_value)}</p>
                <p className="faint">Approximate: the two places are treated as independent, which is cautious for nearby places.</p>
              </div>
            </details>
          </div>
          <div className="contenders">
            <Contender id="A" res={data.a} units={units} />
            <Contender id="B" res={data.b} units={units} />
          </div>
          <InView minHeight={340}>
            <section className="chart-card">
              <h3>Side by side</h3>
              <DuelChart overlay={data.overlay} a={data.a} b={data.b} units={units} title={`${data.variable.label}: place A and place B`} source="NASA POWER" />
            </section>
          </InView>
        </div>
      )}
    </section>
  );
}
