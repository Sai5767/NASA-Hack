import { useMemo, useRef, useState } from "react";
import { useWidth } from "../../hooks.js";
import { bandPath, extent, linePath, linearScale, niceTicks, padExtent } from "../../lib/chart.js";
import { MONTHS, sig, signed } from "../../lib/format.js";

const M = { t: 16, r: 14, b: 30, l: 58 };

function buildAnnual(data, iw, ih) {
  const { annual, trend_line: tl } = data;
  const first = annual[0].year;
  const last = annual[annual.length - 1].year;
  const lineAt = (t) => tl.intercept + tl.slope_per_year * (t - tl.t0);
  const low = (t) => tl.pivot_value + tl.ci_low_per_year * (t - tl.pivot_year);
  const high = (t) => tl.pivot_value + tl.ci_high_per_year * (t - tl.pivot_year);

  const values = annual.map((a) => a.value);
  const [lo, hi] = padExtent(extent([...values, low(first), low(last), high(first), high(last)]), 0.07);
  const xs = linearScale(first, last, 0, iw);
  const ys = linearScale(lo, hi, ih, 0);

  const upper = [];
  const lower = [];
  for (let k = 0; k <= 40; k += 1) {
    const t = first + ((last - first) * k) / 40;
    const a = low(t);
    const b = high(t);
    upper.push([xs(t), ys(Math.max(a, b))]);
    lower.push([xs(t), ys(Math.min(a, b))]);
  }
  return {
    xs,
    ys,
    xTicks: niceTicks(first, last, Math.max(3, Math.floor(iw / 90))),
    yTicks: niceTicks(lo, hi, 5),
    band: bandPath(upper, lower),
    line: linePath(annual.map((a) => [xs(a.year), ys(a.value)])),
    trend: linePath([[xs(first), ys(lineAt(first))], [xs(last), ys(lineAt(last))]]),
    points: annual.map((a) => ({ x: xs(a.year), y: ys(a.value), label: String(a.year), value: a.value, extra: null })),
  };
}

function buildMonthly(data, iw, ih) {
  const { monthly, rolling, annual, trend_line: tl } = data;
  const timeOf = (r) => r.y + (r.m - 0.5) / 12;
  const first = monthly[0].y;
  const last = monthly[monthly.length - 1].y + 1;
  const xs = linearScale(first, last, 0, iw);
  const lineAt = (t) => tl.intercept + tl.slope_per_year * (t - tl.t0) - tl.mean_value;

  const maxAbs = Math.max(...monthly.map((r) => Math.abs(r.a)), ...rolling.map((r) => Math.abs(r.v)), 1e-9) * 1.1;
  const ys = linearScale(-maxAbs, maxAbs, ih, 0);
  const barWidth = Math.max(0.8, (iw / monthly.length) * 0.82);
  const tA = annual[0].year + 0.5;
  const tB = annual[annual.length - 1].year + 0.5;
  return {
    xs,
    ys,
    xTicks: niceTicks(first, last, Math.max(3, Math.floor(iw / 90))),
    yTicks: niceTicks(-maxAbs, maxAbs, 5),
    bars: monthly.map((r) => {
      const y1 = ys(Math.max(r.a, 0));
      const y2 = ys(Math.min(r.a, 0));
      return { x: xs(timeOf(r)) - barWidth / 2, y: y1, h: Math.max(0.6, y2 - y1), up: r.a >= 0 };
    }),
    line: linePath(rolling.map((r) => [xs(r.t), ys(r.v)])),
    trend: linePath([[xs(tA), ys(lineAt(tA - 0.5))], [xs(tB), ys(lineAt(tB - 0.5))]]),
    zeroY: ys(0),
    points: monthly.map((r) => ({
      x: xs(timeOf(r)),
      y: ys(r.a),
      label: `${MONTHS[r.m - 1]} ${r.y}`,
      value: r.v,
      extra: r.a,
    })),
  };
}

