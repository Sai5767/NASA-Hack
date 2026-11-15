import { useMemo, useRef } from "react";
import { useWidth } from "../../hooks.js";
import { chartSpec, extent, linePath, linearScale, niceTicks } from "../../lib/chart.js";
import { ExpandableChart } from "./ChartViewer.jsx";
import { DEFAULT_SOURCE } from "./TrendChart.jsx";

const M = { t: 16, r: 14, b: 30, l: 44 };
const Z_CRIT = 1.96;

/** ChartViewer spec: Mann-Kendall z by end year (a test statistic, so never unit-converted). */
export function emergenceSpec(series, year, { title, source, variable } = {}) {
  return chartSpec({
    title: title ?? `How the evidence builds${variable?.label ? `: ${variable.label}` : ""}`,
    source: source ?? variable?.source ?? DEFAULT_SOURCE,
    unit: "z-score",
    convertible: false,
    variable,
    xKind: "year",
    xLabel: "End year",
    zeroLine: true,
    thresholds: [
      { y: Z_CRIT, label: "Significant rise (z above 1.96)" },
      { y: -Z_CRIT, label: "Significant fall (z below −1.96)" },
    ],
    markers: year != null ? [{ x: year, label: `Became significant in ${year}` }] : [],
    series: [{ id: "z", label: "Trend strength (z) using years up to this one", type: "line", style: "observed", data: series.map((s) => ({ x: s.end_year, y: s.z })) }],
  });
}

/**
 * How the evidence builds as years are added. The line is the Mann-Kendall z-score of the record
 * from the first year up to each end year; beyond +/-1.96 the trend is significant. Click to expand.
 */
export default function Emergence({ series, year, significant, title, source, variable, expandable = true }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 360);
  const height = 230;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const spec = useMemo(() => (series && series.length >= 2 ? emergenceSpec(series, year, { title, source, variable }) : null), [series, year, title, source, variable]);

  if (!series || series.length < 2) {
    return <p className="dim">Not enough years to show how the evidence builds.</p>;
  }

  const [zLo, zHi] = extent(series.map((s) => s.z));
  const lo = Math.min(zLo - 0.4, -2.6);
  const hi = Math.max(zHi + 0.4, 2.6);
  const xs = linearScale(series[0].end_year, series[series.length - 1].end_year, 0, iw);
  const ys = linearScale(lo, hi, ih, 0);
  const points = series.map((s) => [xs(s.end_year), ys(s.z)]);
  const emergence = year != null ? series.find((s) => s.end_year === year) : null;

  return (
    <div className="emergence">
      <ExpandableChart spec={spec} disabled={!expandable}>
        <div ref={wrapRef} className="chart-wrap">
          <svg width={width} height={height} role="img" aria-label={year ? `The trend became significant in ${year}` : "The trend has not become significant"}>
            <g transform={`translate(${M.l},${M.t})`}>
              <rect x={0} y={0} width={iw} height={Math.max(0, ys(Z_CRIT))} className="ch-zone" />
              <rect x={0} y={ys(-Z_CRIT)} width={iw} height={Math.max(0, ih - ys(-Z_CRIT))} className="ch-zone" />
              {niceTicks(lo, hi, 4).map((v) => (
                <g key={v}>
                  <line className="ch-grid" x1={0} x2={iw} y1={ys(v)} y2={ys(v)} />
                  <text className="ch-tick" x={-8} y={ys(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
                </g>
              ))}
              <line className="ch-threshold" x1={0} x2={iw} y1={ys(Z_CRIT)} y2={ys(Z_CRIT)} />
              <line className="ch-threshold" x1={0} x2={iw} y1={ys(-Z_CRIT)} y2={ys(-Z_CRIT)} />
              <text className="ch-note" x={6} y={ys(Z_CRIT) - 6}>Significant rise ▲</text>
              <text className="ch-note" x={6} y={ys(-Z_CRIT) + 16}>Significant fall ▼</text>
              {niceTicks(series[0].end_year, series[series.length - 1].end_year, Math.max(3, Math.floor(iw / 80))).map((v) => (
                <text key={v} className="ch-tick" x={xs(v)} y={ih + 19} textAnchor="middle">{v}</text>
              ))}
              <path className="ch-line observed draw" pathLength="1" d={linePath(points)} style={{ "--d": "300ms", "--dur": "1.2s" }} />
              {emergence && (
                <g className="reveal-fade">
                  <line className="ch-marker" x1={xs(year)} x2={xs(year)} y1={0} y2={ih} />
                  <circle cx={xs(year)} cy={ys(emergence.z)} r={5} className="ch-point actual" />
                  <text className="ch-value-label" x={Math.min(xs(year) + 8, iw - 44)} y={14}>{year}</text>
                </g>
              )}
            </g>
          </svg>
        </div>
      </ExpandableChart>
      <p className="ch-note-text">
        {year
          ? `Seen on its own, the record first became — and stayed — significant in ${year}. (Descriptive only: each point reuses the earlier years; the z-scores are adjusted for year-to-year correlation.)`
          : significant === false
            ? "The overall trend is not significant, so no emergence year is given. More years of data could change that."
            : "The record has not yet become significant. More years of data could change that."}
      </p>
    </div>
  );
}
