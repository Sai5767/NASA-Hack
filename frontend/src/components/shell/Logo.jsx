/**
 * Trend Detective logo (V3 "Quiet Earth", docs/V3_QUIET_EARTH_VISUAL_SPEC.md section 5).
 * A thin white orbital arc around a dot (the Earth), crossed by one rising trend line. Monochrome, project-owned, no NASA
 * marks. Drawn on a 24-unit grid so it stays crisp at 20-28 px. Colour comes from `currentColor` (defaults to --white
 * through the .td-logo class in theme.css).
 *
 * <Logo />                      mark + "Trend Detective" wordmark (the wordmark text is the accessible name)
 * <Logo wordmark={false} />     mark only, with role="img" and an aria-label
 * <Logo href="#/main" />        renders as a link (logo returns to Main); pass onClick for SPA routing
 */

export function LogoMark({ size = 24, title, className = "" }) {
  const labelled = Boolean(title);
  return (
    <svg
      className={`td-logo-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : "true"}
      focusable="false"
    >
      {/* Orbit: a 300 degree elliptical arc (rx 10, ry 5) tilted -25 degrees, open on the left where the trend enters. */}
      <g transform="translate(12 12) rotate(-25)">
        <path d="M -9.4 -1.71 A 10 5 0 1 1 -7.66 3.21" strokeWidth="1.25" opacity="0.9" />
      </g>
      {/* Earth: a solid dot on the centre. */}
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      {/* Trend: one rising line that crosses the dot and ends higher on the right. */}
      <path d="M 2.75 17.25 L 8 14 L 12 12 L 15.25 12.9 L 21.25 6.25" strokeWidth="1.6" />
    </svg>
  );
}

export default function Logo({ size = 24, wordmark = true, href, onClick, label = "Trend Detective", className = "" }) {
  const content = (
    <>
      <LogoMark size={size} title={wordmark ? undefined : label} />
      {wordmark && <span className="td-logo-word">{label}</span>}
    </>
  );
  const cls = `td-logo ${className}`.trim();
  if (href || onClick) {
    return (
      <a className={cls} href={href ?? "#"} onClick={onClick} aria-label={wordmark ? undefined : `${label}, go to Main`}>
        {content}
      </a>
    );
  }
  return <span className={cls}>{content}</span>;
}
