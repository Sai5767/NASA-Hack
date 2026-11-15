import { useMemo, useRef, useState } from "react";
import { useWidth } from "../../hooks.js";
import { chartSpec, extent, linePath, linearScale, niceTicks, padExtent } from "../../lib/chart.js";
import { sig, signed } from "../../lib/format.js";
import { ExpandableChart, LineSwatch } from "./ChartViewer.jsx";
import { DEFAULT_SOURCE } from "./TrendChart.jsx";

const M = { t: 18, r: 14, b: 32, l: 60 };

const trendOf = (res) => (t) => res.trend_line.intercept + res.trend_line.slope_per_year * (t - res.trend_line.t0) - res.trend_line.mean_value;

/** ChartViewer spec for a duel: each place's yearly average relative to its own mean (a difference: delta units). */
export function duelSpec(overlay, a, b, { title, source, unit, variable, units } = {}) {
  const first = overlay[0].year;
  const last = overlay[overlay.length - 1].year;
  const ta = trendOf(a);
  const tb = trendOf(b);
  const v = variable ?? a.variable;
  return chartSpec({
    title: title ?? `${v?.label ?? "Two places"}: place A and place B vs their own averages`,
    source: source ?? v?.source ?? DEFAULT_SOURCE,
    unit: unit ?? units ?? v?.units ?? "",
    yLabel: "vs own average",
    variable: v,
    delta: true,
    zeroLine: true,
    xKind: "year",
    xLabel: "Year",
    series: [
      { id: "a", label: "Place A", type: "line", style: "a", data: overlay.map((r) => ({ x: r.year, y: r.a })) },
      { id: "b", label: "Place B", type: "line", style: "b", data: overlay.map((r) => ({ x: r.year, y: r.b })) },
      { id: "ta", label: "Place A trend", type: "line", style: "fit-a", data: [first, last].map((t) => ({ x: t, y: ta(t) })) },
      { id: "tb", label: "Place B trend", type: "line", style: "fit-b", data: [first, last].map((t) => ({ x: t, y: tb(t) })) },
    ],
  });
}

/** Two places on one axis: each yearly average relative to its own mean, with both trend lines. Click to expand. */
export default function DuelChart({ overlay, a, b, units, title, source, unit, variable, expandable = true }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 260 : 320;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const [hover, setHover] = useState(null);
  const shownUnit = unit ?? units;

  const view = useMemo(() => {
    const first = overlay[0].year;
    const last = overlay[overlay.length - 1].year;
    const ta = trendOf(a);
    const tb = trendOf(b);
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
  const spec = useMemo(() => duelSpec(overlay, a, b, { title, source, unit, variable, units }), [overlay, a, b, title, source, unit, variable, units]);

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
      <ul className="ch-legend">
        <li><LineSwatch style="a" />Place A</li>
        <li><LineSwatch style="b" />Place B (dashed)</li>
        <li><LineSwatch style="fit-a" />Trends (dotted)</li>
        <li className="ch-legend-note">Values relative to each place's own average</li>
      </ul>
      <ExpandableChart spec={spec} disabled={!expandable}>
        <div ref={wrapRef} className="chart-wrap">
          <svg width={width} height={height} role="img" aria-label="Yearly averages of two places compared, relative to each place's own mean">
            <text className="ch-unit" x={M.l} y={12}>{shownUnit} vs own average</text>
            <g transform={`translate(${M.l},${M.t})`}>
              {view.yTicks.map((v) => (
                <g key={v}>
                  <line className={v === 0 ? "ch-zero" : "ch-grid"} x1={0} x2={iw} y1={view.ys(v)} y2={view.ys(v)} />
                  <text className="ch-tick" x={-8} y={view.ys(v)} textAnchor="end" dominantBaseline="middle">{sig(v, 3)}</text>
                </g>
              ))}
              {view.xTicks.map((v) => (
                <text key={v} className="ch-tick" x={view.xs(v)} y={ih + 20} textAnchor="middle">{v}</text>
              ))}
              <path className="ch-line a draw" pathLength="1" d={view.lineA} style={{ "--d": "200ms", "--dur": "1.2s" }} />
              <path className="ch-line b" d={view.lineB} />
              <path d={view.trendA} className="ch-line fit-a reveal-fade" />
              <path d={view.trendB} className="ch-line fit-b reveal-fade" />
              {row && (
                <g pointerEvents="none">
                  <line className="ch-cross" x1={view.xs(row.year)} x2={view.xs(row.year)} y1={0} y2={ih} />
                  <circle cx={view.xs(row.year)} cy={view.ys(row.a)} r={5} className="ch-point a" />
                  <circle cx={view.xs(row.year)} cy={view.ys(row.b)} r={5} className="ch-point b" />
                  <g transform={`translate(${Math.min(Math.max(view.xs(row.year) - 84, 0), iw - 168)},4)`}>
                    <rect width="168" height="62" className="ch-tip-box" />
                    <text x="10" y="18" className="ch-tip-title">{row.year}</text>
                    <text x="10" y="36" className="ch-tip-val">A {signed(row.a, 3)} {shownUnit}</text>
                    <text x="10" y="53" className="ch-tip-val">B {signed(row.b, 3)} {shownUnit}</text>
                  </g>
                </g>
              )}
              <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </g>
          </svg>
        </div>
      </ExpandableChart>
    </div>
  );
}
