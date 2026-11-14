import { useMemo } from "react";
import { FIRST_YEAR, INTAKE_PLACES, LAST_FULL_YEAR } from "../lib/cases.js";

/** Case setup: variable, place and years. Place clicks on the globe update these fields too. */
export default function SetupPanel({ variables, draft, onDraft, onVariable, onApply, onPlace, disabled, message }) {
  const groups = useMemo(() => {
    const out = {};
    variables.forEach((v) => {
      (out[v.group] ??= []).push(v);
    });
    return out;
  }, [variables]);
  const selected = variables.find((v) => v.id === draft.variable);

  return (
    <form
      className="card hud-card setup"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <label className="field">
        Variable to investigate
        <select value={draft.variable} onChange={(e) => onVariable(e.target.value)}>
          {Object.entries(groups).map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((v) => (
                <option key={v.id} value={v.id}>{v.label} ({v.units})</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {selected && (
        <p className="var-desc">
          {selected.description}
          {selected.land_only && <span className="badge">land only</span>}
          {selected.note && <span className="badge warn" title={selected.note}>model-derived</span>}
        </p>
      )}

      <div className="setup-grid">
        <label className="field">
          Latitude
          <input type="number" inputMode="decimal" step="0.01" min="-90" max="90" value={draft.lat} onChange={(e) => onDraft({ lat: e.target.value })} />
        </label>
        <label className="field">
          Longitude
          <input type="number" inputMode="decimal" step="0.01" min="-180" max="180" value={draft.lon} onChange={(e) => onDraft({ lon: e.target.value })} />
        </label>
        <label className="field">
          From year
          <input type="number" inputMode="numeric" min={FIRST_YEAR} max={LAST_FULL_YEAR} value={draft.start} onChange={(e) => onDraft({ start: e.target.value })} />
        </label>
        <label className="field">
          To year
          <input type="number" inputMode="numeric" min={FIRST_YEAR} max={LAST_FULL_YEAR + 1} value={draft.end} onChange={(e) => onDraft({ end: e.target.value })} />
        </label>
      </div>

      <div className="setup-foot">
        <div className="presets" aria-label="Quick places">
          {INTAKE_PLACES.map((p) => (
            <button type="button" key={p.id} className="chip" onClick={() => onPlace(p)} title={p.hint}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" type="submit" disabled={disabled}>
          Investigate ▸
        </button>
      </div>
      {message && <p className="form-msg" role="alert">{message}</p>}
    </form>
  );
}
