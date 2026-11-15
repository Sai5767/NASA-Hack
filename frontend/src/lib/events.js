/**
 * Major geo-weather events, hand-curated from widely documented sources. Each is a place, a year and a variable the event
 * should show up in. The app measures what the data actually show (see eventStats); the text only gives context, so it is
 * written to be true whatever the numbers say.
 *
 * year: the headline year drawn on charts; from/to: the years highlighted in the evidence view
 * expect: the direction an annual average should move in the event years ("up" or "down")
 * scope: "global" events are felt planet-wide and are best seen in Planet vitals
 */
import { distanceKm } from "./geo.js";

/**
 * Event kinds. Monochrome by design (V3 spec 4): a neutral grey for the globe marker (canvas needs a hex) plus a
 * distinct glyph and the label, so the kind is never told by colour alone and never borrows news red/amber/green.
 */
export const KINDS = {
  heat: { label: "Heat wave", glyph: "▲", color: "#f2f2f2" },
  drought: { label: "Drought", glyph: "◇", color: "#d0d0d0" },
  flood: { label: "Flood", glyph: "▼", color: "#b3b3b3" },
  ocean: { label: "Ocean cycle", glyph: "◎", color: "#adadad" },
  ice: { label: "Sea ice", glyph: "✳", color: "#f5f5f5" },
  volcano: { label: "Volcano", glyph: "◆", color: "#8c8c8c" },
};

