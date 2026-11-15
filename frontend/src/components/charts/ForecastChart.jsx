import { useMemo, useRef } from "react";
import { useWidth } from "../../hooks.js";
import { bandPath, chartSpec, extent, linePath, linearScale, niceTicks, padExtent } from "../../lib/chart.js";
import { sig } from "../../lib/format.js";
import { ExpandableChart, HatchPattern, LineSwatch as LineSw, useSvgId } from "./ChartViewer.jsx";
import { DEFAULT_SOURCE } from "./TrendChart.jsx";

const M = { t: 18, r: 14, b: 32, l: 60 };
const HISTORY_YEARS = 25;

/** ChartViewer spec for a forecast: the recorded history, the forecast with its 80% band, and the optional replay. */
export function forecastSpec(lab, replay, { title, source, unit, variable } = {}) {
  const all = lab.history;
  const last = all[all.length - 1];
  const f = lab.forecast;
  const anchor = { x: last.year, y: last.value, lo: last.value, hi: last.value };
  const series = [
    {
      id: "fband",
      label: "Forecast 80% band",
      type: "band",
      style: "forecast",
      data: [anchor, ...f.filter((p) => p.lo != null).map((p) => ({ x: p.year, lo: p.lo, hi: p.hi }))],
    },
    { id: "rec", label: "Recorded", type: "line", style: "observed", data: all.map((h) => ({ x: h.year, y: h.value })) },
    { id: "fc", label: "Forecast", type: "line", style: "forecast", data: [{ x: last.year, y: last.value }, ...f.map((p) => ({ x: p.year, y: p.value }))] },
  ];
  if (replay) {
    const origin = all.find((h) => h.year === replay.origin_year);
    const note = replay.band_basis === "in_sample" ? "In-sample illustration" : undefined;
    if (origin) {
      series.push(
        {
          id: "rband",
          label: `Replay band from ${replay.origin_year}`,
          type: "band",
          style: "replay",
          data: [{ x: origin.year, lo: origin.value, hi: origin.value }, ...replay.points.filter((p) => p.lo != null).map((p) => ({ x: p.year, lo: p.lo, hi: p.hi }))],
        },
        { id: "replay", label: `Replay from ${replay.origin_year}`, type: "line", style: "replay", data: [{ x: origin.year, y: origin.value }, ...replay.points.map((p) => ({ x: p.year, y: p.value, note }))] },
      );
    }
    series.push({ id: "actual", label: "What actually happened", type: "points", style: "actual", data: replay.points.filter((p) => p.actual != null).map((p) => ({ x: p.year, y: p.actual })) });
  }
  return chartSpec({
    title: title ?? `${lab.variable?.label ?? "Forecast"}: next ${f.length} years`,
    source: source ?? lab.variable?.source ?? DEFAULT_SOURCE,
    unit: unit ?? lab.variable?.units ?? "",
    variable: variable ?? lab.variable,
    xKind: "year",
    xLabel: "Year",
    forecastFrom: last.year,
    markers: replay ? [{ x: replay.origin_year, label: `Replay from ${replay.origin_year}` }] : [],
    series,
  });
}

/**
 * Recorded history, the forecast with its 80% band (hatched), and an optional "replay": what the model would have
 * said at an earlier year, drawn next to what actually happened. Click to expand.
 */
