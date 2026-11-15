/**
 * The built-in explainer: written answers from a curated knowledge base, personalised with the numbers of the case
 * on screen. There is no AI model and no network call; matching is plain keyword scoring.
 *
 * An entry has: id, term, short (the hover text), long (paragraphs), keys (words that should find it), follow (related
 * ids) and ctx(d) (one sentence about the case on screen; d is a /api/trend response).
 */
import { GLOSSARY } from "./glossary.js";
import { formatP, formatPEq, signed } from "./format.js";
import { noiseSentence, pValueMeaning, shapeSub, shapeWord } from "./words.js";

const safe = (fn) => (d) => {
  try {
    return d ? fn(d) : null;
  } catch {
    return null;
  }
};
const dir = (s) => (s.significant ? (s.sign === "up" ? "rising" : "falling") : "no clear direction");

/** Deeper text for each glossary term. */
const DEEP = {
  trend: {
    keys: ["trend", "rising", "falling", "change over time"],
    long: [
      "Climate data bounce around from year to year. A trend is the part that keeps heading one way for decades. Finding one means separating that slow drift from the ordinary ups and downs.",
      "Here the drift is measured with Sen's slope, and how far to trust it is judged by the Mann–Kendall test and four other checks.",
    ],
    follow: ["sens", "mk", "grade"],
    ctx: safe((d) => `For ${d.variable.label.toLowerCase()} here the data show ${dir(d.stats)}: ${signed(d.stats.slope_per_decade, 3)} ${d.variable.units} per decade.`),
  },
  anomaly: {
    keys: ["anomaly", "anomalies", "seasonal", "seasons", "seasonal cycle"],
    long: [
      "Raw monthly values mostly show the seasons: July is warmer than January across the northern hemisphere. To see change, each calendar month's own long-run average is subtracted, leaving how unusual that month was.",
      "A positive anomaly means warmer (or wetter, windier, sunnier) than that month normally is. The monthly chart and the 12-month average use anomalies, so the seasons drop out.",
    ],
    follow: ["trend", "fingerprint"],
  },
  sens: {
    keys: ["sen", "slope", "rate", "per decade", "how much"],
    long: [
      "Take every pair of years, work out the slope between them, and take the median of all those slopes. Because it is a median, a few freak years barely move it, unlike an ordinary straight-line fit.",
      "It is quoted per decade so places and variables are easy to compare: -0.13 °C per decade means about 0.13 °C cooler every ten years.",
    ],
    follow: ["ci", "mk", "snr"],
    ctx: safe((d) => `Here the Sen slope is ${signed(d.stats.slope_per_decade, 3)} ${d.variable.units} per decade, with a 95% range of ${signed(d.stats.ci_low_per_decade)} to ${signed(d.stats.ci_high_per_decade)}.`),
  },
  mk: {
    keys: ["mann", "kendall", "mk"],
    long: [
      "For every pair of years it asks one question: is the later year higher or lower? It then adds up the ups and downs. If ups clearly outnumber downs (or the reverse), the data lean one way.",
      "It uses ranks, so it needs neither a straight line nor bell-curve data, and ties are handled. Its p-value says how often shuffled years would lean this strongly.",
    ],
    follow: ["pvalue", "sens", "autocorr"],
    ctx: safe((d) => `Here the Mann–Kendall p-value is ${formatP(d.stats.p_value)}${d.stats.autocorr.adjusted ? ` (${formatP(d.stats.p_naive)} before allowing for year-to-year persistence)` : ""}.`),
  },
  pvalue: {
    keys: ["p-value", "pvalue", "p value", "chance"],
    long: [
      "Imagine the years were shuffled so any pattern is pure luck. The p-value is how often luck alone would give a lean at least this strong. A small p-value makes luck an unlikely explanation.",
      "It does not say how big or important a change is, and 0.05 is a convention, not a law. A tiny change over a long record can be very significant, while a large change in a short, noisy record may not be.",
    ],
    follow: ["sig", "ci", "autocorr"],
    ctx: safe((d) => `${pValueMeaning(d.stats)} (${formatPEq(d.stats.p_value)}).`),
  },
  ci: {
    keys: ["95%", "confidence", "interval", "range"],
    long: [
      "It is the set of rates the data could not rule out. If zero sits inside the range, 'no trend' is still a live possibility.",
      "Wider ranges mean more uncertainty. Short records, noisy places and years that resemble their neighbours all widen it.",
    ],
    follow: ["sens", "pvalue"],
    ctx: safe((d) => {
      const lo = d.stats.ci_low_per_decade;
      const hi = d.stats.ci_high_per_decade;
      return `Here the range is ${signed(lo)} to ${signed(hi)} ${d.variable.units} per decade, which ${lo <= 0 && hi >= 0 ? "includes zero, so no trend is still possible" : "sits entirely on one side of zero"}.`;
    }),
  },
  ttest: {
    keys: ["regression", "t-test", "ttest", "straight line", "ols"],
    long: [
      "Fits the one best straight line through the yearly values and tests whether its slope differs from zero. It is the classic method, and works best when the scatter around the line is roughly bell-shaped.",
      "It is used here as a cross-check. When it and Mann–Kendall agree, the finding does not hinge on one method.",
    ],
    follow: ["mk", "autocorr"],
    ctx: safe((d) => `Here the regression slope is ${signed(d.ols.slope_per_decade, 3)} ${d.variable.units} per decade, ${formatPEq(d.ols.p_value)}.`),
  },
  snr: {
    keys: ["signal", "noise", "swing", "wobble"],
    long: [
      "Divides the total change by the typical wobble of single years around the trend. If the change is only half a normal wobble, the trend can be real yet impossible to see by eye.",
      "It is a measure of size, separate from the p-value, which is about certainty. A long record can make even a small signal-to-noise ratio significant.",
    ],
    follow: ["pvalue", "sens"],
    ctx: safe((d) => `Here the change is ${noiseSentence(d.stats.signal_to_noise)}.`),
  },
  autocorr: {
    keys: ["serial", "autocorrelation", "persistence", "neighbour", "neighbor", "year to year"],
    long: [
      "Warm years tend to follow warm years because oceans and soils hold on to heat and moisture. So 44 years carry less independent information than 44 unrelated numbers would.",
      "The app estimates that persistence, corrects its small-sample bias, and widens the uncertainty to match. Simulations in docs/STATS_AUDIT.md show this keeps false alarms near 5% where an unadjusted test gives 20 to 40% on persistent series.",
    ],
    follow: ["pvalue", "mk"],
    ctx: safe((d) => `Here the lag-1 autocorrelation is ${d.stats.autocorr.r1.toFixed(2)}, and the p-value was ${d.stats.autocorr.adjusted ? `widened (variance x${d.stats.autocorr.factor.toFixed(1)})` : "left essentially unchanged"}.`),
  },
  fdr: {
    keys: ["false discovery", "false-discovery", "fdr", "multiple", "benjamini", "correction", "corrected", "solid outline"],
    long: [
      "Run 25 tests that each have a 5% chance of a fluke and you should expect one or two flukes. When many places or variables are tested together, the Benjamini–Hochberg rule tightens the bar so that about 5% of the flagged results are flukes.",
      "A solid outline on the map means the result survives this correction. A dashed outline is significant by itself but could be one of the lucky ones.",
    ],
    follow: ["pvalue", "moran"],
  },
  moran: {
    keys: ["moran", "spatial", "neighbours", "neighbors", "regional pattern"],
    long: [
      "Moran's I asks whether places close together tend to trend alike. Positive means neighbours share trends, a regional signal. Near its chance value means no spatial pattern.",
      "Its significance comes from reshuffling the places 999 times to see how often chance alone builds a pattern this strong.",
    ],
    follow: ["fdr"],
  },
  emergence: {
    keys: ["emerge", "emergence", "when did"],
    long: [
      "Adds years one at a time and watches the p-value. The emergence year is when the trend became significant and stayed that way.",
      "It is descriptive rather than a formal test, because each step reuses the same years. It shows why long records matter: the same trend can be invisible at 15 years and obvious at 40.",
    ],
    follow: ["pvalue", "trend"],
    ctx: safe((d) => (d.emergence.year ? `Here the evidence became lasting in ${d.emergence.year}.` : "Here the evidence never became lasting within this record.")),
  },
  fingerprint: {
    keys: ["fingerprint", "month", "monthly", "calendar"],
    long: [
      "Gives each calendar month its own trend. If most months agree, the change shows up all year. If one season drives it, the annual average would hide that.",
      "The evidence grade counts this as one check: at least 75% of months should share the overall direction.",
    ],
    follow: ["grade", "anomaly"],
  },
  grade: {
    keys: ["grade", "verdict", "checks", "evidence", "strong", "moderate", "weak", "inconclusive", "stamp"],
    long: [
      "Five transparent checks: Mann–Kendall is significant; the regression agrees; most calendar months move the same way; the trend survives trimming five years off the ends; and the change is bigger than a normal year-to-year swing.",
      "Strong means all five and p below 0.01. Likely means significant with at least four. Faint means significant with fewer, or p below 0.10 with three. It is a rule of thumb for readers, not a hypothesis test.",
    ],
    follow: ["trust", "pvalue", "shape"],
    ctx: safe((d) => {
      const failed = d.checks.filter((c) => !c.passed).map((c) => c.label.toLowerCase());
      return `${d.grade.label}: ${d.grade.passed} of ${d.grade.total} checks passed${failed.length ? `. Not passed: ${failed.join("; ")}` : ""}.`;
    }),
  },
  shape: {
    keys: ["shape", "step", "ramp", "change point", "pettitt", "jump"],
    long: [
      "Is the record a steady ramp, or a sudden step to a new level? The app compares the best straight line with the best single step and runs the Pettitt change-point test.",
      "A step matters because a straight-line trend would describe it badly: it would spread one abrupt change over decades. Causes of steps include instrument or data-source changes as well as real events.",
    ],
    follow: ["trend", "grade"],
    ctx: safe((d) => `${shapeWord(d.shape)}. ${shapeSub(d.shape, d.variable.units)}`),
  },
  enso: {
    keys: ["enso", "el nino", "el niño", "la nina", "la niña", "pacific"],
    long: [
      "El Niño and La Niña are natural swings in Pacific Ocean temperature every few years that shift rainfall and temperature across the world.",
      "Because they are natural, a place that looks warmer partly because of El Niño years is not telling the same story as one warming steadily. The suspect lineup removes ENSO to see what trend is left.",
    ],
    follow: ["amplification", "autocorr"],
  },
  amplification: {
    keys: ["heat ratio", "amplification", "faster than the planet", "global warming"],
    long: [
      "Found by regressing the place's yearly temperature on NASA GISTEMP's global temperature. A ratio of 2 means the place warms two degrees for each degree the planet warms.",
      "Land usually warms faster than the global average (which includes oceans) and the Arctic faster still. The ratio describes the relationship; it does not by itself say why.",
    ],
    follow: ["enso", "reanalysis"],
  },
  cv: {
    keys: ["cross-validat", "leave-one", "validation", "skill"],
    long: [
      "Each year is predicted by a model trained only on the other years, so the score reflects years the model never saw. That guards against a model that just memorises its training data.",
      "Cross-validated R-squared compares the model with always guessing the average: zero or below means no real skill.",
    ],
    follow: ["backtest", "enso"],
  },
  backtest: {
    keys: ["backtest", "back-test", "replay", "forecast", "predict", "future", "machine learning"],
    long: [
      "To test a forecaster fairly, pretend it is some past year, give it only the data up to then, ask for the next one to five years, and compare with what really happened. Repeating that over many past years shows whether a model has real skill.",
      "If nothing beats a naive guess such as 'next year looks like the long-run average', the app says so. That is an honest finding, and the forecast is then little better than a guess. These are statistical extrapolations of short records, not climate projections.",
    ],
    follow: ["conformal", "cv"],
  },
  conformal: {
    keys: ["conformal", "error band", "uncertainty band", "80%"],
    long: [
      "The forecast's band comes from the winning model's own backtest mistakes: the range that contained the truth 80% of the time in the past. It makes no bell-curve assumption.",
      "Its coverage is then re-checked on years it was not calibrated on. If it held less than 80% of the time, the app tells you the band is too narrow.",
    ],
    follow: ["backtest"],
  },
  kmeans: {
    keys: ["k-means", "kmeans", "cluster", "archetype", "twins"],
    long: [
      "An unsupervised machine-learning method: it groups items into k clusters by repeatedly assigning each to the nearest cluster centre and then moving the centres. It finds groups without being told what to look for.",
      "Here each of the 68 places is described by how strongly each of 15 variables is changing, and places with similar fingerprints end up in the same archetype.",
    ],
    follow: ["silhouette", "stability"],
  },
  silhouette: {
    keys: ["silhouette", "separation"],
    long: [
      "Scores how well separated the clusters are, from -1 to +1. Above 0.5 is strong, 0.25 to 0.5 reasonable, below 0.25 weak: the groups overlap and should not be over-interpreted.",
    ],
    follow: ["kmeans", "stability"],
  },
  stability: {
    keys: ["stability", "stable groups", "rand"],
    long: [
      "Leaves out 20% of the places at random, re-clusters, and checks whether the same groups appear, using the adjusted Rand index (1 means identical, about 0 means random).",
      "Unstable groups are probably an accident of which places were sampled.",
    ],
    follow: ["kmeans", "silhouette"],
  },
  reanalysis: {
    keys: ["reanalysis", "merra", "model", "modelled", "modeled", "nasa power", "power"],
    long: [
      "A reanalysis is a weather-and-climate model run over past decades and continually corrected with satellite and ground observations, so it fills the gaps between instruments. NASA POWER draws on products such as MERRA-2 and CERES.",
      "That gives a complete, consistent record for any point on Earth, on a grid about half a degree wide. It is a model constrained by observations, so some variables (cloud, radiation, soil, evaporation) are model-derived and can change character when the inputs change.",
    ],
    follow: ["trust"],
  },
};

