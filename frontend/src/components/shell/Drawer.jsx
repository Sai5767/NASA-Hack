import { createContext, useContext, useRef } from "react";
import { useDialogFocus } from "../Modal.jsx";

/**
 * The right focus panel (V3 section 4.4): one calm reading plane with one close action. Account, news detail, evidence,
 * live weather and Why share it; opening one closes the others. Esc closes it and focus returns where it was.
 * Desktop/tablet: a right drawer `--drawer-w` wide. Mobile: a full-height sheet. Both are focus-trapped dialogs.
 *
 * Any component inside the app can use the slot:
 *   const { openDrawer, closeDrawer, drawerId } = useShell();
 *   openDrawer({ id: "evidence", title: "How did we test this?", render: () => <EvidenceDrawer … /> });
 */
export const ShellContext = createContext({
  openDrawer: () => {},
  closeDrawer: () => {},
  drawerId: null,
  reducedMotion: false,
  page: "main",
});
export const useShell = () => useContext(ShellContext);

export function Drawer({ id, title, eyebrow, onClose, children }) {
  const ref = useRef(null);
  useDialogFocus(ref, onClose);
  const headingId = `drawer-title-${id}`;
  return (
    <div className="td-drawer-layer">
      <div className="td-scrim focus-scrim" onMouseDown={onClose} aria-hidden="true" />
      <aside className="td-drawer focus-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={ref}>
        <header className="td-drawer-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={headingId}>{title}</h2>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label={`Close ${title}`} data-autofocus>✕</button>
        </header>
        <div className="td-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
