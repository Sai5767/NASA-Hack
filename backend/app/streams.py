"""Public climate data streams beyond NASA POWER. All are free and need no key.

  * NASA GISS GISTEMP v4: global surface temperature (monthly) and by latitude band (annual)
  * NOAA Global Monitoring Laboratory: atmospheric CO2 at Mauna Loa (monthly)
  * NSIDC Sea Ice Index (NOAA@NSIDC): Arctic and Antarctic sea-ice extent (monthly)
  * NOAA climate rhythms: ENSO (ONI), Pacific Decadal Oscillation, North Atlantic Oscillation

Each parser is a pure function over text so it can be tested without the network. Series are returned
as {"YYYYMM": value or None}, the same shape NASA POWER uses, so one analysis engine serves everything.
"""

from __future__ import annotations

import asyncio
import time

import httpx

TTL_SECONDS = 12 * 3600
RETRY_STATUS = {429, 500, 502, 503, 504}
NSIDC_VERSIONS = ("v4.0", "v3.0")
NSIDC_BASE = "https://noaadata.apps.nsidc.org/NOAA/G02135/{hemi}/monthly/data/{letter}_{month:02d}_extent_{version}.csv"

URLS = {
    "gistemp_global": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
    "gistemp_zonal": "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv",
    "co2_mlo": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv",
    "oni": "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt",
    "pdo": "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat",
    "nao": "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii.table",
}

# Same fields NASA POWER variables carry, so analyze_series can treat these identically.
STREAMS: dict[str, dict] = {
    "gistemp_global": {
        "label": "Global surface temperature", "units": "°C vs 1951–1980", "group": "Planet", "kind": "trend",
        "ratio": False, "land_only": False, "source": "NASA GISS Surface Temperature Analysis (GISTEMP v4)",
        "description": "How far the planet's average surface temperature, land and ocean together, sits from its 1951–1980 average.",
    },
    "co2_mlo": {
        "label": "Atmospheric carbon dioxide", "units": "ppm", "group": "Planet", "kind": "trend",
        "ratio": True, "land_only": False, "source": "NOAA Global Monitoring Laboratory (Mauna Loa, Hawaii)",
        "description": "Parts per million of CO₂ in the air, measured on Mauna Loa since 1958. The benchmark record of the main greenhouse gas.",
    },
    "arctic_ice": {
        "label": "Arctic sea-ice extent", "units": "million km²", "group": "Planet", "kind": "trend",
        "ratio": True, "land_only": False, "source": "NSIDC Sea Ice Index (NOAA@NSIDC), satellite microwave sensors",
        "description": "Area of Arctic ocean that is at least 15% covered by sea ice, seen from satellites.",
    },
    "antarctic_ice": {
        "label": "Antarctic sea-ice extent", "units": "million km²", "group": "Planet", "kind": "trend",
        "ratio": True, "land_only": False, "source": "NSIDC Sea Ice Index (NOAA@NSIDC), satellite microwave sensors",
        "description": "Area of Antarctic ocean that is at least 15% covered by sea ice, seen from satellites.",
    },
    "oni": {
        "label": "El Niño / La Niña (ONI)", "units": "°C", "group": "Rhythm", "kind": "rhythm",
        "ratio": False, "land_only": False, "source": "NOAA Climate Prediction Center",
        "description": "Central Pacific temperature compared with normal. Above +0.5 °C is El Niño, below −0.5 °C is La Niña.",
    },
    "pdo": {
        "label": "Pacific Decadal Oscillation", "units": "index", "group": "Rhythm", "kind": "rhythm",
        "ratio": False, "land_only": False, "source": "NOAA NCEI (ERSST v5)",
        "description": "A slow, decades-long pattern in North Pacific ocean temperatures that shifts weather around the Pacific.",
    },
    "nao": {
        "label": "North Atlantic Oscillation", "units": "index", "group": "Rhythm", "kind": "rhythm",
        "ratio": False, "land_only": False, "source": "NOAA Climate Prediction Center",
        "description": "A pressure see-saw over the North Atlantic that steers winter weather across Europe and eastern North America.",
    },
}

SEASON_CENTER_MONTH = {
    "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4, "AMJ": 5, "MJJ": 6,
    "JJA": 7, "JAS": 8, "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
}

# Latitude bands used by GISTEMP's zonal file: (south edge, north edge, column name).
ZONAL_BANDS = [
    (-90, -64, "90S-64S"), (-64, -44, "64S-44S"), (-44, -24, "44S-24S"), (-24, 0, "24S-EQU"),
    (0, 24, "EQU-24N"), (24, 44, "24N-44N"), (44, 64, "44N-64N"), (64, 90, "64N-90N"),
]


