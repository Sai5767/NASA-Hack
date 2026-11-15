import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  filterByInterest, interestForVariable, locationsParam, markersFor, NEWS_LABEL, newsCard, newsState, safeUrl, savedStories,
  UNVERIFIED_LABEL,
} from "../src/lib/globeNews.js";
import { formatValue, glyphModel, hourSeries, retryWait, runs, utcTime, weatherState } from "../src/lib/liveWeather.js";

const FX = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/v2_fixtures.json", import.meta.url), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const PLACES = [
  { id: "p-delhi", name: "Delhi", lat: 28.61, lon: 77.21 },
  { id: "p-phx", name: "Phoenix", lat: 33.45, lon: -112.07 },
];

test("verified story: severity border, label and composed overview", () => {
  const c = newsCard(FX.news.items[0]);
  assert.equal(c.verified, true);
  assert.equal(c.tone, "amber");
  assert.equal(c.glyph, "▲");
  assert.equal(c.label, NEWS_LABEL);
  assert.equal(c.publisher, "BBC News");
  assert.equal(c.overview, "Weather / environmental watch · near Delhi (approximate)");
  assert.equal(c.severityLabel, "Weather / environmental watch");
  assert.equal(c.url, "https://www.bbc.com/news/science-environment-101");
  assert.match(c.precision, /city centre, approximate \(within about 50 km\)/);
});

test("unverified story: 'Unverified news context', no severity claim", () => {
  const c = newsCard(FX.news.items[1]);
  assert.equal(c.verified, false);
  assert.equal(c.tone, "unverified");
  assert.equal(c.severity, null);
  assert.equal(c.severityLabel, null);
  assert.ok(c.overview.startsWith(UNVERIFIED_LABEL));
  assert.ok(!c.overview.includes("watch"));
  // A missing field is treated as unverified, and so is any non-true value.
  const { publisher_verified: _, ...noFlag } = FX.news.items[0];
  assert.equal(newsCard(noFlag).verified, false);
  assert.equal(newsCard({ ...FX.news.items[0], publisher_verified: "true" }).verified, false);
});

test("only http(s) links are rendered", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl("http://example.org/a"), "http://example.org/a");
  assert.equal(newsCard({ ...FX.news.items[0], url: "data:text/html,x", canonical_url: null }).url, null);
});

test("markers: one per saved place; colour from verified stories only", () => {
  const list = savedStories(FX.news, PLACES);
  assert.equal(list.length, 2);
  assert.equal(list[0].item.publisher_verified, true, "verified sorted first");
  const markers = markersFor(list);
  const delhi = markers.find((m) => m.placeId === "p-delhi");
  const phx = markers.find((m) => m.placeId === "p-phx");
  assert.equal(delhi.tone, "amber");
  assert.equal(delhi.verified, true);
  assert.equal(phx.tone, "unverified", "an unverified-only place never gets a severity colour");
  assert.equal(phx.glyph, "◇");
  // Mixed place: an unverified red story does not raise a verified amber marker.
  const red = { ...clone(FX.news.items[1]), id: "x", lat: 28.61, lon: 77.21, severity: "red", publisher_verified: false };
  const mixed = markersFor(savedStories({ ...FX.news, items: [...FX.news.items, red] }, PLACES));
  const d2 = mixed.find((m) => m.placeId === "p-delhi");
  assert.equal(d2.tone, "amber");
  assert.equal(d2.count, 2);
  assert.equal(d2.lead.verified, true);
  assert.equal(markersFor(list, { stale: true, openPlaceId: "p-phx" }).find((m) => m.placeId === "p-phx").open, true);
});

test("stories from places the user did not save (global rotation set) are never shown", () => {
  const rot = { ...clone(FX.news.items[0]), id: "rot", location_source: "global_rotation", lat: -33.87, lon: 151.21 };
  const list = savedStories({ ...FX.news, items: [rot, ...FX.news.items] }, PLACES);
  assert.ok(!list.some((s) => s.item.id === "rot"));
  assert.equal(savedStories(FX.news, [PLACES[0]]).length, 1);
});

test("interest filter keeps matching categories and climate science", () => {
  const list = savedStories(FX.news, PLACES);
  assert.equal(filterByInterest(list, "heat").length, 1);
  assert.equal(filterByInterest(list, "water").length, 1);
  assert.equal(filterByInterest(list, null).length, 2);
  const sci = { ...clone(FX.news.items[0]), id: "sci", category: "climate_science" };
  assert.equal(filterByInterest(savedStories({ items: [sci] }, PLACES), "ice").length, 1);
  assert.equal(interestForVariable({ id: "T2M", group: "Heat" }), "heat");
  assert.equal(interestForVariable({ id: "CLOUD_AMT", group: "Sun & clouds" }), "cloud");
});

