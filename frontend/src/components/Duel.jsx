import { useTypewriter } from "../hooks.js";
import { formatP, formatPlace, signed } from "../lib/format.js";
import { INTAKE_PLACES } from "../lib/cases.js";
import DuelChart from "./charts/DuelChart.jsx";
import InView from "./InView.jsx";
import Term from "./Term.jsx";

function Typed({ text, delay = 300 }) {
  const [shown, done, skip] = useTypewriter(text, { speed: 8, delay });
  return (
    <p className="typed" onClick={skip}>
      {shown}
      {!done && <span className="caret">▍</span>}
    </p>
  );
}

function Contender({ id, color, label, res, units }) {
  const s = res.stats;
  return (
    <div className="card contender reveal" style={{ "--c": color, "--d": id === "A" ? "100ms" : "220ms" }}>
      <p className="eyebrow" style={{ color }}>Place {id}</p>
      <b className="mono">{formatPlace(res.location.lat, res.location.lon)}</b>
      <p className="mono contender-rate" style={{ color: s.significant ? (s.sign === "up" ? "var(--up)" : "var(--down)") : "var(--text-dim)" }}>
        {signed(s.slope_per_decade)} <small>{units}/decade</small>
      </p>
      <p className="dim small">95% range {signed(s.ci_low_per_decade)} to {signed(s.ci_high_per_decade)}</p>
      <p className="dim small">p {formatP(s.p_value)} · <span className={`grade-pill grade-${res.grade.code}`}>{res.grade.label}</span></p>
      {label && <p className="faint small">{label}</p>}
    </div>
  );
}

/** Two places, one variable: are their trends really different? */
export default function Duel({ params, pinB, pickTarget, onPickTarget, onPlaceB, onSwap, onRun, data, loading, hasPin, caseNames }) {
  const diff = data?.difference;
  const units = data?.variable.units ?? "";

  return (
    <section className="duel">
      <div className="card hud-card duel-pick reveal">
        <p className="eyebrow">Duel</p>
        <h2>Do two places change at different rates?</h2>
        <p className="dim">
          Pick two places, then click the globe to set the one that's selected. The <Term id="ci">95% range</Term> of the difference tells you
          whether the gap is real or could be chance.
        </p>
        <div className="duel-targets">
          <button type="button" className={`target a${pickTarget === "A" ? " on" : ""}`} onClick={() => onPickTarget("A")} aria-pressed={pickTarget === "A"}>
            <span className="eyebrow">Place A</span>
            <b className="mono">{hasPin ? formatPlace(params.lat, params.lon) : "click the globe"}</b>
            {caseNames?.a && <small>{caseNames.a}</small>}
          </button>
          <button type="button" className="btn btn-sm swap" onClick={onSwap} disabled={!pinB || !hasPin} aria-label="Swap places A and B">⇄</button>
          <button type="button" className={`target b${pickTarget === "B" ? " on" : ""}`} onClick={() => onPickTarget("B")} aria-pressed={pickTarget === "B"}>
            <span className="eyebrow">Place B</span>
            <b className="mono">{pinB ? formatPlace(pinB.lat, pinB.lon) : "click the globe"}</b>
            {caseNames?.b && <small>{caseNames.b}</small>}
          </button>
        </div>
        <div className="presets" aria-label="Quick places for B">
          <span className="dim small">Rival place B:</span>
          {INTAKE_PLACES.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => onPlaceB(p)}>{p.label}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={loading || !hasPin || !pinB}>
          {loading ? "Comparing…" : "Run duel ▸"}
        </button>
      </div>

      {data && (
        <div className="duel-results">
          <div className={`card hud-card duel-verdict ${diff.significant ? "diff" : "same"} reveal`}>
            <div className={`stamp ${diff.significant ? "stamp-strong" : "stamp-none"}`} style={{ "--d": "1500ms" }}>
              <span className="stamp-word">{diff.significant ? "DIFFERENT RATES" : "NO CLEAR GAP"}</span>
              <span className="stamp-sub mono">{signed(diff.slope_diff_per_decade)} {units}/dec</span>
            </div>
            <div className="verdict-text">
              <p className="eyebrow">Verdict</p>
              <Typed text={diff.text} />
              <p className="faint small">p {formatP(diff.p_value)} · approximate: the two places are treated as independent, which is conservative for nearby places.</p>
            </div>
          </div>
          <div className="contenders">
            <Contender id="A" color="var(--pin-a)" res={data.a} units={units} />
            <Contender id="B" color="var(--pin-b)" res={data.b} units={units} />
          </div>
          <InView minHeight={340}>
            <section className="card chart-card">
              <h3>Side by side</h3>
              <DuelChart overlay={data.overlay} a={data.a} b={data.b} units={units} />
            </section>
          </InView>
        </div>
      )}
    </section>
  );
}
