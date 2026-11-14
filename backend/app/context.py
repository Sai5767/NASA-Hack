"""Context for a trend: which large-scale rhythms move with it, and how it compares with independent data.

Everything here is correlational. A "linked" rhythm moves in step with the variable from year to year; it
is not proof of cause. Series are linearly detrended before rhythms are correlated, p-values use the
effective number of independent years (Bretherton et al., 1999), and the three rhythms are tested together
with Benjamini-Hochberg false-discovery control.
"""

from __future__ import annotations

import asyncio

from . import streams
from .analysis import ALPHA, MIN_YEARS, annual_core
from .nasa_power import annual_means
from .stats import (
    benjamini_hochberg,
    correlation_p_value,
    effective_sample_size,
    lag1_autocorrelation,
    linear_detrend,
    mann_kendall,
    ols,
    pearson,
    variance_factor_from_autocorr,
)

MIN_COMMON_YEARS = 15

# Rhythms that swing from year to year (so detrended correlation is meaningful).
RHYTHMS = [
    {"id": "oni", "label": "El Niño / La Niña (ENSO)", "high_phase": "El Niño years", "low_phase": "La Niña years"},
    {"id": "pdo", "label": "Pacific Decadal Oscillation", "high_phase": "positive-phase years", "low_phase": "negative-phase years"},
    {"id": "nao", "label": "North Atlantic Oscillation", "high_phase": "positive-phase years", "low_phase": "negative-phase years"},
]

BAND_LABELS = {
    "90S-64S": "90°S–64°S", "64S-44S": "64°S–44°S", "44S-24S": "44°S–24°S", "24S-EQU": "24°S–equator",
    "EQU-24N": "equator–24°N", "24N-44N": "24°N–44°N", "44N-64N": "44°N–64°N", "64N-90N": "64°N–90°N",
}


def _align(local: dict[int, float], other: dict[int, float]) -> tuple[list[int], list[float], list[float]]:
    years = sorted(set(local) & set(other))
    return years, [local[y] for y in years], [other[y] for y in years]


def _rhythm_link(local: dict[int, float], driver: dict[int, float]) -> dict | None:
    years, y, d = _align(local, driver)
    if len(years) < MIN_COMMON_YEARS:
        return None
    times = [float(t) for t in years]
    y_flat, d_flat = linear_detrend(y, times), linear_detrend(d, times)
    r = pearson(y_flat, d_flat)
    if r is None:
        return None
    n_eff = effective_sample_size(len(years), lag1_autocorrelation(y_flat), lag1_autocorrelation(d_flat))
    return {
        "r": r,
        "n_years": len(years),
        "n_eff": n_eff,
        "p_value": correlation_p_value(r, n_eff),
        "explained": r * r * 100.0,
    }


def _enso_adjusted(info: dict, local: dict[int, float], oni: dict[int, float]) -> dict | None:
    """Trend after removing the part of each year's value that tracks ENSO."""
    years, y, d = _align(local, oni)
    if len(years) < MIN_YEARS:
        return None
    d_mean = sum(d) / len(d)
    fit = ols(y, d)
    adjusted = [v - fit.slope * (x - d_mean) for v, x in zip(y, d)]
    before = annual_core(info, years, y)["stats"]
    after = annual_core(info, years, adjusted)["stats"]
    return {
        "n_years": len(years),
        "enso_share": max(0.0, fit.r2) * 100.0,
        "slope_before": before["slope_per_decade"],
        "slope_after": after["slope_per_decade"],
        "ci_low_after": after["ci_low_per_decade"],
        "ci_high_after": after["ci_high_per_decade"],
        "p_after": after["p_value"],
        "significant_after": after["significant"],
        "significant_before": before["significant"],
    }


def _amplification(local: dict[int, float], global_temp: dict[int, float]) -> dict | None:
    """How many degrees this place moves per degree of global temperature change (pattern scaling)."""
    years, y, g = _align(local, global_temp)
    if len(years) < MIN_COMMON_YEARS:
        return None
    first = ols(y, g)
    g_mean, y_mean = sum(g) / len(g), sum(y) / len(y)
    residuals = [v - (y_mean + first.slope * (x - g_mean)) for v, x in zip(y, g)]
    factor = variance_factor_from_autocorr(lag1_autocorrelation(residuals), len(years))
    fit = ols(y, g, variance_factor=factor)
    return {
        "beta": fit.slope,
        "ci_low": fit.ci_low,
        "ci_high": fit.ci_high,
        "r2": fit.r2,
        "p_value": fit.p_value,
        "n_years": len(years),
        "autocorr_adjusted": factor > 1.0,
    }


