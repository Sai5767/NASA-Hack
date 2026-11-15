import { useEffect, useId, useRef } from "react";
import { INTEREST_IDS, MAX_PLACES, interestById, variablesFor } from "../../lib/profile.js";
import { useDialogFocus } from "../Modal.jsx";
import { TypeIcon } from "./ui.jsx";

/**
 * Place group: the active place as the group's value, the saved places as a quiet radio list, and small actions
 * (add a place, save pin, back to previous pin). Loads nothing itself.
 */
export function PlaceSwitcher({ places, place, onPlace, onAdd, actions }) {
  const id = useId();
  const unsaved = place && !place.saved;
  return (
    <div className="rail-place">
      {!places.length && !place ? (
        <button type="button" className="rail-empty-action" onClick={onAdd}>Choose a place</button>
      ) : (
        <div className="rail-list" role="radiogroup" aria-labelledby={`${id}-l`}>
          <span id={`${id}-l`} className="sr-only">Active place</span>
          {places.map((p) => (
            <label key={p.id} className={`rail-option${place?.id === p.id ? " on" : ""}`}>
              <input type="radio" name={`${id}-place`} className="sr-only" checked={place?.id === p.id} onChange={() => onPlace(p)} />
              <span className="rail-option-name">{p.name}</span>
            </label>
          ))}
          {unsaved && (
            <label className="rail-option on">
              <input type="radio" name={`${id}-place`} className="sr-only" checked readOnly />
              <span className="rail-option-name">{place.name}</span>
              <span className="rail-option-note">pinned</span>
            </label>
          )}
          {places.length < MAX_PLACES && (
            <button type="button" className="rail-add" onClick={onAdd} aria-label="Add a place">+ Add</button>
          )}
        </div>
      )}
      {actions}
    </div>
  );
}

/** Subject group: the user's chosen data types as quiet chips, then a variable select filtered to the chosen type. */
export function DataPicker({ interests, variables, variablesStatus, dataType, variableId, onDataType, onVariable }) {
  const id = useId();
  const shown = interests.length ? interests : INTEREST_IDS;
  const list = variablesFor(dataType, variables);
  return (
    <div className="data-picker">
      <div className="chip-row" role="group" aria-label="Data type">
        {shown.map((tid) => {
          const it = interestById(tid);
          const on = tid === dataType;
          return (
            <button key={tid} type="button" className={`chip type-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => onDataType(tid)}>
              <TypeIcon id={tid} />
              {it.label}
            </button>
          );
        })}
      </div>
      <label className="sr-only" htmlFor={`${id}-var`}>Variable</label>
      <select
        id={`${id}-var`}
        className="rail-select"
        value={list.some((v) => v.id === variableId) ? variableId : ""}
        onChange={(e) => onVariable(e.target.value)}
        disabled={!list.length}
      >
        {!list.some((v) => v.id === variableId) && (
          <option value="" disabled>{variablesStatus === "error" ? "Variables unavailable" : variablesStatus === "loading" ? "Loading…" : "Pick something to follow"}</option>
        )}
        {list.map((v) => (
          <option key={v.id} value={v.id}>{v.label} ({v.units})</option>
        ))}
      </select>
      {variablesStatus === "error" && <p className="field-error">Couldn't load the list. Try reloading.</p>}
    </div>
  );
}

/** One quiet rail group: a short label, then its content; groups are separated by one hairline. */
export function RailGroup({ label, children, name }) {
  const id = useId();
  return (
    <section className="rail-group" data-group={name} aria-labelledby={`${id}-g`}>
      <h2 id={`${id}-g`} className="rail-label">{label}</h2>
      {children}
    </section>
  );
}

/**
 * The left control rail (V3 section 4): three quiet groups, hairlines, no cards.
 * Tablet and phone (`sheet`): a bottom sheet. Closed, it shows one peek row (`peek`) that opens it; open, it is a
 * focus-trapped dialog that scrolls inside itself while the globe stays dominant above it.
 */
export default function Dashboard({ sheet, open, onOpen, onClose, peek, children, footer }) {
  const ref = useRef(null);
  const asDialog = sheet && open;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hidden = sheet && !open;
    el.inert = hidden;
    if (hidden) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
  }, [sheet, open]);
  useDialogFocus(ref, onClose, asDialog);
  return (
    <>
      {sheet && !open && (
        <button type="button" className="rail-peek" onClick={onOpen} aria-expanded="false" aria-controls="dashboard">
          <span className="rail-peek-grip" aria-hidden="true" />
          <span className="rail-peek-text">{peek}</span>
          <span className="rail-peek-open" aria-hidden="true">⌃</span>
          <span className="sr-only">Open controls</span>
        </button>
      )}
      {asDialog && <div className="td-scrim rail-scrim" onMouseDown={onClose} aria-hidden="true" />}
      <aside
        ref={ref}
        id="dashboard"
        className={`rail${sheet ? " as-sheet" : ""}${open ? " open" : ""}`}
        role={asDialog ? "dialog" : "region"}
        aria-modal={asDialog || undefined}
        aria-label="Controls"
      >
        {sheet && (
          <div className="rail-sheet-head">
            <span className="rail-peek-grip" aria-hidden="true" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} data-autofocus aria-label="Close controls">✕</button>
          </div>
        )}
        {children}
        {footer && <footer className="rail-foot">{footer}</footer>}
      </aside>
    </>
  );
}

/** Kept for older imports: a plain rail group without a label. */
export function Slot({ name, children }) {
  return (
    <section className="rail-group" data-slot={name}>
      {children}
    </section>
  );
}
