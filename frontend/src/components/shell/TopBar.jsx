import { BrandMark, initialOf } from "./ui.jsx";

/** Brand wordmark, used by the top bar and the welcome screen. */
export function Brand({ tagline = true, as: Tag = "p" }) {
  return (
    <div className="brand">
      <BrandMark />
      <div>
        <Tag className="brand-name">
          <span className="brand-long">Trend <span>Detective</span></span>
          <span className="brand-short" aria-hidden="true">TD</span>
        </Tag>
        {tagline && <p className="brand-tag">Earth system case files</p>}
      </div>
    </div>
  );
}

/**
 * The top bar (spec 1.5): brand, the Main/Explore switch and the Account button. Nothing else lives here.
 * The switch is a navigation landmark with aria-current, not tabs: each item is a page with its own URL.
 */
export default function TopBar({ page, onPage, accountLabel, accountOpen, onAccount }) {
  const item = (id, label) => (
    <a
      href={id === "main" ? "#" : "#p=explore"}
      className={page === id ? "on" : ""}
      aria-current={page === id ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
        e.preventDefault();
        onPage(id);
      }}
    >
      {label}
    </a>
  );
  return (
    <header className="topbar">
      <Brand />
      <nav className="seg page-switch" aria-label="Pages">
        {item("main", "Main")}
        {item("explore", "Explore")}
      </nav>
      <button type="button" className="account-btn" onClick={onAccount} aria-expanded={accountOpen} aria-haspopup="dialog">
        <span className="account-disc" aria-hidden="true">{initialOf(accountLabel)}</span>
        <span className="account-label">Account</span>
        <span className="sr-only">, signed in as {accountLabel}</span>
      </button>
    </header>
  );
}
