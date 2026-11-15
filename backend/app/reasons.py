"""Published context for why a trend might exist.

The statistics can show that a trend is real; they cannot show why. This module attaches short, hedged background from
the published literature to trends that survive false-discovery control. Every entry says how well established the
explanation is, and every one names its sources. It is context, never a result of this app's data.

Rules are checked in order and the first match wins, so region-specific rules come before general ones.
"""

from __future__ import annotations

HEAT = {"T2M", "T2M_MAX", "T2M_MIN", "TS"}
SUNLIGHT = {"ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN"}
HUMIDITY = {"QV2M", "TQV"}
SOIL = {"GWETROOT", "GWETTOP"}

WELL = "well established"
PLAUSIBLE = "plausible"
UNCERTAIN = "uncertain"

REGIONS = {
    "arctic": lambda la, lo: la >= 60,
    "south_asia": lambda la, lo: 20 <= la <= 32 and 70 <= lo <= 92,
    "amazon": lambda la, lo: -15 <= la <= 5 and -75 <= lo <= -45,
    "sahel": lambda la, lo: 10 <= la <= 18 and -20 <= lo <= 40,
    "mediterranean": lambda la, lo: 30 <= la <= 45 and -10 <= lo <= 40,
}

# (region or None, variables, sign or None for either, text, confidence, sources)
RULES: list[tuple[str | None, set[str], str | None, str, str, list[str]]] = [
    (
        "arctic", HEAT, "up",
        "The Arctic is warming roughly two to four times faster than the planet. Melting sea ice and snow expose darker surfaces "
        "that soak up more sunlight, which amplifies the warming ('Arctic amplification').",
        WELL, ["Rantanen et al. 2022, Communications Earth & Environment", "AMAP 2021"],
    ),
    (
        "south_asia", SUNLIGHT, "down",
        "Haze from burning fuel, crop residue and industry scatters and absorbs sunlight, so less reaches the ground across the "
        "Indo-Gangetic Plain. It is part of the wider 'global dimming' seen in polluted regions.",
        WELL, ["Ramanathan et al. 2005, PNAS", "Wild 2009, Journal of Geophysical Research"],
    ),
    (
        "amazon", {"PRECTOTCORR"}, "down",
        "Parts of the Amazon, especially the south, have a longer dry season than a few decades ago. Deforestation reduces the "
        "moisture that forests recycle into the air, and warmer oceans shift rainfall patterns.",
        PLAUSIBLE, ["Fu et al. 2013, PNAS", "Lovejoy and Nobre 2018, Science Advances"],
    ),
    (
        "sahel", {"PRECTOTCORR"}, "up",
        "Sahel rainfall has partly recovered since the severe droughts of the 1970s and 1980s. Ocean temperature patterns in the "
        "Atlantic, and changes in air pollution, are the leading explanations for the drought and its partial recovery.",
        PLAUSIBLE, ["Giannini et al. 2003, Science", "IPCC AR6 WG1"],
    ),
    (
        "sahel", {"PRECTOTCORR"}, "down",
        "The Sahel has a history of multi-decade drought tied to ocean temperature patterns. A continued decline would fit "
        "that history, but this data alone cannot say why.",
        UNCERTAIN, ["Giannini et al. 2003, Science"],
    ),
    (
        "mediterranean", {"PRECTOTCORR"}, "down",
        "The Mediterranean is drying as the subtropical dry zone expands and winter storm tracks shift poleward, on top of a "
        "warming climate that raises evaporation.",
        WELL, ["Hoerling et al. 2012, Journal of Climate", "IPCC AR6 WG1"],
    ),
    (
        None, HEAT, "up",
        "Human-caused greenhouse gas warming. The planet is about 1.1 °C warmer than in 1850 to 1900, and land has warmed faster "
        "than the oceans. At any one place, natural swings add to or hide that signal.",
        WELL, ["IPCC AR6 WG1", "NASA GISS GISTEMP"],
    ),
    (
        None, HEAT, "down",
        "Global warming does not predict cooling at a single place, so look for local causes: irrigation, air pollution, land "
        "cover, ocean cycles, or a step change in the record. Regional cooling does occur.",
        UNCERTAIN, ["IPCC AR6 WG1"],
    ),
    (
        None, {"T2M_RANGE"}, "down",
        "Nights have warmed faster than days in many places, which narrows the day-night swing. More humidity and cloud, and a "
        "stronger greenhouse effect at night, are the usual explanations.",
        PLAUSIBLE, ["Vose et al. 2005, Geophysical Research Letters", "IPCC AR6 WG1"],
    ),
    (
        None, HUMIDITY, "up",
        "Warmer air holds about 7% more water vapor for each degree of warming (the Clausius-Clapeyron relation), and "
        "observations show moisture rising with temperature.",
        WELL, ["Trenberth et al. 2003, Bulletin of the AMS", "IPCC AR6 WG1"],
    ),
    (
        None, {"RH2M"}, "down",
        "Over land, relative humidity has fallen since around 2000 because land warms faster than the oceans can supply "
        "moisture, so the air sits further from saturation.",
        PLAUSIBLE, ["Simmons et al. 2010, Nature Geoscience", "Byrne and O'Gorman 2018, PNAS"],
    ),
    (
        None, SUNLIGHT, "down",
        "Less sunlight at the ground usually points to more aerosol haze or more cloud. Haze from fuel and biomass burning has "
        "dimmed parts of Asia.",
        PLAUSIBLE, ["Wild 2009, Journal of Geophysical Research"],
    ),
    (
        None, SUNLIGHT, "up",
        "Brighter skies fit cleaner air: after pollution controls in Europe and North America, aerosols fell and surface "
        "sunlight rose from the 1990s ('brightening').",
        PLAUSIBLE, ["Wild et al. 2005, Science", "Wild 2009, Journal of Geophysical Research"],
    ),
    (
        None, {"CLOUD_AMT"}, None,
        "Cloud trends are hard to pin down: changes in air circulation, ocean temperature and aerosols all matter, and cloud in "
        "a reanalysis is model-derived rather than measured.",
        UNCERTAIN, ["IPCC AR6 WG1"],
    ),
    (
        None, {"ALLSKY_SFC_LW_DWN"}, "up",
        "More greenhouse gases and more water vapor radiate more heat back down to the surface.",
        WELL, ["IPCC AR6 WG1"],
    ),
    (
        None, {"WS2M"}, "down",
        "Near-surface winds weakened over many land areas from the 1980s to around 2010, called 'terrestrial stilling'. More "
        "surface roughness (trees, buildings) and shifts in circulation are the leading explanations.",
        PLAUSIBLE, ["Vautard et al. 2010, Nature Geoscience"],
    ),
    (
        None, {"WS2M"}, "up",
        "Winds over land have strengthened again since around 2010 after decades of weakening, and shifts in large-scale "
        "circulation are the leading explanation.",
        PLAUSIBLE, ["Zeng et al. 2019, Nature Climate Change"],
    ),
    (
        None, {"PRECTOTCORR"}, "up",
        "Wet regions tend to get wetter as warmer air carries more moisture, but local rainfall also depends on circulation, "
        "aerosols and land use, and rainfall is the noisiest variable.",
        PLAUSIBLE, ["IPCC AR6 WG1"],
    ),
    (
        None, {"PRECTOTCORR"}, "down",
        "Dry subtropical regions tend to get drier as circulation patterns shift, but local rainfall also depends on ocean "
        "cycles, aerosols and land use.",
        PLAUSIBLE, ["IPCC AR6 WG1"],
    ),
    (
        None, {"EVLAND"}, "up",
        "Warmer air and more available energy raise the demand for evaporation, where there is water to evaporate.",
        PLAUSIBLE, ["IPCC AR6 WG1"],
    ),
    (
        None, SOIL, "down",
        "Drier soil usually follows less rain or more evaporation from warmer air. Soil moisture here comes from a land model, "
        "so treat it as an estimate.",
        PLAUSIBLE, ["Berg and Sheffield 2018, Current Climate Change Reports"],
    ),
    (
        None, {"PRECSNOLAND"}, "down",
        "A warmer climate turns more snow into rain and shortens the snow season.",
        WELL, ["IPCC AR6 WG1"],
    ),
    (
        None, {"PS"}, None,
        "Surface pressure shifts mostly reflect changes in weather patterns and in the reanalysis itself, not a direct climate "
        "signal. Interpret with care.",
        UNCERTAIN, [],
    ),
]

