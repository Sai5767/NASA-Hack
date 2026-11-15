import { useEffect, useId, useRef, useState } from "react";
import { formatPlace } from "../../lib/format.js";
import { nearestPlace } from "../../lib/geo.js";
import { INTERESTS, MAX_PLACES, addPlace, hasPlace, removePlace, toggleInterest } from "../../lib/profile.js";
import Globe from "../Globe.jsx";
import PlaceSearch from "./PlaceSearch.jsx";
import { TypeIcon } from "./ui.jsx";

/** The chips of chosen places, with remove buttons. Shared with the Account panel. */
export function PlaceChips({ places, onRemove }) {
  if (!places.length) return null;
  return (
    <ul className="place-chips" aria-label="Your places">
      {places.map((p) => (
        <li key={p.id} className="chip on">
          {p.name}
          <button type="button" className="chip-x" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}>✕</button>
        </li>
      ))}
    </ul>
  );
}

/** Search + optional pin map for choosing up to five places. `onChange` receives an updater function (profile → profile). */
export function PlacePicker({ value, places, placesStatus, onChange }) {
  const [mapOpen, setMapOpen] = useState(false);
  const full = value.places.length >= MAX_PLACES;
  const add = (p) => onChange((v) => addPlace(v, p));
  const pick = (lat, lon) => {
    if (full) return;
    const near = nearestPlace(places ?? [], lat, lon, 150);
    add({ name: near?.name ?? formatPlace(lat, lon), lat, lon });
  };
  return (
    <div className="place-picker">
      <PlaceSearch places={places} status={placesStatus} disabled={full} onAdd={add} isSaved={(lat, lon) => hasPlace(value, lat, lon)} />
      <div className="pin-row">
        <span className="dim small">Or pin on the map:</span>
        <button type="button" className="btn btn-sm" aria-expanded={mapOpen} onClick={() => setMapOpen((o) => !o)}>
          {mapOpen ? "Close the pin map" : "Open the pin map"}
        </button>
      </div>
      {mapOpen && (
        <div className="pin-map">
          <Globe
            pins={value.places.map((p) => ({ lat: p.lat, lon: p.lon, color: "#b3a1ff", label: "" }))}
            idleSpin={false}
            onPick={pick}
          />
          {full && <p className="pin-map-note mono small">5 of 5 — remove one to add another</p>}
        </div>
      )}
      <p className="eyebrow places-count" aria-live="polite">
        Your places {value.places.length} of {MAX_PLACES}
        {full && <span className="dim"> — remove one to add another</span>}
      </p>
      <PlaceChips places={value.places} onRemove={(id) => onChange((v) => removePlace(v, id))} />
    </div>
  );
}

/** The six data-type tiles (aria-pressed toggles, check mark when chosen). Shared with the Account panel. `onChange` receives an updater. */
export function InterestTiles({ value, onChange, compact = false }) {
  return (
    <ul className={`type-tiles${compact ? " compact" : ""}`} aria-label="Data types">
      {INTERESTS.map((it) => {
        const on = value.interests.includes(it.id);
        return (
          <li key={it.id}>
            <button
              type="button"
              className={`type-tile${on ? " on" : ""}`}
              style={{ "--type": `var(--type-${it.id})` }}
              aria-pressed={on}
              onClick={() => onChange((v) => toggleInterest(v, it.id))}
            >
              <TypeIcon id={it.id} />
              <span>{it.label}</span>
              <i className="type-check" aria-hidden="true">{on ? "✓" : ""}</i>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Exactly two questions (spec 1.4): preferred places, then data types. "Skip for now" is on every step. The profile is
 * edited as a draft here and handed back on Finish or Skip.
 */
export default function Onboarding({ profile, places, placesStatus, onFinish, onSkip }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(profile);
  const headingRef = useRef(null);
  const id = useId();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const canContinue = step === 0 ? draft.places.length > 0 : draft.interests.length > 0;
  return (
    <section className="onboarding card-swap" key={step} aria-labelledby={`${id}-q`}>
      <div className="ob-progress">
        <p className="eyebrow">Question {step + 1} of 2</p>
        <span className="ob-bars" aria-hidden="true">
          <i className="on" />
          <i className={step === 1 ? "on" : ""} />
        </span>
      </div>

      {step === 0 ? (
        <>
          <h2 id={`${id}-q`} className="ob-question" tabIndex={-1} ref={headingRef}>Which places matter to you?</h2>
          <p className="dim">Choose up to five. You can change them later.</p>
          <PlacePicker value={draft} places={places} placesStatus={placesStatus} onChange={setDraft} />
        </>
      ) : (
        <>
          <h2 id={`${id}-q`} className="ob-question" tabIndex={-1} ref={headingRef}>Which kinds of data do you care about?</h2>
          <p className="dim">Pick any. These decide what your dashboard loads.</p>
          <InterestTiles value={draft} onChange={setDraft} />
        </>
      )}

      <div className="ob-actions">
        {step === 1 && <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>}
        <button type="button" className="linklike ob-skip" onClick={() => onSkip(draft)}>Skip for now</button>
        <span className="ob-spacer" />
        {!canContinue && (
          <span className="faint small ob-hint" id={`${id}-hint`}>
            {step === 0 ? "Choose at least one place, or skip for now" : "Choose at least one, or skip for now"}
          </span>
        )}
        {step === 0 ? (
          <button type="button" className="btn btn-primary" disabled={!canContinue} aria-describedby={!canContinue ? `${id}-hint` : undefined} onClick={() => setStep(1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canContinue} aria-describedby={!canContinue ? `${id}-hint` : undefined} onClick={() => onFinish(draft)}>
            Finish
          </button>
        )}
      </div>
    </section>
  );
}