export const EVENTS = [
  {
    id: "sahel-1984", name: "Sahel drought and famine", kind: "drought", year: 1984, from: 1982, to: 1985,
    lat: 14, lon: 0, radiusKm: 900, variable: "PRECTOTCORR", expect: "down", scope: "place",
    blurb: "A long drought gripped the Sahel from the late 1960s into the 1980s. 1983 and 1984 were among the driest years, crops failed and famine followed. Rainfall recovered partly from the 1990s, and changes in Atlantic and Indian Ocean temperatures are the leading explanation.",
    lookFor: "The record starts in 1981, in the middle of the drought, so it shows the recovery more clearly than the drought's start.",
    sources: ["NOAA", "Giannini et al. 2003, Science"],
  },
  {
    id: "pinatubo-1991", name: "Mount Pinatubo eruption", kind: "volcano", year: 1991, from: 1991, to: 1992,
    lat: 15.13, lon: 120.35, radiusKm: 800, variable: "T2M", expect: "down", scope: "global",
    blurb: "In June 1991 Mount Pinatubo in the Philippines threw roughly 20 million tonnes of sulfur dioxide into the stratosphere. The aerosols it formed reflected sunlight and cooled the whole planet by about half a degree Celsius for a year or two.",
    lookFor: "The cooling was global and short-lived, so one place's annual average may barely move. Planet vitals shows it best.",
    sources: ["NASA Earth Observatory", "USGS"],
  },
  {
    id: "nino-1997", name: "1997–98 El Niño", kind: "ocean", year: 1997, from: 1997, to: 1998,
    lat: 0, lon: -140, radiusKm: 2500, variable: "T2M", expect: "up", scope: "place",
    blurb: "One of the strongest El Niños on record. Unusually warm water spread across the tropical Pacific and shifted rainfall around the world: floods in Peru and East Africa, drought and huge fires in Indonesia. 1998 set a new global temperature record.",
    lookFor: "A warm spike in 1997 and 1998 in the central equatorial Pacific.",
    sources: ["NOAA Climate Prediction Center", "NASA GISS"],
  },
  {
    id: "europe-2003", name: "2003 European heat wave", kind: "heat", year: 2003, from: 2003, to: 2003,
    lat: 47, lon: 4, radiusKm: 700, variable: "T2M", expect: "up", scope: "place",
    blurb: "Summer 2003 was the hottest in Europe in at least 500 years. Heat and drought caused tens of thousands of extra deaths; one widely cited estimate is about 70,000 across Europe.",
    lookFor: "A single hot summer can lift a whole year's average, so 2003 should sit near the top.",
    sources: ["Luterbacher et al. 2004, Science", "Robine et al. 2008"],
  },
  {
    id: "amazon-2010", name: "2010 Amazon drought", kind: "drought", year: 2010, from: 2010, to: 2010,
    lat: -3.1, lon: -60, radiusKm: 900, variable: "PRECTOTCORR", expect: "down", scope: "place",
    blurb: "The Amazon suffered severe droughts in 2005 and again in 2010, each described as a once-in-a-century event. River levels fell to record lows in places, and the forest took up less carbon than usual.",
    lookFor: "A dry year in 2010, and possibly 2005.",
    sources: ["Lewis et al. 2011, Science", "NASA Earth Observatory"],
  },
  {
    id: "russia-2010", name: "2010 Russian heat wave", kind: "heat", year: 2010, from: 2010, to: 2010,
    lat: 55.75, lon: 37.6, radiusKm: 900, variable: "T2M", expect: "up", scope: "place",
    blurb: "A record-breaking summer heat wave and peat fires hit western Russia and Moscow was shrouded in smoke. Tens of thousands of excess deaths were estimated, and Russia banned wheat exports after crop losses.",
    lookFor: "2010 should be among the warmest years of the record.",
    sources: ["Dole et al. 2011, Geophysical Research Letters", "Barriopedro et al. 2011, Science"],
  },
  {
    id: "texas-2011", name: "2011 Texas drought", kind: "drought", year: 2011, from: 2011, to: 2011,
    lat: 31, lon: -99, radiusKm: 600, variable: "PRECTOTCORR", expect: "down", scope: "place",
    blurb: "2011 was the driest year in Texas since records began in 1895, with extreme summer heat. Crops failed, millions of trees died, and agricultural losses ran to several billion dollars.",
    lookFor: "2011 should be at or near the bottom of the yearly rainfall.",
    sources: ["NOAA NCEI", "Texas A&M AgriLife"],
  },
  {
    id: "cornbelt-2012", name: "2012 US drought and heat", kind: "drought", year: 2012, from: 2012, to: 2012,
    lat: 41.5, lon: -93, radiusKm: 700, variable: "PRECTOTCORR", expect: "down", scope: "place",
    blurb: "A flash drought and heat spread over the central United States in summer 2012, among the worst since the 1930s. It was also the warmest year on record for the contiguous US up to then, and corn and soybean yields fell sharply.",
    lookFor: "A dry 2012 in the Corn Belt. Switch the variable to air temperature to see the heat.",
    sources: ["NOAA NCEI", "USDA"],
  },
  {
    id: "arctic-2012", name: "2012 Arctic sea-ice minimum", kind: "ice", year: 2012, from: 2012, to: 2012,
    lat: 80, lon: -140, radiusKm: 1500, variable: "T2M", expect: "up", scope: "global",
    blurb: "On 16 September 2012 Arctic sea ice shrank to about 3.4 million square kilometres, the smallest extent in the satellite record up to then (the record began in 1979).",
    lookFor: "Open Planet vitals for the sea-ice series and its long decline; air temperature at one Arctic spot moves more slowly.",
    sources: ["NSIDC"],
  },
  {
    id: "nino-2015", name: "2015–16 El Niño", kind: "ocean", year: 2015, from: 2015, to: 2016,
    lat: 0, lon: -140, radiusKm: 2500, variable: "T2M", expect: "up", scope: "place",
    blurb: "One of the three strongest El Niños on record, alongside 1982–83 and 1997–98. 2015 and then 2016 each set a new global temperature record, and drought struck southern Africa, Ethiopia and parts of the Amazon.",
    lookFor: "A warm spike in 2015 and 2016 in the central equatorial Pacific.",
    sources: ["NOAA Climate Prediction Center", "NASA GISS"],
  },
  {
    id: "harvey-2017", name: "Hurricane Harvey rainfall", kind: "flood", year: 2017, from: 2017, to: 2017,
    lat: 29.8, lon: -95.4, radiusKm: 400, variable: "PRECTOTCORR", expect: "up", scope: "place",
    blurb: "In late August 2017 Hurricane Harvey stalled over southeast Texas and dropped more than 60 inches (about 1,500 mm) of rain in some places, a record for a single US storm. Flooding in the Houston area forced tens of thousands of people into shelters, and damage was estimated at well over 100 billion dollars.",
    lookFor: "2017 should be among the wettest years, because one storm delivered a large share of a normal year's rain in a few days.",
    sources: ["NOAA National Hurricane Center", "National Weather Service"],
  },
  {
    id: "australia-2019", name: "Australia's record heat and Black Summer", kind: "heat", year: 2019, from: 2019, to: 2019,
    lat: -33, lon: 150, radiusKm: 700, variable: "T2M", expect: "up", scope: "place",
    blurb: "2019 was Australia's warmest and driest year on record. The heat and drought set the stage for the 'Black Summer' bushfires of 2019–20, which burned about 18 million hectares.",
    lookFor: "A warm 2019. Switch the variable to rainfall to see the dryness.",
    sources: ["Australian Bureau of Meteorology"],
  },
  {
    id: "siberia-2020", name: "2020 Siberian heat wave", kind: "heat", year: 2020, from: 2020, to: 2020,
    lat: 67.5, lon: 133.4, radiusKm: 1200, variable: "T2M", expect: "up", scope: "place",
    blurb: "In June 2020 the town of Verkhoyansk recorded 38 °C, the highest temperature ever verified north of the Arctic Circle (WMO). Siberia ran several degrees above normal for months, and a rapid attribution study found the heat very unlikely without human-caused warming.",
    lookFor: "2020 should stand out as unusually warm.",
    sources: ["WMO", "Ciavarella et al. 2021, Climatic Change"],
  },
  {
    id: "southwest-megadrought", name: "Southwest US megadrought", kind: "drought", year: 2000, from: 2000, to: 2021,
    lat: 34, lon: -110, radiusKm: 800, variable: "GWETROOT", expect: "down", scope: "place",
    blurb: "The American Southwest has been in drought since 2000. Researchers found 2000–2021 to be the driest 22-year stretch in at least 1,200 years, with human-caused warming responsible for roughly 40% of its severity.",
    lookFor: "Root-zone soil wetness should sit below its 1981–1999 level through the 2000s and 2010s.",
    sources: ["Williams et al. 2022, Nature Climate Change"],
  },
  {
    id: "pakistan-2022", name: "2022 Pakistan floods", kind: "flood", year: 2022, from: 2022, to: 2022,
    lat: 27, lon: 68, radiusKm: 600, variable: "PRECTOTCORR", expect: "up", scope: "place",
    blurb: "Monsoon rain in July and August 2022 fell at several times the normal rate across Sindh and Balochistan. The floods covered large parts of the country, affected tens of millions of people and caused many billions of dollars in damage.",
    lookFor: "2022 should be among the wettest years of the record.",
    sources: ["UN OCHA", "World Bank"],
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Events close enough to a place, and inside the years on screen, to be marked on its charts. Oldest first. */
export function eventsNear(lat, lon, period) {
  return EVENTS.filter(
    (e) => distanceKm(lat, lon, e.lat, e.lon) <= e.radiusKm && e.year >= period.start_year && e.year <= period.end_year,
  ).sort((a, b) => a.year - b.year);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/**
 * What the data show for an event: the event years against the other years of the same record.
 * annual: [{year, value}]. Returns null when the event years are not in the record or there is too little to compare.
 */
export function eventStats(annual, event) {
  const inEvent = annual.filter((a) => a.year >= event.from && a.year <= event.to);
  const others = annual.filter((a) => a.year < event.from || a.year > event.to);
  if (!inEvent.length || others.length < 8) return null;
  const baseValues = others.map((a) => a.value);
  const baseMean = mean(baseValues);
  const baseSd = sd(baseValues);
  const eventMean = mean(inEvent.map((a) => a.value));
  const z = baseSd > 0 ? (eventMean - baseMean) / baseSd : 0;
  const up = event.expect === "up";
  // The year that is most extreme in the expected direction, and where it ranks among all years.
  const extreme = inEvent.reduce((best, a) => ((up ? a.value > best.value : a.value < best.value) ? a : best), inEvent[0]);
  const rank = annual.filter((a) => (up ? a.value > extreme.value : a.value < extreme.value)).length + 1;
  return {
    baseMean,
    baseSd,
    eventMean,
    z,
    extremeYear: extreme.year,
    extremeValue: extreme.value,
    rank,
    n: annual.length,
    inExpectedDirection: up ? z > 0 : z < 0,
    standsOut: Math.abs(z) >= 1.5 && (up ? z > 0 : z < 0),
  };
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** One honest sentence about what the numbers show, whichever way they point. */
export function describeEvent(stats, event, units) {
  if (!stats) return "The record here does not cover enough years before and after the event to compare.";
  const word = event.expect === "up" ? "highest" : "lowest";
  const span = event.from === event.to ? `${event.from}` : `${event.from}–${event.to}`;
  const z = Math.abs(stats.z).toFixed(1);
  const dir = stats.z > 0 ? "above" : "below";
  const base = `In ${span} the average was ${Number(stats.eventMean.toPrecision(3))} ${units}, ${z} standard deviations ${dir} the other years' average of ${Number(stats.baseMean.toPrecision(3))}.`;
  const place = `${stats.extremeYear} ranks ${ordinal(stats.rank)} ${word} of ${stats.n} years.`;
  if (stats.standsOut) return `${base} ${place} The event stands out clearly in this record.`;
  if (stats.inExpectedDirection) return `${base} ${place} That is the expected direction, but not unusual enough to stand out from normal year-to-year swings in this grid cell.`;
  return `${base} ${place} This grid cell did not move the way the event would suggest: a regional event does not always hit one 50 km cell, and an annual average can hide a short extreme.`;
}
