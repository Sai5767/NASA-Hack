/**
 * Capital cities for the rotating globe popups (Main page).
 *
 * Fifty main countries across every inhabited continent (except Antarctica), one capital each. This is static geography written by hand and
 * bundled with the app: positions are approximate (about 0.01 degrees, a kilometre or two), nothing here is fetched, and
 * none of it is climate data, news or a measurement. Where a country has more than one seat of government the card says
 * which one is meant.
 *
 * The details shown are either computed from the position (latitude, longitude, distance from the equator, mean solar
 * time against Greenwich) or a short fixed fact that is well established. Mean solar time is the Sun's position, not
 * the legal clock time.
 */

// [id, capital, country, lat, lon, optional note about which capital, optional fixed fact]
const RAW = [
  ["washington", "Washington, D.C.", "United States", 38.9, -77.04],
  ["ottawa", "Ottawa", "Canada", 45.42, -75.7],
  ["mexico-city", "Mexico City", "Mexico", 19.43, -99.13],
  ["brasilia", "Brasília", "Brazil", -15.79, -47.88, null, "Built from scratch in the 1950s and inaugurated as the capital in 1960."],
  ["buenos-aires", "Buenos Aires", "Argentina", -34.6, -58.38],
  ["santiago", "Santiago", "Chile", -33.45, -70.67],
  ["bogota", "Bogotá", "Colombia", 4.71, -74.07],
  ["lima", "Lima", "Peru", -12.05, -77.04],
  ["quito", "Quito", "Ecuador", -0.18, -78.47],
  ["la-paz", "La Paz", "Bolivia", -16.5, -68.15, "seat of government", "The highest seat of government in the world, about 3,600 m above sea level."],
  ["london", "London", "United Kingdom", 51.51, -0.13],
  ["paris", "Paris", "France", 48.86, 2.35],
  ["berlin", "Berlin", "Germany", 52.52, 13.4],
  ["rome", "Rome", "Italy", 41.9, 12.5],
  ["madrid", "Madrid", "Spain", 40.42, -3.7],
  ["lisbon", "Lisbon", "Portugal", 38.72, -9.14],
  ["amsterdam", "Amsterdam", "Netherlands", 52.37, 4.9],
  ["oslo", "Oslo", "Norway", 59.91, 10.75],
  ["stockholm", "Stockholm", "Sweden", 59.33, 18.07],
  ["helsinki", "Helsinki", "Finland", 60.17, 24.94],
  ["reykjavik", "Reykjavík", "Iceland", 64.15, -21.94, null, "The northernmost capital of a sovereign state."],
  ["warsaw", "Warsaw", "Poland", 52.23, 21.01],
  ["kyiv", "Kyiv", "Ukraine", 50.45, 30.52],
  ["ankara", "Ankara", "Türkiye", 39.93, 32.86],
  ["moscow", "Moscow", "Russia", 55.76, 37.62],
  ["cairo", "Cairo", "Egypt", 30.04, 31.24],
  ["abuja", "Abuja", "Nigeria", 9.08, 7.4, null, "A planned city that replaced Lagos as the capital in 1991."],
  ["nairobi", "Nairobi", "Kenya", -1.29, 36.82],
  ["addis-ababa", "Addis Ababa", "Ethiopia", 9.03, 38.74],
  ["pretoria", "Pretoria", "South Africa", -25.75, 28.19, "executive capital"],
  ["rabat", "Rabat", "Morocco", 34.02, -6.84],
  ["riyadh", "Riyadh", "Saudi Arabia", 24.71, 46.68],
  ["tehran", "Tehran", "Iran", 35.69, 51.39],
  ["baghdad", "Baghdad", "Iraq", 33.31, 44.36],
  ["islamabad", "Islamabad", "Pakistan", 33.69, 73.05, null, "A planned city built in the 1960s as the new capital."],
  ["new-delhi", "New Delhi", "India", 28.61, 77.21],
  ["dhaka", "Dhaka", "Bangladesh", 23.81, 90.41],
  ["astana", "Astana", "Kazakhstan", 51.17, 71.45],
  ["beijing", "Beijing", "China", 39.9, 116.41],
  ["tokyo", "Tokyo", "Japan", 35.68, 139.69],
  ["seoul", "Seoul", "South Korea", 37.57, 126.98],
  ["hanoi", "Hanoi", "Vietnam", 21.03, 105.85],
  ["bangkok", "Bangkok", "Thailand", 13.76, 100.5],
  ["manila", "Manila", "Philippines", 14.6, 120.98],
  ["jakarta", "Jakarta", "Indonesia", -6.21, 106.85],
  ["canberra", "Canberra", "Australia", -35.28, 149.13, null, "A planned capital, chosen as a compromise between Sydney and Melbourne."],
  ["wellington", "Wellington", "New Zealand", -41.29, 174.78, null, "The southernmost capital of a sovereign state."],
  ["tashkent", "Tashkent", "Uzbekistan", 41.3, 69.24],
  ["athens", "Athens", "Greece", 37.98, 23.73],
  ["kuala-lumpur", "Kuala Lumpur", "Malaysia", 3.14, 101.69],
];

export const CAPITALS = RAW.map(([id, name, country, lat, lon, note = null, fact = null]) => ({ id: `capital-${id}`, name, country, lat, lon, note, fact }));

/** "28.6° N, 77.2° E" */
export function coordText(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}° ${ns}, ${Math.abs(lon).toFixed(1)}° ${ew}`;
}

/** How far the Sun's mean time runs ahead of or behind Greenwich at this longitude: 15 degrees = 1 hour. */
export function solarOffsetText(lon) {
  const minutes = Math.round((Math.abs(lon) / 15) * 60);
  if (minutes < 2) return "On the Greenwich meridian";
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `Sun time is ${h > 0 ? `${h} h ${m} min` : `${minutes} min`} ${lon > 0 ? "ahead of" : "behind"} Greenwich`;
}

/** Distance from the equator, in whole kilometres rounded to the nearest 10 (one degree of latitude is about 111 km). */
export function equatorText(lat) {
  const km = Math.round((Math.abs(lat) * 111.2) / 10) * 10;
  if (km < 40) return "Almost on the equator";
  return `${km.toLocaleString("en-US")} km ${lat >= 0 ? "north" : "south"} of the equator`;
}

/**
 * The card a popup shows, kept short so the globe never feels crowded: title, country line, the position, and ONE more
 * derived detail (Sun time against Greenwich, or distance from the equator; which one alternates city by city), plus
 * an optional fixed fact for the few cities that have one.
 */
export function capitalCard(c) {
  const index = Math.max(0, CAPITALS.findIndex((x) => x.id === c.id));
  return {
    id: c.id,
    title: c.name,
    country: c.note ? `${c.country} · ${c.note}` : c.country,
    details: [coordText(c.lat, c.lon), index % 2 === 0 ? solarOffsetText(c.lon) : equatorText(c.lat)],
    fact: c.fact,
  };
}

/** Globe marker objects for every capital (one popup at a time is chosen by lib/newsCycle.js; the dots stay hidden). */
export function capitalMarkers() {
  return CAPITALS.map((c) => ({
    id: c.id,
    kind: "capital",
    placeId: null,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    tone: "capital",
    verified: true,
    glyph: "○",
    count: 1,
    stale: false,
    open: false,
    uncertaintyKm: null,
    lead: null,
    card: capitalCard(c),
  }));
}