test("news request states: idle, loading/slow, error, empty, stale, partial, items", () => {
  assert.equal(newsState(null, []).kind, "idle");
  assert.equal(newsState({ loading: true }, [], { slow: true }).slow, true);
  assert.equal(newsState({ error: "x" }, []).kind, "error");
  const list = savedStories(FX.news, PLACES);
  assert.equal(newsState({ data: FX.news }, list).kind, "items");
  const empty = { ...clone(FX.news), items: [], empty_reason: "Nothing near your places." };
  const e = newsState({ data: empty }, []);
  assert.equal(e.kind, "empty");
  assert.equal(e.reason, "Nothing near your places.");
  const stale = newsState({ data: { ...clone(FX.news), stale: true, cache_age_seconds: 2520 } }, list);
  assert.equal(stale.stale, true);
  assert.equal(stale.age, "42 min ago");
  // Every saved place failed and nothing came back: a provider error, never placeholder headlines.
  const down = {
    ...empty,
    locations_queried: [{ id: "custom_28.61_77.21", source: "saved_location" }, { id: "sydney", source: "global_rotation" }],
    partial_failures: [{ location_id: "custom_28.61_77.21", location_name: "Delhi", code: "timeout" }, { location_id: "sydney", code: "timeout" }],
  };
  const d = newsState({ data: down }, []);
  assert.equal(d.kind, "error");
  assert.equal(d.partial.length, 1, "failures of the global rotation set are not reported");
});

test("locations param: saved places only, Name:lat:lon, at most 5, at most 300 chars", () => {
  assert.equal(locationsParam(PLACES), "Delhi:28.61:77.21,Phoenix:33.45:-112.07");
  assert.equal(locationsParam([{ name: "A, B: C", lat: 1, lon: 2 }]), "A B C:1.00:2.00");
  const many = Array.from({ length: 8 }, (_, i) => ({ name: "X".repeat(80), lat: i, lon: i }));
  const p = locationsParam(many);
  assert.ok(p.split(",").length <= 5);
  assert.ok(p.length <= 300);
  assert.equal(locationsParam([]), "");
});

test("live weather status mapping covers every backend status", () => {
  assert.equal(weatherState(null).kind, "idle");
  assert.equal(weatherState({ loading: true }).kind, "loading");
  assert.equal(weatherState({ error: "net" }).kind, "error");
  const ok = weatherState({ data: FX.live_weather_available });
  assert.equal(ok.kind, "available");
  assert.equal(ok.canShowOnGlobe, true);
  assert.equal(ok.label, "Meteomatics weather forecast — not NASA trend data");
  const un = weatherState({ data: FX.live_weather_unconfigured });
  assert.equal(un.kind, "unconfigured");
  assert.equal(un.canShowOnGlobe, false);
  assert.match(un.reason, /not configured/);
  const stale = weatherState({ data: { ...clone(FX.live_weather_available), status: "stale", stale: true, reason: "Refresh failed." } });
  assert.equal(stale.kind, "stale");
  assert.equal(stale.canShowOnGlobe, true);
  const rl = weatherState({ data: { ...clone(FX.live_weather_unconfigured), status: "rate_limited", retry_after_seconds: 120, reason: "Try later." } });
  assert.equal(rl.kind, "rate_limited");
  assert.equal(rl.retryAfter, 120);
  assert.equal(weatherState({ data: { ...clone(FX.live_weather_unconfigured), status: "unavailable" } }).kind, "unavailable");
  assert.equal(weatherState({ data: { ...clone(FX.live_weather_unconfigured), status: "weird" } }).kind, "unavailable");
  // "available" without data is not trusted.
  assert.equal(weatherState({ data: { ...clone(FX.live_weather_available), current: null } }).kind, "unavailable");
});

test("live weather values: null stays '—', glyph arcs clamp, gaps stay gaps", () => {
  assert.equal(formatValue(null, "m/s"), "—");
  assert.equal(formatValue(3.2, "m/s"), "3.2 m/s");
  assert.equal(formatValue(40, "%", 0), "40 %");
  const g = glyphModel(FX.live_weather_available);
  assert.equal(g.cloud, 0.4);
  assert.equal(g.rain, 0);
  assert.equal(g.wind, 0.16);
  const g2 = glyphModel({ current: { temperature_c: null, cloud_cover_percent: null, precipitation_1h_mm: 50, wind_speed_10m_ms: 99 } });
  assert.equal(g2.temp, null);
  assert.equal(g2.cloud, null);
  assert.equal(g2.rain, 1);
  assert.equal(g2.rainOver, true);
  assert.equal(g2.wind, 1);
  assert.equal(glyphModel(FX.live_weather_unconfigured), null);
  const pts = hourSeries({ series: [{ temperature_c: 1 }, { temperature_c: null }, { temperature_c: 3 }, { temperature_c: 4 }] });
  assert.equal(runs(pts, "temp").length, 2);
  assert.equal(utcTime("2026-11-15T14:09:53Z"), "14:09 UTC");
  assert.equal(retryWait(120, 1_000_000, 1_000_000 + 30_000), 90);
  assert.equal(retryWait(120, 0, 10_000_000), 0);
  assert.equal(retryWait(null, 0, 0), 0);
});
