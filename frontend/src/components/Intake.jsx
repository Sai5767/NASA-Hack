import { useState } from "react";
import { INTAKE_PLACES } from "../lib/cases.js";
import { DEFAULT_PROFILE, GOALS, LEVELS, TOPICS, WHO } from "../lib/profile.js";
import Modal from "./Modal.jsx";

const STEPS = [
  { id: "who", title: "Who is investigating?", help: "This sets how much detail we show first. You can change it any time." },
  { id: "interests", title: "What are you curious about?", help: "Pick as many as you like. These drive the suggestions on the globe." },
  { id: "places", title: "Which places matter to you?", help: "Pick any. You can add exact spots later by clicking the globe." },
  { id: "level", title: "How technical should we be?", help: "Plain words keep the statistics one click away; the numbers option opens on them." },
  { id: "goal", title: "What would you like to do first?", help: "We will start there." },
];

function Choice({ label, hint, on, onClick }) {
  return (
    <button type="button" className={`choice${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      <b>{label}</b>
      {hint && <small>{hint}</small>}
    </button>
  );
}

/** Five questions that tune the home screen. Answers are kept in this browser only. */
export default function IntakeWizard({ initial, onFinish, onSurprise, onClose }) {
  const [p, setP] = useState({ ...DEFAULT_PROFILE, ...initial });
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const toggle = (key, id) =>
    setP((s) => ({ ...s, [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [...s[key], id] }));
  const pickWho = (w) => setP((s) => ({ ...s, who: w.id, level: w.level }));

  return (
    <Modal eyebrow={`Question ${step + 1} of ${STEPS.length}`} title={current.title} onClose={onClose}>
      <p className="dim">{current.help}</p>

      {current.id === "who" && (
        <ul className="choice-grid">
          {WHO.map((w) => (
            <li key={w.id}><Choice label={w.label} hint={w.hint} on={p.who === w.id} onClick={() => pickWho(w)} /></li>
          ))}
        </ul>
      )}

      {current.id === "interests" && (
        <>
          <ul className="choice-grid">
            {TOPICS.map((t) => (
              <li key={t.id}><Choice label={t.label} hint={t.hint} on={p.interests.includes(t.id)} onClick={() => toggle("interests", t.id)} /></li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm" onClick={onSurprise}>✦ Surprise me instead</button>
        </>
      )}

      {current.id === "places" && (
        <ul className="choice-grid">
          {INTAKE_PLACES.map((pl) => (
            <li key={pl.id}><Choice label={pl.label} hint={pl.hint} on={p.places.includes(pl.id)} onClick={() => toggle("places", pl.id)} /></li>
          ))}
        </ul>
      )}

      {current.id === "level" && (
        <ul className="choice-grid one">
          {LEVELS.map((l) => (
            <li key={l.id}><Choice label={l.label} hint={l.hint} on={p.level === l.id} onClick={() => setP((s) => ({ ...s, level: l.id }))} /></li>
          ))}
        </ul>
      )}

      {current.id === "goal" && (
        <ul className="choice-grid one">
          {GOALS.map((g) => (
            <li key={g.id}><Choice label={g.label} hint={g.hint} on={p.goal === g.id} onClick={() => setP((s) => ({ ...s, goal: g.id }))} /></li>
          ))}
        </ul>
      )}

      <div className="wizard-foot">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</button>
        <span className="wizard-dots" aria-hidden="true">
          {STEPS.map((s, i) => <i key={s.id} className={i === step ? "on" : i < step ? "done" : ""} />)}
        </span>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={() => onFinish(p)}>Start investigating ▸</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Next ▸</button>
        )}
      </div>
    </Modal>
  );
}