def _zonal_check(lat: float, local_years: list[int], local_stats: dict, band_series: dict[int, float]) -> dict | None:
    """Independent check: NASA GISTEMP's trend for the same latitude band over the same years."""
    years = [y for y in local_years if y in band_series]
    if len(years) < MIN_YEARS:
        return None
    res = mann_kendall([band_series[y] for y in years], [float(y) for y in years])
    band = streams.zonal_band_for(lat)
    lo = max(res.sens_ci_low * 10, local_stats["ci_low_per_decade"])
    hi = min(res.sens_ci_high * 10, local_stats["ci_high_per_decade"])
    return {
        "band": band,
        "band_label": BAND_LABELS[band],
        "band_slope_per_decade": res.sens_slope * 10,
        "band_ci_low": res.sens_ci_low * 10,
        "band_ci_high": res.sens_ci_high * 10,
        "band_p_value": res.p_value,
        "band_significant": res.significant,
        "local_slope_per_decade": local_stats["slope_per_decade"],
        "ranges_overlap": lo <= hi,
        "n_years": len(years),
    }


async def _annual(stream_id: str) -> dict[int, float]:
    return annual_means(await streams.get_monthly(stream_id))


async def build_context(variable_info: dict, lat: float, years: list[int], values: list[float], local_stats: dict) -> dict:
    """Suspect lineup, ENSO-adjusted trend, global amplification and an independent zonal check."""
    local = dict(zip(years, values))
    wants_global = bool(variable_info.get("tracks_global_temp"))
    wants_zonal = variable_info.get("label") == "Air temperature"

    jobs = {r["id"]: _annual(r["id"]) for r in RHYTHMS}
    if wants_global:
        jobs["gistemp_global"] = _annual("gistemp_global")
    if wants_zonal:
        jobs["zonal"] = streams.get_zonal()
    results = dict(zip(jobs, await asyncio.gather(*jobs.values(), return_exceptions=True)))

    errors: list[str] = []

    def fetched(key: str, label: str):
        value = results.get(key)
        if isinstance(value, Exception):
            errors.append(f"{label} is unavailable right now.")
            return None
        return value

    suspects: list[dict] = []
    testable: list[int] = []
    for rhythm in RHYTHMS:
        entry = {"id": rhythm["id"], "label": rhythm["label"], "high_phase": rhythm["high_phase"], "low_phase": rhythm["low_phase"], "ok": False}
        driver = fetched(rhythm["id"], rhythm["label"])
        link = _rhythm_link(local, driver) if driver else None
        if link:
            entry.update(link, ok=True, significant_fdr=False)
            testable.append(len(suspects))
        suspects.append(entry)
    for idx, flag in zip(testable, benjamini_hochberg([suspects[i]["p_value"] for i in testable], ALPHA)):
        suspects[idx]["significant_fdr"] = flag
    for s in suspects:
        if s["ok"]:
            s["verdict"] = "linked" if s["significant_fdr"] else "possible" if s["p_value"] < ALPHA else "not_linked"

    oni = fetched("oni", "ENSO")
    enso_adjusted = _enso_adjusted(variable_info, local, oni) if oni else None

    amplification = None
    if wants_global:
        global_temp = fetched("gistemp_global", "Global temperature")
        amplification = _amplification(local, global_temp) if global_temp else None

    zonal = None
    if wants_zonal:
        bands = fetched("zonal", "NASA GISTEMP latitude bands")
        band = bands.get(streams.zonal_band_for(lat)) if bands else None
        zonal = _zonal_check(lat, years, local_stats, band) if band else None

    return {
        "years": [years[0], years[-1]],
        "suspects": suspects,
        "enso_adjusted": enso_adjusted,
        "amplification": amplification,
        "zonal": zonal,
        "errors": errors,
        "caveat": "These links are correlations between yearly values. They show what moves together, not what causes what.",
    }
