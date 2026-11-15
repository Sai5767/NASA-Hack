import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY_BY_ID } from "../lib/glossary.js";
import { ExplainContext } from "./ExplainContext.js";

const GAP = 8;
const EDGE = 12;
const HOVER_IN_MS = 120;
const HOVER_OUT_MS = 160;

/**
 * Inline jargon (owner item 8). A subtle dotted grey underline; the short plain-language definition opens on
 * mouse hover, keyboard focus, or click/tap (touch-friendly), and closes on Esc, on a second tap, or on a tap elsewhere.
 * "More in the explainer" hands the id to the docked Explainer through ExplainContext.
 *
 *   <Term id="baseline">usual for this month</Term>   children default to the glossary term itself.
 *
 * The pop-up is portalled to <body> with fixed positioning, so it is never clipped by a scrolling panel, and is kept
 * inside the viewport. Avoid placing a <Term> inside another button (nested interactive content).
 */
export default function Term({ id, children }) {
  const entry = GLOSSARY_BY_ID[id];
  const explain = useContext(ExplainContext);
  const [open, setOpen] = useState(null); // null | "hover" | "focus" | "pinned"
  const [pos, setPos] = useState(null);
  const anchor = useRef(null);
  const pop = useRef(null);
  const timer = useRef(0);
  const popId = useId();

  const clear = () => window.clearTimeout(timer.current);
  const later = (fn, ms) => {
    clear();
    timer.current = window.setTimeout(fn, ms);
  };
  const close = useCallback(() => {
    clear();
    setOpen(null);
  }, []);

  // Place the pop-up above the term (below when there is no room), clamped inside the viewport.
  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = a.top - p.height - GAP;
    let below = false;
    if (top < EDGE) {
      top = Math.min(a.bottom + GAP, vh - p.height - EDGE);
      below = true;
    }
    const left = Math.max(EDGE, Math.min(a.left + a.width / 2 - p.width / 2, vw - p.width - EDGE));
    setPos({ top: Math.max(EDGE, top), left, below });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        anchor.current?.focus();
      }
    };
    const onDown = (e) => {
      if (anchor.current?.contains(e.target) || pop.current?.contains(e.target)) return;
      close();
    };
    const onMove = () => close();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close]);

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  if (!entry) return children ?? null;
  const label = children ?? entry.term;

  const onPointerEnter = (e) => {
    if (e.pointerType !== "mouse") return;
    later(() => setOpen((o) => o ?? "hover"), HOVER_IN_MS);
  };
  const onPointerLeave = (e) => {
    if (e.pointerType !== "mouse") return;
    later(() => setOpen((o) => (o === "hover" ? null : o)), HOVER_OUT_MS);
  };
  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    clear();
    setOpen((o) => (o === "pinned" ? null : "pinned"));
  };

  return (
    <>
      <span
        ref={anchor}
        className={`term${open ? " is-open" : ""}`}
        tabIndex={0}
        role="button"
        aria-expanded={!!open}
        aria-describedby={open ? popId : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggle(e);
        }}
        onFocus={() => setOpen((o) => o ?? "focus")}
        onBlur={(e) => {
          if (pop.current?.contains(e.relatedTarget)) return;
          setOpen((o) => (o === "pinned" ? o : null));
        }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {label}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={pop}
            id={popId}
            role="tooltip"
            className={`term-float${pos ? " is-placed" : ""}${pos?.below ? " is-below" : ""}`}
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            onPointerEnter={(e) => e.pointerType === "mouse" && clear()}
            onPointerLeave={onPointerLeave}
            onBlur={(e) => {
              if (anchor.current?.contains(e.relatedTarget) || pop.current?.contains(e.relatedTarget)) return;
              close();
            }}
          >
            <b className="term-float-title">{entry.term}</b>
            <span className="term-float-text">{entry.short}</span>
            <button
              type="button"
              className="term-float-more"
              onClick={() => {
                close();
                explain(id);
              }}
            >
              More in the explainer
            </button>
          </span>,
          document.body,
        )}
    </>
  );
}
