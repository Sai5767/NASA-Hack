import { MONTHS_LONG, sig, signed } from "../lib/format.js";
import Sparkline from "./charts/Sparkline.jsx";
import Term from "./Term.jsx";

const SHAPE_WORD = { steady: "steady ramp", step: "step-like", unclear: "no clear shape" };
// "°C vs 1951–1980" describes the baseline of a reading; a rate of change is simply "°C per decade".
const rateUnits = (units) => units.split(" vs ")[0];

function VitalCard({ v, index }) {
  if (!v.ok) {
    return (
      <article className="card vital flat reveal" style={{ "--d": `${index * 90}ms` }}>
        <p className="eyebrow">{v.label}</p>
        <p className="dim">Unavailable right now: {v.message}</p>
      </article>
    );
  }
  const s = v.stats;
  const tone = s.significant ? s.sign : "flat";
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--flat)";
  return (
    <article className={`card vital ${tone} reveal`} style={{ "--d": `${index * 90}ms` }}>
      <header>
        <p className="eyebrow">{v.label}</p>
        <p className="faint small mono">{v.source}</p>
      </header>
      <div className="vital-latest">
        <span className="mono vital-value">{sig(v.latest?.value, 4)}</span>
        <span className="dim small">{v.units} · {v.latest?.label}</span>
      </div>
      <div className="vital-rate" style={{ color }}>
        <span className="mono">{signed(s.slope_per_decade)}</span>
        <small>{rateUnits(v.units)} / decade</small>
        <span className={`grade-pill grade-${v.grade.code}`}>{v.grade.label}</span>
      </div>
      <p className="dim small mono">95% range {signed(s.ci_low_per_decade)} to {signed(s.ci_high_per_decade)} · {v.period.start_year}–{v.period.end_year}</p>
      <Sparkline values={v.annual.map((a) => a.value)} color={color} width={260} height={52} delay={index * 90 + 300} />
      {v.strongest_month && (
        <p className="small">
          Steepest in <b>{MONTHS_LONG[v.strongest_month.month - 1]}</b>: <span className="mono">{signed(v.strongest_month.slope_per_decade)}</span> {rateUnits(v.units)}/decade.
        </p>
      )}
      <p className="faint small">
        Shape: {SHAPE_WORD[v.shape.label]}
        {v.shape.label === "step" ? ` near ${v.shape.step_year}` : ""}.{v.emergence_year ? ` Significant on its own since ${v.emergence_year}.` : ""}
      </p>
    </article>
  );
}

function RhythmTile({ r, index }) {
  if (!r.ok) return null;
  const hot = r.latest?.phase === "El Niño" || r.latest?.phase === "Positive phase";
  return (
    <li className="card rhythm reveal" style={{ "--d": `${400 + index * 90}ms` }}>
      <p className="eyebrow">{r.label}</p>
      <p className="rhythm-phase">
        <span className={`phase ${hot ? "hi" : r.latest?.phase === "Neutral" ? "mid" : "lo"}`}>{r.latest?.phase}</span>
        <span className="mono dim small">{signed(r.latest?.value, 3)} · {r.latest?.label}</span>
      </p>
      <Sparkline values={r.annual.map((a) => a.value)} color="var(--accent)" width={200} height={36} delay={500 + index * 90} />
    </li>
  );
}

/** Earth's vital signs: the same trend engine on global streams, plus climate rhythms as status readouts. */
export default function Vitals({ data }) {
  const solid = data.vitals.filter((v) => v.ok && v.stats.significant).length;
  return (
    <section className="vitals">
      <header className="card hud-card vitals-head reveal">
        <svg className="pulse" viewBox="0 0 240 40" aria-hidden="true">
          <path
            className="draw pulse-line"
            pathLength="1"
            d="M0 22 H48 L58 22 L66 6 L76 34 L84 22 H120 L128 22 L136 10 L146 30 L154 22 H240"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <p className="eyebrow">Planet vitals</p>
        <h2>Earth's vital signs</h2>
        <p className="dim">
          The same trend tests as everywhere else, pointed at global records from NASA, NOAA and NSIDC. {solid} of {data.vitals.length} show a
          significant trend over {data.period.start_year}–{data.period.end_year}. Each card carries the same <Term id="grade">evidence grade</Term> used
          everywhere else in the app.
        </p>
      </header>

      <div className="vital-grid">
        {data.vitals.map((v, i) => (
          <VitalCard key={v.id} v={v} index={i} />
        ))}
      </div>

      <div className="card rhythms-box reveal" style={{ "--d": "350ms" }}>
        <h3>Climate rhythms right now</h3>
        <p className="dim small">
          These swing back and forth rather than trend, so they are shown as status readouts and deliberately not tested for a trend.
        </p>
        <ul className="rhythms">
          {data.rhythms.map((r, i) => (
            <RhythmTile key={r.id} r={r} index={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}
