import { useEffect, useState } from "react";
import { fetchTrend } from "../api.js";
import { FIRST_YEAR, LAST_FULL_YEAR } from "../lib/cases.js";
import { EVENTS, KINDS, describeEvent, eventStats } from "../lib/events.js";
import { formatPlace } from "../lib/format.js";
import Loading from "./Loading.jsx";

/** Yearly departures from the other years' average, with the event years picked out. */
function EventBars({ annual, event, stats, units }) {
  const W = 600;
  const H = 160;
  const pad = { l: 8, r: 8, t: 16, b: 22 };
  const values = annual.map((a) => a.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const bw = (W - pad.l - pad.r) / annual.length;
  const y = (v) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const base = y(stats.baseMean);
  const mid = annual.findIndex((a) => a.year === event.year);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="event-bars" role="img" aria-label={`Yearly values of ${units}; the event years are highlighted.`}>
      {annual.map((a, i) => {
        const inEvent = a.year >= event.from && a.year <= event.to;
        const top = y(a.value);
        return (
          <rect
            key={a.year}
            x={pad.l + i * bw + 1}
            y={Math.min(top, base)}
            width={Math.max(1, bw - 2)}
            height={Math.max(1.5, Math.abs(top - base))}
            fill={inEvent ? "var(--amber)" : "var(--flat)"}
            opacity={inEvent ? 1 : 0.55}
          >
            <title>{a.year}: {Number(a.value.toPrecision(3))} {units}</title>
          </rect>
        );
      })}
      <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} className="mean" />
      <text x={pad.l} y={H - 6} className="ax-tick">{annual[0].year}</text>
      <text x={W - pad.r} y={H - 6} className="ax-tick" textAnchor="end">{annual[annual.length - 1].year}</text>
      {mid >= 0 && (
        <text x={pad.l + mid * bw + bw / 2} y={11} className="ax-tick event-year" textAnchor="middle">{event.year}</text>
      )}
    </svg>
  );
}

/** Fetches the record at the event's place and says what it shows. */
function EventEvidence({ event }) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, data: null, error: "" });
    fetchTrend({ variable: event.variable, lat: event.lat, lon: event.lon, start_year: FIRST_YEAR, end_year: LAST_FULL_YEAR }, controller.signal)
      .then((data) => setState({ loading: false, data, error: "" }))
      .catch((e) => {
        if (e.name !== "AbortError") setState({ loading: false, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [event.id, event.variable, event.lat, event.lon]);

  if (state.loading) return <Loading title="Reading the record" steps={["Asking NASA POWER for this place…", "Comparing the event years with the rest…"]} />;
  if (state.error) return <p className="dim">The data are unavailable right now: {state.error}</p>;

  const { variable, annual } = state.data;
  const stats = eventStats(annual, event);
  return (
    <div className="event-evidence">
      <p className="mono dim small">
        {variable.label} ({variable.units}) at {formatPlace(event.lat, event.lon)}, one NASA grid cell
      </p>
      {stats && <EventBars annual={annual} event={event} stats={stats} units={variable.units} />}
      {stats && (
        <p className="legend-line small">
          <i style={{ background: "var(--amber)" }} /> event years <i style={{ background: "var(--flat)" }} /> other years <span className="faint">bars show departure from the other years' average</span>
        </p>
      )}
      <p className={stats?.standsOut ? "evidence-yes" : "evidence-no"}>{describeEvent(stats, event, variable.units)}</p>
      <p className="faint small">
        Annual averages of a 0.5° grid cell can dilute a short extreme or miss an event that struck a few hundred kilometres away. This shows
        what is in the data, not whether the event happened.
      </p>
    </div>
  );
}

function EventDetail({ event, onBack, onOpenCase, onOpenVitals }) {
  const kind = KINDS[event.kind];
  const span = event.from === event.to ? event.from : `${event.from}–${event.to}`;
  return (
    <article className="event-detail">
      <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>← All events</button>
      <section className="card hud-card event-head reveal">
        <p className="eyebrow">{span} · <span style={{ color: kind.color }}>{kind.label}</span></p>
        <h2>{event.name}</h2>
        <p>{event.blurb}</p>
        <p className="look-for"><span className="eyebrow">What to look for</span>{event.lookFor}</p>
        <p className="faint small">Context from: {event.sources.join("; ")}. Written as background, not as a result of this app's data.</p>
      </section>
      <section className="card event-card reveal" style={{ "--d": "150ms" }}>
        <h3>What the data show here</h3>
        <EventEvidence event={event} />
      </section>
      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={() => onOpenCase(event)}>Open the full case file here ▸</button>
        {event.scope === "global" && <button type="button" className="btn" onClick={onOpenVitals}>See it in Planet vitals ▸</button>}
      </div>
    </article>
  );
}

export default function Events({ selectedId, onSelect, onOpenCase, onOpenVitals }) {
  const [kind, setKind] = useState("all");
  const event = EVENTS.find((e) => e.id === selectedId);
  if (event) return <EventDetail event={event} onBack={() => onSelect(null)} onOpenCase={onOpenCase} onOpenVitals={onOpenVitals} />;

  const list = EVENTS.filter((e) => kind === "all" || e.kind === kind).sort((a, b) => a.year - b.year);
  const kinds = [...new Set(EVENTS.map((e) => e.kind))];
  return (
    <section className="card events-list reveal">
      <p className="eyebrow">Major events</p>
      <h2>What was happening when the record moved?</h2>
      <p className="dim">
        Well-documented heat waves, droughts, floods and climate swings. Pick one to see what the NASA data actually show at that place and
        year, and to jump into its case file. Events also appear as markers on a case file's chart when they happened nearby.
      </p>
      <div className="chip-row">
        <button type="button" className={`chip${kind === "all" ? " on" : ""}`} onClick={() => setKind("all")}>All</button>
        {kinds.map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>{KINDS[k].label}</button>
        ))}
      </div>
      <ul className="case-grid">
        {list.map((e, i) => (
          <li key={e.id} className="reveal" style={{ "--d": `${i * 50}ms` }}>
            <button type="button" className="case-card" onClick={() => onSelect(e.id)}>
              <span className="eyebrow">{e.year} · <span style={{ color: KINDS[e.kind].color }}>{KINDS[e.kind].label}</span></span>
              <b>{e.name}</b>
              <span className="dim">{e.blurb.split(". ")[0]}.</span>
              <span className="open">See what the data show ▸</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