/** Entries that are not glossary terms but are what people actually ask. */
const EXTRA = [
  {
    id: "sig",
    term: "Statistically significant",
    short: "A pattern unlikely to be down to chance alone, by a conventional bar (usually p below 0.05). It is about certainty, not size or importance.",
    keys: ["significant", "significance", "statistically"],
    long: [
      "'Significant' here has a narrow technical meaning: if there were truly no change, a pattern at least this strong would be rare (by convention, under 5% of the time). It does not mean important, large or dangerous.",
      "A large effect can be non-significant when the record is short and noisy; a tiny effect can be significant when the record is long. That is why the app shows size (rate per decade, signal vs noise) next to certainty (p-value, grade).",
    ],
    follow: ["pvalue", "snr", "grade"],
    ctx: safe((d) => `Here the trend is ${d.stats.significant ? "significant" : "not significant"} (${formatPEq(d.stats.p_value)}).`),
  },
  {
    id: "trust",
    term: "Can I trust this?",
    short: "Look at the evidence grade, the 95% range and the Detective's notes; then remember the data are a model constrained by observations.",
    keys: ["trust", "reliable", "accurate", "confident", "sure", "believe", "correct", "real", "true"],
    long: [
      "Read the answer in three layers. First the evidence grade: five visible checks, including whether the trend survives trimming years off either end. Second the 95% range: if it includes zero, the data do not settle the direction. Third the notes, which flag step changes, persistence and model-derived variables.",
      "The statistics are hand-written and cross-checked against SciPy, pymannkendall and pyhomogeneity, with simulations showing false alarms stay near 5% (docs/STATS_AUDIT.md). The limits are the data: a reanalysis grid about half a degree wide, a record of about 45 years, and one place at a time.",
    ],
    follow: ["grade", "reanalysis", "cause"],
    ctx: safe((d) => `For this case: ${d.grade.label.toLowerCase()}, ${d.grade.passed} of ${d.grade.total} checks passed, ${formatPEq(d.stats.p_value)}.`),
  },
  {
    id: "cause",
    term: "Does this show what is causing it?",
    short: "No. The app finds and measures change; a pattern shows direction, not cause.",
    keys: ["cause", "causing", "why is", "because", "human", "climate change", "proof", "prove", "blame"],
    long: [
      "Detecting a trend and attributing it to a cause are different jobs. This app does the first. The suspect lineup shows which natural climate rhythms (ENSO, PDO, NAO) move in step with a place, but those are correlations, never causes.",
      "Attribution takes physical understanding, many lines of evidence and climate models. The Trend ledger and the events view add well-documented context from published science, always flagged as context rather than proof from this data.",
    ],
    follow: ["enso", "amplification", "trust"],
  },
  {
    id: "data",
    term: "Where does the data come from?",
    short: "NASA POWER (MERRA-2 and satellite-based radiation), NASA GISTEMP, NOAA CO2, ENSO, PDO and NAO, and the NSIDC sea-ice index. All are public and need no key.",
    keys: ["data", "source", "nasa", "noaa", "satellite", "gistemp", "nsidc", "where does"],
    long: [
      "Place-based variables come from NASA Langley's POWER project (19 monthly variables at any point, 1981 onward). Planet-wide records come from NASA GISS (global temperature), NOAA's Global Monitoring Laboratory (CO2), the NSIDC Sea Ice Index (Arctic and Antarctic sea ice) and NOAA's Climate Prediction Center and NCEI (ENSO, PDO, NAO).",
      "Direct satellite-instrument series such as MODIS, OMI, AIRS and GPM are a known gap, because NASA's Earthdata services need a login and this app uses only keyless sources.",
    ],
    follow: ["reanalysis", "trust"],
  },
  {
    id: "howto",
    term: "How do I use this?",
    short: "Drop a pin on the globe, read the Overview, then open the Detail view for the evidence.",
    keys: ["how do i", "how to", "use", "start", "help", "begin", "guide", "getting started"],
    long: [
      "Click the globe, type a place or a question such as 'is Phoenix getting hotter?', or use Personalise to get suggestions. The Overview answers what is changing, where, how much and whether it is real, with one chart and a forecast headline.",
      "Open the Detail view for the evidence locker, climate rhythms and the forecast lab. Sweep ranks all 19 variables at your place and Scan checks the surrounding region. The tabs under 'Explore more' compare places, survey the world, read the planet's vital signs, rank every trend, and browse major events.",
    ],
    follow: ["grade", "trust"],
  },
  {
    id: "views",
    term: "Overview or Detail?",
    short: "Overview is the plain answer; Detail is every test and chart behind it.",
    keys: ["overview", "detail", "simple", "technical", "advanced"],
    long: [
      "The Overview is built for a quick, honest answer: what is changing, where, how much, and whether it is real. Nothing in it is dumbed down; the technical material is just one click away.",
      "Detail holds the evidence locker, seasonal fingerprint, the climate-rhythm suspects and the forecast lab in collapsible sections. Your choice is remembered, and the Personalise questions set the starting point.",
    ],
    follow: ["grade", "trust"],
  },
];

