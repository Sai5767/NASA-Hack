/**
 * The fixed global showcase for the rotating news cycle (final visual fix, section 3).
 *
 * Ten main cities across continents, on purpose: the globe never asks for news at arbitrary worldwide coordinates, so
 * the work stays bounded. Saved user places always come first; a showcase city that is within ~1.5 degrees of a saved
 * place is dropped (the saved place already covers it). News for the showcase goes through the same /api/news flow as
 * saved places (cached, rate-limited, publisher-verified by the server), in batches of at most five, one batch at a time.
 */
import { locationsParam } from "./globeNews.js";

export const SHOWCASE_CITIES = [
  { id: "showcase-london", name: "London", lat: 51.51, lon: -0.13 },
  { id: "showcase-new-york", name: "New York", lat: 40.71, lon: -74.01 },
  { id: "showcase-sao-paulo", name: "São Paulo", lat: -23.55, lon: -46.63 },
  { id: "showcase-cairo", name: "Cairo", lat: 30.04, lon: 31.24 },
  { id: "showcase-delhi", name: "Delhi", lat: 28.61, lon: 77.21 },
  { id: "showcase-singapore", name: "Singapore", lat: 1.35, lon: 103.82 },
  { id: "showcase-tokyo", name: "Tokyo", lat: 35.68, lon: 139.69 },
  { id: "showcase-sydney", name: "Sydney", lat: -33.87, lon: 151.21 },
  { id: "showcase-johannesburg", name: "Johannesburg", lat: -26.2, lon: 28.05 },
  { id: "showcase-mexico-city", name: "Mexico City", lat: 19.43, lon: -99.13 },
].map((c) => ({ ...c, showcase: true }));

export const SHOWCASE_BATCH = 5;

const near = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) < 1.5;

/** The showcase cities not already covered by a saved place. */
export function showcaseFor(savedPlaces) {
  return SHOWCASE_CITIES.filter((c) => !(savedPlaces ?? []).some((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && near(c, p)));
}

/** The cities split into request batches of at most five: [{ cities, param }]. */
export function showcaseBatches(savedPlaces) {
  const list = showcaseFor(savedPlaces);
  const out = [];
  for (let i = 0; i < list.length; i += SHOWCASE_BATCH) {
    const cities = list.slice(i, i + SHOWCASE_BATCH);
    out.push({ cities, param: locationsParam(cities) });
  }
  return out;
}
