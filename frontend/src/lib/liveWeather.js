/**
 * Pure live-weather logic (spec 3.7, 5.8). Meteomatics is point-based operational weather for the next 1-72 hours.
 * It is never NASA POWER data, never part of a trend and never the app's own monthly forecast, so nothing here touches
 * the monthly timeline. A value Meteomatics did not supply stays null and is shown as "—".
 */

export const LIVE_LABEL = "Meteomatics weather forecast — not NASA trend data";
export const LIVE_SOURCE_NOTE = "Meteomatics operational weather data. It is separate from NASA POWER climate-trend analysis.";
export const HOURS = [24, 48, 72];

const STATUSES = new Set(["available", "stale", "unconfigured", "unavailable", "rate_limited"]);

/**
 * Map a request to one card state:
 *   idle | loading | available | stale | unconfigured | unavailable | rate_limited | error
 * `canShowOnGlobe` is true only when there is data to draw. Unknown statuses are treated as unavailable.
 */
export function weatherState(req) {
  if (!req || (!req.loading && !req.data && !req.error)) return { kind: "idle", canShowOnGlobe: false };
  if (req.loading && !req.data) return { kind: "loading", canShowOnGlobe: false };
  if (req.error && !req.data) return { kind: "error", message: req.error, canShowOnGlobe: false };
  const d = req.data;
  let kind = STATUSES.has(d.status) ? d.status : "unavailable";
  if (kind === "available" && (d.available !== true || !d.current)) kind = "unavailable";
  if (kind === "stale" && !d.current) kind = "unavailable";
  const hasData = (kind === "available" || kind === "stale") && !!d.current;
  return {
    kind,
    canShowOnGlobe: hasData,
    reason: d.reason ?? null,
    retryAfter: Number.isFinite(d.retry_after_seconds) ? d.retry_after_seconds : null,
    label: d.label || LIVE_LABEL,
    sourceNote: d.source_note || LIVE_SOURCE_NOTE,
    provider: d.provider || "Meteomatics",
  };
}

export const STATE_TITLES = {
  loading: "Requesting Meteomatics…",
  unconfigured: "Live weather isn't set up on this server",
  unavailable: "Meteomatics is unavailable right now",
  rate_limited: "Too many requests for now",
  error: "We couldn't load live weather",
};

/** Seconds left before "Try again" is enabled after a rate limit (0 when allowed). */
export function retryWait(retryAfter, receivedAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(retryAfter) || !Number.isFinite(receivedAtMs)) return 0;
  return Math.max(0, Math.ceil(retryAfter - (nowMs - receivedAtMs) / 1000));
}

export function formatValue(v, unit, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Number(v).toFixed(digits)}${unit === "%" ? " %" : unit ? ` ${unit}` : ""}`;
}

export function utcTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

const frac = (v, max) => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(1, v / max)));

/**
 * The point glyph (display scales only): cloud 0-100 %, hourly precipitation 0-10 mm, wind 0-20 m/s, clamped.
 * A null value gives a null arc (drawn as a dashed empty track). Returns null when there is nothing to draw.
 */
export function glyphModel(resp) {
  const c = resp?.current;
  if (!c) return null;
  return {
    temp: c.temperature_c == null || !Number.isFinite(c.temperature_c) ? null : c.temperature_c,
    cloud: frac(c.cloud_cover_percent, 100),
    rain: frac(c.precipitation_1h_mm, 10),
    rainOver: Number.isFinite(c.precipitation_1h_mm) && c.precipitation_1h_mm >= 10,
    wind: frac(c.wind_speed_10m_ms, 20),
    stale: resp.status === "stale",
    fetchedAt: resp.fetched_at ?? null,
  };
}

/** Hourly chart points on the card's own hour axis; null values stay gaps. */
export function hourSeries(resp, hours = 24) {
  const s = (resp?.series ?? []).slice(0, hours);
  return s.map((p, i) => ({ i, time: p.time, temp: Number.isFinite(p.temperature_c) ? p.temperature_c : null, rain: Number.isFinite(p.precipitation_1h_mm) ? p.precipitation_1h_mm : null }));
}

/** Split a series into runs of non-null values, so the line is broken at gaps (never bridged). */
export function runs(points, key) {
  const out = [];
  let cur = [];
  for (const p of points) {
    if (p[key] == null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
