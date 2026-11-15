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
      <section className="card lapse-card reveal" style={{ "--d": "100ms" }}>
        <div>
          <p className="eyebrow">Time-lapse</p>
          <p className="dim small">
            Watch every site's year-by-year anomaly, from {first} to {last}, change on the map: red where a year ran above that site's own
            average, blue where it ran below.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onChange({ ...lapse, on: true, year: first, playing: true })}>
          ▶ Play the time-lapse
        </button>
      </section>
    );
  }

  const atEnd = lapse.year >= last;
  return (
    <section className="card lapse-card on">
      <div className="lapse-top">
        <div>
          <p className="eyebrow">Time-lapse</p>
          <b className="lapse-big mono">{lapse.year}</b>
        </div>
        <div className="lapse-buttons">
          <button
            type="button"
            className="btn btn-sm btn-primary"
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
        <span className="faint small">Each dot is one site's {units} that year compared with its own {first}–{last} average.</span>
        <span className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s.ms} type="button" className={lapse.speed === s.ms ? "on" : ""} onClick={() => onChange({ ...lapse, speed: s.ms })}>{s.label}</button>
          ))}
        </span>
      </div>
    </section>
  );
}
