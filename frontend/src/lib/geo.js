import { wrapLon } from "./format.js";

/**
 * Ring of a lat/lon square, densified so it follows parallels on the globe.
 * d3-geo wants exterior rings clockwise as seen on a map: west edge up, north edge east,
 * east edge down, south edge west.
 */
export function cellRing(lat, lon, half, step = 2.5) {
  const south = Math.max(-90, lat - half);
  const north = Math.min(90, lat + half);
  const west = lon - half;
  const east = lon + half;
  const span = (a, b) => {
    const parts = Math.max(1, Math.ceil(Math.abs(b - a) / step));
    return Array.from({ length: parts }, (_, i) => a + ((b - a) * i) / parts);
  };
  const ring = [];
  for (const la of span(south, north)) ring.push([west, la]);
  for (const lo of span(west, east)) ring.push([lo, north]);
  for (const la of span(north, south)) ring.push([east, la]);
  for (const lo of span(east, west)) ring.push([lo, south]);
  ring.push(ring[0]);
  return ring;
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The closest named place within `maxKm`, or null. */
export function nearestPlace(places, lat, lon, maxKm = 300) {
  let best = null;
  let bestKm = Infinity;
  for (const p of places) {
    const km = distanceKm(lat, lon, p.lat, p.lon);
    if (km < bestKm) {
      bestKm = km;
      best = p;
    }
  }
  return best && bestKm <= maxKm ? best : null;
}

export function cellContains(cell, lat, lon, half) {
  return Math.abs(lat - cell.lat) <= half && Math.abs(wrapLon(lon - cell.lon)) <= half;
}
