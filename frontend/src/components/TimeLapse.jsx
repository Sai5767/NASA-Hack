import Term from "./Term.jsx";

const SPEEDS = [
  { ms: 1000, label: "Slow" },
  { ms: 500, label: "Normal" },
  { ms: 220, label: "Fast" },
];

/** Play, pause and scrub the world-survey time-lapse. The coloured dots are drawn on the map. */
export default function TimeLapse({ lapse, years, units, onChange }) {
  if (years.length < 2) return null;
  const first = years[0];
  const last = years[years.length - 1];

  if (!lapse.on) {
    return (
      <section className="lapse-card">
        <div>
          <p className="lapse-title">Time-lapse</p>
          <p className="dim">
            Watch each site's year compared with what that place <Term id="baseline">usually is</Term>, {first} to {last}.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...lapse, on: true, year: first, playing: true })}>
          ▶ Play
        </button>
      </section>
    );
  }

  const atEnd = lapse.year >= last;
  return (
    <section className="lapse-card on">
      <div className="lapse-top">
        <div>
          <p className="lapse-title">Time-lapse</p>
          <b className="lapse-big mono">{lapse.year}</b>
        </div>
        <div className="lapse-buttons">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onChange(atEnd ? { ...lapse, year: first, playing: true } : { ...lapse, playing: !lapse.playing })}
          >
            {atEnd ? "↺ Replay" : lapse.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ ...lapse, on: false, playing: false })}>Exit</button>
        </div>
      </div>
      <input
        type="range"
        min={first}
        max={last}
        step={1}
        value={lapse.year}
        onChange={(e) => onChange({ ...lapse, year: Number(e.target.value), playing: false })}
        aria-label="Year"
        aria-valuetext={`${lapse.year}`}
      />
      <div className="lapse-foot">
        <span className="faint">
          Each dot: one site's {units} that year compared with its own {first}–{last} <Term id="baseline">baseline</Term>.
        </span>
        <span className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s.ms} type="button" className={lapse.speed === s.ms ? "on" : ""} aria-pressed={lapse.speed === s.ms} onClick={() => onChange({ ...lapse, speed: s.ms })}>{s.label}</button>
          ))}
        </span>
      </div>
    </section>
  );
}
