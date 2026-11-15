/**
 * Capital cities for the rotating globe popups (Main page): the capitals of the 193 United Nations member states.
 *
 * This is static geography written by hand and bundled with the app: positions are approximate (about 0.01 to 0.1
 * degrees, a few kilometres at most), nothing here is fetched, and none of it is climate data or a measurement. Where a
 * country has more than one seat of government the card says which one is meant. The first fifty entries are the main
 * countries across every inhabited continent; the popups prefer them, then the rest follow.
 *
 * The details shown are either computed from the position (latitude, longitude, distance from the equator, mean solar
 * time against Greenwich) or a short fixed fact that is well established. Mean solar time is the Sun's position, not
 * the legal clock time. News for a capital is fetched separately (lib/capitalNews.js) and is context, not evidence.
 */
import { markersFor } from "./globeNews.js";

// [id, capital, country, lat, lon, optional note about which capital, optional fixed fact]
const RAW = [
  // The main countries first.
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
  // The rest of the 193 UN member states, alphabetical by country.
  ["kabul", "Kabul", "Afghanistan", 34.53, 69.17],
  ["tirana", "Tirana", "Albania", 41.33, 19.82],
  ["algiers", "Algiers", "Algeria", 36.75, 3.06],
  ["andorra-la-vella", "Andorra la Vella", "Andorra", 42.51, 1.52],
  ["luanda", "Luanda", "Angola", -8.84, 13.23],
  ["saint-johns", "Saint John's", "Antigua and Barbuda", 17.12, -61.85],
  ["yerevan", "Yerevan", "Armenia", 40.18, 44.51],
  ["vienna", "Vienna", "Austria", 48.21, 16.37],
  ["baku", "Baku", "Azerbaijan", 40.41, 49.87],
  ["nassau", "Nassau", "Bahamas", 25.05, -77.36],
  ["manama", "Manama", "Bahrain", 26.23, 50.59],
  ["bridgetown", "Bridgetown", "Barbados", 13.1, -59.61],
  ["minsk", "Minsk", "Belarus", 53.9, 27.57],
  ["brussels", "Brussels", "Belgium", 50.85, 4.35],
  ["belmopan", "Belmopan", "Belize", 17.25, -88.77],
  ["porto-novo", "Porto-Novo", "Benin", 6.5, 2.63],
  ["thimphu", "Thimphu", "Bhutan", 27.47, 89.64],
  ["sarajevo", "Sarajevo", "Bosnia and Herzegovina", 43.86, 18.41],
  ["gaborone", "Gaborone", "Botswana", -24.65, 25.91],
  ["bandar-seri-begawan", "Bandar Seri Begawan", "Brunei", 4.89, 114.94],
  ["sofia", "Sofia", "Bulgaria", 42.7, 23.32],
  ["ouagadougou", "Ouagadougou", "Burkina Faso", 12.37, -1.52],
  ["gitega", "Gitega", "Burundi", -3.43, 29.93, "political capital"],
  ["praia", "Praia", "Cabo Verde", 14.93, -23.51],
  ["phnom-penh", "Phnom Penh", "Cambodia", 11.56, 104.92],
  ["yaounde", "Yaoundé", "Cameroon", 3.85, 11.5],
  ["bangui", "Bangui", "Central African Republic", 4.36, 18.56],
  ["ndjamena", "N'Djamena", "Chad", 12.13, 15.05],
  ["moroni", "Moroni", "Comoros", -11.7, 43.26],
  ["brazzaville", "Brazzaville", "Republic of the Congo", -4.27, 15.28],
  ["san-jose", "San José", "Costa Rica", 9.93, -84.08],
  ["yamoussoukro", "Yamoussoukro", "Côte d'Ivoire", 6.83, -5.29, "political capital"],
  ["zagreb", "Zagreb", "Croatia", 45.81, 15.98],
  ["havana", "Havana", "Cuba", 23.11, -82.37],
  ["nicosia", "Nicosia", "Cyprus", 35.19, 33.38],
  ["prague", "Prague", "Czechia", 50.08, 14.44],
  ["kinshasa", "Kinshasa", "DR Congo", -4.44, 15.27],
  ["copenhagen", "Copenhagen", "Denmark", 55.68, 12.57],
  ["djibouti", "Djibouti", "Djibouti", 11.59, 43.15],
  ["roseau", "Roseau", "Dominica", 15.3, -61.39],
  ["santo-domingo", "Santo Domingo", "Dominican Republic", 18.49, -69.93],
  ["san-salvador", "San Salvador", "El Salvador", 13.69, -89.22],
  ["malabo", "Malabo", "Equatorial Guinea", 3.75, 8.78],
  ["asmara", "Asmara", "Eritrea", 15.34, 38.93],
  ["tallinn", "Tallinn", "Estonia", 59.44, 24.75],
  ["mbabane", "Mbabane", "Eswatini", -26.31, 31.14, "administrative capital"],
  ["suva", "Suva", "Fiji", -18.14, 178.44],
  ["libreville", "Libreville", "Gabon", 0.39, 9.45],
  ["banjul", "Banjul", "Gambia", 13.45, -16.58],
  ["tbilisi", "Tbilisi", "Georgia", 41.72, 44.79],
  ["accra", "Accra", "Ghana", 5.6, -0.19],
  ["saint-georges", "Saint George's", "Grenada", 12.06, -61.75],
  ["guatemala-city", "Guatemala City", "Guatemala", 14.63, -90.51],
  ["conakry", "Conakry", "Guinea", 9.64, -13.58],
  ["bissau", "Bissau", "Guinea-Bissau", 11.86, -15.6],
  ["georgetown", "Georgetown", "Guyana", 6.8, -58.16],
  ["port-au-prince", "Port-au-Prince", "Haiti", 18.54, -72.34],
  ["tegucigalpa", "Tegucigalpa", "Honduras", 14.07, -87.19],
  ["budapest", "Budapest", "Hungary", 47.5, 19.04],
  ["dublin", "Dublin", "Ireland", 53.35, -6.26],
  ["jerusalem", "Jerusalem", "Israel", 31.77, 35.22, "its status is disputed internationally"],
  ["kingston", "Kingston", "Jamaica", 17.97, -76.79],
  ["amman", "Amman", "Jordan", 31.95, 35.93],
  ["tarawa", "South Tarawa", "Kiribati", 1.33, 173.02],
  ["kuwait-city", "Kuwait City", "Kuwait", 29.38, 47.99],
  ["bishkek", "Bishkek", "Kyrgyzstan", 42.87, 74.59],
  ["vientiane", "Vientiane", "Laos", 17.97, 102.63],
  ["riga", "Riga", "Latvia", 56.95, 24.11],
  ["beirut", "Beirut", "Lebanon", 33.89, 35.5],
  ["maseru", "Maseru", "Lesotho", -29.31, 27.48],
  ["monrovia", "Monrovia", "Liberia", 6.3, -10.8],
  ["tripoli", "Tripoli", "Libya", 32.89, 13.19],
  ["vaduz", "Vaduz", "Liechtenstein", 47.14, 9.52],
  ["vilnius", "Vilnius", "Lithuania", 54.69, 25.28],
  ["luxembourg", "Luxembourg", "Luxembourg", 49.61, 6.13],
  ["antananarivo", "Antananarivo", "Madagascar", -18.88, 47.51],
  ["lilongwe", "Lilongwe", "Malawi", -13.96, 33.77],
  ["male", "Malé", "Maldives", 4.18, 73.51],
  ["bamako", "Bamako", "Mali", 12.64, -8.0],
  ["valletta", "Valletta", "Malta", 35.9, 14.51],
  ["majuro", "Majuro", "Marshall Islands", 7.09, 171.38],
  ["nouakchott", "Nouakchott", "Mauritania", 18.09, -15.98],
  ["port-louis", "Port Louis", "Mauritius", -20.16, 57.5],
  ["palikir", "Palikir", "Micronesia", 6.92, 158.16],
  ["chisinau", "Chișinău", "Moldova", 47.01, 28.86],
  ["monaco", "Monaco", "Monaco", 43.74, 7.42],
  ["ulaanbaatar", "Ulaanbaatar", "Mongolia", 47.89, 106.91],
  ["podgorica", "Podgorica", "Montenegro", 42.44, 19.26],
  ["maputo", "Maputo", "Mozambique", -25.97, 32.57],
  ["naypyidaw", "Naypyidaw", "Myanmar", 19.76, 96.08],
  ["windhoek", "Windhoek", "Namibia", -22.56, 17.08],
  ["yaren", "Yaren", "Nauru", -0.55, 166.92],
  ["kathmandu", "Kathmandu", "Nepal", 27.72, 85.32],
  ["managua", "Managua", "Nicaragua", 12.14, -86.25],
  ["niamey", "Niamey", "Niger", 13.51, 2.11],
  ["pyongyang", "Pyongyang", "North Korea", 39.04, 125.76],
  ["skopje", "Skopje", "North Macedonia", 42.0, 21.43],
  ["muscat", "Muscat", "Oman", 23.59, 58.41],
  ["ngerulmud", "Ngerulmud", "Palau", 7.5, 134.62],
  ["panama-city", "Panama City", "Panama", 8.98, -79.52],
  ["port-moresby", "Port Moresby", "Papua New Guinea", -9.44, 147.18],
  ["asuncion", "Asunción", "Paraguay", -25.27, -57.58],
  ["doha", "Doha", "Qatar", 25.29, 51.53],
  ["bucharest", "Bucharest", "Romania", 44.43, 26.1],
  ["kigali", "Kigali", "Rwanda", -1.95, 30.06],
  ["basseterre", "Basseterre", "Saint Kitts and Nevis", 17.3, -62.72],
  ["castries", "Castries", "Saint Lucia", 14.01, -60.99],
  ["kingstown", "Kingstown", "Saint Vincent and the Grenadines", 13.16, -61.22],
  ["apia", "Apia", "Samoa", -13.83, -171.76],
  ["san-marino", "San Marino", "San Marino", 43.94, 12.45],
  ["sao-tome", "São Tomé", "São Tomé and Príncipe", 0.34, 6.73],
  ["dakar", "Dakar", "Senegal", 14.72, -17.47],
  ["belgrade", "Belgrade", "Serbia", 44.79, 20.45],
  ["victoria", "Victoria", "Seychelles", -4.62, 55.45],
  ["freetown", "Freetown", "Sierra Leone", 8.48, -13.23],
  ["singapore", "Singapore", "Singapore", 1.29, 103.85],
  ["bratislava", "Bratislava", "Slovakia", 48.15, 17.11],
  ["ljubljana", "Ljubljana", "Slovenia", 46.06, 14.51],
  ["honiara", "Honiara", "Solomon Islands", -9.43, 159.95],
  ["mogadishu", "Mogadishu", "Somalia", 2.05, 45.32],
  ["juba", "Juba", "South Sudan", 4.85, 31.58],
  ["kotte", "Sri Jayawardenepura Kotte", "Sri Lanka", 6.89, 79.92, "legislative capital"],
  ["khartoum", "Khartoum", "Sudan", 15.5, 32.56],
  ["paramaribo", "Paramaribo", "Suriname", 5.85, -55.2],
  ["bern", "Bern", "Switzerland", 46.95, 7.45],
  ["damascus", "Damascus", "Syria", 33.51, 36.29],
  ["dushanbe", "Dushanbe", "Tajikistan", 38.56, 68.77],
  ["dodoma", "Dodoma", "Tanzania", -6.16, 35.75],
  ["dili", "Dili", "Timor-Leste", -8.56, 125.57],
  ["lome", "Lomé", "Togo", 6.13, 1.22],
  ["nukualofa", "Nukuʻalofa", "Tonga", -21.14, -175.2],
  ["port-of-spain", "Port of Spain", "Trinidad and Tobago", 10.66, -61.51],
  ["tunis", "Tunis", "Tunisia", 36.81, 10.18],
  ["ashgabat", "Ashgabat", "Turkmenistan", 37.96, 58.33],
  ["funafuti", "Funafuti", "Tuvalu", -8.52, 179.2],
  ["kampala", "Kampala", "Uganda", 0.35, 32.58],
  ["abu-dhabi", "Abu Dhabi", "United Arab Emirates", 24.45, 54.38],
  ["montevideo", "Montevideo", "Uruguay", -34.9, -56.16],
  ["port-vila", "Port Vila", "Vanuatu", -17.73, 168.32],
  ["caracas", "Caracas", "Venezuela", 10.48, -66.9],
  ["sanaa", "Sana'a", "Yemen", 15.37, 44.19],
  ["lusaka", "Lusaka", "Zambia", -15.39, 28.32],
  ["harare", "Harare", "Zimbabwe", -17.83, 31.05],
];

