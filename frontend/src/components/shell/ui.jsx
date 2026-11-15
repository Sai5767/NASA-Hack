/**
 * Shared V2 primitives (spec 5.1, 5.2). Agents 3 and 4 consume these; the class names are the styling contract and are
 * styled in styles/shell.css, so a component may also use the classes directly.
 *
 *   <Badge kind="observed|forecast|live|stale|unverified|source">text</Badge>
 *   <StateCard kind="loading|empty|error|stale|withheld|nokey|ratelimited|unavailable|partial|storage" title body action />
 *   <Disclosure summary="How good is it?">…</Disclosure>
 *   <Drawer title onClose>…</Drawer>   (in Drawer.jsx: right drawer on desktop/tablet, full-height sheet on mobile)
 */
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo.jsx";

/** Kept for older imports: the V3 logo mark (see Logo.jsx). */
export function BrandMark({ className = "brand-mark" }) {
  return <LogoMark className={className} />;
}

const BADGE_GLYPH = { observed: "▣", forecast: "", live: "", stale: "◔", unverified: "◇", source: "" };

export function Badge({ kind = "source", children, title }) {
  return (
    <span className={`td-badge td-badge--${kind} mono`} title={title}>
      {kind === "forecast" && <i className="td-hatch" aria-hidden="true" />}
      {BADGE_GLYPH[kind] && <span aria-hidden="true">{BADGE_GLYPH[kind]}</span>}
      {children}
    </span>
  );
}

const STATE_GLYPH = {
  loading: "",
  empty: "○",
  error: "✕",
  stale: "◔",
  withheld: "🔒︎",
  nokey: "⏻",
  ratelimited: "⧗",
  unavailable: "☁",
  partial: "◧",
  storage: "⛁",
  info: "ⓘ",
};
const STATE_ROLE = { error: "alert", loading: "status", stale: "status", ratelimited: "status", unavailable: "status", partial: "status", storage: "status" };

/** One standard state card: glyph, a one-line title, one or two lines of explanation, at most one action. */
export function StateCard({ kind = "empty", title, children, action, slowAfter = 8000, slowText = "Still working…" }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (kind !== "loading" || !slowAfter) return undefined;
    const t = setTimeout(() => setSlow(true), slowAfter);
    return () => clearTimeout(t);
  }, [kind, slowAfter]);
  return (
    <div className={`td-state td-state--${kind}`} role={STATE_ROLE[kind]} aria-live={STATE_ROLE[kind] && STATE_ROLE[kind] !== "alert" ? "polite" : undefined}>
      <span className="td-state-glyph" aria-hidden="true">{kind === "loading" ? <i className="td-loading-dot" /> : STATE_GLYPH[kind]}</span>
      <div className="td-state-text">
        {title && <p className="td-state-title">{title}</p>}
        {children && <div className="td-state-body">{children}</div>}
        {slow && <p className="td-state-body">{slowText}</p>}
        {action && <div className="td-state-action">{action}</div>}
      </div>
    </div>
  );
}

export function Disclosure({ summary, children, open, className = "" }) {
  return (
    <details className={`td-disclosure ${className}`} open={open}>
      <summary>{summary}</summary>
      <div className="td-disclosure-body">{children}</div>
    </details>
  );
}

/** The data-type icons (onboarding tiles, data picker chips). Inline, `currentColor`, 24px grid. */
export function TypeIcon({ id }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="type-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      {id === "heat" && (
        <g {...common}><path d="M12 14V5a2 2 0 1 0-4 0v9a4 4 0 1 0 4 0Z" transform="translate(2 0)" /><path d="M16 9h3M16 6h2M16 12h2" /></g>
      )}
      {id === "water" && <path {...common} d="M12 3c3.5 4.4 6 7.7 6 10.6A6 6 0 0 1 6 13.6C6 10.7 8.5 7.4 12 3Z" />}
      {id === "cloud" && (
        <g {...common}><circle cx="8" cy="7" r="2.5" /><path d="M8 2.5v1M3.5 7h1M4.8 3.8l.7.7" /><path d="M7 19h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 13.2 3 3 0 0 0 7 19Z" /></g>
      )}
      {id === "land" && (
        <g {...common}><path d="M12 21V11" /><path d="M12 11c0-4 3-6 7-6 0 4-3 6-7 6Z" /><path d="M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z" /><path d="M4 21h16" /></g>
      )}
      {id === "wind" && (
        <g {...common}><path d="M3 8h11a3 3 0 1 0-3-3" /><path d="M3 12h15a3 3 0 1 1-3 3" /><path d="M3 16h7" /></g>
      )}
      {id === "ice" && (
        <g {...common}><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5" /></g>
      )}
    </svg>
  );
}

/** First letter of the display label, for the 32px account disc. */
export const initialOf = (label) => (String(label ?? "").trim()[0] ?? "?").toUpperCase();
