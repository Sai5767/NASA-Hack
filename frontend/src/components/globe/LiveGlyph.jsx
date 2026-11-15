/**
 * Meteomatics point glyph (spec 3.7): a screen-space glyph at one point, never an area. Three arcs (cloud, rain, wind)
 * on display-only scales; a null value draws a dashed empty track. The chip says LIVE · Meteomatics (or STALE).
 * The parent positions the anchor at the exact point; the glyph sits 44 px above-right with a leader line.
 */
import { utcTime } from "../../lib/liveWeather.js";

const D = 72;
const RAD = 30;
// Three 100-degree arcs (SVG angles, 0 = right, clockwise): cloud on top, rain at the bottom, wind on the left.
const ARCS = [
  { key: "cloud", start: -140 },
  { key: "rain", start: 40 },
  { key: "wind", start: 160 },
];

function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = ((startDeg + sweepDeg) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export default function LiveGlyph({ model, reduced = false }) {
  if (!model) return null;
  const cx = 44 + D / 2;
  const cy = -44 - D / 2;
  const stale = model.stale;
  return (
    <div className={`gl-live${stale ? " is-stale" : ""}${reduced ? "" : " gl-live--sweep"}`}>
      <svg className="gl-live-svg" width={44 + D + 4} height={44 + D + 4} viewBox={`0 ${-44 - D - 2} ${44 + D + 4} ${44 + D + 4}`} overflow="visible" aria-hidden="true" focusable="false">
        <line x1="0" y1="0" x2={cx - RAD * 0.75} y2={cy + RAD * 0.75} className="gl-live-leader" />
        <circle cx="0" cy="0" r="3" className="gl-live-point" />
        <circle cx={cx} cy={cy} r={RAD + 6} className="gl-live-disc" />
        {ARCS.map((a) => {
          const v = model[a.key];
          return (
            <g key={a.key}>
              <path d={arcPath(cx, cy, RAD, a.start, 100)} className={`gl-live-track${v == null ? " is-null" : ""}`} />
              {v != null && v > 0 && <path d={arcPath(cx, cy, RAD, a.start, Math.max(2, 100 * v))} className="gl-live-value" pathLength="1" />}
            </g>
          );
        })}
        <text x={cx} y={cy - 2} className="gl-live-temp">{model.temp == null ? "—" : `${Math.round(model.temp)}°C`}</text>
        <text x={cx} y={cy + 13} className="gl-live-word">{stale ? "STALE" : "LIVE"}</text>
      </svg>
      <span className="gl-live-chip mono">
        {stale ? `◔ STALE · Meteomatics · ${utcTime(model.fetchedAt)}` : "LIVE · Meteomatics"}
      </span>
    </div>
  );
}
