import { useTypewriter } from "../hooks.js";

/** The brief for a guided case: the question and what to look at. The data supplies the answer. */
export default function Briefing({ item, onClose }) {
  const [shown, done, skip] = useTypewriter(item.question, { speed: 18, delay: 200 });
  return (
    <aside className="card hud-card briefing reveal" aria-label="Case briefing">
      <div className="briefing-head">
        <div>
          <p className="eyebrow">Case briefing · {item.codename}</p>
          <p className="briefing-q" onClick={skip}>
            {shown}
            {!done && <span className="caret">▍</span>}
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Dismiss briefing">✕</button>
      </div>
      <p className="eyebrow dim">What to look at</p>
      <ol className="clues">
        {item.clues.map((c, i) => (
          <li key={c} className="reveal-slide" style={{ "--d": `${900 + i * 160}ms` }}>{c}</li>
        ))}
      </ol>
    </aside>
  );
}
