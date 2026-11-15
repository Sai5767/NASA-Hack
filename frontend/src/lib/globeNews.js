/**
 * Pure news-context logic (spec 3.6, 5.9). News is context, not scientific evidence: every card carries the item's own
 * `label`. A story whose `publisher_verified` is not exactly `true` is "Unverified news context": it never shows a
 * severity colour or `severity_label`, and it never raises a marker's colour.
 */

export const NEWS_LABEL = "news context, not scientific evidence";
export const UNVERIFIED_LABEL = "Unverified news context";
export const SEVERITY_NOTE = "Border colour is an editorial attention label from keywords in the headline. It is not an official warning.";
export const SLOW_TEXT = "Looking for news context… the first load can take up to 20 seconds.";

const SEVERITY_RANK = { green: 1, amber: 2, red: 3 };
export const SEVERITY_GLYPH = { green: "●", amber: "▲", red: "◆", unverified: "◇" };

/** Story categories (backend keyword rules) relevant to each data interest. "climate_science" is always kept. */
export const INTEREST_CATEGORIES = {
  heat: ["heat_wildfire"],
  water: ["flood_storm", "drought_water"],
  cloud: ["air_atmosphere", "flood_storm"],
  land: ["drought_water", "heat_wildfire"],
  wind: ["air_atmosphere", "flood_storm"],
  ice: ["cryosphere_ocean"],
};

export const CATEGORY_LABEL = {
  heat_wildfire: "heat & wildfire",
  flood_storm: "flood & storm",
  drought_water: "drought & water",
  cryosphere_ocean: "ice & ocean",
  air_atmosphere: "air & atmosphere",
  climate_science: "climate science",
};

/** Map a /api/variables entry to a data-interest id (same groups as the profile's interests). */
export function interestForVariable(variable) {
  if (!variable) return null;
  if (["PRECSNOLAND"].includes(variable.id)) return "ice";
  if (variable.id === "CLOUD_AMT") return "cloud";
  const byGroup = { Heat: "heat", Water: "water", "Sun & clouds": "cloud", Land: "land", "Wind & pressure": "wind" };
  return byGroup[variable.group] ?? null;
}