DEFAULT = (
    "The data show a trend, but nothing in this app's knowledge base explains it for this variable and place. The climate "
    "rhythms in a case file's Detail view are the natural candidates to check.",
    UNCERTAIN,
    [],
)

# Planet-wide streams, by id and direction. None matches either direction.
PLANET_RULES: dict[str, list[tuple[str | None, str, str, list[str]]]] = {
    "gistemp_global": [
        ("up", "Heat-trapping gases from burning fossil fuels and from land-use change. Recent years are the warmest in NASA's record.", WELL,
         ["NASA GISS GISTEMP", "IPCC AR6 WG1"]),
    ],
    "co2_mlo": [
        ("up", "Burning coal, oil and gas, plus deforestation, adds CO2 faster than oceans and plants absorb it; roughly half of what is "
               "emitted stays in the air.", WELL, ["NOAA Global Monitoring Laboratory", "Global Carbon Project"]),
    ],
    "arctic_ice": [
        ("down", "Arctic warming melts sea ice, especially in late summer, and the loss feeds back by exposing darker ocean that absorbs "
                 "more heat. September ice extent has fallen about 12 to 13% per decade since 1979.", WELL, ["NSIDC"]),
    ],
    "antarctic_ice": [
        (None, "Antarctic sea ice has no simple trend: it grew slightly until about 2014 and then fell sharply, and scientists are still "
               "working out why. Winds, ocean heat and ice-shelf melt are all candidates.", UNCERTAIN, ["NSIDC"]),
    ],
}

CONTEXT_NOTE = "Background from published science. This app's data can show that a trend exists; they cannot show why."


def reason_for(variable: str, lat: float | None, lon: float | None, sign: str, stream: str | None = None) -> dict:
    """Published context for a trend. `sign` is "up" or "down". Always returns something, even if only the default."""
    if stream is not None:
        for want, text, confidence, sources in PLANET_RULES.get(stream, []):
            if want is None or want == sign:
                return {"text": text, "confidence": confidence, "sources": sources}
        return {"text": DEFAULT[0], "confidence": DEFAULT[1], "sources": DEFAULT[2]}
    for region, variables, want, text, confidence, sources in RULES:
        if variable not in variables or (want is not None and want != sign):
            continue
        if region is not None and (lat is None or lon is None or not REGIONS[region](lat, lon)):
            continue
        return {"text": text, "confidence": confidence, "sources": sources}
    return {"text": DEFAULT[0], "confidence": DEFAULT[1], "sources": DEFAULT[2]}
