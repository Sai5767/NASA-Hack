import { useMemo, useRef } from "react";
import { useWidth } from "../../hooks.js";
import { bandPath, extent, linePath, linearScale, niceTicks, padExtent } from "../../lib/chart.js";
import { sig } from "../../lib/format.js";

const M = { t: 16, r: 14, b: 30, l: 58 };
const HISTORY_YEARS = 25;

/**
 * Recorded history, the forecast with its 80% band, and an optional "replay": what the model would have
 * said at an earlier year, drawn next to what actually happened.
 */
export default function ForecastChart({ lab, replay, units }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const height = width < 520 ? 250 : 300;
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;

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
      ...(replay ? replay.points.flatMap((p) => [p.value, p.lo, p.hi]) : []),
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
      replayView = {
        originX: xs(replay.origin_year),
        line: linePath([[xs(origin.year), ys(origin.value)], ...replay.points.map((p) => [xs(p.year), ys(p.value)])]),
        band: bandOf(origin, replay.points),
        actual: replay.points.map((p) => ({ x: xs(p.year), y: ys(p.actual), year: p.year, value: p.actual })),
      };
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

  return (
    <div className="chart-block">
      <ul className="legend">
        <li><i className="sw line" style={{ background: "var(--accent)" }} />recorded</li>
        <li><i className="sw line" style={{ background: "var(--amber)" }} />forecast and its 80% band</li>
        {replay && <li><i className="sw line" style={{ background: "var(--pin-b)" }} />replay from {replay.origin_year}</li>}
        {replay && <li><i className="sw dot" style={{ background: "#fff" }} />what actually happened</li>}
      </ul>
      <div ref={wrapRef} className="chart-wrap">
        <svg width={width} height={height} role="img" aria-label={`Forecast of ${lab.variable.label} for the next five years with a replay of past forecasts`}>
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

            <line className="now-line" x1={view.lastX} x2={view.lastX} y1={0} y2={ih} />
            <text className="ax-tick" x={view.lastX + 6} y={12}>now</text>

            {view.forecastBand && <path d={view.forecastBand} className="fc-band reveal-fade" style={{ "--d": "900ms" }} />}
            <path className="draw" pathLength="1" d={view.history} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" style={{ "--d": "100ms", "--dur": "1.2s" }} />
            <path d={view.forecastLine} fill="none" stroke="var(--amber)" strokeWidth="2.4" strokeDasharray="6 5" strokeLinecap="round" className="reveal-fade" style={{ "--d": "1100ms" }} />
            {view.forecastPoints.map(({ x, y, p }) => (
              <circle key={p.year} cx={x} cy={y} r="3.4" fill="var(--amber)" className="reveal-pop" style={{ "--d": "1200ms" }}>
                <title>{`${p.year}: ${sig(p.value, 4)} ${units}${p.lo != null ? ` (80% band ${sig(p.lo, 4)} to ${sig(p.hi, 4)})` : ""}`}</title>
              </circle>
            ))}

            {view.replayView && (
              <g key={replay.origin_year} className="reveal-fade">
                <line className="origin-line" x1={view.replayView.originX} x2={view.replayView.originX} y1={0} y2={ih} />
                {view.replayView.band && <path d={view.replayView.band} className="replay-band" />}
                <path d={view.replayView.line} fill="none" stroke="var(--pin-b)" strokeWidth="2.2" strokeDasharray="5 4" />
                {view.replayView.actual.map((a) => (
                  <circle key={a.year} cx={a.x} cy={a.y} r="4" fill="#fff" stroke="#04060d" strokeWidth="1.5">
                    <title>{`${a.year}: actually ${sig(a.value, 4)} ${units}`}</title>
                  </circle>
                ))}
              </g>
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}
