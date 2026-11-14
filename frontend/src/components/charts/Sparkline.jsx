import { linePath } from "../../lib/chart.js";
import { mean } from "../../lib/format.js";

/** Tiny standardized line: shape of the series, independent of its units. */
export default function Sparkline({ values, color = "var(--accent)", width = 104, height = 30, delay = 0 }) {
  if (!values || values.length < 2) return null;
  const mu = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - mu) ** 2))) || 1;
  const z = values.map((v) => (v - mu) / sd);
  const lo = Math.min(...z);
  const hi = Math.max(...z);
  const pad = 3;
  const pts = z.map((v, i) => [pad + (i / (z.length - 1)) * (width - pad * 2), pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path className="draw" pathLength="1" d={linePath(pts)} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" style={{ "--d": `${delay}ms`, "--dur": "1s" }} />
      <circle cx={lx} cy={ly} r="2.6" fill={color} className="reveal-pop" style={{ "--d": `${delay + 900}ms` }} />
    </svg>
  );
}
