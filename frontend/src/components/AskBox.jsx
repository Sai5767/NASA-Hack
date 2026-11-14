import { useMemo, useState } from "react";
import { suggest } from "../lib/ask.js";

/** "Ask the detective": type a few words, get a place and a variable. No AI, just a keyword list and a gazetteer. */
export default function AskBox({ places, variables, currentVariable, onAsk }) {
  const [query, setQuery] = useState("");
  const suggestions = useMemo(() => suggest(query, places, currentVariable), [query, places, currentVariable]);
  const label = (id) => variables.find((v) => v.id === id)?.label ?? id;

  const pick = (s) => {
    onAsk(s);
    setQuery("");
  };

  return (
    <div className="ask">
      <label className="field">
        Ask the detective
        <input
          type="search"
          value={query}
          placeholder='Try "is Phoenix getting hotter?" or "Amazon rain"'
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions[0]) pick(suggestions[0]);
            }
            if (e.key === "Escape") setQuery("");
          }}
          aria-describedby="ask-help"
        />
      </label>
      <p id="ask-help" className="sr-only">Type a place and what you are curious about, then press Enter to open the first suggestion.</p>
      {query.trim() && suggestions.length === 0 && (
        <p className="dim small">No match. Try a city, a landscape such as "Amazon" or "Sahara", and a word like heat, rain, wind or sun.</p>
      )}
      {suggestions.length > 0 && (
        <ul className="ask-list" role="listbox" aria-label="Suggestions">
          {suggestions.map((s) => (
            <li key={s.type === "place" ? s.place.id : s.variable} role="option" aria-selected="false">
              <button type="button" onClick={() => pick(s)}>
                {s.type === "place" ? (
                  <>
                    <b>{s.place.name}</b>
                    <span className="dim"> · {label(s.variable)}</span>
                    <small className="mono faint"> {s.place.kind}</small>
                  </>
                ) : (
                  <>
                    <b>Switch variable</b>
                    <span className="dim"> · {label(s.variable)}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
