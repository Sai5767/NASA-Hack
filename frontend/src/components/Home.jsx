import { FIRST_YEAR, INTAKE_PLACES, LAST_FULL_YEAR } from "../lib/cases.js";
import { LEVELS, TOPICS } from "../lib/profile.js";
import Watchlist from "./Watchlist.jsx";

/** The landing view: the challenge's four questions, a watchlist, and what the app has learned about the user. */
export default function Home({ placeCount, profile, watch, variables, onCases, onIntake, onOpenWatch, onRemoveWatch }) {
  const years = LAST_FULL_YEAR - FIRST_YEAR + 1;
  const topics = profile.interests.map((id) => TOPICS.find((t) => t.id === id)?.label).filter(Boolean);
  const places = profile.places.map((id) => INTAKE_PLACES.find((p) => p.id === id)?.hint).filter(Boolean);
  const level = LEVELS.find((l) => l.id === profile.level)?.label;

  return (
    <>
      <section className="card hud-card hero reveal">
        <p className="eyebrow">Earth system case files</p>
        <h2>
          Is it changing? <span>Where?</span> By how much? <span>Is it real?</span>
        </h2>
        <p className="dim">
          Pick any spot on Earth and a variable. Trend Detective gathers {years} years of NASA data, measures the change, and tells you how much to
          trust it, then checks what moves with it and whether independent records agree.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={onCases}>Open a case file ▸</button>
          <button type="button" className="btn" onClick={onIntake}>{profile.done ? "Edit my interests" : "✦ Personalise (5 questions)"}</button>
        </div>
        <p className="faint small">…or type a question below, or click anywhere on the globe to drop a pin.</p>
        <ul className="hero-stats mono">
          <li><b>19</b> Earth-system variables</li>
          <li><b>8</b> NASA, NOAA and NSIDC data streams</li>
          <li><b>{placeCount || 68}</b> places to survey</li>
          <li><b>8</b> ways to investigate</li>
        </ul>
      </section>

      <Watchlist items={watch} variables={variables} onOpen={onOpenWatch} onRemove={onRemoveWatch} />

      <section className="card profile-strip reveal" style={{ "--d": "350ms" }}>
        {profile.done ? (
          <>
            <p className="eyebrow">Tuned for you</p>
            <div className="chip-row">
              {topics.map((t) => <span key={t} className="chip on">{t}</span>)}
              {places.map((p) => <span key={p} className="chip">{p}</span>)}
              {level && <span className="chip">{level}</span>}
            </div>
            <p className="faint small">The suggestions on the globe come from these answers. They never leave this browser.</p>
          </>
        ) : (
          <>
            <p className="eyebrow">Make it yours</p>
            <p className="dim small">
              Answer five quick questions and the globe will suggest case files for your interests and places, and open at the level of detail you like.
            </p>
          </>
        )}
      </section>
    </>
  );
}
