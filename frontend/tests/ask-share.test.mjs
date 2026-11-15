import assert from "node:assert/strict";
import { test } from "node:test";

import { guessVariable, matchPlaces, normalize, suggest } from "../src/lib/ask.js";
import { decodeState, encodeState } from "../src/lib/share.js";

const PLACES = [
  { id: "phoenix", name: "Phoenix", kind: "city" },
  { id: "amazon", name: "Amazon Basin", kind: "rainforest" },
  { id: "sahara", name: "Central Sahara", kind: "desert" },
  { id: "gobi", name: "Gobi Desert", kind: "desert" },
  { id: "sahel", name: "Sahel", kind: "dryland" },
  { id: "siberia", name: "Siberia (Yakutsk)", kind: "boreal" },
  { id: "sao-paulo", name: "São Paulo", kind: "city" },
];

// ---------------------------------------------------------------- ask

test("normalize strips accents, punctuation and case", () => {
  assert.equal(normalize("  São  Paulo!? "), "sao paulo");
  assert.equal(normalize(null), "");
});

test("guessVariable maps plain words to the right variable", () => {
  assert.equal(guessVariable("is Phoenix getting hotter?"), "T2M");
  assert.equal(guessVariable("Amazon rain"), "PRECTOTCORR");
  assert.equal(guessVariable("are nights warming faster"), "T2M_MIN");
  assert.equal(guessVariable("hottest days in Iowa"), "T2M_MAX");
  assert.equal(guessVariable("dry soil"), "GWETROOT");
  assert.equal(guessVariable("water vapor"), "TQV");
  assert.equal(guessVariable("sunlight over Delhi"), "ALLSKY_SFC_SW_DWN");
  assert.equal(guessVariable("windy"), "WS2M");
  assert.equal(guessVariable("banana"), null);
});

test("'rainforest' is a place type, not a rainfall hint", () => {
  assert.equal(guessVariable("Amazon rainforest"), null);
  assert.equal(guessVariable("Amazon rainforest heat"), "T2M");
});

test("matchPlaces finds a place by name inside a sentence", () => {
  assert.equal(matchPlaces("is Phoenix getting hotter?", PLACES)[0].id, "phoenix");
  assert.equal(matchPlaces("Amazon rain", PLACES)[0].id, "amazon");
  assert.equal(matchPlaces("sahara heat", PLACES)[0].id, "sahara");
  assert.equal(matchPlaces("Yakutsk", PLACES)[0].id, "siberia");
});

test("matchPlaces ignores accents and falls back to place types", () => {
  assert.equal(matchPlaces("sao paulo", PLACES)[0].id, "sao-paulo");
  assert.equal(matchPlaces("São Paulo", PLACES)[0].id, "sao-paulo");
  const deserts = matchPlaces("desert", PLACES).map((p) => p.id);
  assert.deepEqual(deserts.sort(), ["gobi", "sahara"]);
});

test("matchPlaces returns nothing for keyword-only or empty input", () => {
  assert.deepEqual(matchPlaces("hotter", PLACES), []);
  assert.deepEqual(matchPlaces("", PLACES), []);
  assert.deepEqual(matchPlaces("qzxv", PLACES), []);
});

test("suggest keeps the current variable when none is named, and offers a variable switch alone", () => {
  assert.deepEqual(suggest("Phoenix", PLACES, "PRECTOTCORR")[0], { type: "place", place: PLACES[0], variable: "PRECTOTCORR" });
  assert.equal(suggest("Phoenix heat", PLACES, "PRECTOTCORR")[0].variable, "T2M");
  assert.deepEqual(suggest("wind", PLACES, "T2M"), [{ type: "variable", variable: "WS2M" }]);
  assert.deepEqual(suggest("zzzz", PLACES, "T2M"), []);
});

// ---------------------------------------------------------------- share

const sample = { variable: "T2M", lat: 42, lon: -93.6, start: 1981, end: 2025 };

test("share links round-trip a case", () => {
  const hash = encodeState({ tab: "sweep", params: sample, pinB: null });
  const back = decodeState(`#${hash}`);
  assert.equal(back.tab, "sweep");
  assert.deepEqual(back.params, sample);
  assert.equal(back.pinB, null);
});

test("share links carry the second place of a duel", () => {
  const back = decodeState(encodeState({ tab: "duel", params: sample, pinB: { lat: 0, lon: -160 } }));
  assert.deepEqual(back.pinB, { lat: 0, lon: -160 });
});

test("invalid or hostile hashes are rejected, not trusted", () => {
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#t=investigate"), null);
  assert.equal(decodeState("#v=T2M&lat=120&lon=0"), null); // latitude out of range: nothing valid remains
  assert.equal(decodeState("#t=sweep&v=T2M&lat=120&lon=0").params, null); // the valid tab survives, the bad place does not
  assert.equal(decodeState("#v=T2M&lat=abc&lon=0"), null);
  assert.equal(decodeState("#v=%3Cscript%3E&lat=10&lon=10"), null); // variable fails the allow-list pattern
  assert.equal(decodeState("#t=nonsense&v=T2M&lat=10&lon=10").tab, "investigate"); // unknown tab falls back
  assert.equal(decodeState("#v=T2M&lat=10&lon=10&from=1900&to=abc").params.start, 1981); // bad years fall back to defaults
});

test("a bare tab link (for the planet-wide views) is valid", () => {
  const back = decodeState("#t=vitals");
  assert.equal(back.tab, "vitals");
  assert.equal(back.params, null);
});

test("parseQuestion: the question decides place, variable and years (Ask tool)", async () => {
  const { parseQuestion, parseYears, parseCoords } = await import("../src/lib/ask.js");
  const q = parseQuestion("Is Phoenix getting hotter since 2000?", PLACES, "PRECTOTCORR");
  assert.equal(q.place, PLACES[0]);
  assert.equal(q.variable, "T2M");
  assert.equal(q.variableFrom, "asked");
  assert.deepEqual(q.years, { start: 2000 });
  assert.equal(q.ready, true);
  assert.equal(parseQuestion("Phoenix", PLACES, "WS2M").variableFrom, "kept");
  assert.deepEqual(parseYears("rain 2010 to 1990"), { start: 1990, end: 2010 });
  assert.equal(parseYears("in 1900"), null);
  assert.deepEqual(parseCoords("33.4N 112.1W"), { lat: 33.4, lon: -112.1 });
  assert.deepEqual(parseCoords("trend at 12.5, -70.2"), { lat: 12.5, lon: -70.2 });
  assert.equal(parseQuestion("zzzz", PLACES, "T2M").ready, false);
});
