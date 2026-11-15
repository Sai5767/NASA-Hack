import { useEffect, useRef } from "react";

// Open dialogs, innermost last: only the top one reacts to Esc and Tab (a confirm modal over the account drawer).
const stack = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus behaviour shared by Modal and the shell drawers/sheets: Esc closes, Tab is trapped inside, focus moves in
 * on open (to `[data-autofocus]`, else the first control) and returns to the opener on close; the page behind does not scroll.
 * `active` lets a component that is only sometimes a dialog (the tablet dashboard drawer) switch the behaviour on and off.
 */
export function useDialogFocus(ref, onClose, active = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement;
    const token = {};
    stack.push(token);
    const onKey = (e) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current?.();
      }
      if (e.key === "Tab" && ref.current) {
        const focusable = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = ref.current?.querySelector("[data-autofocus]") ?? ref.current?.querySelector(FOCUSABLE);
    target?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus?.();
    };
  }, [active, ref]);
}

/** Accessible modal: Esc closes, focus moves inside and is trapped, page behind does not scroll. */
export default function Modal({ title, eyebrow, onClose, wide = false, children }) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, onClose);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal card${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <header className="modal-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close" data-autofocus>✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
