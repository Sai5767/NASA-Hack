import { useEffect, useId, useRef } from "react";
import { INTEREST_IDS, MAX_PLACES, interestById, variablesFor } from "../../lib/profile.js";
import { useDialogFocus } from "../Modal.jsx";
import { TypeIcon } from "./ui.jsx";

/** Slot 1: saved places as a radio group of chips, plus "+" (opens Account ▸ places). Loads nothing itself. */
export function PlaceSwitcher({ places, place, onPlace, onSave, onAdd, canSave }) {
  const id = useId();
  if (!places.length && !place) {
    return (
      <div className="place-empty-card">
        <p className="slot-title">Add a place to start</p>
        <button type="button" className="btn btn-sm" onClick={onAdd}>+ Add a place</button>
        <p className="faint small">or click the globe</p>
      </div>
    );
  }
  const unsaved = place && !place.saved;
  return (
    <fieldset className="place-switcher">
      <legend className="eyebrow">Your places</legend>
      <div className="chip-row" role="radiogroup" aria-labelledby={`${id}-l`}>
        <span id={`${id}-l`} className="sr-only">Active place</span>
        {places.map((p) => (
          <label key={p.id} className={`chip radio-chip${place?.id === p.id ? " on" : ""}`}>
            <input type="radio" name={`${id}-place`} className="sr-only" checked={place?.id === p.id} onChange={() => onPlace(p)} />
            {place?.id === p.id && <span aria-hidden="true">✓</span>}
            {p.name}
          </label>
        ))}
        {unsaved && (
          <label className="chip radio-chip on">
            <input type="radio" name={`${id}-place`} className="sr-only" checked readOnly />
            <span aria-hidden="true">✓</span>
            {place.name} <small className="faint">(not saved)</small>
          </label>
        )}
        {places.length < MAX_PLACES && (
          <button type="button" className="chip chip-add" onClick={onAdd} aria-label="Add a place">+</button>
        )}
      </div>
      {unsaved && (
        <p className="small">
          {canSave ? (
            <button type="button" className="linklike" onClick={onSave}>Save {place.name} to your places</button>
          ) : (
            <span className="faint">5 of 5 saved — remove one in Account to save this spot</span>
          )}
        </p>
      )}
    </fieldset>
  );
}

/** Slot 2: the user's chosen data types as chips, then a variable select filtered to the chosen type. */
export function DataPicker({ interests, variables, variablesStatus, dataType, variableId, onDataType, onVariable }) {
  const id = useId();
  const shown = interests.length ? interests : INTEREST_IDS;
  const list = variablesFor(dataType, variables);
  return (
    <div className="data-picker">
      <p className="eyebrow" id={`${id}-types`}>Data</p>
      <div className="chip-row" role="group" aria-labelledby={`${id}-types`}>
        {shown.map((tid) => {
          const it = interestById(tid);
          const on = tid === dataType;
          return (
            <button
              key={tid}
              type="button"
              className={`chip type-chip${on ? " on" : ""}`}
              style={{ "--type": `var(--type-${tid})` }}
              aria-pressed={on}
              onClick={() => onDataType(tid)}
            >
              <TypeIcon id={tid} />
              {it.label}
              {on && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      {!interests.length && <p className="faint small">Showing everything — pick favourites in Account</p>}
      <label className="field">
        Variable
        <select
          value={list.some((v) => v.id === variableId) ? variableId : ""}
          onChange={(e) => onVariable(e.target.value)}
          disabled={!list.length}
        >
          {!list.some((v) => v.id === variableId) && <option value="" disabled>{variablesStatus === "error" ? "Variables unavailable" : variablesStatus === "loading" ? "Loading variables…" : "Choose a variable"}</option>}
          {list.map((v) => (
            <option key={v.id} value={v.id}>{v.label} ({v.units})</option>
          ))}
        </select>
      </label>
      {variablesStatus === "error" && <p className="field-error small">We couldn't load the variable list. Try reloading the page.</p>}
    </div>
  );
}

/**
 * The left dashboard (spec 1.6): cards in the spec's order. Slots 3–6 are supplied by the Insight and Globe agents
 * (components/main/*); each slot is a plain <section class="card dash-slot">, and nothing styles another agent's slot.
 *
 * On tablet (768–1199px) the same element is a left drawer: a focus-trapped dialog while open, inert while closed.
 */
export default function Dashboard({ drawerMode, open, onClose, header, children, footer }) {
  const ref = useRef(null);
  const asDialog = drawerMode && open;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hidden = drawerMode && !open;
    el.inert = hidden;
    if (hidden) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
  }, [drawerMode, open]);
  // After the inert flag above is cleared, so focus can move into the opened drawer.
  useDialogFocus(ref, onClose, asDialog);
  return (
    <>
      {asDialog && <div className="td-scrim dash-scrim" onMouseDown={onClose} aria-hidden="true" />}
      <aside
        ref={ref}
        id="dashboard"
        className={`dash${drawerMode ? " as-drawer" : ""}${open ? " open" : ""}`}
        role={asDialog ? "dialog" : "region"}
        aria-modal={asDialog || undefined}
        aria-label="Your dashboard"
      >
        {drawerMode && (
          <div className="dash-drawer-head">
            <p className="eyebrow">Dashboard</p>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} data-autofocus>✕ Close</button>
          </div>
        )}
        <section className="card dash-card dash-rise" style={{ "--d": "0ms" }}>{header}</section>
        {children}
        <footer className="dash-foot">{footer}</footer>
      </aside>
    </>
  );
}

/** One dashboard slot container. `name` is a data attribute for tests and the integration lead. */
export function Slot({ name, index, children }) {
  return (
    <section className="card dash-card dash-slot dash-rise" data-slot={name} style={{ "--d": `${Math.min(index, 4) * 40}ms` }}>
      {children}
    </section>
  );
}

