import Logo from "./Logo.jsx";
import { initialOf } from "./ui.jsx";

/** Kept for older imports: the V3 logo with its wordmark. */
export function Brand({ onClick }) {
  return <Logo href={onClick ? "#" : undefined} onClick={onClick} />;
}

/**
 * The top edge: logo (returns to Main), the Main/Explore switch, a small "Scan active" indicator while a scan result is
 * held, and the round account control. No tagline, no telemetry.
 * The switch is a navigation landmark with aria-current, not tabs: each item is a page with its own URL.
 */
export default function TopBar({ page, onPage, accountLabel, accountOpen, onAccount, scanActive, onScan }) {
  const go = (id) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
    e.preventDefault();
    onPage(id);
  };
  const item = (id, label) => (
    <a href={id === "main" ? "#" : "#p=explore"} className={page === id ? "on" : ""} aria-current={page === id ? "page" : undefined} onClick={go(id)}>
      {label}
    </a>
  );
  return (
    <header className="topbar">
      <Logo href="#" onClick={go("main")} className="topbar-logo" />
      <nav className="seg page-switch" aria-label="Pages">
        {item("main", "Main")}
        {item("explore", "Explore")}
      </nav>
      <div className="topbar-end">
        {scanActive && (
          <button type="button" className="scan-flag" onClick={onScan} title="Return to the scan">
            <i className="scan-flag-dot" aria-hidden="true" />
            <span className="scan-flag-text">Scan active · {scanActive}</span>
          </button>
        )}
        <button type="button" className="account-btn" onClick={onAccount} aria-expanded={accountOpen} aria-haspopup="dialog" aria-label={`Account, signed in as ${accountLabel ?? ""}`}>
          <span className="account-disc" aria-hidden="true">{initialOf(accountLabel)}</span>
        </button>
      </div>
    </header>
  );
}
