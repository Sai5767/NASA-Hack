import { useMemo, useState } from "react";
import { useProgress } from "../../hooks.js";
import { chartSpec, directionColor, rampFamily, sectorPath } from "../../lib/chart.js";
import { MONTHS, MONTHS_LONG, formatP, signed } from "../../lib/format.js";
import { ExpandableChart } from "./ChartViewer.jsx";
import { DEFAULT_SOURCE } from "./TrendChart.jsx";

const C = 150;
const R0 = 46;
const R1 = 114;

/**
 * ChartViewer spec: each calendar month's own trend per decade as bars. Slopes are deltas (unit conversion uses the
 * scale factor only); the p-value and "holds after correction" notes are shown verbatim and never converted.
 */
export function fingerprintSpec(rows, units, { title, source, variable } = {}) {
  const fam = rampFamily(units, variable);
  return chartSpec({
    title: title ?? `Trend by calendar month${variable?.label ? `: ${variable.label}` : ""}`,
    source: source ?? variable?.source ?? DEFAULT_SOURCE,
    unit: units,
    yLabel: "per decade",
    variable,
    delta: true,
    zeroLine: true,
    xKind: "month",
    xLabel: "Month",
    series: [
      {
        id: "slope",
        label: "Trend per decade",
        type: "bars",
        legend: [
          { label: "Rising month", color: directionColor(1, fam) },
          { label: "Falling month", color: directionColor(-1, fam) },
        ],
        data: rows
          .map((r, i) => (r.ok ? {
            x: i + 1,
            y: r.slope_per_decade,
            label: MONTHS_LONG[i],
            color: directionColor(r.sign > 0 ? 1 : -1, fam),
            note: `p ${formatP(r.p_value)}${r.significant ? " · holds after correction" : " · does not hold after correction"}`,
          } : null))
          .filter(Boolean),
      },
    ],
  });
}

/**
 * Radial "trend fingerprint": one wedge per calendar month. Wedge length is the size of that month's own trend,
 * colour (data scale) is its direction, and solid wedges survive the multiple-testing correction. Click to expand.
 */
export default function Fingerprint({ rows, agreement, units, title, source, variable, unit, expandable = true }) {
  const progress = useProgress({ duration: 1100, delay: 450 });
  const [hover, setHover] = useState(null);
  const shownUnit = unit ?? units;
  const fam = rampFamily(shownUnit, variable);
  const tested = rows.filter((r) => r.ok);
  const maxAbs = Math.max(...tested.map((r) => Math.abs(r.slope_per_decade)), 1e-9);
  const active = hover != null ? rows[hover] : null;
  const spec = useMemo(() => fingerprintSpec(rows, shownUnit, { title, source, variable }), [rows, shownUnit, title, source, variable]);

  return (
    <div className="fingerprint">
      <ExpandableChart spec={spec} disabled={!expandable}>
        <svg viewBox="0 0 300 300" role="img" aria-label={`Trend by calendar month: ${agreement.agree} of ${agreement.total} months share the overall direction`}>
          <circle cx={C} cy={C} r={R1 + 4} className="fp-ring" />
          <circle cx={C} cy={C} r={R0} className="fp-ring base" />
          {rows.map((row, i) => {
            const angle = i * 30;
            const rad = (angle * Math.PI) / 180;
            const lx = C + (R1 + 20) * Math.sin(rad);
            const ly = C - (R1 + 20) * Math.cos(rad);
            const color = directionColor(row.sign > 0 ? 1 : -1, fam);
            return (
              <g key={row.month}>
                <text x={lx} y={ly} className={`fp-label${hover === i ? " on" : ""}`} textAnchor="middle" dominantBaseline="middle">{MONTHS[i]}</text>
                {row.ok ? (
                  <path
                    d={sectorPath(C, C, R0, R0 + Math.max(3, (R1 - R0) * (Math.abs(row.slope_per_decade) / maxAbs) * progress), angle - 12, angle + 12)}
                    style={{ fill: color, stroke: color }}
                    fillOpacity={row.significant ? 0.9 : 0.12}
                    strokeWidth={row.significant ? 0 : 1.2}
                    strokeDasharray={row.significant ? undefined : "3 3"}
                    className="fp-wedge"
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <title>{`${MONTHS_LONG[i]}: ${signed(row.slope_per_decade)} ${shownUnit} per decade, p ${formatP(row.p_value)}`}</title>
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
                <text x={C} y={C + 8} textAnchor="middle" className="fp-mid">{signed(active.slope_per_decade, 2)}</text>
                <text x={C} y={C + 24} textAnchor="middle" className="fp-small">per decade</text>
              </>
            ) : (
              <>
                <text x={C} y={C - 4} textAnchor="middle" className="fp-big">{agreement.agree}/{agreement.total}</text>
                <text x={C} y={C + 16} textAnchor="middle" className="fp-small">months agree</text>
              </>
            )}
          </g>
        </svg>
      </ExpandableChart>
      <p className="ch-note-text">
        Each wedge is one calendar month's own trend. Length = size of the change, colour = direction, solid = holds up after
        correcting for testing 12 months at once.
        {active && active.ok && (
          <span className="mono"> {MONTHS_LONG[hover]}: {signed(active.slope_per_decade)} {shownUnit}/decade, p {formatP(active.p_value)}</span>
        )}
      </p>
    </div>
  );
}
