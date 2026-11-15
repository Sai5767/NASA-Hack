import { GradeMeter, TrendArrow } from "./insight/Evidence.jsx";
import Term from "./Term.jsx";

/** A number shown at once (V3: no count-up animation; delayed reveals are prohibited motion). */
export function Count({ value, format }) {
  return <>{format(value)}</>;
}

/** Plain text (V3: the typewriter reveal was removed). Kept as a component so older call sites still work. */
export function Typed({ text }) {
  return <p className="typed">{text}</p>;
}

export function Metric({ term, label, tone = "", sub, children }) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-label">{term ? <Term id={term}>{label}</Term> : label}</span>
      <span className="metric-value mono">{children}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

/** The V1 grade as the shared monochrome language: direction glyph, filled marks, label, checks passed. */
export function Stamp({ grade, stats }) {
  const dir = stats.significant ? stats.sign : "flat";
  return (
    <div className={`stamp stamp-${grade.code}`} aria-label={`${grade.label}. ${grade.passed} of ${grade.total} checks passed.`}>
      <TrendArrow dir={dir} />
      <span className="stamp-word"><GradeMeter code={grade.code} /> {grade.label}</span>
      <span className="stamp-score mono">{grade.passed} of {grade.total} <Term id="grade">checks</Term></span>
    </div>
  );
}

/** The grade and the one-paragraph summary, shared by the Overview and the Detail view. */
export function Verdict({ data }) {
  const { grade, stats, summary, variable } = data;
  const tone = stats.significant ? stats.sign : "flat";
  return (
    <section className={`verdict ${tone}`}>
      <Stamp grade={grade} stats={stats} />
      <div className="verdict-text">
        <Typed text={summary} />
        <p className="verdict-hint dim">{variable.description}</p>
      </div>
    </section>
  );
}
