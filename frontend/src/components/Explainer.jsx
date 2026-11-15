import { useCallback, useEffect, useRef, useState } from "react";
import { answer, explainTerm, starters } from "../lib/explain.js";

const MARGIN = 12;
const STEP = 24;
const DESKTOP = "(min-width: 768px)";
const clampPos = (x, y, w, h) => ({
  x: Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)),
  y: Math.max(MARGIN, Math.min(y, window.innerHeight - Math.min(h, window.innerHeight - 2 * MARGIN) - MARGIN)),
});

function Bot({ r, onAsk }) {
  return (
    <div className="msg bot">
      <b className="msg-title">{r.title}</b>
      <p>{r.short}</p>
      {r.more.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {r.inCase && (
        <p className="in-case">
          <span className="in-case-label">In this case</span>
          {r.inCase}
        </p>
      )}
      {r.related.length > 0 && (
        <div className="chip-row msg-related" aria-label="Related">
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

function useDesktop() {
  const [desk, setDesk] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return undefined;
    const on = () => setDesk(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return desk;
}

/**
 * The explainer (owner item 11). A written knowledge base with keyword matching: no AI model, no network, nothing leaves
 * the browser. `request` is {id} (a glossary term) or {query} (free text); `data` is the open case, if any.
 *
 * Desktop: a floating panel that can be dragged by its title bar (kept inside the viewport; arrow keys move it while
 * the "Move" handle has focus; "Reset position" docks it again), resized from its corner, and expanded to a large
 * reading size. Phone: a bottom sheet (normal or expanded). The answer list scrolls on its own, so the input and
 * close button never scroll away. Starter suggestions fold into one "Suggestions" disclosure after the first question.
 * Esc closes it.
 */
export default function Explainer({ request, data, open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [large, setLarge] = useState(false);
  const [pos, setPos] = useState(null); // null = docked bottom-right
  const listRef = useRef(null);
  const boxRef = useRef(null);
  const drag = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const desktop = useDesktop();

  const ask = (req) => {
    const reply = req.id ? explainTerm(req.id, dataRef.current) : answer(req.query, dataRef.current);
    if (!reply) return;
    const said = req.id ? `What is "${reply.title}"?` : req.query;
    setMessages((m) => [...m, { role: "user", text: said }, { role: "bot", reply }]);
  };

  useEffect(() => {
    if (request) ask(request);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the start of the newest answer (not its end), so a long reply is read from the top.
  useEffect(() => {
    const list = listRef.current;
    const last = list?.querySelector(".msg.user:last-of-type");
    if (list && last) list.scrollTo({ top: last.offsetTop - 8, behavior: "smooth" });
  }, [messages.length]);

  // Keep a moved panel inside the viewport when the window or its size changes.
  const keepInside = useCallback(() => {
    setPos((p) => {
      if (!p || !boxRef.current) return p;
      const r = boxRef.current.getBoundingClientRect();
      const n = clampPos(p.x, p.y, r.width, r.height);
      return n.x === p.x && n.y === p.y ? p : n;
    });
  }, []);
  useEffect(() => {
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, [keepInside]);
  useEffect(() => {
    if (!desktop) setPos(null);
  }, [desktop]);
  useEffect(() => {
    keepInside();
  }, [large, keepInside]);

  const startDrag = (e) => {
    if (!desktop || e.button !== 0 || e.target.closest("button:not(.explainer-move), input, a")) return;
    const r = boxRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy, d.w, d.h));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const nudge = (e) => {
    const keys = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
    const k = keys[e.key];
    if (!k || !boxRef.current) return;
    e.preventDefault();
    const r = boxRef.current.getBoundingClientRect();
    setPos(clampPos(r.left + k[0], r.top + k[1], r.width, r.height));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    ask({ query: text });
    setText("");
  };

  const asked = messages.length > 0;
  const suggestions = starters(data).map((s) => (
    <button key={s} type="button" className="chip" onClick={() => ask({ query: s })}>{s}</button>
  ));
  const style = desktop && pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

  return (
    <aside
      ref={boxRef}
      className={`explainer${large ? " is-large" : ""}${pos ? " is-moved" : ""}`}
      hidden={!open}
      aria-label="Explainer"
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="explainer-bar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {desktop && (
          <button type="button" className="explainer-move" aria-label="Move the explainer (arrow keys)" title="Drag to move, or use the arrow keys" onKeyDown={nudge}>
            <span aria-hidden="true">⠿</span>
          </button>
        )}
        <h2 className="explainer-title">Explainer</h2>
        <div className="explainer-tools">
          {desktop && pos && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPos(null)}>Reset position</button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLarge((l) => !l)} aria-pressed={large} aria-label={large ? "Make the explainer smaller" : "Expand the explainer"}>
            <span aria-hidden="true">{large ? "⤡" : "⤢"}</span>
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close the explainer">✕</button>
        </div>
      </header>

      <div className="explainer-list" ref={listRef} aria-live="polite" tabIndex={0} aria-label="Answers">
        {!asked && (
          <div className="msg bot">
            <p>Tap any dotted word in the app, or ask here. I answer in plain words and, when a case is open, use its own numbers.</p>
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

      <div className="explainer-foot">
        {asked ? (
          <details className="td-disclosure explainer-sugg">
            <summary>Suggestions</summary>
            <div className="td-disclosure-body chip-row">{suggestions}</div>
          </details>
        ) : (
          <div className="chip-row starters" aria-label="Suggestions">{suggestions}</div>
        )}
        <form onSubmit={submit} className="explainer-form">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask: what is a p-value?" aria-label="Your question" />
          <button type="submit" className="btn btn-sm btn-primary">Ask</button>
        </form>
        <p className="faint explainer-note">A built-in knowledge base, not an AI. Nothing leaves your browser.</p>
      </div>
    </aside>
  );
}
