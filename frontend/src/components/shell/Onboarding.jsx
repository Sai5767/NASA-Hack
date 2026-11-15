import { useEffect, useId, useRef, useState } from "react";
import { INTAKE_PLACES } from "../../lib/cases.js";
import { formatPlace } from "../../lib/format.js";
import { nearestPlace } from "../../lib/geo.js";
import { INTERESTS, MAX_PLACES, addPlace, hasPlace, placeId, removePlace, toggleInterest } from "../../lib/profile.js";
import Globe from "../Globe.jsx";
import PlaceSearch from "./PlaceSearch.jsx";
import { PIN_COLORS } from "../../lib/theme.js";
import { TypeIcon } from "./ui.jsx";

const QUICK_PLACES = INTAKE_PLACES.slice(0, 6);

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

/**
 * Search (primary), a few large quick choices, and an optional pin map behind a small action, for choosing up to five
 * places. `onChange` receives an updater (profile → profile). `onFocusPlace(place)` lets the welcome globe orient.
 */
export function PlacePicker({ value, places, placesStatus, onChange, onFocusPlace, quick = true }) {
  const [mapOpen, setMapOpen] = useState(false);
  const full = value.places.length >= MAX_PLACES;
  const add = (p) => {
    onChange((v) => addPlace(v, p));
    onFocusPlace?.(p);
  };
  const pick = (lat, lon) => {
    if (full) return;
    const near = nearestPlace(places ?? [], lat, lon, 150);
    add({ name: near?.name ?? formatPlace(lat, lon), lat, lon });
  };
  const toggleQuick = (q) => {
    const id = placeId(q.lat, q.lon);
    if (hasPlace(value, q.lat, q.lon)) onChange((v) => removePlace(v, id));
    else if (!full) add({ name: q.hint, lat: q.lat, lon: q.lon });
  };
  return (
    <div className="place-picker">
      <PlaceSearch places={places} status={placesStatus} disabled={full} onAdd={add} isSaved={(lat, lon) => hasPlace(value, lat, lon)} />
      {quick && (
        <ul className="ob-choices" aria-label="Quick choices">
          {QUICK_PLACES.map((q) => {
            const on = hasPlace(value, q.lat, q.lon);
            return (
              <li key={q.id}>
                <button type="button" className={`ob-choice${on ? " on" : ""}`} aria-pressed={on} disabled={!on && full} onClick={() => toggleQuick(q)}>
                  <span className="ob-choice-name">{q.hint}</span>
                  <i className="ob-check" aria-hidden="true">{on ? "✓" : ""}</i>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PlaceChips places={quick ? value.places.filter((p) => !QUICK_PLACES.some((q) => placeId(q.lat, q.lon) === p.id)) : value.places} onRemove={(id) => onChange((v) => removePlace(v, id))} />
      <p className="ob-count" aria-live="polite">
        <span className="mono">{value.places.length}</span> of <span className="mono">{MAX_PLACES}</span>
        {full && <span className="faint"> · remove one to add another</span>}
      </p>
      <button type="button" className="linklike ob-small" aria-expanded={mapOpen} onClick={() => setMapOpen((o) => !o)}>
        {mapOpen ? "Hide the pin map" : "Pin a spot on a map instead"}
      </button>
      {mapOpen && (
        <div className="pin-map">
          <Globe pins={value.places.map((p) => ({ lat: p.lat, lon: p.lon, color: PIN_COLORS[0].hex, label: "" }))} idleSpin={false} onPick={pick} />
        </div>
      )}
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
            <button type="button" className={`type-tile${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange((v) => toggleInterest(v, it.id))}>
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
 * Exactly two questions, one at a time: places, then what to follow. "Skip for now" is on both. The profile is edited
 * as a draft here and handed back on Finish or Skip; nothing is fetched for the chosen places until onboarding is done.
 */
export default function Onboarding({ profile, places, placesStatus, onFinish, onSkip, onFocusPlace }) {
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
    <section className="onboarding" key={step} aria-labelledby={`${id}-q`}>
      <p className="ob-step">
        <span className="sr-only">Question </span>
        <span className="mono">{step + 1}</span> of <span className="mono">2</span>
      </p>

      {step === 0 ? (
        <>
          <h2 id={`${id}-q`} className="ob-question" tabIndex={-1} ref={headingRef}>Which places matter to you?</h2>
          <PlacePicker value={draft} places={places} placesStatus={placesStatus} onChange={setDraft} onFocusPlace={onFocusPlace} />
        </>
      ) : (
        <>
          <h2 id={`${id}-q`} className="ob-question" tabIndex={-1} ref={headingRef}>What would you like to follow?</h2>
          <InterestTiles value={draft} onChange={setDraft} />
        </>
      )}

      <div className="ob-actions">
        {step === 1 && <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>}
        <button type="button" className="linklike ob-skip" onClick={() => onSkip(draft)}>Skip for now</button>
        <span className="ob-spacer" />
        {step === 0 ? (
          <button type="button" className="btn btn-primary" disabled={!canContinue} aria-describedby={!canContinue ? `${id}-hint` : undefined} onClick={() => setStep(1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canContinue} aria-describedby={!canContinue ? `${id}-hint` : undefined} onClick={() => onFinish(draft)}>
            Finish
          </button>
        )}
        {!canContinue && <span className="sr-only" id={`${id}-hint`}>{step === 0 ? "Choose at least one place, or skip for now" : "Choose at least one, or skip for now"}</span>}
      </div>
    </section>
  );
}
