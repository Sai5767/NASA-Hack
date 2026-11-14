/** Plain-language definitions used by hover tips and the glossary. Written for curious non-specialists. */
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
    term: "95% range",
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
      "When a year tends to resemble the year before it. That makes chance “trends” look more convincing than they are, so when it is statistically strong the uncertainty is widened.",
  },
  {
    id: "fdr",
    term: "False-discovery control",
    short:
      "Test many places or variables and a few will pass by luck. The Benjamini–Hochberg method keeps the expected share of false alarms among the flagged results near 5%.",
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
    id: "reanalysis",
    term: "Reanalysis",
    short:
      "A computer model of the atmosphere continually corrected with satellite and ground observations. NASA POWER draws on products such as MERRA-2 and CERES.",
  },
];

export const GLOSSARY_BY_ID = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
