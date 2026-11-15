/**
 * Time-lapse of the world survey: every site is coloured by how far each year's value sits from that site's own
 * average over the whole record, so the colours shift as the years play.
 */

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** places: world-survey entries ({id, ok, series: [[year, value], ...]}). Returns the years to play and a lookup. */
export function prepareLapse(places) {
  const usable = places.filter((p) => p.ok && Array.isArray(p.series) && p.series.length >= 10);
  const byPlace = new Map();
  const counts = new Map();
  const absolute = [];
  for (const p of usable) {
    const m = mean(p.series.map(([, v]) => v));
    const byYear = new Map(p.series.map(([y, v]) => [y, v - m]));
    byPlace.set(p.id, byYear);
    for (const [y, a] of byYear) {
      counts.set(y, (counts.get(y) ?? 0) + 1);
      absolute.push(Math.abs(a));
    }
  }
  // Play only the years most sites have, so the picture never flickers on a handful of sites.
  const years = [...counts.entries()].filter(([, c]) => c >= 0.8 * usable.length).map(([y]) => y).sort((a, b) => a - b);
  absolute.sort((a, b) => a - b);
  const scale = absolute.length ? absolute[Math.floor(0.9 * (absolute.length - 1))] || 1e-9 : 1e-9; // 90th percentile
  return { years, scale, at: (id, year) => byPlace.get(id)?.get(year) ?? null };
}

/** 0 (typical) to 1 (as unusual as the 90th percentile of all site-years, or more). */
export const intensity = (anomaly, scale) => Math.min(1, Math.abs(anomaly) / scale);

/** Blend two #rrggbb colours: t = 0 gives a, t = 1 gives b. Used to fade a dot from neutral grey to red or blue. */
export function mixHex(a, b, t) {
  const parse = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const part = (x, y) => Math.round(x + (y - x) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0");
  return `#${part(ar, br)}${part(ag, bg)}${part(ab, bb)}`;
}
