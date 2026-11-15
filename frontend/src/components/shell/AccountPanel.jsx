import { useEffect, useId, useRef, useState } from "react";
import { DETAIL_LEVELS, LABEL_MAX, MAX_PLACES, addPlace, applyImport, exportProfile, hasPlace, importProfile, movePlace, removePlace, setLabel, setPrefs } from "../../lib/profile.js";
import Modal from "../Modal.jsx";
import { InterestTiles } from "./Onboarding.jsx";
import PlaceSearch from "./PlaceSearch.jsx";

export const ACCOUNT_NOTICE = "Stored on this device for this demo. This is not a secure online account.";

/**
 * The Account panel body (spec 5.3). Rendered inside the shell's right drawer / mobile sheet.
 * Every change is applied immediately through `onChange`; the shell saves it to localStorage.
 */
export default function AccountPanel({ profile, onChange, places, placesStatus, storageStatus, onReset, onAbout, version }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabelText] = useState(profile.account?.label ?? "");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef(null);
  const id = useId();
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next) => {
    onChange(next);
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  };

  const doExport = () => {
    const blob = new Blob([exportProfile(profile)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trend-detective-profile.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (file) => {
    setImportMsg("");
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importProfile(text); // throws IMPORT_ERROR before anything changes
      change((cur) => applyImport(cur, imported));
      setImportMsg("Profile imported.");
    } catch (e) {
      setImportMsg(e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const full = profile.places.length >= MAX_PLACES;

  return (
    <div className="account-panel">
      <p className="td-notice td-notice--info"><span aria-hidden="true">ⓘ </span>{ACCOUNT_NOTICE}</p>
      {storageStatus === "blocked" && (
        <p className="td-notice td-notice--warn">Your browser is blocking storage. Your choices will last only until this tab closes.</p>
      )}
      <p className="sr-only" aria-live="polite">{saved ? "Saved on this device" : ""}</p>
      {saved && <p className="saved-flag mono small" aria-hidden="true">✓ Saved on this device</p>}

      <section className="acct-section" aria-labelledby={`${id}-who`}>
        <h3 id={`${id}-who`} className="eyebrow">Signed in as</h3>
        {editing ? (
          <form
            className="label-edit"
            onSubmit={(e) => {
              e.preventDefault();
              change((cur) => setLabel(cur, label));
              setEditing(false);
            }}
          >
            <label className="sr-only" htmlFor={`${id}-label`}>Display label</label>
            <input id={`${id}-label`} value={label} maxLength={LABEL_MAX} onChange={(e) => setLabelText(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm" disabled={!label.trim()}>Save</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(false); setLabelText(profile.account?.label ?? ""); }}>Cancel</button>
          </form>
        ) : (
          <div className="acct-row">
            <b className="mono">{profile.account?.label}</b>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>Edit label</button>
          </div>
        )}
      </section>

      <section className="acct-section" aria-labelledby={`${id}-places`}>
        <h3 id={`${id}-places`} className="eyebrow">My places {profile.places.length} of {MAX_PLACES}</h3>
        {profile.places.length === 0 && <p className="dim small">No places yet. Add one below or click the globe on Main.</p>}
        <ol className="acct-places">
          {profile.places.map((p, i) => (
            <li key={p.id}>
              <span className="acct-place-name">{p.name}</span>
              <span className="acct-place-tools">
                <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => change((cur) => movePlace(cur, p.id, -1))} aria-label={`Move ${p.name} up`}>▲</button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={i === profile.places.length - 1} onClick={() => change((cur) => movePlace(cur, p.id, 1))} aria-label={`Move ${p.name} down`}>▼</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => change((cur) => removePlace(cur, p.id))} aria-label={`Remove ${p.name}`}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        {adding ? (
          <div className="acct-add">
            <PlaceSearch
              places={places}
              status={placesStatus}
              disabled={full}
              isSaved={(lat, lon) => hasPlace(profile, lat, lon)}
              onAdd={(pl) => change((cur) => addPlace(cur, pl))}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>Done</button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" disabled={full} onClick={() => setAdding(true)}>
            {full ? "5 of 5 — remove one to add another" : "+ Add a place"}
          </button>
        )}
      </section>

      <section className="acct-section" aria-labelledby={`${id}-types`}>
        <h3 id={`${id}-types`} className="eyebrow">Data types I care about</h3>
        <InterestTiles value={profile} onChange={(fn) => change(fn)} compact />
      </section>

      <section className="acct-section" aria-labelledby={`${id}-prefs`}>
        <h3 id={`${id}-prefs`} className="eyebrow">Preferences</h3>
        <div className="acct-row">
          <span id={`${id}-motion`}>Reduce motion</span>
          <div className="seg" role="group" aria-labelledby={`${id}-motion`}>
            <button type="button" className={!profile.prefs.reduceMotion ? "on" : ""} aria-pressed={!profile.prefs.reduceMotion} onClick={() => change((cur) => setPrefs(cur, { reduceMotion: false }))}>Off</button>
            <button type="button" className={profile.prefs.reduceMotion ? "on" : ""} aria-pressed={profile.prefs.reduceMotion} onClick={() => change((cur) => setPrefs(cur, { reduceMotion: true }))}>On</button>
          </div>
        </div>
        <div className="acct-row">
          <span id={`${id}-detail`}>Detail level</span>
          <div className="seg" role="group" aria-labelledby={`${id}-detail`}>
            {DETAIL_LEVELS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={profile.prefs.detail === d.id ? "on" : ""}
                aria-pressed={profile.prefs.detail === d.id}
                onClick={() => change((cur) => setPrefs(cur, { detail: d.id, view: null }))}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="acct-section" aria-labelledby={`${id}-data`}>
        <h3 id={`${id}-data`} className="eyebrow">Your data</h3>
        <div className="acct-actions">
          <button type="button" className="btn btn-sm" onClick={doExport}>Export profile</button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>Import profile</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
        {importMsg && <p className={`small ${importMsg === "Profile imported." ? "dim" : "field-error"}`} role="status">{importMsg}</p>}
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmReset(true)}>Reset and sign out</button>
      </section>

      <footer className="acct-foot faint small">
        <button type="button" className="linklike" onClick={onAbout}>About &amp; credits</button>
        <span className="mono"> · Version {version}</span>
        <p>Independent project, not endorsed by NASA.</p>
      </footer>

      {confirmReset && (
        <Modal title="Remove your profile from this device?" onClose={() => setConfirmReset(false)}>
          <p className="dim">This deletes your saved places and preferences here and returns to the sign-in page.</p>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={onReset}>Remove and sign out</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