const clean = (s) => String(s ?? "").replace(/[,:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Saved place";

/** The `locations` query for saved places only: "Name:lat:lon" entries, at most 5, at most 300 characters. */
export function locationsParam(places) {
  const parts = [];
  let len = 0;
  for (const p of (places ?? []).slice(0, 5)) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    const token = `${clean(p.name)}:${p.lat.toFixed(2)}:${p.lon.toFixed(2)}`;
    if (len + token.length + (parts.length ? 1 : 0) > 300) break;
    parts.push(token);
    len += token.length + (parts.length > 1 ? 1 : 0);
  }
  return parts.join(",");
}

/** Only http(s) links are ever rendered. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Index of the saved place a story belongs to (same rounded coordinates, within ~2 km), or -1. */
export function placeIndexFor(item, places, tolerance = 0.02) {
  let best = -1;
  let bestD = Infinity;
  (places ?? []).forEach((p, i) => {
    const d = Math.hypot(p.lat - item.lat, (p.lon - item.lon) * Math.cos((p.lat * Math.PI) / 180));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return bestD <= tolerance ? best : -1;
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function ageText(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  if (seconds < 90) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function precisionText(item, showcase = false) {
  const km = item?.uncertainty_km;
  const within = Number.isFinite(km) ? ` (within about ${km} km)` : "";
  if (showcase || item?.coordinate_precision === "city_centroid") return `Location: city centre, approximate${within}`;
  if (item?.coordinate_precision === "custom_pin") return `Location: your saved place, approximate${within}`;
  return `Location: region, approximate${within}`;
}

/** View model of one card (closed card, list row and panel entry). */
export function newsCard(item, { showcase = false } = {}) {
  const verified = item?.publisher_verified === true;
  const severity = verified && SEVERITY_RANK[item?.severity] ? item.severity : null;
  const place = item?.location_name ? `near ${item.location_name} (approximate)` : "location approximate";
  return {
    id: item.id,
    verified,
    severity,
    tone: verified ? severity ?? "green" : "unverified",
    glyph: verified ? SEVERITY_GLYPH[severity ?? "green"] : SEVERITY_GLYPH.unverified,
    headline: String(item?.title ?? "").trim() || "Untitled story",
    publisher: String(item?.publisher ?? "").trim() || hostOf(item?.url) || "Unknown publisher",
    date: formatDate(item?.published_at),
    overview: verified ? `${item?.severity_label ?? "Environmental context"} · ${place}` : `${UNVERIFIED_LABEL} · ${place}`,
    severityLabel: verified ? item?.severity_label ?? null : null,
    category: CATEGORY_LABEL[item?.category] ?? null,
    label: item?.label || NEWS_LABEL,
    url: safeUrl(item?.url ?? item?.canonical_url),
    host: hostOf(item?.url ?? item?.canonical_url),
    precision: precisionText(item, showcase),
    uncertaintyKm: Number.isFinite(item?.uncertainty_km) ? item.uncertainty_km : null,
  };
}

/** Saved-place stories only (the backend adds a fixed global rotation set; it is never shown), sorted verified first. */
export function savedStories(resp, places, tolerance = 0.02) {
  const out = [];
  for (const item of resp?.items ?? []) {
    if (!item || item.location_source !== "saved_location") continue;
    const idx = placeIndexFor(item, places, tolerance);
    if (idx < 0) continue;
    out.push({ item, place: places[idx] });
  }
  return sortStories(out);
}

export function sortStories(list) {
  return [...list].sort((a, b) => {
    const va = a.item.publisher_verified === true ? 0 : 1;
    const vb = b.item.publisher_verified === true ? 0 : 1;
    if (va !== vb) return va - vb;
    return String(b.item.published_at ?? "").localeCompare(String(a.item.published_at ?? ""));
  });
}

/** Keep stories in the selected interest's categories plus general climate science. No interest keeps everything. */
export function filterByInterest(list, interest) {
  const cats = INTEREST_CATEGORIES[interest];
  if (!cats) return list;
  return list.filter(({ item }) => item.category === "climate_science" || cats.includes(item.category));
}

/**
 * One globe marker per saved place with stories. The colour is the highest severity among VERIFIED stories only;
 * a place with only unverified stories gets the neutral dashed "unverified" marker.
 */
export function markersFor(list, { stale = false, openPlaceId = null } = {}) {
  const byPlace = new Map();
  for (const { item, place } of list) {
    if (!byPlace.has(place.id)) byPlace.set(place.id, { place, items: [] });
    byPlace.get(place.id).items.push(item);
  }
  return [...byPlace.values()].map(({ place, items }) => {
    let best = 0;
    let tone = "unverified";
    for (const it of items) {
      if (it.publisher_verified !== true) continue;
      const r = SEVERITY_RANK[it.severity] ?? 1;
      if (r > best) {
        best = r;
        tone = it.severity in SEVERITY_RANK ? it.severity : "green";
      }
    }
    const verifiedCount = items.filter((it) => it.publisher_verified === true).length;
    const lead = sortStories(items.map((item) => ({ item, place })))[0].item;
    const unc = items.map((it) => it.uncertainty_km).filter(Number.isFinite);
    return {
      id: place.id,
      placeId: place.id,
      showcase: place.showcase === true,
      name: place.name,
      lat: lead.lat,
      lon: lead.lon,
      tone,
      verified: verifiedCount > 0,
      glyph: SEVERITY_GLYPH[tone],
      count: items.length,
      stale,
      open: openPlaceId === place.id,
      uncertaintyKm: unc.length ? Math.max(...unc) : null,
      lead: newsCard(lead, { showcase: place.showcase === true }),
    };
  });
}

/**
 * Overall state of the news request:
 *   "idle" | "loading" | "error" | "empty" | "items"   plus `stale`, `slow`, `partial` (places that did not answer).
 */
export function newsState(req, list, { slow = false } = {}) {
  if (!req || (!req.loading && !req.data && !req.error)) return { kind: "idle" };
  if (req.loading && !req.data) return { kind: "loading", slow };
  if (req.error && !req.data) return { kind: "error", message: req.error };
  const d = req.data;
  // Only failures for the user's saved places matter; the backend's fixed global rotation set is never shown.
  const savedIds = new Set((d.locations_queried ?? []).filter((q) => q?.source === "saved_location").map((q) => q.id));
  const partial = (d.partial_failures ?? []).filter((f) => f && savedIds.has(f.location_id));
  const stale = d.stale === true;
  const age = ageText(d.cache_age_seconds);
  if (!list.length && savedIds.size > 0 && partial.length >= savedIds.size) {
    return { kind: "error", message: d.empty_reason || "The news provider did not answer for your places.", partial, stale, age };
  }
  if (!list.length) return { kind: "empty", reason: d.empty_reason ?? null, partial, stale, age, fetchedAt: d.fetched_at ?? null };
  return { kind: "items", partial, stale, age, fetchedAt: d.fetched_at ?? null, contextNote: d.context_note ?? null };
}
