import { useContext } from "react";
import { GLOSSARY_BY_ID } from "../lib/glossary.js";
import { ExplainContext } from "./ExplainContext.js";

/** Inline jargon: hover or focus for a plain-language tip, click (or press Enter) for the fuller explainer. */
export default function Term({ id, children }) {
  const entry = GLOSSARY_BY_ID[id];
  const explain = useContext(ExplainContext);
  if (!entry) return children;
  const open = () => explain(id);
  return (
    <span
      className="term"
      tabIndex={0}
      role="button"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {children}
      <span className="term-pop" role="tooltip">
        <b>{entry.term}</b>
        {entry.short}
        <em className="term-more">Click for a fuller explanation ▸</em>
      </span>
    </span>
  );
}
