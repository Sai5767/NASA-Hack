import { useEffect, useState } from "react";
import { fetchTrend } from "../api.js";
import { FIRST_YEAR, LAST_FULL_YEAR } from "../lib/cases.js";
import { EVENTS, KINDS, describeEvent, eventStats } from "../lib/events.js";
import { chartSpec } from "../lib/chart.js";
import { formatPlace } from "../lib/format.js";
import ExpandableChart from "./charts/ChartViewer.jsx";
import Loading from "./Loading.jsx";
import Term from "./Term.jsx";

const KindTag = ({ k }) => (
  <span className="ev-kind"><span aria-hidden="true">{KINDS[k].glyph} </span>{KINDS[k].label}</span>
);

/**
 * Yearly departures from the other years' average, with the event years picked out (solid white) against the other
 * years (grey). Exported and self-contained (one <svg>, values from props) so the shared ChartViewer from
 * components/charts/ can wrap it: <ExpandableChart title=… rows={annual}><EventBars … /></ExpandableChart>.
 */
export function EventBars({ annual, event, stats, units }) {
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
            fill={inEvent ? "var(--text)" : "var(--grey-600)"}
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
      <p className="mono dim">
        {variable.label} ({variable.units}) at {formatPlace(event.lat, event.lon)}, one NASA <Term id="gridcell">grid square</Term>
      </p>
      {stats && (
        <ExpandableChart
          spec={chartSpec({
            title: `${variable.label} at ${formatPlace(event.lat, event.lon)}, yearly`,
            source: "NASA POWER",
            unit: variable.units,
            variable: variable.id,
            series: [
              { id: "other", label: "Other years", type: "bars", style: "muted", data: annual.filter((a) => a.year < event.from || a.year > event.to).map((a) => ({ x: a.year, y: a.value })) },
              { id: "event", label: "Event years", type: "bars", data: annual.filter((a) => a.year >= event.from && a.year <= event.to).map((a) => ({ x: a.year, y: a.value })) },
            ],
            markers: [{ x: event.year, label: event.name }],
          })}
        >
          <EventBars annual={annual} event={event} stats={stats} units={variable.units} />
        </ExpandableChart>
      )}
      {stats && (
        <p className="legend-line">
          <i style={{ background: "var(--text)" }} /> event years <i style={{ background: "var(--grey-600)" }} /> other years <span className="faint">bars: above or below the other years' <Term id="baseline">average</Term></span>
        </p>
      )}
      <p className={stats?.standsOut ? "evidence-yes" : "evidence-no"}>{describeEvent(stats, event, variable.units)}</p>
      <p className="faint">
        Annual averages of a 0.5° grid square can dilute a short extreme or miss an event that struck a few hundred kilometres away. This shows
        what is in the data, not whether the event happened.
      </p>
    </div>
  );
}

function EventDetail({ event, onBack, onOpenCase, onOpenVitals }) {
  const span = event.from === event.to ? event.from : `${event.from}–${event.to}`;
  return (
    <article className="event-detail">
      <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>← All events</button>
      <section className="event-head">
        <p className="event-meta"><span className="mono">{span}</span> · <KindTag k={event.kind} /></p>
        <h2 className="tool-title">{event.name}</h2>
        <p>{event.blurb}</p>
        <p className="look-for"><b>What to look for</b> {event.lookFor}</p>
        <p className="faint">Context from: {event.sources.join("; ")}. Written as background, not as a result of this app's data.</p>
      </section>
      <section className="event-card">
        <h3>What the data show here</h3>
        <EventEvidence event={event} />
      </section>
      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={() => onOpenCase(event)}>Open the case file here ›</button>
        {event.scope === "global" && <button type="button" className="btn" onClick={onOpenVitals}>See it in Vitals ›</button>}
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
    <section className="events-list">
      <h2 className="tool-title">What was happening when the record moved?</h2>
      <p className="tool-lead">Famous heat waves, droughts, floods and climate swings. Pick one to see what the data show there.</p>
      <div className="chip-row" role="group" aria-label="Filter by kind">
        <button type="button" className={`chip${kind === "all" ? " on" : ""}`} aria-pressed={kind === "all"} onClick={() => setKind("all")}>All</button>
        {kinds.map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}><span aria-hidden="true">{KINDS[k].glyph} </span>{KINDS[k].label}</button>
        ))}
      </div>
      <ul className="case-grid">
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" className="case-card" onClick={() => onSelect(e.id)}>
              <span className="event-meta"><span className="mono">{e.year}</span> · <KindTag k={e.kind} /></span>
              <b>{e.name}</b>
              <span className="dim">{e.blurb.split(". ")[0]}.</span>
              <span className="open">See what the data show ›</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