export const MAIN_COUNT = 52; // the first entries above are the main countries; the popups prefer them

export const CAPITALS = RAW.map(([id, name, country, lat, lon, note = null, fact = null], i) => ({
  id: `capital-${id}`,
  name,
  country,
  lat,
  lon,
  note,
  fact,
  main: i < MAIN_COUNT,
}));

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
 * The geography card of a capital, kept short: title, country line, the position, and ONE more derived detail (Sun time
 * against Greenwich, or distance from the equator; which one alternates city by city), plus an optional fixed fact.
 * `full` adds both derived details (used by the detailed overview).
 */
export function capitalCard(c, { full = false } = {}) {
  const index = Math.max(0, CAPITALS.findIndex((x) => x.id === c.id));
  const second = index % 2 === 0 ? solarOffsetText(c.lon) : equatorText(c.lat);
  return {
    id: c.id,
    title: c.name,
    country: c.note ? `${c.country} · ${c.note}` : c.country,
    details: full ? [coordText(c.lat, c.lon), solarOffsetText(c.lon), equatorText(c.lat)] : [coordText(c.lat, c.lon), second],
    fact: c.fact,
  };
}

/** The capital list used as "places" for news lookups and story matching. */
export const capitalPlaces = () => CAPITALS.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, capital: true }));

/**
 * Globe marker objects for every capital. `stories` (optional) are the matched news stories [{ item, place }] for the
 * capitals fetched so far: a capital with verified news carries the highest severity (green, amber or red), one with only
 * unverified news is neutral and dashed, and one with no news yet shows the geography card alone.
 */
export function capitalMarkers(stories = [], { stale = false } = {}) {
  const byPlace = new Map();
  for (const s of stories) {
    if (!byPlace.has(s.place.id)) byPlace.set(s.place.id, []);
    byPlace.get(s.place.id).push(s);
  }
  return CAPITALS.map((c) => {
    const base = {
      id: c.id,
      kind: "capital",
      placeId: c.id,
      main: c.main,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      tone: "capital",
      verified: false,
      glyph: "",
      count: 0,
      stale,
      open: false,
      uncertaintyKm: null,
      lead: null,
      card: capitalCard(c),
    };
    const list = byPlace.get(c.id);
    if (!list?.length) return base;
    const [m] = markersFor(list, { stale });
    return { ...base, tone: m.tone, verified: m.verified, glyph: m.glyph, count: m.count, lead: m.lead };
  });
}
