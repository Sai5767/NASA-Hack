import { useMemo, useRef, useState } from "react";
import { useWidth } from "../../hooks.js";
import { bandPath, chartSpec, directionColor, extent, linePath, linearScale, niceTicks, padExtent, rampFamily } from "../../lib/chart.js";
import { MONTHS, formatPlace, sig, signed } from "../../lib/format.js";
import { ExpandableChart, LineSwatch as LineSw } from "./ChartViewer.jsx";

const M = { t: 18, r: 14, b: 32, l: 60 };
export const DEFAULT_SOURCE = "NASA POWER (NASA Langley Research Center)";

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
    barWidth,
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

/**
 * ChartViewer specs for a trend result: [yearly averages, monthly departures]. Values are the backend's annual
 * means / monthly anomalies / rolling means; the trend line and its 95% band come from the backend's trend_line.
 */
export function trendSpecs(data, { title, source, unit, variable, mode = "annual", events = [] } = {}) {
  const { annual, monthly = [], rolling = [], trend_line: tl, variable: v, location } = data;
  const units = unit ?? v.units;
  const where = location ? `, ${formatPlace(location.lat, location.lon)}` : "";
  const base = {
    source: source ?? v.source ?? (typeof data.source === "string" ? data.source : null) ?? DEFAULT_SOURCE,
    unit: units,
    variable: variable ?? v,
    xLabel: "Year",
  };
  const first = annual[0].year;
  const last = annual[annual.length - 1].year;
  const lineAt = (t) => tl.intercept + tl.slope_per_year * (t - tl.t0);
  const pts = annual.map((a) => ({ x: a.year, y: a.value, label: String(a.year) }));
  const annualSpec = chartSpec({
    ...base,
    title: title ?? `${v.label}${where}: yearly averages`,
    viewLabel: "Yearly averages",
    xKind: "year",
    initial: mode === "annual",
    markers: events.map((ev) => ({ x: ev.year, label: ev.name })),
    series: [
      {
        id: "ci",
        label: "95% range of the trend",
        type: "band",
        style: "ci",
        data: [first, last].map((t) => {
          const a = tl.pivot_value + tl.ci_low_per_year * (t - tl.pivot_year);
          const b = tl.pivot_value + tl.ci_high_per_year * (t - tl.pivot_year);
          return { x: t, lo: Math.min(a, b), hi: Math.max(a, b) };
        }),
      },
      { id: "obs", label: "Yearly average", type: "line", style: "observed", data: pts },
      { id: "fit", label: "Trend (Sen's slope)", type: "line", style: "fit", data: [first, last].map((t) => ({ x: t, y: lineAt(t) })) },
    ],
  });
  if (!monthly.length) return [annualSpec];
  const fam = rampFamily(units, v);
  const tA = annual[0].year + 0.5;
  const tB = annual[annual.length - 1].year + 0.5;
  const monthlySpec = chartSpec({
    ...base,
    title: title ? `${title} (monthly departures)` : `${v.label}${where}: monthly departures from normal`,
    viewLabel: "Monthly departures",
    xKind: "time",
    delta: true,
    zeroLine: true,
    yLabel: "vs normal",
    initial: mode === "monthly",
    series: [
      {
        id: "anom",
        label: "Departure from normal",
        type: "bars",
        legend: [
          { label: "Above normal", color: directionColor(1, fam) },
          { label: "Below normal", color: directionColor(-1, fam) },
        ],
        data: monthly.map((r) => ({ x: r.y + (r.m - 0.5) / 12, y: r.a, label: `${MONTHS[r.m - 1]} ${r.y}`, color: directionColor(r.a >= 0 ? 1 : -1, fam) })),
      },
      { id: "roll", label: "12-month average", type: "line", style: "observed", data: rolling.map((r) => ({ x: r.t, y: r.v })) },
      {
        id: "fit",
        label: "Trend (Sen's slope)",
        type: "line",
        style: "fit",
        data: [
          { x: tA, y: lineAt(tA - 0.5) - tl.mean_value },
          { x: tB, y: lineAt(tB - 0.5) - tl.mean_value },
        ],
      },
    ],
  });
  return [annualSpec, monthlySpec];
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

/**
 * The record: yearly averages with the trend, or monthly departures from normal. Click to expand.
 * Props: data (trend result), events / onEvent (optional event markers) and optional viewer metadata
 * title, source, unit, variable; `expandable={false}` turns the viewer off.
 */
export default function TrendChart({ data, events = [], onEvent, title, source, unit, variable, expandable = true }) {
  const [mode, setMode] = useState("annual");
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 270 : 340;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const { stats, variable: v } = data;
  const units = unit ?? v.units;
  const fam = rampFamily(units, v);

  const view = useMemo(
    () => (mode === "annual" ? buildAnnual(data, iw, ih) : buildMonthly(data, iw, ih)),
    [mode, data, iw, ih],
  );
  const specs = useMemo(() => trendSpecs(data, { title, source, unit, variable, mode, events }), [data, title, source, unit, variable, mode, events]);
  const point = hover != null ? view.points[hover] : null;
  const label = mode === "annual" ? "Yearly averages" : "Monthly departures from normal";

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearest(view.points, e.clientX - rect.left - M.l));
  };

  return (
    <div className="chart-block">
      <div className="chart-head">
        <div className="seg" role="group" aria-label="Chart view">
          <button type="button" className={mode === "annual" ? "on" : ""} aria-pressed={mode === "annual"} onClick={() => { setMode("annual"); setHover(null); }}>Yearly averages</button>
          <button type="button" className={mode === "monthly" ? "on" : ""} aria-pressed={mode === "monthly"} onClick={() => { setMode("monthly"); setHover(null); }}>Monthly departures</button>
        </div>
        <ul className="ch-legend">
          {mode === "annual" ? (
            <>
              <li><LineSw style="observed" />Yearly average</li>
              <li><LineSw style="fit" />Trend</li>
              <li><i className="ch-sw box ch-sw-ci" />95% range of trend</li>
              {events.length > 0 && <li><i className="ch-sw diamond" />Major event nearby</li>}
            </>
          ) : (
            <>
              <li><i className="ch-sw box" style={{ background: directionColor(1, fam) }} />Above normal</li>
              <li><i className="ch-sw box" style={{ background: directionColor(-1, fam) }} />Below normal</li>
              <li><LineSw style="observed" />12-month average</li>
            </>
          )}
        </ul>
      </div>

      <ExpandableChart spec={specs} disabled={!expandable}>
        <div ref={wrapRef} className="chart-wrap">
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label} of ${v.label}, ${stats.significant ? stats.direction : "no clear trend"}`}
            key={mode}
          >
            <text className="ch-unit" x={M.l} y={12}>{units}{mode === "monthly" ? " vs normal" : ""}</text>
            <g transform={`translate(${M.l},${M.t})`}>
              {view.yTicks.map((t) => (
                <g key={t}>
                  <line className="ch-grid" x1={0} x2={iw} y1={view.ys(t)} y2={view.ys(t)} />
                  <text className="ch-tick" x={-8} y={view.ys(t)} textAnchor="end" dominantBaseline="middle">{sig(t, 3)}</text>
                </g>
              ))}
              {view.xTicks.map((t) => (
                <text key={t} className="ch-tick" x={view.xs(t)} y={ih + 20} textAnchor="middle">{t}</text>
              ))}

              {mode === "annual" ? (
                <>
                  <path className="ch-band ci reveal-fade" d={view.band} />
                  <path className="ch-line observed draw" pathLength="1" d={view.line} style={{ "--d": "150ms", "--dur": "1.2s" }} />
                  {view.points.map((p, i) => (
                    <circle key={p.label} className="ch-point observed" cx={p.x} cy={p.y} r={hover === i ? 4.5 : 2.4} />
                  ))}
                </>
              ) : (
                <>
                  <line className="ch-zero" x1={0} x2={iw} y1={view.zeroY} y2={view.zeroY} />
                  {view.bars.map((b, i) => (
                    <rect key={i} x={b.x} y={b.y} width={view.barWidth} height={b.h} className="ch-bar" style={{ fill: directionColor(b.up ? 1 : -1, fam) }} />
                  ))}
                  <path className="ch-line observed draw" pathLength="1" d={view.line} style={{ "--d": "300ms", "--dur": "1.2s" }} />
                </>
              )}
              <path className="ch-line fit reveal-fade" d={view.trend} />

              {point && (
                <g className="hover-layer" pointerEvents="none">
                  <line className="ch-cross" x1={point.x} x2={point.x} y1={0} y2={ih} />
                  <circle cx={point.x} cy={point.y} r={5.5} className="ch-focus-dot" />
                  <g transform={`translate(${Math.min(Math.max(point.x - 84, 0), iw - 168)},4)`}>
                    <rect width="168" height={point.extra != null ? 60 : 44} className="ch-tip-box" />
                    <text x="10" y="18" className="ch-tip-title">{point.label}</text>
                    <text x="10" y="36" className="ch-tip-val">{sig(point.value, 4)} {units}</text>
                    {point.extra != null && <text x="10" y="52" className="ch-tip-sub">{signed(point.extra, 3)} vs normal</text>}
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
                      className="event-marker ch-event"
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
      </ExpandableChart>
    </div>
  );
}
