/**
 * "Ask the detective": turns a few typed words into a place and a variable.
 * No AI involved: a small, transparent keyword list plus the bundled gazetteer.
 */

// Most specific phrases first; the first group that matches wins.
const VARIABLE_KEYWORDS = [
  [["daily high", "hottest", "hot days", "heat wave", "heatwave", "max temperature"], "T2M_MAX"],
  [["night", "nights", "overnight", "daily low", "coldest", "min temperature"], "T2M_MIN"],
  [["skin temperature", "ground temperature", "surface temperature"], "TS"],
  [["water vapor", "water vapour", "precipitable"], "TQV"],
  [["specific humidity"], "QV2M"],
  [["humid", "humidity", "muggy"], "RH2M"],
  [["soil", "root zone"], "GWETROOT"],
  [["evaporation", "evaporate"], "EVLAND"],
  [["snow"], "PRECSNOLAND"],
  [["cloud"], "CLOUD_AMT"],
  [["sunlight", "sunshine", "solar", "dimming", "brightening"], "ALLSKY_SFC_SW_DWN"],
  [["wind"], "WS2M"],
  [["pressure"], "PS"],
  [["rain", "precip", "wet", "drought", "dry", "drier", "wetter", "monsoon"], "PRECTOTCORR"],
  [["hot", "heat", "warm", "temperature", "temp", "cold", "cool"], "T2M"],
];

const STOP_WORDS = new Set([
  "the", "and", "are", "was", "how", "what", "does", "did", "getting", "more", "less", "much", "over", "time", "year", "years",
  "change", "changing", "changed", "trend", "trends", "for", "with", "into", "this", "that", "than", "from", "has", "have",
  "weather", "climate", "show", "find", "tell", "about", "there", "where", "here", "city", "area", "region",
]);

export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The variable a sentence is probably about, or null. */
export function guessVariable(text) {
  // "rainforest" is a place type, not a hint about rainfall.
  const q = ` ${normalize(text).replace(/rainforest/g, " forest ")} `;
  for (const [words, id] of VARIABLE_KEYWORDS) {
    if (words.some((w) => q.includes(` ${w}`))) return id;
  }
  return null;
}

/** Places whose name (or kind) the sentence mentions, best match first. */
export function matchPlaces(query, places, limit = 5) {
  const nq = normalize(query);
  if (!nq) return [];
  const tokens = nq
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && guessVariable(t) === null);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const place of places) {
    const name = normalize(place.name);
    const words = name.split(" ");
    let score = 0;
    if (nq.includes(name)) score = 100 + name.length;
    else if (tokens.some((t) => words.includes(t))) score = 60;
    else if (tokens.some((t) => words.some((w) => w.startsWith(t) || (w.length >= 4 && t.startsWith(w))))) score = 40;
    else if (tokens.some((t) => name.includes(t))) score = 25;
    if (tokens.some((t) => place.kind.startsWith(t) || (t.length >= 4 && t.startsWith(place.kind)))) score += 10;
    if (score > 0) scored.push({ place, score });
  }
  scored.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
  return scored.slice(0, limit).map((s) => s.place);
}

/**
 * Suggestions for the search box. Each is { type: "place", place, variable } or { type: "variable", variable }.
 * When the sentence names no variable, the current one is kept.
 */
export function suggest(query, places, currentVariable) {
  const guessed = guessVariable(query);
  const variable = guessed ?? currentVariable;
  const found = matchPlaces(query, places);
  if (found.length > 0) return found.map((place) => ({ type: "place", place, variable }));
  if (guessed) return [{ type: "variable", variable: guessed }];
  return [];
}

const YEAR_MIN = 1981;
const yearOf = (t) => {
  const n = Number.parseInt(t, 10);
  return n >= YEAR_MIN && n <= 2100 ? n : null;
};

/**
 * Years named in a sentence: "2000-2020", "from 1990 to 2010", "between 1995 and 2015", "since 2000", "after 2005",
 * "before 2010", "until 2015". Returns { start?, end? } or null. Years outside 1981–2100 are ignored.
 */
export function parseYears(text) {
  const q = String(text ?? "").toLowerCase();
  let m = q.match(/\b(\d{4})\s*(?:-|–|—|to|until|through|and)\s*(\d{4})\b/);
  if (m) {
    const a = yearOf(m[1]);
    const b = yearOf(m[2]);
    if (a && b) return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  m = q.match(/\b(?:since|after|from)\s+(\d{4})\b/);
  if (m && yearOf(m[1])) return { start: yearOf(m[1]) };
  m = q.match(/\b(?:before|until|till|up to)\s+(\d{4})\b/);
  if (m && yearOf(m[1])) return { end: yearOf(m[1]) };
  return null;
}

/** Coordinates typed as "12.5, -70.2" or "12.5N 70.2W". Returns { lat, lon } or null. */
export function parseCoords(text) {
  const q = String(text ?? "").toUpperCase();
  let m = q.match(/(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])[\s,;]+(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])/);
  if (m) {
    const lat = Number(m[1]) * (m[2] === "S" ? -1 : 1);
    const lon = Number(m[3]) * (m[4] === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  m = q.match(/(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

/**
 * The whole question at once, for the Ask tool (owner item 2): the question decides the place and the variable; the
 * years and coordinates are read too when typed. Nothing is guessed silently: each part says whether it came from the
 * question ("asked") or is the current setting ("kept"), so the Adjust form can show and pre-fill it.
 *
 * Returns { place, coords, variable, variableFrom, years, alternatives, ready }.
 *   place          best gazetteer match or null; alternatives: the other matches
 *   coords         { lat, lon } typed in the question, or null
 *   variable       guessed id, else currentVariable; variableFrom: "asked" | "kept"
 *   years          { start?, end? } or null
 *   ready          true when there is a place (or typed coordinates) to investigate
 */
export function parseQuestion(text, places, currentVariable) {
  const guessed = guessVariable(text);
  const coords = parseCoords(text);
  const found = coords ? [] : matchPlaces(text, places ?? []);
  return {
    place: found[0] ?? null,
    alternatives: found.slice(1),
    coords,
    variable: guessed ?? currentVariable ?? null,
    variableFrom: guessed ? "asked" : "kept",
    years: parseYears(text),
    ready: !!(coords || found[0]),
  };
}
