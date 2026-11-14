import { useEffect, useState } from "react";

const LINES = [
  "TREND DETECTIVE · Earth system case files",
  "linking to NASA POWER data service ........ ok",
  "loading 19 Earth-system variables ......... ok",
  "tuning in NASA, NOAA and NSIDC streams .... ok",
  "calibrating significance tests ............ ok",
  "ready. choose a place on the globe.",
];

/** Short start-up sequence. Shown once per browser session; click or press a key to skip. */
export default function Boot({ onDone }) {
  const [shown, setShown] = useState(1);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timers = [];
    for (let i = 2; i <= LINES.length; i += 1) timers.push(setTimeout(() => setShown(i), (i - 1) * 330));
    timers.push(setTimeout(() => setLeaving(true), LINES.length * 330 + 420));
    timers.push(setTimeout(onDone, LINES.length * 330 + 900));
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  useEffect(() => {
    const skip = () => setLeaving(true);
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);

  useEffect(() => {
    if (leaving) {
      const t = setTimeout(onDone, 480);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [leaving, onDone]);

  return (
    <div className={`boot${leaving ? " out" : ""}`} onClick={() => setLeaving(true)} role="status" aria-label="Starting up">
      <div className="boot-inner">
        <svg className="boot-mark" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="22" cy="22" r="15" fill="none" stroke="#4dffd9" strokeWidth="2.4" />
          <path d="M11 28 L17 22 L22 25 L32 14" fill="none" stroke="#4dffd9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="33" y1="33" x2="44" y2="44" stroke="#4dffd9" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
        <pre className="boot-text mono">
          {LINES.slice(0, shown).map((line, i) => (
            <span key={line} className={i === 0 ? "boot-title" : i === LINES.length - 1 ? "boot-ready" : ""}>
              {`> ${line}\n`}
            </span>
          ))}
          <span className="boot-cursor">▍</span>
        </pre>
        <div className="boot-bar" aria-hidden="true"><i /></div>
        <p className="boot-skip mono">click anywhere to skip</p>
      </div>
    </div>
  );
}
