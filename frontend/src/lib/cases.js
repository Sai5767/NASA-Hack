export const LAST_FULL_YEAR = new Date().getFullYear() - 1;
export const FIRST_YEAR = 1981;

/**
 * Demo investigations. Each is posed as a question: the data answers, the text never does.
 * tab: which view opens (investigate | sweep | scan | duel).
 */
export const CASES = [
  {
    id: "poles",
    tab: "duel",
    codename: "Hot poles, cool tropics?",
    question: "Is the far north warming faster than the tropics?",
    variable: "T2M",
    a: { lat: 70, lon: -150, name: "Arctic Alaska" },
    b: { lat: 0, lon: -160, name: "Equatorial Pacific" },
    clues: [
      "Compare the two slopes and their 95% ranges, not the raw temperatures.",
      "Read the difference test: could chance alone explain the gap?",
      "Hover the chart to compare the same year in both places.",
    ],
  },
  {
    id: "delhi",
    tab: "investigate",
    codename: "The Delhi dimming",
    question: "Is less sunlight reaching the ground over northern India's hazy Indo-Gangetic Plain?",
    variable: "ALLSKY_SFC_SW_DWN",
    a: { lat: 28.6, lon: 77.2, name: "Delhi region" },
    clues: [
      "Check the fingerprint: which months drive the change?",
      "Open the Sweep tab and compare “clear-sky” with “all-sky” sunlight. The gap between them points to clouds.",
      "Notice the signal-to-noise tile: is this change big compared with normal swings?",
    ],
  },
  {
    id: "amazon",
    tab: "investigate",
    codename: "Amazon under pressure",
    question: "Is the Amazon basin getting drier?",
    variable: "PRECTOTCORR",
    a: { lat: -3.1, lon: -60, name: "Central Amazon" },
    clues: [
      "Look at the 95% range: does it clear zero comfortably, or just touch it?",
      "Open the Sweep tab to see whether soil wetness and evaporation tell the same story.",
      "Check the robustness test: does trimming five years from either end change the verdict?",
    ],
  },
  {
    id: "nights",
    tab: "sweep",
    codename: "Night shift",
    question: "Are the nights warming faster than the days?",
    variable: "T2M",
    a: { lat: 42, lon: -93.6, name: "Iowa" },
    clues: [
      "Find “Daily low temperature” and “Daily high temperature” in the ranking and compare their evidence grades.",
      "A bigger number is not proof: compare the 95% ranges and the grades.",
      "The day–night temperature swing row shows what happens to the gap between them.",
    ],
  },
  {
    id: "sahel",
    tab: "investigate",
    codename: "The Sahel mystery",
    question: "After the great Sahel droughts of the 1970s and 80s, are the rains returning?",
    variable: "PRECTOTCORR",
    a: { lat: 14, lon: 2, name: "Sahel, West Africa" },
    clues: [
      "An inconclusive result is not the same as “nothing is happening”. Read the 95% range.",
      "Look at the emergence chart: how far is the evidence from the significance line?",
      "Check the percent change in the Total change tile. Is it large even though it is not significant?",
    ],
  },
  {
    id: "alaska",
    tab: "investigate",
    codename: "Who's behind Alaska's warming?",
    question: "Which big climate pattern moves in step with Arctic Alaska's temperature, and does the trend survive without it?",
    variable: "T2M",
    a: { lat: 70, lon: -150, name: "Arctic Alaska" },
    clues: [
      "Scroll to the suspect lineup: is any climate pattern LINKED, and which ones have an ALIBI?",
      "Read the ENSO alibi check: does the trend change once El Niño and La Niña are removed?",
      "Compare with NASA GISTEMP's independent reading for the same latitude band.",
    ],
  },
  {
    id: "fastest",
    tab: "world",
    codename: "Where is it changing fastest?",
    question: "Across the sample places, where is air temperature rising or falling the most?",
    variable: "T2M",
    clues: [
      "Switch the map to Map view to see every dot at once. Ringed dots hold up after correcting for testing many places.",
      "Size shows signal vs noise: a big dot is a change that stands well clear of normal swings.",
      "Click any dot to open its full case file.",
    ],
  },
  {
    id: "vitals",
    tab: "vitals",
    codename: "The planet's vital signs",
    question: "Which of Earth's vital signs are trending, which are not, and which month changes most?",
    variable: "T2M",
    clues: [
      "Compare the evidence grades: are all four trend vitals equally clear?",
      "Find the month with the steepest sea-ice decline.",
      "Read the shape line for Antarctic sea ice: is a straight line the right story?",
    ],
  },
  {
    id: "heartland",
    tab: "scan",
    codename: "Heartland scan",
    question: "Is warming uniform across the central United States?",
    variable: "T2M",
    a: { lat: 40, lon: -100, name: "Central US" },
    scan: { size: 30, n: 5 },
    clues: [
      "Solid outlines survive the false-discovery correction; thin ones do not.",
      "Read the spatial pattern: do neighboring cells trend together?",
      "Click any cell to open its full case file.",
    ],
  },
];

/** Where to look. Used by the intake wizard. */
export const INTAKE_TOPICS = [
  { id: "heat", label: "Heat", hint: "Air temperature", variable: "T2M" },
  { id: "rain", label: "Rain & drought", hint: "Precipitation", variable: "PRECTOTCORR" },
  { id: "sun", label: "Sunlight & clouds", hint: "Sunlight at the ground", variable: "ALLSKY_SFC_SW_DWN" },
  { id: "wind", label: "Wind", hint: "Wind speed", variable: "WS2M" },
  { id: "humid", label: "Humidity", hint: "Water vapor in the air", variable: "QV2M" },
  { id: "soil", label: "Soil & water on land", hint: "Root-zone soil wetness (land only)", variable: "GWETROOT" },
];

export const INTAKE_PLACES = [
  { id: "arctic", label: "Frozen north", hint: "Arctic Alaska", lat: 70, lon: -150 },
  { id: "rainforest", label: "Rainforest", hint: "Central Amazon", lat: -3.1, lon: -60 },
  { id: "desert", label: "Desert", hint: "Central Sahara", lat: 23, lon: 12 },
  { id: "farm", label: "Big farmland", hint: "Iowa Corn Belt", lat: 42, lon: -93.6 },
  { id: "city", label: "Megacity region", hint: "Delhi", lat: 28.6, lon: 77.2 },
  { id: "mountain", label: "High mountains", hint: "Tibetan Plateau", lat: 31, lon: 88 },
  { id: "ocean", label: "Open ocean", hint: "Equatorial Pacific", lat: 0, lon: -160 },
];

/** For the "surprise me" button: places and variables that make interesting stories. */
export const SURPRISES = [
  { variable: "T2M", lat: 75, lon: 40, name: "Barents Sea region" },
  { variable: "ALLSKY_SFC_SW_DWN", lat: 28.6, lon: 77.2, name: "Delhi region" },
  { variable: "PRECTOTCORR", lat: -3.1, lon: -60, name: "Central Amazon" },
  { variable: "T2M_MIN", lat: 42, lon: -93.6, name: "Iowa" },
  { variable: "CLOUD_AMT", lat: 42, lon: -93.6, name: "Iowa" },
  { variable: "T2M", lat: 24, lon: 45, name: "Arabian Peninsula" },
  { variable: "TQV", lat: 40, lon: -100, name: "Central US" },
  { variable: "GWETROOT", lat: 34, lon: -110, name: "US Southwest" },
];