function nearest(points, px) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.abs(points[i].x - px);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export default function TrendChart({ data, events = [], onEvent }) {
  const [mode, setMode] = useState("annual");
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 270 : 340;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const { stats, variable } = data;
  const units = variable.units;
  const trendColor = stats.significant ? (stats.sign === "up" ? "var(--up)" : "var(--down)") : "var(--flat)";

  const view = useMemo(
    () => (mode === "annual" ? buildAnnual(data, iw, ih) : buildMonthly(data, iw, ih)),
    [mode, data, iw, ih],
  );
  const point = hover != null ? view.points[hover] : null;
  const label = mode === "annual" ? "Annual averages" : "Monthly departures from normal";

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearest(view.points, e.clientX - rect.left - M.l));
  };

  return (
    <div className="chart-block">
      <div className="chart-head">
        <div className="seg" role="group" aria-label="Chart view">
          <button type="button" className={mode === "annual" ? "on" : ""} onClick={() => { setMode("annual"); setHover(null); }}>Annual averages</button>
          <button type="button" className={mode === "monthly" ? "on" : ""} onClick={() => { setMode("monthly"); setHover(null); }}>Monthly anomalies</button>
        </div>
        <ul className="legend">
          {mode === "annual" ? (
            <>
              <li><i className="sw line" style={{ background: "var(--accent)" }} />yearly average</li>
              <li><i className="sw line" style={{ background: trendColor }} />trend (Sen)</li>
              <li><i className="sw box" style={{ background: "rgba(var(--accent-rgb),0.18)" }} />95% range of trend</li>
              {events.length > 0 && <li><i className="sw box" style={{ background: "var(--amber)" }} />major event nearby</li>}
            </>
          ) : (
            <>
              <li><i className="sw box" style={{ background: "var(--up)" }} />above normal</li>
              <li><i className="sw box" style={{ background: "var(--down)" }} />below normal</li>
              <li><i className="sw line" style={{ background: "#fff" }} />12-month average</li>
            </>
          )}
        </ul>
      </div>

      <div ref={wrapRef} className="chart-wrap">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} of ${variable.label}, ${stats.significant ? stats.direction : "no significant trend"}`}
          key={mode}
        >
          <text className="ax-unit" x={M.l} y={10}>{units}</text>
          <g transform={`translate(${M.l},${M.t})`}>
            {view.yTicks.map((v) => (
              <g key={v}>
                <line className="grid" x1={0} x2={iw} y1={view.ys(v)} y2={view.ys(v)} />
                <text className="ax-tick" x={-8} y={view.ys(v)} textAnchor="end" dominantBaseline="middle">{sig(v, 3)}</text>
              </g>
            ))}
            {view.xTicks.map((v) => (
              <text key={v} className="ax-tick" x={view.xs(v)} y={ih + 18} textAnchor="middle">{v}</text>
            ))}

            {mode === "annual" ? (
              <>
                <path className="band reveal-fade" d={view.band} style={{ "--d": "1500ms" }} />
                <path className="draw" pathLength="1" d={view.line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" style={{ "--d": "250ms", "--dur": "1.5s" }} />
                {view.points.map((p, i) => (
                  <circle key={p.label} className="reveal-pop" cx={p.x} cy={p.y} r={hover === i ? 5 : 2.6} fill="var(--accent)" style={{ "--d": `${250 + (i / view.points.length) * 1500}ms` }} />
                ))}
              </>
            ) : (
              <>
                <line className="zero" x1={0} x2={iw} y1={view.zeroY} y2={view.zeroY} />
                {view.bars.map((b, i) => (
                  <rect key={i} x={b.x} y={b.y} width={Math.max(0.8, iw / view.bars.length * 0.82)} height={b.h} fill={b.up ? "var(--up)" : "var(--down)"} opacity={0.78} className="reveal-fade" style={{ "--d": `${(i / view.bars.length) * 1100}ms` }} />
                ))}
                <path className="draw" pathLength="1" d={view.line} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" style={{ "--d": "500ms", "--dur": "1.6s" }} />
              </>
            )}
            <path className="draw" pathLength="1" d={view.trend} fill="none" stroke={trendColor} strokeWidth="2.6" strokeDasharray="1" strokeLinecap="round" style={{ "--d": "1700ms", "--dur": "0.9s", filter: "drop-shadow(0 0 5px currentColor)", color: trendColor }} />

            {point && (
              <g className="hover-layer" pointerEvents="none">
                <line className="cross" x1={point.x} x2={point.x} y1={0} y2={ih} />
                <circle cx={point.x} cy={point.y} r={5.5} fill="none" stroke="#fff" strokeWidth="1.5" />
                <g transform={`translate(${Math.min(Math.max(point.x - 78, 0), iw - 156)},4)`}>
                  <rect width="156" height={point.extra != null ? 56 : 42} rx="8" className="tip-box" />
                  <text x="10" y="17" className="tip-title">{point.label}</text>
                  <text x="10" y="34" className="tip-val">{sig(point.value, 4)} {units}</text>
                  {point.extra != null && <text x="10" y="49" className="tip-sub">{signed(point.extra, 3)} vs normal</text>}
                </g>
              </g>
            )}
            <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            {mode === "annual" &&
              events.map((ev) => {
                const x = view.xs(ev.year);
                const open = () => onEvent?.(ev);
                return (
                  <g
                    key={ev.id}
                    className="event-marker"
                    role="button"
                    tabIndex={0}
                    aria-label={`${ev.year}: ${ev.name}. Open the event details.`}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open();
                      }
                    }}
                  >
                    <rect x={x - 8} y={0} width={16} height={ih} fill="transparent" />
                    <line x1={x} x2={x} y1={8} y2={ih} />
                    <path d={`M${x},1 l6,6 l-6,6 l-6,-6 Z`} />
                    <title>{ev.year}: {ev.name} (click for details)</title>
                  </g>
                );
              })}
          </g>
        </svg>
      </div>
    </div>
  );
}
