import { useEffect, useId, useMemo, useState } from "react";
import { parseQuestion } from "../lib/ask.js";
import { FIRST_YEAR, LAST_FULL_YEAR } from "../lib/cases.js";
import { formatPlace } from "../lib/format.js";
import Term from "./Term.jsx";

const EXAMPLES = ["Is Phoenix getting hotter?", "Amazon rain since 2000", "Is it getting cloudier in London?", "Sunlight in the Sahara 1990 to 2020"];

const round2 = (n) => Math.round(n * 100) / 100;
const yearOr = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/**
 * Explore ▸ Ask (owner items 2 and 3). The typed question decides the place and the variable (lib/ask.js keyword list
 * and the bundled gazetteer: no AI, nothing leaves the browser). Variable, latitude, longitude and years sit in an
 * optional "Adjust" disclosure, pre-filled from the question, so nobody has to pick a variable first.
 *
 * Props:
 *   places, variables         gazetteer and /api/variables
 *   currentVariable           the app's variable, kept when the question names none
 *   current                   optional current params { lat, lon, start, end } (pre-fills years and coordinates)
 *   onInvestigate(params)     { variable, lat, lon, start, end } → open the case file (App: commit + go to "investigate")
 *   onAsk(suggestion)         fallback when onInvestigate is not wired: the V2 { type: "place", place, variable } seam
 *   disabled                  e.g. while variables are loading
 */
