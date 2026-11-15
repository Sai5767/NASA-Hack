import { useId, useState } from "react";
import { formatPlace } from "../../lib/format.js";
import { PIN_LABEL_MAX, nextPinColor } from "../../lib/pins.js";
import { PIN_COLORS } from "../../lib/theme.js";

/** A colour swatch from the saved-pin palette (--pin-1..6). Colour is never the only cue: the label is always beside it. */
export function PinSwatch({ color }) {
  const i = Math.max(0, PIN_COLORS.findIndex((c) => c.id === color));
  return <i className="pin-swatch" style={{ "--swatch": `var(--pin-${i + 1})` }} aria-hidden="true" />;
}

/**
 * "Save pin": a label and one of six colours. `onSave({ label, color })`. Small inline form, not a dialog.
 */
export function SavePinForm({ defaultLabel, pins, onSave, onCancel }) {
  const id = useId();
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [color, setColor] = useState(() => nextPinColor(pins));
  return (
    <form
      className="save-pin"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ label: label.trim() || defaultLabel, color });
      }}
    >
      <label className="sr-only" htmlFor={`${id}-label`}>Pin label</label>
      <input id={`${id}-label`} className="save-pin-input" value={label} maxLength={PIN_LABEL_MAX} onChange={(e) => setLabel(e.target.value)} autoFocus />
      <div className="save-pin-colors" role="radiogroup" aria-label="Pin colour">
        {PIN_COLORS.map((c, i) => (
          <label key={c.id} className={`save-pin-color${color === c.id ? " on" : ""}`} title={c.label}>
            <input type="radio" className="sr-only" name={`${id}-color`} checked={color === c.id} onChange={() => setColor(c.id)} />
            <i className="pin-swatch" style={{ "--swatch": `var(--pin-${i + 1})` }} aria-hidden="true" />
            <span className="sr-only">{c.label}</span>
          </label>
        ))}
      </div>
      <div className="save-pin-actions">
        <button type="submit" className="btn btn-sm btn-primary">Save</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * The Saved view (Explore tab id "saved"): every saved pin with its question and scan summary. Open restores the pin
 * (and its scan from storage when the payload is still kept); Unpin deletes it.
 */
export default function SavedPins({ pins, variables, note, activeId, onOpen, onRemove, onDismissNote }) {
  const label = (id) => variables?.find((v) => v.id === id)?.label ?? id;
  return (
    <section className="saved-pins" aria-labelledby="saved-title">
      <h2 id="saved-title" className="saved-title">Saved pins</h2>
      {note && (
        <p className="saved-note" role="status">
          {note}
          {onDismissNote && <button type="button" className="linklike" onClick={onDismissNote}>Dismiss</button>}
        </p>
      )}
      {!pins.length ? (
        <p className="dim">No saved pins yet. Choose a place, then Save pin.</p>
      ) : (
        <ul className="saved-list">
          {pins.map((p) => {
            const s = p.scan?.summary;
            return (
              <li key={p.id} className={`saved-row${activeId === p.id ? " on" : ""}`}>
                <PinSwatch color={p.color} />
                <div className="saved-main">
                  <p className="saved-label">{p.label}</p>
                  <p className="saved-meta">
                    {label(p.variable)} · <span className="mono">{p.start}–{p.end}</span> · <span className="mono">{formatPlace(p.lat, p.lon)}</span>
                  </p>
                  {s && (
                    <p className="saved-meta">
                      Scan: <span className="mono">{s.holds}</span> of <span className="mono">{s.analysed}</span> squares hold after correction
                      {p.scan.dropped && <span className="faint"> · result will reload</span>}
                    </p>
                  )}
                </div>
                <div className="saved-actions">
                  <button type="button" className="btn btn-sm" onClick={() => onOpen(p)} aria-label={`Open ${p.label}`}>Open</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRemove(p.id)} aria-label={`Unpin ${p.label}`}>Unpin</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
