/** Tiny scale / tick / path helpers for the hand-built SVG charts. */

export function linearScale(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const scale = (v) => r0 + (v - d0) * k;
  scale.invert = (px) => d0 + (px - r0) / k;
  scale.domain = [d0, d1];
  return scale;
}

/** "Nice" tick values between min and max (roughly `count` of them). */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].find((m) => m * mag >= raw) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

export function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function padExtent([lo, hi], fraction = 0.08) {
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * fraction, hi + span * fraction];
}

export function linePath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

/** Closed polygon path from an upper edge and a lower edge (both left-to-right). */
export function bandPath(upper, lower) {
  return `${linePath(upper)}${[...lower].reverse().map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join("")}Z`;
}

/** Diverging color: negative -> blue, positive -> coral, centered on a dark neutral. */
export function divergingColor(value, maxAbs) {
  if (!maxAbs) return "rgb(60,70,100)";
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  const neutral = [34, 42, 66];
  const target = t >= 0 ? [255, 106, 92] : [77, 166, 255];
  const k = Math.pow(Math.abs(t), 0.85);
  const rgb = neutral.map((n, i) => Math.round(n + (target[i] - n) * k));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** Annular sector path (for the radial fingerprint). Angles in degrees, 0 = up, clockwise. */
export function sectorPath(cx, cy, r0, r1, a0, a1) {
  const rad = (deg) => ((deg - 90) * Math.PI) / 180;
  const p = (r, a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r1},${r1} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
    + `L${x2.toFixed(2)},${y2.toFixed(2)}A${r0},${r0} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)}Z`;
}
