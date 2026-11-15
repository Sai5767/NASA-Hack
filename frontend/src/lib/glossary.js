/**
 * Plain-language definitions used by <Term> pop-ups, the glossary dialog and the explainer. Written for a curious
 * high-school student: the first sentence must make sense on its own. Entries may carry keys, long and follow
 * (used by lib/explain.js when it has no deeper text of its own).
 */
export const GLOSSARY = [
  {
    id: "trend",
    term: "Trend",
    short: "A steady rise or fall over many years, as opposed to the ups and downs from one year to the next.",
  },
  {
    id: "anomaly",
    term: "Anomaly",
    short:
      "How far a value is above or below normal for that time of year. Subtracting each calendar month's long-term average removes the seasons, so real change stands out.",
  },
  {
    id: "sens",
    term: "Sen's slope",
    short:
      "The median of the slopes between every pair of years. It is a middle-of-the-road rate of change that a few odd years cannot easily bend.",
  },
  {
    id: "mk",
    term: "Mann–Kendall test",
    short:
      "Compares every pair of years and asks whether later years tend to be higher (or lower) than earlier ones. It needs neither a straight line nor bell-curve data.",
  },
  {
    id: "pvalue",
    term: "p-value",
    short:
      "If there were truly no trend, how often would chance alone make a pattern at least this strong? Below 0.05 is the usual bar for “significant”. It says nothing about how big or important the change is.",
  },
  {
    id: "ci",
    term: "95% range (confidence interval)",
    short:
      "The span of rates the data cannot rule out (a confidence interval). If the whole range sits on one side of zero, the trend is significant at the 5% level.",
  },
  {
    id: "ttest",
    term: "Regression t-test",
    short:
      "Fits a straight line and tests whether its slope differs from zero. It is less robust than Mann–Kendall but very widely used, so both are shown and compared.",
  },
  {
    id: "snr",
    term: "Signal vs noise",
    short:
      "Total change divided by the typical year-to-year wobble around the trend. Above 1× the change is larger than a normal swing; well below 1× it is easily hidden by natural variability.",
  },
  {
    id: "autocorr",
    term: "Serial correlation",
    short:
      "When a year tends to resemble the year before it. That makes chance “trends” look more convincing than they are, so the uncertainty is widened whenever years tend to follow each other.",
  },
  {
    id: "fdr",
    term: "False-discovery control (correction)",
    short:
      "Test many places or variables and a few will pass by luck. This correction (the Benjamini–Hochberg method) keeps the expected share of false alarms among the flagged results near 5%.",
  },
  {
    id: "moran",
    term: "Moran's I",
    short:
      "Measures whether neighboring places have similar trends (positive), opposite trends (negative) or no pattern (near the expected value). Significance comes from shuffling the places 999 times.",
  },
  {
    id: "emergence",
    term: "Emergence",
    short:
      "The first year after which the trend stays significant as years are added. It is descriptive, not a formal test, because each step reuses the earlier years.",
  },
  {
    id: "fingerprint",
    term: "Trend fingerprint",
    short:
      "The trend of each calendar month on its own. If most months agree, the change is consistent across the seasons rather than driven by one stretch of the year.",
  },
  {
    id: "grade",
    term: "Evidence grade",
    short:
      "Five checks: Mann–Kendall significant, regression agrees, most months agree, survives trimming 5 years from the ends, and change larger than normal swings. Strong = all five and p < 0.01; Moderate = significant and at least four; Weak = significant but fewer, or p < 0.10 with three; otherwise none.",
  },
  {
    id: "shape",
    term: "Shape check",
    short:
      "Is the record a steady ramp, or more like a sudden step to a new level? It compares a straight line with a single step (and runs the Pettitt change-point test). A step means a straight-line trend can mislead.",
  },
  {
    id: "enso",
    term: "ENSO",
    short:
      "El Niño–Southern Oscillation: a natural swing in Pacific Ocean temperatures every few years that shifts weather around the world. Removing it shows whether a trend is more than that swing.",
  },
  {
    id: "amplification",
    term: "Heat ratio",
    short:
      "How many degrees a place warms for each degree the whole planet warms, found by regressing the place's yearly temperature on NASA GISTEMP's global temperature. Above 1× means it warms faster than the planet.",
  },
  {
    id: "cv",
    term: "Leave-one-year-out testing",
    short:
      "Each year is predicted by a model trained on all the other years, so the score reflects years the model never saw. The cross-validated R² says how much better than guessing the average it does; zero or below means no real skill.",
  },
  {
    id: "backtest",
    term: "Backtest",
    short:
      "A fair test of a forecaster: pretend it is some past year, give the model only the data up to then, ask for the next few years, and compare with what really happened. Repeating this over many past years shows whether a model has real skill.",
  },
  {
    id: "conformal",
    term: "Conformal error band",
    short:
      "The forecast's error band is taken from the winning model's own backtest mistakes: the range that contained the truth 80% of the time in the past. It makes no bell-curve assumption, and its coverage is then re-checked on years it was not calibrated on.",
  },
  {
    id: "kmeans",
    term: "k-means clustering",
    short:
      "An unsupervised machine-learning method that groups items into k clusters by repeatedly assigning each to the nearest cluster center and moving the centers. It finds groups in the data without being told what to look for.",
  },
  {
    id: "silhouette",
    term: "Separation (silhouette)",
    short:
      "How well separated the clusters are, from −1 to +1. Above 0.5 is strong, 0.25 to 0.5 is reasonable, below 0.25 is weak: the groups overlap and should not be over-interpreted.",
  },
  {
    id: "stability",
    term: "Stability",
    short:
      "Do the same groups appear when 20% of the places are left out at random? Measured with the adjusted Rand index (1 = identical groups, about 0 = random). Unstable groups are probably an accident of which places were sampled.",
  },
  {
    id: "reanalysis",
    term: "Reanalysis",
    short:
      "A computer model of the atmosphere continually corrected with satellite and ground observations. NASA POWER draws on products such as MERRA-2 and CERES.",
  },
  // ---- V3 additions (owner item 8): every specialist word the interface uses. `keys`/`long`/`follow` feed the explainer.
  {
    id: "baseline",
    term: "Baseline",
    short: "What a place is usually like at that time of year: its own long-term average for that month. “Warmer than usual” means warmer than this baseline.",
    keys: ["baseline", "usual", "normal", "own average", "site's own average"],
    long: ["Each place is compared with itself, not with anywhere else. A desert and a rainforest have very different normals; the baseline is each one's own typical value for the same calendar month."],
    follow: ["anomaly"],
  },
  {
    id: "correction",
    term: "Correction for many tests",
    short: "Test enough places or variables and a few will look like trends by pure luck. The correction raises the bar so those lucky flukes are filtered out.",
    keys: ["correction", "multiple testing", "many tests", "corrected", "adjusted"],
    long: ["If you flip a coin 100 times you will see some streaks. Testing hundreds of trends is the same: some pass by chance. This app uses the Benjamini–Hochberg method to keep the share of false alarms near 5%."],
    follow: ["fdr", "holds", "beforeonly"],
  },
  {
    id: "holds",
    term: "Holds after correction",
    short: "Still holds after allowing for testing many things at once. This is the stronger kind of result.",
    keys: ["survives correction", "holds after correction", "holds up", "survive"],
    long: ["A result that survives the correction is unlikely to be one of the lucky flukes you expect when many things are tested together. On the globe these squares have a solid outline."],
    follow: ["correction", "beforeonly"],
  },
  {
    id: "beforeonly",
    term: "Only before correction",
    short: "Looks like a trend when tested on its own, but not once we allow for testing many things at once. Treat it as a maybe.",
    keys: ["nominal", "before correction", "nominal only", "only before"],
    long: ["These results could be real, or could be the lucky flukes expected when many things are tested. On the globe these squares have a dashed outline."],
    follow: ["correction", "holds"],
  },
  {
    id: "forecastband",
    term: "Forecast band",
    short: "The shaded range a forecast expects the real value to fall in most of the time. A wider band means less certain. It is a statistical estimate, not a measurement.",
    keys: ["forecast band", "band", "forecast range", "prediction interval"],
    long: ["The band comes from how wrong the model was when tested on past years it had not seen. It is drawn with a hatch and a dashed line so it is never confused with observed data."],
    follow: ["backtest", "conformal"],
  },
  {
    id: "nodata",
    term: "No data",
    short: "No value was returned for this place or month. It is shown with a grey hatch, never as zero or as a colour.",
    keys: ["no data", "hatch", "missing", "grey hatch", "gap"],
    long: ["Gaps happen when the source has no record for a place or month, or a variable is only measured over land. Leaving them visibly empty is more honest than filling them in."],
  },
  {
    id: "samplesite",
    term: "Sample site",
    short: "One of a fixed list of places around the world that we test. The dots are a sample, not a complete map of the planet.",
    keys: ["sample site", "sample places", "dots", "world survey"],
    long: ["Testing every point on Earth would take far too many requests, so World uses a spread of sample places. Areas between dots were not tested."],
  },
  {
    id: "coarse",
    term: "Coarse global preview",
    short: "A blurry, approximate picture of the whole Earth to help you find your way. It is not a measurement and carries no trend or evidence.",
    keys: ["coarse", "preview", "approximate pattern", "global preview"],
    long: ["The preview is built from a few low-resolution points. Choose a place to see detailed local data instead."],
    follow: ["localdata"],
  },
  {
    id: "localdata",
    term: "Detailed local data",
    short: "The actual values NASA POWER returned for the small patch of grid squares around your chosen place. Trends and evidence come only from these.",
    keys: ["detailed local", "local data", "local cells"],
    long: ["NASA POWER divides the Earth into grid squares about half a degree across. The detailed layer shows only the squares around your place, at their true size."],
    follow: ["coarse", "gridcell"],
  },
  {
    id: "evidence",
    term: "How sure are we?",
    short: "Filled marks show how strong the evidence for a change is: three = strong, two = some, one = no clear change yet, none = not enough data.",
    keys: ["evidence level", "how sure", "meter", "marks", "evidence"],
    long: ["The level is decided on the server from several checks: whether the trend tests agree, whether there are enough complete years, and whether the change stands out from normal ups and downs. The page only shows it."],
    follow: ["grade", "pvalue"],
  },
  {
    id: "perdecade",
    term: "Per decade",
    short: "How much the value changes every ten years if the trend keeps the same pace.",
    keys: ["per decade", "decade", "/decade"],
    long: ["A rate of +0.3 °C per decade means about +1.2 °C over 40 years. It describes the past record; it is not a forecast."],
    follow: ["sens"],
  },
  {
    id: "wm2",
    term: "Sunlight units (MJ/m²/day, W/m²)",
    short: "How much sunlight energy reaches each square metre of ground. NASA POWER reports megajoules per square metre per day (MJ/m²/day); 1 MJ/m²/day is the same as a steady 11.6 W/m² (watts per square metre).",
    keys: ["w/m2", "w/m²", "watts", "mj/m", "megajoule", "sunlight unit", "solar unit"],
    long: ["A bright summer noon delivers about 1000 W/m², but these are averages over the whole day, night included, so typical values are 10–30 MJ/m²/day (about 115–350 W/m²)."],
    follow: ["units"],
  },
  {
    id: "units",
    term: "Units",
    short: "°C = degrees Celsius, mm/day = millimetres of rain or snow per day, % = percent, m/s = metres per second, kPa = kilopascals (air pressure), MJ/m²/day = sunlight energy per day.",
    keys: ["unit", "units", "mm/day", "celsius", "kpa", "m/s"],
    long: ["Every value in the app carries the unit its source reports it in. Rates of change add “per decade”."],
    follow: ["wm2", "perdecade"],
  },
  {
    id: "gridcell",
    term: "Grid square",
    short: "NASA POWER data come in squares about half a degree (roughly 50 km) across. Each value is an average over its square, not a single weather station.",
    keys: ["grid cell", "grid square", "cell", "resolution"],
    long: ["A short, very local event, such as a storm over one town, can be diluted in an average over a whole square."],
    follow: ["reanalysis", "localdata"],
  },
  {
    id: "archetype",
    term: "Archetype",
    short: "A group of places whose many variables are changing in a similar way, found automatically by the computer.",
    keys: ["archetype", "cluster", "group of places"],
    long: ["Archetypes are found with k-means clustering. They describe patterns of change, not causes, and can shift when the sample changes."],
    follow: ["kmeans", "silhouette", "stability"],
  },
  {
    id: "vitals",
    term: "Vital signs",
    short: "Planet-wide records such as global temperature, CO₂ and sea ice, tested with the same trend checks as a single place.",
    keys: ["vital", "vitals", "global record", "gistemp", "co2", "sea ice"],
    long: ["These come from NASA GISS GISTEMP, NOAA and NSIDC rather than NASA POWER."],
  },
  {
    id: "rhythm",
    term: "Climate rhythm",
    short: "A natural back-and-forth swing, like El Niño, that repeats every few years. Shown as its current state, not tested for a trend.",
    keys: ["rhythm", "oscillation", "el nino", "la nina"],
    long: ["Rhythms move up and down rather than steadily one way, so a trend test would be misleading."],
    follow: ["enso"],
  },
  {
    id: "spatial",
    term: "Spatial pattern",
    short: "Whether nearby places tend to change in the same way (clustered), in opposite ways (dispersed) or with no pattern.",
    keys: ["spatial", "clustered", "dispersed", "neighbours", "neighbors"],
    long: ["Measured with Moran's I. A clustered pattern suggests a regional influence; no pattern means local differences dominate."],
    follow: ["moran"],
  },
];

export const GLOSSARY_BY_ID = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
