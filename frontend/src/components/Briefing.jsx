/** The brief for a guided case: the question and what to look at. The data supplies the answer. */
export default function Briefing({ item, onClose }) {
  return (
    <aside className="briefing" aria-label="Guided case">
      <div className="briefing-head">
        <div>
          <p className="eyebrow">Guided case · {item.codename}</p>
          <p className="briefing-q">{item.question}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Dismiss the guided case">✕</button>
      </div>
      <p className="eyebrow">What to look at</p>
      <ol className="clues">
        {item.clues.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
    </aside>
  );
}