export default function AskBox({ places = [], variables = [], currentVariable, current, onInvestigate, onAsk, disabled }) {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [adjust, setAdjust] = useState(null); // user edits in the Adjust form; null = follow the question
  const [msg, setMsg] = useState("");
  const inputId = useId();
  const parsed = useMemo(() => (asked ? parseQuestion(asked, places, currentVariable) : null), [asked, places, currentVariable]);
  const live = useMemo(() => (query.trim() ? parseQuestion(query, places, currentVariable) : null), [query, places, currentVariable]);
  const varLabel = (id) => variables.find((v) => v.id === id)?.label ?? id ?? "—";
  const varUnits = (id) => variables.find((v) => v.id === id)?.units ?? "";

  // What the question decided, before any adjustment.
  const fromQuestion = useMemo(() => {
    if (!parsed) return null;
    const lat = parsed.coords?.lat ?? parsed.place?.lat ?? current?.lat;
    const lon = parsed.coords?.lon ?? parsed.place?.lon ?? current?.lon;
    return {
      variable: parsed.variable ?? currentVariable ?? variables[0]?.id ?? "",
      lat: lat != null ? String(round2(lat)) : "",
      lon: lon != null ? String(round2(lon)) : "",
      start: String(parsed.years?.start ?? current?.start ?? FIRST_YEAR),
      end: String(parsed.years?.end ?? current?.end ?? LAST_FULL_YEAR),
    };
  }, [parsed, current, currentVariable, variables]);
  const form = adjust ?? fromQuestion;

  useEffect(() => {
    setAdjust(null);
    setMsg("");
  }, [asked]);

  const submitQuestion = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setAsked(query.trim());
  };

  const go = () => {
    if (!form) return;
    const lat = Number(form.lat);
    const lon = Number(form.lon);
    const start = yearOr(form.start, FIRST_YEAR);
    const end = yearOr(form.end, LAST_FULL_YEAR);
    if (!form.lat || !form.lon || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setMsg("We need a place. Name a city or landscape, or type coordinates in Adjust.");
      return;
    }
    if (end - start < 9) {
      setMsg("Choose at least 10 years so a trend can be tested.");
      return;
    }
    setMsg("");
    const params = { variable: form.variable, lat: round2(lat), lon: round2(lon), start, end };
    if (onInvestigate) onInvestigate(params);
    else if (onAsk && parsed?.place) onAsk({ type: "place", place: { ...parsed.place, lat: params.lat, lon: params.lon }, variable: params.variable });
  };

  const edit = (patch) => setAdjust({ ...(form ?? {}), ...(patch.lat != null || patch.lon != null ? { name: undefined } : {}), ...patch });
  const placeName = parsed?.coords ? formatPlace(parsed.coords.lat, parsed.coords.lon) : parsed?.place?.name;

  return (
    <section className="ask-tool" aria-labelledby={`${inputId}-h`}>
      <h2 id={`${inputId}-h`} className="tool-title">Ask a question</h2>
      <p className="tool-lead">Type it in your own words. We pick the place and what to measure.</p>

      <form className="ask-form" onSubmit={submitQuestion}>
        <label className="sr-only" htmlFor={inputId}>Your question</label>
        <input
          id={inputId}
          className="ask-input"
          type="search"
          value={query}
          placeholder="Is Phoenix getting hotter?"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
        <button type="submit" className="btn btn-primary" disabled={!query.trim()}>Ask</button>
      </form>

      {!asked && (
        <div className="ask-examples" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => { setQuery(q); setAsked(q); }}>{q}</button>
          ))}
        </div>
      )}
      {live && query.trim() !== asked && (
        <p className="ask-live" aria-live="polite">
          {live.ready ? <>Looks like <b>{live.coords ? formatPlace(live.coords.lat, live.coords.lon) : live.place.name}</b> · {varLabel(live.variable)}</> : "Name a place, for example a city, a desert or a forest."}
        </p>
      )}

      {parsed && (
        <div className="ask-result" aria-live="polite">
          {parsed.ready ? (
            <>
              <dl className="ask-read">
                <div><dt>Place</dt><dd>{form?.name ?? (adjust && (adjust.lat !== fromQuestion?.lat || adjust.lon !== fromQuestion?.lon) ? formatPlace(Number(adjust.lat), Number(adjust.lon)) : placeName)}{parsed.place?.kind ? <span className="faint"> · {parsed.place.kind}</span> : null}</dd></div>
                <div>
                  <dt>Measuring</dt>
                  <dd>
                    {varLabel(form?.variable)}
                    {varUnits(form?.variable) && <span className="faint mono"> {varUnits(form?.variable)}</span>}
                    {parsed.variableFrom === "kept" && !adjust && <span className="faint"> (your current choice)</span>}
                  </dd>
                </div>
                <div><dt>Years</dt><dd className="mono">{form?.start}–{form?.end}</dd></div>
              </dl>
              {parsed.alternatives.length > 0 && (
                <p className="ask-alt">
                  <span className="faint">Did you mean </span>
                  {parsed.alternatives.slice(0, 3).map((p) => (
                    <button key={p.id} type="button" className="linklike" onClick={() => setAdjust({ ...(form ?? {}), lat: String(round2(p.lat)), lon: String(round2(p.lon)), name: p.name })}>{p.name}</button>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="ask-miss">We couldn't find a place in that. Try a city, a landscape such as “Amazon” or “Sahara”, or open Adjust and type coordinates.</p>
          )}

          <details className="td-disclosure ask-adjust" open={!parsed.ready || undefined}>
            <summary>Adjust</summary>
            <div className="td-disclosure-body ask-adjust-grid">
              <label className="field field-wide">
                What to measure
                <select value={form?.variable ?? ""} onChange={(e) => edit({ variable: e.target.value })}>
                  {variables.map((v) => <option key={v.id} value={v.id}>{v.label} ({v.units})</option>)}
                </select>
              </label>
              <label className="field">
                Latitude
                <input type="number" inputMode="decimal" step="0.01" min="-90" max="90" value={form?.lat ?? ""} onChange={(e) => edit({ lat: e.target.value })} />
              </label>
              <label className="field">
                Longitude
                <input type="number" inputMode="decimal" step="0.01" min="-180" max="180" value={form?.lon ?? ""} onChange={(e) => edit({ lon: e.target.value })} />
              </label>
              <label className="field">
                From year
                <input type="number" inputMode="numeric" min={FIRST_YEAR} max={LAST_FULL_YEAR} value={form?.start ?? ""} onChange={(e) => edit({ start: e.target.value })} />
              </label>
              <label className="field">
                To year
                <input type="number" inputMode="numeric" min={FIRST_YEAR} max={LAST_FULL_YEAR + 1} value={form?.end ?? ""} onChange={(e) => edit({ end: e.target.value })} />
              </label>
              {adjust && <button type="button" className="linklike" onClick={() => setAdjust(null)}>Back to what the question said</button>}
              <p className="faint ask-units">Values are averages over one <Term id="gridcell">grid square</Term>.</p>
            </div>
          </details>

          <div className="ask-go">
            <button type="button" className="btn btn-primary" onClick={go} disabled={disabled || !form}>Check for change ›</button>
            {msg && <p className="form-msg" role="alert">{msg}</p>}
          </div>
        </div>
      )}
      <p className="faint ask-note">A keyword list and a place list, not an AI. Nothing you type leaves your browser.</p>
    </section>
  );
}
