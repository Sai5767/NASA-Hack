import { useState } from "react";
import { useProgress } from "../../hooks.js";
import { sectorPath } from "../../lib/chart.js";
import { MONTHS, MONTHS_LONG, formatP, signed } from "../../lib/format.js";

const C = 150;
const R0 = 46;
const R1 = 114;

/**
 * Radial "trend fingerprint": one wedge per calendar month. Wedge length is the size of that
 * month's own trend, color is its direction, and solid wedges survive the multiple-testing correction.
 */
export default function Fingerprint({ rows, agreement, units }) {
  const progress = useProgress({ duration: 1100, delay: 450 });
  const [hover, setHover] = useState(null);
  const tested = rows.filter((r) => r.ok);
  const maxAbs = Math.max(...tested.map((r) => Math.abs(r.slope_per_decade)), 1e-9);
  const active = hover != null ? rows[hover] : null;

  return (
    <div className="fingerprint">
      <svg viewBox="0 0 300 300" role="img" aria-label={`Trend by calendar month: ${agreement.agree} of ${agreement.total} months share the overall direction`}>
        <defs>
          <filter id="fp-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx={C} cy={C} r={R1 + 4} className="fp-ring" />
        <circle cx={C} cy={C} r={R0} className="fp-ring base" />
        {rows.map((row, i) => {
          const angle = i * 30;
          const rad = (angle * Math.PI) / 180;
          const lx = C + (R1 + 20) * Math.sin(rad);
          const ly = C - (R1 + 20) * Math.cos(rad);
          return (
            <g key={row.month}>
              <text x={lx} y={ly} className={`fp-label${hover === i ? " on" : ""}`} textAnchor="middle" dominantBaseline="middle">{MONTHS[i]}</text>
              {row.ok ? (
                <path
                  d={sectorPath(C, C, R0, R0 + Math.max(3, (R1 - R0) * (Math.abs(row.slope_per_decade) / maxAbs) * progress), angle - 12, angle + 12)}
                  fill={row.sign > 0 ? "var(--up)" : "var(--down)"}
                  fillOpacity={row.significant ? 0.88 : 0.14}
                  stroke={row.sign > 0 ? "var(--up)" : "var(--down)"}
                  strokeWidth={row.significant ? 0 : 1.2}
                  strokeDasharray={row.significant ? undefined : "3 3"}
                  filter={row.significant ? "url(#fp-glow)" : undefined}
                  className="fp-wedge"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                >
                  <title>{`${MONTHS_LONG[i]}: ${signed(row.slope_per_decade)} ${units} per decade, p ${formatP(row.p_value)}`}</title>
                </path>
              ) : (
                <path d={sectorPath(C, C, R0, R0 + 4, angle - 12, angle + 12)} className="fp-missing" />
              )}
            </g>
          );
        })}
        <g className="fp-center">
          {active && active.ok ? (
            <>
              <text x={C} y={C - 12} textAnchor="middle" className="fp-big">{MONTHS_LONG[hover].slice(0, 3)}</text>
              <text x={C} y={C + 6} textAnchor="middle" className="fp-mid">{signed(active.slope_per_decade, 2)}</text>
              <text x={C} y={C + 20} textAnchor="middle" className="fp-small">per decade</text>
            </>
          ) : (
            <>
              <text x={C} y={C - 4} textAnchor="middle" className="fp-big">{agreement.agree}/{agreement.total}</text>
              <text x={C} y={C + 12} textAnchor="middle" className="fp-small">months agree</text>
            </>
          )}
        </g>
      </svg>
      <p className="fp-note">
        Each wedge is one calendar month's own trend. Length = size of the change, color = direction, solid = holds up after
        correcting for testing 12 months at once.
        {active && active.ok && (
          <span className="mono"> {MONTHS_LONG[hover]}: {signed(active.slope_per_decade)} {units}/decade, p {formatP(active.p_value)}</span>
        )}
      </p>
    </div>
  );
}