export default function ForecastChart({ lab, replay, units, title, source, unit, variable, expandable = true }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 250 : 300;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const hatchId = useSvgId("fc-hatch");
  const shownUnit = unit ?? units;

  const view = useMemo(() => {
    const all = lab.history;
    const startYear = Math.min(all[Math.max(0, all.length - HISTORY_YEARS)].year, replay?.origin_year ?? Infinity);
    const history = all.filter((h) => h.year >= startYear);
    const last = history[history.length - 1];
    const f = lab.forecast;
    const endYear = f[f.length - 1].year;

    const numbers = [
      ...history.map((h) => h.value),
      ...f.flatMap((p) => [p.value, p.lo, p.hi]),
      ...(replay ? replay.points.flatMap((p) => [p.value, p.lo, p.hi, p.actual]) : []),
    ].filter((v) => v != null);
    const [lo, hi] = padExtent(extent(numbers), 0.08);
    const xs = linearScale(startYear, endYear, 0, iw);
    const ys = linearScale(lo, hi, ih, 0);
    const bandOf = (anchor, points) => {
      const withBand = points.filter((p) => p.lo != null);
      if (withBand.length === 0) return null;
      const upper = [[xs(anchor.year), ys(anchor.value)], ...withBand.map((p) => [xs(p.year), ys(p.hi)])];
      const lower = [[xs(anchor.year), ys(anchor.value)], ...withBand.map((p) => [xs(p.year), ys(p.lo)])];
      return bandPath(upper, lower);
    };

    let replayView = null;
    if (replay) {
      const origin = all.find((h) => h.year === replay.origin_year);
      if (origin) {
        replayView = {
          originX: xs(replay.origin_year),
          line: linePath([[xs(origin.year), ys(origin.value)], ...replay.points.map((p) => [xs(p.year), ys(p.value)])]),
          band: bandOf(origin, replay.points),
          actual: replay.points.filter((p) => p.actual != null).map((p) => ({ x: xs(p.year), y: ys(p.actual), year: p.year, value: p.actual })),
        };
      }
    }

    return {
      xs,
      ys,
      xTicks: niceTicks(startYear, endYear, Math.max(3, Math.floor(iw / 90))),
      yTicks: niceTicks(lo, hi, 5),
      history: linePath(history.map((h) => [xs(h.year), ys(h.value)])),
      forecastLine: linePath([[xs(last.year), ys(last.value)], ...f.map((p) => [xs(p.year), ys(p.value)])]),
      forecastBand: bandOf(last, f),
      forecastPoints: f.map((p) => ({ x: xs(p.year), y: ys(p.value), p })),
      lastX: xs(last.year),
      replayView,
    };
  }, [lab, replay, iw, ih]);

  const spec = useMemo(() => forecastSpec(lab, replay, { title, source, unit: shownUnit, variable }), [lab, replay, title, source, shownUnit, variable]);

  return (
    <div className="chart-block">
      <ul className="ch-legend">
        <li><LineSw style="observed" />Recorded</li>
        <li><LineSw style="forecast" />Forecast</li>
        <li>
          <svg className="ch-sw-svg" width="22" height="12" aria-hidden="true"><defs><HatchPattern id={`${hatchId}-k`} /></defs><rect x="1" y="1" width="20" height="10" className="ch-band forecast" fill={`url(#${hatchId}-k)`} /></svg>
          80% forecast band
        </li>
        {replay && <li><LineSw style="replay" />Replay from {replay.origin_year}{replay.band_basis === "in_sample" ? " (in-sample illustration)" : ""}</li>}
        {replay && <li><svg className="ch-sw-svg" width="22" height="12" aria-hidden="true"><circle cx="11" cy="6" r="3.5" className="ch-point actual" /></svg>What actually happened</li>}
      </ul>
      <ExpandableChart spec={spec} disabled={!expandable}>
        <div ref={wrapRef} className="chart-wrap">
          <svg width={width} height={height} role="img" aria-label={`Forecast of ${lab.variable.label} for the next ${lab.forecast.length} years${replay ? " with a replay of a past forecast" : ""}`}>
            <defs><HatchPattern id={hatchId} /></defs>
            <text className="ch-unit" x={M.l} y={12}>{shownUnit}</text>
            <g transform={`translate(${M.l},${M.t})`}>
              <rect className="ch-forecast-zone" x={view.lastX} y={0} width={Math.max(0, iw - view.lastX)} height={ih} />
              {view.yTicks.map((v) => (
                <g key={v}>
                  <line className="ch-grid" x1={0} x2={iw} y1={view.ys(v)} y2={view.ys(v)} />
                  <text className="ch-tick" x={-8} y={view.ys(v)} textAnchor="end" dominantBaseline="middle">{sig(v, 3)}</text>
                </g>
              ))}
              {view.xTicks.map((v) => (
                <text key={v} className="ch-tick" x={view.xs(v)} y={ih + 20} textAnchor="middle">{v}</text>
              ))}

              <line className="ch-forecast-divider" x1={view.lastX} x2={view.lastX} y1={0} y2={ih} />
              <text className="ch-note" x={Math.min(view.lastX + 6, iw - 4)} y={14} textAnchor={view.lastX + 70 > iw ? "end" : "start"}>Forecast</text>

              {view.forecastBand && <path d={view.forecastBand} className="ch-band forecast reveal-fade" fill={`url(#${hatchId})`} />}
              <path className="ch-line observed draw" pathLength="1" d={view.history} style={{ "--d": "100ms", "--dur": "1.2s" }} />
              <path d={view.forecastLine} className="ch-line forecast reveal-fade" />
              {view.forecastPoints.map(({ x, y, p }) => (
                <circle key={p.year} cx={x} cy={y} r="3.2" className="ch-point forecast">
                  <title>{`${p.year}: ${sig(p.value, 4)} ${shownUnit}${p.lo != null ? ` (80% band ${sig(p.lo, 4)} to ${sig(p.hi, 4)})` : ""}`}</title>
                </circle>
              ))}

              {view.replayView && (
                <g key={replay.origin_year} className="reveal-fade">
                  <line className="ch-marker" x1={view.replayView.originX} x2={view.replayView.originX} y1={0} y2={ih} />
                  {view.replayView.band && <path d={view.replayView.band} className="ch-band replay" />}
                  <path d={view.replayView.line} className="ch-line replay" />
                  {view.replayView.actual.map((a) => (
                    <circle key={a.year} cx={a.x} cy={a.y} r="4" className="ch-point actual">
                      <title>{`${a.year}: actually ${sig(a.value, 4)} ${shownUnit}`}</title>
                    </circle>
                  ))}
                </g>
              )}
            </g>
          </svg>
        </div>
      </ExpandableChart>
    </div>
  );
}