class StreamError(RuntimeError):
    """A data stream could not be fetched or parsed."""


# --------------------------------------------------------------------------- parsers (pure)


def _number(token: str, *, missing_at_or_above: float | None = None, missing_at_or_below: float | None = None) -> float | None:
    try:
        value = float(token.strip())
    except ValueError:
        return None  # includes GISTEMP's "***"
    if missing_at_or_above is not None and value >= missing_at_or_above:
        return None
    if missing_at_or_below is not None and value <= missing_at_or_below:
        return None
    return value


def parse_gistemp_global(text: str) -> dict[str, float | None]:
    """GLB.Ts+dSST.csv: one row per year, columns Jan..Dec then annual and seasonal means (ignored)."""
    out: dict[str, float | None] = {}
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 13 or not parts[0].isdigit():
            continue
        for month in range(1, 13):
            out[f"{int(parts[0])}{month:02d}"] = _number(parts[month])
    return out


def parse_gistemp_zonal(text: str) -> dict[str, dict[int, float]]:
    """ZonAnn.Ts+dSST.csv: {band name: {year: anomaly}}."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header = None
    for i, line in enumerate(lines):
        if line.split(",")[0].strip() == "Year":
            header = [h.strip() for h in line.split(",")]
            lines = lines[i + 1 :]
            break
    if header is None:
        raise StreamError("Unexpected GISTEMP zonal file format.")
    bands: dict[str, dict[int, float]] = {name: {} for name in header[1:]}
    for line in lines:
        parts = [p.strip() for p in line.split(",")]
        if not parts[0].isdigit() or len(parts) != len(header):
            continue
        for name, token in zip(header[1:], parts[1:]):
            value = _number(token)
            if value is not None:
                bands[name][int(parts[0])] = value
    return bands


def parse_co2(text: str) -> dict[str, float | None]:
    """co2_mm_mlo.csv: year, month, decimal date, monthly average ppm, ... (-99.99 means missing)."""
    out: dict[str, float | None] = {}
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 4 or not parts[0].isdigit():
            continue
        out[f"{int(parts[0])}{int(parts[1]):02d}"] = _number(parts[3], missing_at_or_below=-90)
    return out


def parse_oni(text: str) -> dict[str, float | None]:
    """oni.ascii.txt: 3-month seasons (DJF, JFM, ...). Each is placed on its center month."""
    out: dict[str, float | None] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0] not in SEASON_CENTER_MONTH or not parts[1].isdigit():
            continue
        out[f"{int(parts[1])}{SEASON_CENTER_MONTH[parts[0]]:02d}"] = _number(parts[3])
    return out


def _year_by_month_table(text: str, missing_at_or_above: float | None, missing_at_or_below: float | None) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 13 or not parts[0].isdigit() or len(parts[0]) != 4:
            continue
        for month in range(1, 13):
            out[f"{int(parts[0])}{month:02d}"] = _number(
                parts[month], missing_at_or_above=missing_at_or_above, missing_at_or_below=missing_at_or_below
            )
    return out


def parse_pdo(text: str) -> dict[str, float | None]:
    """ersst.v5.pdo.dat: year then 12 monthly values (99.99 means missing)."""
    return _year_by_month_table(text, missing_at_or_above=90, missing_at_or_below=None)


def parse_nao(text: str) -> dict[str, float | None]:
    """norm.nao.monthly...ascii.table: year then 12 monthly values."""
    return _year_by_month_table(text, missing_at_or_above=90, missing_at_or_below=-90)


def parse_nsidc_month(text: str) -> dict[str, float | None]:
    """One NSIDC monthly-extent file: year, mo, source, region, extent (million km2), area. -9999 is missing."""
    out: dict[str, float | None] = {}
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        out[f"{int(parts[0])}{int(parts[1]):02d}"] = _number(parts[4], missing_at_or_below=-90)
    return out


def zonal_band_for(lat: float) -> str:
    """Name of the GISTEMP latitude band containing `lat`."""
    for south, north, name in ZONAL_BANDS:
        if south <= lat < north or (north == 90 and lat == 90):
            return name
    raise ValueError("Latitude must be between -90 and 90.")


# --------------------------------------------------------------------------- network + cache

_text_cache: dict[str, tuple[float, str]] = {}
_series_cache: dict[str, tuple[float, object]] = {}


def _fresh(entry: tuple[float, object] | None) -> bool:
    return entry is not None and time.monotonic() - entry[0] < TTL_SECONDS


async def fetch_text(url: str) -> str:
    """GET a text file (cached for 12 hours, retried on transient errors)."""
    cached = _text_cache.get(url)
    if _fresh(cached):
        return cached[1]
    last: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=40, follow_redirects=True) as client:
                resp = await client.get(url)
            if resp.status_code in RETRY_STATUS and attempt < 2:
                await asyncio.sleep(0.7 * (attempt + 1))
                continue
            resp.raise_for_status()
            _text_cache[url] = (time.monotonic(), resp.text)
            return resp.text
        except httpx.TransportError as exc:
            last = exc
            await asyncio.sleep(0.7 * (attempt + 1))
        except httpx.HTTPError as exc:
            raise StreamError(f"Could not fetch {url}: {exc}") from exc
    raise StreamError(f"Could not fetch {url}: {last}")


async def _nsidc(hemisphere: str) -> dict[str, float | None]:
    hemi, letter = ("north", "N") if hemisphere == "north" else ("south", "S")

    async def month_file(month: int) -> dict[str, float | None]:
        last: StreamError | None = None
        for version in NSIDC_VERSIONS:
            try:
                text = await fetch_text(NSIDC_BASE.format(hemi=hemi, letter=letter, month=month, version=version))
                return parse_nsidc_month(text)
            except StreamError as exc:
                last = exc
        raise last or StreamError("NSIDC sea-ice file not found.")

    combined: dict[str, float | None] = {}
    for part in await asyncio.gather(*(month_file(m) for m in range(1, 13))):
        combined.update(part)
    return combined


async def get_monthly(stream_id: str) -> dict[str, float | None]:
    """Monthly series for a stream, keyed "YYYYMM"."""
    if stream_id not in STREAMS:
        raise KeyError(stream_id)
    cached = _series_cache.get(stream_id)
    if _fresh(cached):
        return cached[1]  # type: ignore[return-value]
    parsers = {
        "gistemp_global": parse_gistemp_global, "co2_mlo": parse_co2, "oni": parse_oni,
        "pdo": parse_pdo, "nao": parse_nao,
    }
    if stream_id == "arctic_ice":
        series = await _nsidc("north")
    elif stream_id == "antarctic_ice":
        series = await _nsidc("south")
    else:
        series = parsers[stream_id](await fetch_text(URLS[stream_id]))
    if not any(v is not None for v in series.values()):
        raise StreamError(f"{STREAMS[stream_id]['label']}: the file contained no usable values.")
    _series_cache[stream_id] = (time.monotonic(), series)
    return series


async def get_zonal() -> dict[str, dict[int, float]]:
    """GISTEMP annual anomalies by latitude band: {band: {year: value}}."""
    cached = _series_cache.get("gistemp_zonal")
    if _fresh(cached):
        return cached[1]  # type: ignore[return-value]
    bands = parse_gistemp_zonal(await fetch_text(URLS["gistemp_zonal"]))
    _series_cache["gistemp_zonal"] = (time.monotonic(), bands)
    return bands


def clip_years(series: dict[str, float | None], start_year: int, end_year: int) -> dict[str, float | None]:
    return {k: v for k, v in series.items() if start_year <= int(k[:4]) <= end_year}


def latest_value(series: dict[str, float | None]) -> tuple[str, float] | None:
    """(YYYYMM, value) of the most recent month with data."""
    for stamp in sorted(series, reverse=True):
        if series[stamp] is not None:
            return stamp, series[stamp]
    return None


def cache_health() -> dict:
    """Non-secret cache and availability telemetry for public planet streams."""
    from .resilience import HEALTH_REGISTRY, load_config

    cfg = load_config()
    now = time.monotonic()
    ages = [max(0.0, now - ts) for ts, _ in _series_cache.values()]
    snap = HEALTH_REGISTRY.snapshot("planet_streams")
    return {
        "status": "degraded" if snap["consecutive_failures"] > 0 else "available",
        "configured": True,
        "keyless": True,
        "cached_streams": sorted(str(k) for k in _series_cache),
        "cache_entries": len(_series_cache),
        "ttl_seconds": cfg.streams_cache_ttl_seconds,
        "newest_cache_age_seconds": round(min(ages), 1) if ages else None,
        "oldest_cache_age_seconds": round(max(ages), 1) if ages else None,
        **snap,
    }
