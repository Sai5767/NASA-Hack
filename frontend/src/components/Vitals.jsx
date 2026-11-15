import { MONTHS_LONG, sig, signed } from "../lib/format.js";
import Sparkline from "./charts/Sparkline.jsx";
import { GradeMeter, TrendArrow } from "./insight/Evidence.jsx";
import { rateUnits } from "./insight/logic.js";
import Term from "./Term.jsx";

const SHAPE_WORD = { steady: "steady ramp", step: "step-like", unclear: "no clear shape" };

/**
 * One vital sign. The sparkline is a self-contained chart (values + label from props) so the shared ChartViewer from
 * components/charts/ can wrap it: <ExpandableChart title={v.label} units={v.units} rows={v.annual}>…</ExpandableChart>.
 */
function VitalCard({ v }) {
  if (!v.ok) {
    return (
      <article className="vital vital--off">
        <h3 className="vital-title">{v.label}</h3>
        <p className="dim">Unavailable right now: {v.message}</p>
      </article>
    );
  }
  const s = v.stats;
  const dir = s.significant ? s.sign : "flat";
  const ru = rateUnits(v.units);
  return (
    <article className="vital">
      <header>
        <h3 className="vital-title">{v.label}</h3>
        <p className="faint mono vital-source">{v.source}</p>
      </header>
      <div className="vital-latest">
        <span className="mono vital-value">{sig(v.latest?.value, 4)}</span>
        <span className="dim">{v.units} · {v.latest?.label}</span>
      </div>
      <div className="vital-rate">
        <TrendArrow dir={dir} />
        <span className="mono">{signed(s.slope_per_decade)} <small>{ru} <Term id="perdecade">per decade</Term></small></span>
      </div>
      <p className="vital-sure">
        <GradeMeter code={v.grade.code} /> <span className="dim">{v.grade.label}</span>
      </p>
      <figure className="vital-chart" aria-label={`${v.label}, yearly values ${v.period.start_year}–${v.period.end_year}`}>
        <Sparkline values={v.annual.map((a) => a.value)} width={260} height={52} expandable title={v.label} unit={v.units} years={v.annual.map((a) => a.year)} source={v.source} />
      </figure>
      <details className="td-disclosure">
        <summary>See how we know</summary>
        <div className="td-disclosure-body">
          <p className="mono dim">
            <Term id="ci">95% range</Term> {signed(s.ci_low_per_decade)} to {signed(s.ci_high_per_decade)} {ru} per decade · {v.period.start_year}–{v.period.end_year}
          </p>
          {v.strongest_month && (
            <p>
              Steepest in <b>{MONTHS_LONG[v.strongest_month.month - 1]}</b>: <span className="mono">{signed(v.strongest_month.slope_per_decade)}</span> {ru} per decade.
            </p>
          )}
          <p className="faint">
            <Term id="shape">Shape</Term>: {SHAPE_WORD[v.shape.label]}
            {v.shape.label === "step" ? ` near ${v.shape.step_year}` : ""}.{v.emergence_year ? ` Clear on its own since ${v.emergence_year}.` : ""}
          </p>
        </div>
      </details>
    </article>
  );
}

function RhythmTile({ r }) {
  if (!r.ok) return null;
  return (
    <li className="rhythm">
      <p className="rhythm-title">{r.label}</p>
      <p className="rhythm-phase">
        <span className="phase">{r.latest?.phase}</span>
        <span className="mono dim">{signed(r.latest?.value, 3)} · {r.latest?.label}</span>
      </p>
      <Sparkline values={r.annual.map((a) => a.value)} color="var(--text-dim)" width={200} height={36} delay={0} />
    </li>
  );
}

/** Earth's vital signs: the same trend engine on global streams, plus climate rhythms as status readouts. */
export default function Vitals({ data }) {
  const solid = data.vitals.filter((v) => v.ok && v.stats.significant).length;
  return (
    <section className="vitals">
      <header className="vitals-head">
        <h2 className="tool-title">Earth's <Term id="vitals">vital signs</Term></h2>
        <p className="tool-lead">
          Planet-wide records from NASA, NOAA and NSIDC, tested the same way as a single place. {solid} of {data.vitals.length} show a clear change,{" "}
          {data.period.start_year}–{data.period.end_year}.
        </p>
      </header>

      <div className="vital-grid">
        {data.vitals.map((v) => (
          <VitalCard key={v.id} v={v} />
        ))}
      </div>

      <section className="rhythms-box">
        <h3><Term id="rhythm">Climate rhythms</Term> right now</h3>
        <p className="dim">These swing back and forth rather than trend, so they show their current state and are not tested for a trend.</p>
        <ul className="rhythms">
          {data.rhythms.map((r) => (
            <RhythmTile key={r.id} r={r} />
          ))}
        </ul>
      </section>
    </section>
  );
}
