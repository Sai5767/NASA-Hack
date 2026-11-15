import { useMemo } from "react";
import { formatPlace } from "../lib/format.js";
import { FIRST_YEAR, INTAKE_PLACES, LAST_FULL_YEAR } from "../lib/cases.js";

/**
 * "Adjust" (owner items 2 and 3): variable, coordinates and years as one collapsed disclosure. It no longer sits above
 * every Explore tool and no longer holds "Ask" (that is its own tool now): ExplorePanel shows it only for the place
 * tools (case file, Sweep, Scan, Duel). Globe clicks still update these fields.
 *
 * Props: variables, draft, onDraft(patch), onVariable(id), onApply(), onPlace(place), disabled, message,
 *        open (optional: start expanded, e.g. when there is no pin yet). `places` / `onAsk` are accepted and ignored.
 */
export default function SetupPanel({ variables, draft, onDraft, onVariable, onApply, onPlace, disabled, message, open }) {
  const groups = useMemo(() => {
    const out = {};
    variables.forEach((v) => {
      (out[v.group] ??= []).push(v);
    });
    return out;
  }, [variables]);
  const selected = variables.find((v) => v.id === draft.variable);
  const lat = Number(draft.lat);
  const lon = Number(draft.lon);
  const where = draft.lat !== "" && draft.lon !== "" && Number.isFinite(lat) && Number.isFinite(lon) ? formatPlace(lat, lon) : "no place yet";

  return (
    <details className="td-disclosure setup" open={open || !!message || undefined}>
      <summary>
        Adjust <span className="setup-sum faint">{selected?.label ?? "variable"} · {where} · <span className="mono">{draft.start}–{draft.end}</span></span>
      </summary>
      <form
        className="td-disclosure-body setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        <label className="field field-wide">
          What to measure
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
            {selected.note && <span className="badge" title={selected.note}>model-derived</span>}
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
            Apply
          </button>
        </div>
        {message && <p className="form-msg" role="alert">{message}</p>}
      </form>
    </details>
  );
}
