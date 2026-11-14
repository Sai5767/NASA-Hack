import { useEffect, useRef } from "react";

/** Accessible modal: Esc closes, focus moves inside, page behind does not scroll. */
export default function Modal({ title, eyebrow, onClose, wide = false, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("[data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal card hud-card${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
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
