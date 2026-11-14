import { GLOSSARY_BY_ID } from "../lib/glossary.js";

/** Inline jargon with a plain-language tooltip (hover or keyboard focus). */
export default function Term({ id, children }) {
  const entry = GLOSSARY_BY_ID[id];
  if (!entry) return children;
  return (
    <span className="term" tabIndex={0}>
      {children}
      <span className="term-pop" role="tooltip">
        <b>{entry.term}</b>
        {entry.short}
      </span>
    </span>
  );
}
