import { useMemo, useRef, useState } from "react";
import { useWidth } from "../../hooks.js";
import { extent, linePath, linearScale, niceTicks, padExtent } from "../../lib/chart.js";
import { sig, signed } from "../../lib/format.js";

const M = { t: 16, r: 14, b: 30, l: 58 };
const COLORS = { a: "var(--pin-a)", b: "var(--pin-b)" };

/** Two places on one axis: each yearly average relative to its own mean, with both trend lines. */
export default function DuelChart({ overlay, a, b, units }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 260 : 320;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const [hover, setHover] = useState(null);

  const view = useMemo(() => {
    const first = overlay[0].year;
    const last = overlay[overlay.length - 1].year;
    const trend = (res) => (t) => res.trend_line.intercept + res.trend_line.slope_per_year * (t - res.trend_line.t0) - res.trend_line.mean_value;
    const ta = trend(a);
    const tb = trend(b);
    const [lo, hi] = padExtent(extent([...overlay.flatMap((r) => [r.a, r.b]), ta(first), ta(last), tb(first), tb(last)]), 0.08);
    const xs = linearScale(first, last, 0, iw);
    const ys = linearScale(lo, hi, ih, 0);
    return {
      xs,
      ys,
      xTicks: niceTicks(first, last, Math.max(3, Math.floor(iw / 90))),
      yTicks: niceTicks(lo, hi, 5),
      lineA: linePath(overlay.map((r) => [xs(r.year), ys(r.a)])),
      lineB: linePath(overlay.map((r) => [xs(r.year), ys(r.b)])),
      trendA: linePath([[xs(first), ys(ta(first))], [xs(last), ys(ta(last))]]),
      trendB: linePath([[xs(first), ys(tb(first))], [xs(last), ys(tb(last))]]),
    };
  }, [overlay, a, b, iw, ih]);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = view.xs.invert(e.clientX - rect.left - M.l);
    let best = 0;
    overlay.forEach((r, i) => {
      if (Math.abs(r.year - t) < Math.abs(overlay[best].year - t)) best = i;
    });
    setHover(best);
  };
  const row = hover != null ? overlay[hover] : null;

  return (
    <div className="chart-block">
      <ul className="legend">
        <li><i className="sw line" style={{ background: COLORS.a }} />Place A</li>
        <li><i className="sw line" style={{ background: COLORS.b }} />Place B</li>
        <li className="dim">dashed = trend · values relative to each place's own average</li>
      </ul>
      <div ref={wrapRef} className="chart-wrap">
        <svg width={width} height={height} role="img" aria-label="Yearly averages of two places compared, relative to each place's own mean">
          <text className="ax-unit" x={M.l} y={10}>{units} vs own average</text>
          <g transform={`translate(${M.l},${M.t})`}>
            {view.yTicks.map((v) => (
              <g key={v}>
                <line className={v === 0 ? "zero" : "grid"} x1={0} x2={iw} y1={view.ys(v)} y2={view.ys(v)} />
                <text className="ax-tick" x={-8} y={view.ys(v)} textAnchor="end" dominantBaseline="middle">{sig(v, 3)}</text>
              </g>
            ))}
            {view.xTicks.map((v) => (
              <text key={v} className="ax-tick" x={view.xs(v)} y={ih + 18} textAnchor="middle">{v}</text>
            ))}
            <path className="draw" pathLength="1" d={view.lineA} fill="none" stroke={COLORS.a} strokeWidth="2.2" strokeLinejoin="round" style={{ "--d": "200ms", "--dur": "1.4s" }} />
            <path className="draw" pathLength="1" d={view.lineB} fill="none" stroke={COLORS.b} strokeWidth="2.2" strokeLinejoin="round" style={{ "--d": "450ms", "--dur": "1.4s" }} />
            <path d={view.trendA} fill="none" stroke={COLORS.a} strokeWidth="2" strokeDasharray="6 5" className="reveal-fade" style={{ "--d": "1700ms" }} />
            <path d={view.trendB} fill="none" stroke={COLORS.b} strokeWidth="2" strokeDasharray="6 5" className="reveal-fade" style={{ "--d": "1800ms" }} />
            {row && (
              <g pointerEvents="none">
                <line className="cross" x1={view.xs(row.year)} x2={view.xs(row.year)} y1={0} y2={ih} />
                <circle cx={view.xs(row.year)} cy={view.ys(row.a)} r={5} fill={COLORS.a} stroke="#fff" strokeWidth="1.2" />
                <circle cx={view.xs(row.year)} cy={view.ys(row.b)} r={5} fill={COLORS.b} stroke="#fff" strokeWidth="1.2" />
                <g transform={`translate(${Math.min(Math.max(view.xs(row.year) - 78, 0), iw - 156)},4)`}>
                  <rect width="156" height="58" rx="8" className="tip-box" />
                  <text x="10" y="17" className="tip-title">{row.year}</text>
                  <text x="10" y="34" className="tip-val" fill={COLORS.a}>A {signed(row.a, 3)}</text>
                  <text x="10" y="50" className="tip-val" fill={COLORS.b}>B {signed(row.b, 3)}</text>
                </g>
              </g>
            )}
            <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      </div>
    </div>
  );
}
