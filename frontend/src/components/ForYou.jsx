/** Pop-up suggestions over the globe, chosen from what the user said they care about. */
export default function ForYou({ items, personal, onOpen, onClose }) {
  if (!items.length) return null;
  return (
    <section className="foryou" aria-label={personal ? "Suggested for you" : "Where to start"}>
      <header>
        <span className="eyebrow">{personal ? "For you" : "Where to start"}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Hide suggestions">✕</button>
      </header>
      <ul>
        {items.map((s, i) => (
          <li key={s.id} className="reveal-pop" style={{ "--d": `${500 + i * 160}ms` }}>
            <button type="button" onClick={() => onOpen(s)} title={s.reason}>
              <b>{s.title}</b>
              <span>{s.why}</span>
              <em>Open ▸</em>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
