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
