import { useRef } from "react";
import { useWidth } from "../../hooks.js";
import { extent, linePath, linearScale, niceTicks } from "../../lib/chart.js";

const M = { t: 14, r: 14, b: 28, l: 40 };
const Z_CRIT = 1.96;

/**
 * How the evidence builds as years are added. The line is the Mann-Kendall z-score of the record
 * from the first year up to each end year; beyond +/-1.96 the trend is significant.
 */
export default function Emergence({ series, year, significant }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 360);
  const height = 230;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;

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
    <div className="emergence" ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label={year ? `The trend became significant in ${year}` : "The trend has not become significant"}>
        <g transform={`translate(${M.l},${M.t})`}>
          <rect x={0} y={0} width={iw} height={ys(Z_CRIT)} className="zone up" />
          <rect x={0} y={ys(-Z_CRIT)} width={iw} height={ih - ys(-Z_CRIT)} className="zone down" />
          {niceTicks(lo, hi, 4).map((v) => (
            <g key={v}>
              <line className="grid" x1={0} x2={iw} y1={ys(v)} y2={ys(v)} />
              <text className="ax-tick" x={-8} y={ys(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
            </g>
          ))}
          <line className="thresh" x1={0} x2={iw} y1={ys(Z_CRIT)} y2={ys(Z_CRIT)} />
          <line className="thresh" x1={0} x2={iw} y1={ys(-Z_CRIT)} y2={ys(-Z_CRIT)} />
          <text className="zone-label" x={6} y={ys(Z_CRIT) - 5}>significant ↑</text>
          <text className="zone-label" x={6} y={ys(-Z_CRIT) + 13}>significant ↓</text>
          {niceTicks(series[0].end_year, series[series.length - 1].end_year, Math.max(3, Math.floor(iw / 80))).map((v) => (
            <text key={v} className="ax-tick" x={xs(v)} y={ih + 17} textAnchor="middle">{v}</text>
          ))}
          <path className="draw" pathLength="1" d={linePath(points)} fill="none" stroke="var(--amber)" strokeWidth="2.4" strokeLinejoin="round" style={{ "--d": "700ms", "--dur": "1.6s" }} />
          {emergence && (
            <g className="reveal-pop" style={{ "--d": "2000ms" }}>
              <line className="emerge-line" x1={xs(year)} x2={xs(year)} y1={0} y2={ih} />
              <circle cx={xs(year)} cy={ys(emergence.z)} r={5.5} fill="var(--accent)" stroke="#04060d" strokeWidth="2" />
              <text className="emerge-label" x={Math.min(xs(year) + 8, iw - 70)} y={14}>{year}</text>
            </g>
          )}
        </g>
      </svg>
      <p className="fp-note">
        {year
          ? `Seen on its own, the record first became — and stayed — significant in ${year}. (Descriptive only: each point reuses the earlier years; the z-scores are adjusted for year-to-year correlation.)`
          : significant === false
            ? "The overall trend is not significant, so no emergence year is given. More years of data could change that."
            : "The record has not yet become significant. More years of data could change that."}
      </p>
    </div>
  );
}
