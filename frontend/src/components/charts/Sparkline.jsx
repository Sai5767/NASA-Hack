import { useMemo } from "react";
import { chartSpec, linePath } from "../../lib/chart.js";
import { mean } from "../../lib/format.js";
import { ExpandableChart } from "./ChartViewer.jsx";

/** ChartViewer spec for a sparkline: the real values (not the standardised shape), by year when `years` is given. */
export function sparklineSpec(values, { years, title, source, unit, variable } = {}) {
  const hasYears = Array.isArray(years) && years.length === values.length;
  return chartSpec({
    title: title ?? variable?.label ?? "Series",
    source: source ?? variable?.source ?? "",
    unit: unit ?? variable?.units ?? "",
    variable,
    xKind: hasYears ? "year" : "index",
    xLabel: hasYears ? "Year" : "Point",
    series: [{ id: "v", label: title ?? variable?.label ?? "Value", type: "line", style: "observed", data: values.map((v, i) => ({ x: hasYears ? years[i] : i + 1, y: v })) }],
  });
}

/**
 * Tiny standardised line: shape of the series, independent of its units.
 * Not expandable by default (it is often one of many in a list). Pass `expandable` plus `title`, `unit`, `source`
 * and optionally `years` where the sparkline is the main visual of a section.
 * `color` is kept for backward compatibility; V3 lines are monochrome, so callers should omit it.
 */
export default function Sparkline({ values, color = "var(--text)", width = 104, height = 30, delay = 0, expandable = false, years, title, source, unit, variable }) {
  const spec = useMemo(
    () => (expandable && values && values.length >= 2 ? sparklineSpec(values, { years, title, source, unit, variable }) : null),
    [expandable, values, years, title, source, unit, variable],
  );
  if (!values || values.length < 2) return null;
  const mu = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - mu) ** 2))) || 1;
  const z = values.map((v) => (v - mu) / sd);
  const lo = Math.min(...z);
  const hi = Math.max(...z);
  const pad = 3;
  const pts = z.map((v, i) => [pad + (i / (z.length - 1)) * (width - pad * 2), pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2)]);
  const [lx, ly] = pts[pts.length - 1];
  const svg = (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path className="draw" pathLength="1" d={linePath(pts)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" style={{ "--d": `${delay}ms`, "--dur": "1s" }} />
      <circle cx={lx} cy={ly} r="2.4" fill={color} />
    </svg>
  );
  if (!spec) return svg;
  return (
    <ExpandableChart spec={spec} className="xc-spark">
      {svg}
    </ExpandableChart>
  );
}
