import { useEffect, useState } from "react";
import { fetchTrend } from "../api.js";
import { FIRST_YEAR, LAST_FULL_YEAR } from "../lib/cases.js";
import { signed } from "../lib/format.js";
import Sparkline from "./charts/Sparkline.jsx";

const summaries = new Map(); // remembered for the session so the list is instant after the first look

/** Loads one watch item's trend after a short stagger, so a long list does not hit NASA all at once. */
function useSummary(item, delay) {
  const [state, setState] = useState(() => summaries.get(item.id) ?? { loading: true });
  useEffect(() => {
    const cached = summaries.get(item.id);
    if (cached) {
      setState(cached);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchTrend({ variable: item.variable, lat: item.lat, lon: item.lon, start_year: FIRST_YEAR, end_year: LAST_FULL_YEAR }, controller.signal)
        .then((d) => {
          const s = {
            loading: false,
            values: d.annual.map((a) => a.value),
            slope: d.stats.slope_per_decade,
            units: d.variable.units,
            significant: d.stats.significant,
            sign: d.stats.sign,
          };
          summaries.set(item.id, s);
          setState(s);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setState({ loading: false, error: true });
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [item.id, item.variable, item.lat, item.lon, delay]);
  return state;
}

function Row({ item, label, index, onOpen, onRemove }) {
  const s = useSummary(item, index * 350);
  const tone = s.significant ? s.sign : "flat";
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--flat)";
  return (
    <li className={`watch-row ${tone}`}>
      <button type="button" className="watch-main" onClick={() => onOpen(item)}>
        <span className="watch-name">
          <b>{item.name}</b>
          <small className="dim">{label}</small>
        </span>
        <span className="watch-spark">
          {s.values ? <Sparkline values={s.values} color={color} width={92} height={28} /> : <span className="faint mono">{s.error ? "n/a" : "…"}</span>}
        </span>
        <span className="watch-delta mono">
          {s.values && (
            <>
              <b>{signed(s.slope, 2)}</b>
              <small>
                {s.units}/decade {s.significant ? (s.sign === "up" ? "▲" : "▼") : "—"}
              </small>
            </>
          )}
        </span>
      </button>
      <button type="button" className="btn btn-sm btn-ghost" aria-label={`Stop watching ${item.name}`} onClick={() => onRemove(item.id)}>✕</button>
    </li>
  );
}

/** Saved places with a sparkline and trend, like a stock watchlist. Stored in the browser only. */
export default function Watchlist({ items, variables, onOpen, onRemove }) {
  const label = (id) => variables.find((v) => v.id === id)?.label ?? id;
  return (
    <section className="card watchlist reveal" style={{ "--d": "250ms" }}>
      <div className="watch-head">
        <h3>Your watchlist</h3>
        <span className="faint small mono">{items.length ? `${items.length} saved · stays in this browser` : "stays in this browser"}</span>
      </div>
      {items.length === 0 ? (
        <p className="dim small">
          Nothing here yet. Open any case file and press <b>☆ Watch</b> to keep a place and variable here, with its trend at a glance.
        </p>
      ) : (
        <ul>
          {items.map((w, i) => (
            <Row key={w.id} item={w} label={label(w.variable)} index={i} onOpen={onOpen} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}
