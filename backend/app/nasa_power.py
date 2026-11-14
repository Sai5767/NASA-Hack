"""Access to NASA POWER monthly point data (free, no API key).

Docs: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

Data credit: NASA Langley Research Center (LaRC) POWER Project, funded through
the NASA Earth Science/Applied Science Program.

Notes verified against the live API:
  * Units below are the ones the "AG" community returns (e.g. solar is MJ/m^2/day).
  * Each year also carries an annual summary stored as month "13" (e.g. 199013).
    It is not a real month and is ignored here; annual values are computed from months.
  * Land-only variables (evaporation, root-zone wetness, snowfall) are -999 over oceans.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict

import httpx

POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
MISSING = -999.0
MIN_VALID_MONTHS = 12          # annual means need all 12 months, otherwise the season mix is biased
MAX_PARAMS_PER_REQUEST = 20
CACHE_LIMIT = 4000
RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_DELAYS = (0.7, 1.6)

# Variables offered in the app, keyed by POWER parameter name.
#   ratio: a "percent of average" change is meaningful (strictly positive physical quantity).
#   land_only: not defined over open ocean.
VARIABLES: dict[str, dict] = {
    # --- Heat ---
    "T2M": {
        "label": "Air temperature", "units": "°C", "group": "Heat", "ratio": False, "land_only": False,
        "description": "Average temperature of the air about 2 m above the ground. Rising values mean warming.",
    },
    "T2M_MAX": {
        "label": "Daily high temperature", "units": "°C", "group": "Heat", "ratio": False, "land_only": False,
        "description": "Average of each day's highest temperature. Shows whether hot days are getting hotter.",
    },
    "T2M_MIN": {
        "label": "Daily low temperature", "units": "°C", "group": "Heat", "ratio": False, "land_only": False,
        "description": "Average of each day's lowest temperature. Often changes differently from daily highs.",
    },
    "T2M_RANGE": {
        "label": "Day–night temperature swing", "units": "°C", "group": "Heat", "ratio": False, "land_only": False,
        "description": "Gap between each day's high and low. Shrinks or grows with cloud, humidity and land change.",
    },
    "TS": {
        "label": "Ground surface temperature", "units": "°C", "group": "Heat", "ratio": False, "land_only": False,
        "description": "Temperature of the ground or sea surface itself, rather than the air above it.",
    },
    # --- Water ---
    "PRECTOTCORR": {
        "label": "Rainfall and snowfall", "units": "mm/day", "group": "Water", "ratio": True, "land_only": False,
        "description": "Average daily precipitation (bias-corrected). Shows whether a place is getting wetter or drier.",
    },
    "RH2M": {
        "label": "Relative humidity", "units": "%", "group": "Water", "ratio": False, "land_only": False,
        "description": "How full of water vapor the air is, compared with the most it could hold at that temperature.",
    },
    "QV2M": {
        "label": "Specific humidity", "units": "g/kg", "group": "Water", "ratio": True, "land_only": False,
        "description": "Actual mass of water vapor in the air near the ground. Warmer air can hold more.",
    },
    "TQV": {
        "label": "Water vapor in the air column", "units": "kg/m²", "group": "Water", "ratio": True, "land_only": False,
        "description": "All the water vapor in a column of air from ground to space. A key greenhouse and rain ingredient.",
    },
    # --- Land ---
    "EVLAND": {
        "label": "Evaporation from land", "units": "mm/day", "group": "Land", "ratio": True, "land_only": True,
        "description": "Water moving from soil and plants into the air. Links the water cycle to heat.",
    },
    "GWETROOT": {
        "label": "Root-zone soil wetness", "units": "0–1", "group": "Land", "ratio": True, "land_only": True,
        "description": "How full the soil is of water where plant roots reach (0 = bone dry, 1 = saturated).",
    },
    "GWETTOP": {
        "label": "Surface soil wetness", "units": "0–1", "group": "Land", "ratio": True, "land_only": True,
        "description": "How wet the top few centimeters of soil are (0 = dry, 1 = saturated).",
    },
    "PRECSNOLAND": {
        "label": "Snowfall on land", "units": "mm/day", "group": "Land", "ratio": True, "land_only": True,
        "description": "Water-equivalent of snow falling on land. Only meaningful where it snows.",
    },
    # --- Sun and clouds ---
    "ALLSKY_SFC_SW_DWN": {
        "label": "Sunlight reaching the ground", "units": "MJ/m²/day", "group": "Sun & clouds", "ratio": True,
        "land_only": False,
        "description": "Solar energy arriving at the surface, clouds included. Reflects cloud cover and air pollution.",
    },
    "CLRSKY_SFC_SW_DWN": {
        "label": "Sunlight if skies were clear", "units": "MJ/m²/day", "group": "Sun & clouds", "ratio": True,
        "land_only": False,
        "description": "Solar energy that would reach the ground with no clouds. Changes point to haze and aerosols.",
    },
    "ALLSKY_SFC_LW_DWN": {
        "label": "Heat radiated down by the air", "units": "MJ/m²/day", "group": "Sun & clouds", "ratio": True,
        "land_only": False,
        "description": "Infrared energy sent back to the ground by gases and clouds, a direct greenhouse-effect signal.",
    },
    "CLOUD_AMT": {
        "label": "Cloud cover", "units": "%", "group": "Sun & clouds", "ratio": False, "land_only": False,
        "description": "Share of the sky covered by cloud, averaged over the month.",
    },
    # --- Wind and pressure ---
    "WS2M": {
        "label": "Wind speed", "units": "m/s", "group": "Wind & pressure", "ratio": True, "land_only": False,
        "description": "Average wind speed about 2 m above the ground.",
    },
    "PS": {
        "label": "Surface air pressure", "units": "kPa", "group": "Wind & pressure", "ratio": False,
        "land_only": False,
        "description": "Weight of the air above the surface. Shifts reveal changes in weather patterns or terrain height.",
    },
}

# Variables that are model-derived or may blend data sources whose mix changes over time.
# A step change in the source can look like a trend, so these get an extra caveat.
MODELED_NOTE = (
    "This variable is model-derived or may blend data sources that change over time, so a step change in "
    "the source can mimic a trend. Treat the result as indicative."
)
for _variable in (
    "CLOUD_AMT", "ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN", "ALLSKY_SFC_LW_DWN",
    "EVLAND", "GWETROOT", "GWETTOP", "PRECSNOLAND",
):
    VARIABLES[_variable]["note"] = MODELED_NOTE

# Absolute temperatures: how strongly they follow global warming is a meaningful question.
for _variable in ("T2M", "T2M_MAX", "T2M_MIN", "TS"):
    VARIABLES[_variable]["tracks_global_temp"] = True

_cache: OrderedDict[tuple, dict[str, float | None]] = OrderedDict()


class PowerError(RuntimeError):
    """Raised when NASA POWER cannot be reached or returns unusable data."""


def _cache_get(key: tuple) -> dict[str, float | None] | None:
    value = _cache.get(key)
    if value is not None:
        _cache.move_to_end(key)
    return value


def _cache_put(key: tuple, value: dict[str, float | None]) -> None:
    _cache[key] = value
    _cache.move_to_end(key)
    while len(_cache) > CACHE_LIMIT:
        _cache.popitem(last=False)


def parse_series(raw: dict) -> dict[str, float | None]:
    """Turn a POWER parameter block into {"YYYYMM": value or None}, real months only."""
    series: dict[str, float | None] = {}
    for stamp, value in raw.items():
        if len(stamp) != 6 or not stamp.isdigit():
            continue
        month = int(stamp[4:])
        if not 1 <= month <= 12:  # month 13 is POWER's annual summary
            continue
        series[stamp] = None if value is None or value <= MISSING else float(value)
    return series


async def _request(params: dict) -> dict:
    last_error: Exception | None = None
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.get(POWER_MONTHLY_URL, params=params)
            if resp.status_code in RETRY_STATUS and attempt < len(RETRY_DELAYS):
                await asyncio.sleep(RETRY_DELAYS[attempt])
                continue
            resp.raise_for_status()
            return resp.json()
        except httpx.TransportError as exc:
            last_error = exc
            if attempt < len(RETRY_DELAYS):
                await asyncio.sleep(RETRY_DELAYS[attempt])
                continue
        except httpx.HTTPError as exc:
            raise PowerError(f"Could not reach NASA POWER: {exc}") from exc
        except ValueError as exc:
            raise PowerError("NASA POWER returned a response that is not JSON.") from exc
    raise PowerError(f"Could not reach NASA POWER: {last_error}")


async def fetch_monthly_multi(
    parameters: list[str], lat: float, lon: float, start: int, end: int
) -> dict[str, dict[str, float | None]]:
    """Monthly series for several parameters at one location, using the cache and one request per chunk."""
    lat_key, lon_key = round(lat, 3), round(lon, 3)
    result: dict[str, dict[str, float | None]] = {}
    missing: list[str] = []
    for parameter in parameters:
        cached = _cache_get((parameter, lat_key, lon_key, start, end))
        if cached is not None:
            result[parameter] = cached
        else:
            missing.append(parameter)

    for i in range(0, len(missing), MAX_PARAMS_PER_REQUEST):
        chunk = missing[i : i + MAX_PARAMS_PER_REQUEST]
        payload = await _request(
            {
                "parameters": ",".join(chunk),
                "community": "AG",
                "longitude": lon,
                "latitude": lat,
                "start": start,
                "end": end,
                "format": "JSON",
            }
        )
        try:
            blocks = payload["properties"]["parameter"]
        except (KeyError, TypeError) as exc:
            raise PowerError("Unexpected NASA POWER response.") from exc
        for parameter in chunk:
            series = parse_series(blocks.get(parameter, {}))
            _cache_put((parameter, lat_key, lon_key, start, end), series)
            result[parameter] = series
    return result


async def fetch_monthly(parameter: str, lat: float, lon: float, start: int, end: int) -> dict[str, float | None]:
    """Monthly series for one parameter."""
    return (await fetch_monthly_multi([parameter], lat, lon, start, end))[parameter]


def annual_means(monthly: dict[str, float | None]) -> dict[int, float]:
    """Average each year's months. Only complete years count, so seasons are never under-weighted."""
    by_year: dict[int, list[float]] = {}
    for stamp, value in monthly.items():
        if value is None:
            continue
        by_year.setdefault(int(stamp[:4]), []).append(value)
    return {
        year: sum(vals) / len(vals)
        for year, vals in sorted(by_year.items())
        if len(vals) >= MIN_VALID_MONTHS
    }
