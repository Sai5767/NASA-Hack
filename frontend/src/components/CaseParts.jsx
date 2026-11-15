import { useCountUp, useTypewriter } from "../hooks.js";
import { STAMP_WORDS } from "../lib/words.js";
import Term from "./Term.jsx";

export function Count({ value, format, delay = 0 }) {
  const v = useCountUp(value, { duration: 1200, delay });
  return <>{format(v)}</>;
}

export function Typed({ text, delay = 0, speed = 8 }) {
  const [shown, done, skip] = useTypewriter(text, { speed, delay });
  return (
    <p className="typed" onClick={skip} title={done ? undefined : "Click to skip"}>
      {shown}
      {!done && <span className="caret">▍</span>}
    </p>
  );
}

export function Metric({ term, label, delay, tone = "", sub, children }) {
  return (
    <div className={`metric ${tone} reveal`} style={{ "--d": `${delay}ms` }}>
      <span className="metric-label">{term ? <Term id={term}>{label}</Term> : label}</span>
      <span className="metric-value mono">{children}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

export function Stamp({ grade, stats }) {
  const sub = stats.significant ? (stats.sign === "up" ? "▲ RISING" : "▼ FALLING") : "— NO CLEAR DIRECTION";
  return (
    <div className={`stamp stamp-${grade.code}`} style={{ "--d": "2500ms" }} aria-label={`${grade.label}. ${sub}`}>
      <span className="stamp-word">{STAMP_WORDS[grade.code]}</span>
      <span className="stamp-sub">{sub}</span>
      <span className="stamp-score">{grade.passed}/{grade.total} CHECKS</span>
    </div>
  );
}

/** The verdict stamp and the one-paragraph summary, shared by the Overview and the Detail view. */
export function Verdict({ data }) {
  const { grade, stats, summary, variable } = data;
  const tone = stats.significant ? stats.sign : "flat";
  return (
    <section className={`card hud-card verdict ${tone} reveal`} style={{ "--d": "80ms" }}>
      <Stamp grade={grade} stats={stats} />
      <div className="verdict-text">
        <p className="eyebrow">Verdict</p>
        <Typed text={summary} delay={300} />
        <p className="verdict-hint dim">{variable.description}</p>
      </div>
    </section>
  );
}
