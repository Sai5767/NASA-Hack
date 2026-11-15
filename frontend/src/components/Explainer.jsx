import { useEffect, useRef, useState } from "react";
import { answer, explainTerm, starters } from "../lib/explain.js";

function Bot({ r, onAsk }) {
  return (
    <div className="msg bot">
      <b>{r.title}</b>
      <p>{r.short}</p>
      {r.more.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {r.inCase && (
        <p className="in-case">
          <span className="eyebrow">In this case</span>
          {r.inCase}
        </p>
      )}
      {r.related.length > 0 && (
        <div className="chip-row">
          {r.related.map((x) => (
            <button key={x.id} type="button" className="chip" onClick={() => onAsk({ id: x.id })}>
              {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A docked explainer. It is a written knowledge base with keyword matching: no AI model, no network, nothing leaves
 * the browser. `request` is {id} (a glossary term) or {query} (free text); `data` is the open case, if any.
 */
export default function Explainer({ request, data, open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const ask = (req) => {
    const reply = req.id ? explainTerm(req.id, dataRef.current) : answer(req.query, dataRef.current);
    if (!reply) return;
    const said = req.id ? `What is "${reply.title}"?` : req.query;
    setMessages((m) => [...m, { role: "user", text: said }, { role: "bot", reply }]);
  };

  useEffect(() => {
    if (request) ask(request);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    ask({ query: text });
    setText("");
  };

  return (
    <aside className="explainer card hud-card" hidden={!open} aria-label="Explainer">
      <header>
        <div>
          <p className="eyebrow">Explainer</p>
          <h2>Ask what anything means</h2>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close the explainer">✕</button>
      </header>

      <div className="explainer-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="msg bot">
            <p>
              Click any dotted term in the app, or ask a question here. I explain in plain words and, when a case file is open, use its own
              numbers.
            </p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">{m.text}</div>
          ) : (
            <Bot key={i} r={m.reply} onAsk={ask} />
          ),
        )}
      </div>

      <div className="chip-row starters">
        {starters(data).map((s) => (
          <button key={s} type="button" className="chip" onClick={() => ask({ query: s })}>{s}</button>
        ))}
      </div>

      <form onSubmit={submit} className="explainer-form">
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask: what is a p-value?" aria-label="Your question" />
        <button type="submit" className="btn btn-sm btn-primary">Ask</button>
      </form>
      <p className="faint small">A built-in knowledge base, not an AI model. It runs in your browser and sends nothing anywhere.</p>
    </aside>
  );
}