export const ENTRIES = [
  ...GLOSSARY.map((g) => ({ ...g, ...DEEP[g.id], long: DEEP[g.id]?.long ?? [], keys: DEEP[g.id]?.keys ?? [], follow: DEEP[g.id]?.follow ?? [] })),
  ...EXTRA,
];
export const ENTRY_BY_ID = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

function score(entry, q) {
  let s = 0;
  const term = norm(entry.term);
  if (q.includes(term)) s += 6;
  for (const word of term.split(/[^a-z0-9%]+/).filter((w) => w.length > 3)) if (q.includes(word)) s += 2;
  for (const key of entry.keys) if (q.includes(key)) s += 3;
  return s;
}

function reply(entry, ctx) {
  return {
    id: entry.id,
    title: entry.term,
    short: entry.short,
    more: entry.long,
    inCase: entry.ctx ? entry.ctx(ctx) : null,
    related: entry.follow.map((id) => ENTRY_BY_ID[id]).filter(Boolean).map((e) => ({ id: e.id, label: e.term })),
  };
}

/** The reply for a term the user clicked. */
export function explainTerm(id, ctx) {
  const entry = ENTRY_BY_ID[id];
  return entry ? reply(entry, ctx) : null;
}

/** The reply for free text. Falls back to a polite "I don't know that one" that offers real topics. */
export function answer(query, ctx) {
  const q = norm(query);
  const ranked = q ? ENTRIES.map((e) => ({ e, s: score(e, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s) : [];
  if (!ranked.length) {
    return {
      id: null,
      title: "I do not know that one yet",
      short: "This explainer only knows the terms and ideas used in this app, and it is a written knowledge base rather than an AI model.",
      more: ["Try a term such as p-value, Sen's slope, serial correlation or backtest, or a question such as 'can I trust this?' or 'does this show the cause?'."],
      inCase: null,
      related: [ENTRY_BY_ID.trust, ENTRY_BY_ID.sig, ENTRY_BY_ID.cause, ENTRY_BY_ID.howto].map((e) => ({ id: e.id, label: e.term })),
    };
  }
  const best = reply(ranked[0].e, ctx);
  const extra = ranked.slice(1, 3).map((x) => ({ id: x.e.id, label: x.e.term }));
  const seen = new Set();
  best.related = [...best.related, ...extra].filter((r) => (seen.has(r.id) ? false : seen.add(r.id) && r.id !== best.id));
  return best;
}

/** Starter questions: tuned to the case on screen when there is one. */
export function starters(ctx) {
  const base = ["Can I trust this?", "What does significant mean?", "Does this show what is causing it?", "Where does the data come from?"];
  if (!ctx) return base;
  return ["Explain this verdict", "What does the p-value mean here?", "Why were some checks not passed?", ...base.slice(0, 2)];
}
