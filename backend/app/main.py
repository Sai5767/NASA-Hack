"""FastAPI backend for the Earth System Trend Detective.

Run from the backend folder:
    uvicorn app.main:app --reload

Data credit: NASA Langley Research Center (LaRC) POWER Project, funded through the
NASA Earth Science/Applied Science Program. This is an independent project and is not
endorsed by NASA.
"""

from __future__ import annotations

import asyncio
import math
from datetime import date

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analysis import (
    ALPHA,
    FIRST_YEAR,
    MIN_YEARS,
    AnalysisError,
    analyze_many,
    analyze_point,
    annual_core,
    grid_points,
)
from .archetypes import build_archetypes
from .context import build_context
from .forecast import run_forecast_lab
from .ledger import build_ledger
from .morans import morans_i
from .nasa_power import VARIABLES, PowerError
from .places import PLACES
from .planet import build_vitals
from .stats import benjamini_hochberg, t_critical, t_two_sided_p

MAX_WORLD_CONCURRENCY = 4

MAX_GRID_SIDE = 5           # up to 5 x 5 = 25 cells per scan
MAX_CONCURRENT_FETCHES = 3  # be polite to the NASA POWER service
GRADE_RANK = {"strong": 3, "moderate": 2, "weak": 1, "none": 0}

app = FastAPI(title="Earth System Trend Detective API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- validation


def _check_years(start_year: int, end_year: int) -> None:
    last_year = date.today().year
    if not (FIRST_YEAR <= start_year < end_year <= last_year):
        raise HTTPException(400, f"Years must satisfy {FIRST_YEAR} <= start < end <= {last_year}.")
    if end_year - start_year + 1 < MIN_YEARS:
        raise HTTPException(400, f"Choose at least {MIN_YEARS} years so the trend is meaningful.")


def _check_variable(variable: str) -> None:
    if variable not in VARIABLES:
        raise HTTPException(404, f"Unknown variable '{variable}'.")


# --------------------------------------------------------------------------- endpoints


@app.get("/api/variables")
def list_variables() -> list[dict]:
    """Variables the user can choose, with plain-language descriptions."""
    return [{"id": key, **info} for key, info in VARIABLES.items()]


@app.get("/api/trend")
async def trend(
    variable: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Full case file for one variable at one location and period."""
    _check_variable(variable)
    _check_years(start_year, end_year)
    try:
        return await analyze_point(variable, lat, lon, start_year, end_year)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PowerError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/sweep")
async def sweep(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Which variables are trending at this location? Every variable, ranked by evidence."""
    _check_years(start_year, end_year)
    try:
        results = await analyze_many(list(VARIABLES), lat, lon, start_year, end_year, detail=True)
    except PowerError as exc:
        raise HTTPException(502, str(exc)) from exc

    rows: list[dict] = []
    for variable, res in results.items():
        info = VARIABLES[variable]
        base = {"id": variable, "label": info["label"], "units": info["units"], "group": info["group"]}
        if isinstance(res, AnalysisError):
            rows.append({**base, "ok": False, "message": str(res)})
            continue
        s = res["stats"]
        rows.append(
            {
                **base,
                "ok": True,
                "sign": s["sign"],
                "direction": s["direction"],
                "significant": s["significant"],
                "significant_fdr": False,
                "p_value": s["p_value"],
                "slope_per_decade": s["slope_per_decade"],
                "ci_low_per_decade": s["ci_low_per_decade"],
                "ci_high_per_decade": s["ci_high_per_decade"],
                "total_change": s["total_change"],
                "percent_of_mean": s["percent_of_mean"],
                "signal_to_noise": s["signal_to_noise"],
                "grade": res["grade"],
                "emergence_year": res["emergence"]["year"],
                "years": [a["year"] for a in res["annual"]],
                "annual": [a["value"] for a in res["annual"]],
            }
        )

    ok_rows = [r for r in rows if r["ok"]]
    for row, flag in zip(ok_rows, benjamini_hochberg([r["p_value"] for r in ok_rows], ALPHA)):
        row["significant_fdr"] = flag

    rows.sort(
        key=lambda r: (
            0 if not r["ok"] else 1,
            GRADE_RANK[r["grade"]["code"]] if r["ok"] else 0,
            abs(r["signal_to_noise"] or 0.0) if r["ok"] else 0.0,
        ),
        reverse=True,
    )
    return {
        "location": {"lat": lat, "lon": lon},
        "period": {"start_year": start_year, "end_year": end_year},
        "alpha": ALPHA,
        "rows": rows,
        "counts": {
            "total": len(rows),
            "analyzed": len(ok_rows),
            "significant": sum(1 for r in ok_rows if r["significant"]),
            "significant_fdr": sum(1 for r in ok_rows if r["significant_fdr"]),
            "strong_or_moderate": sum(1 for r in ok_rows if r["grade"]["code"] in ("strong", "moderate")),
        },
    }


@app.get("/api/grid")
async def grid(
    variable: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    size: float = Query(10.0, gt=0, le=40, description="Width of the scanned area in degrees"),
    n: int = Query(3, ge=2, le=MAX_GRID_SIDE, description="Points per side"),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Trend for each point on an n x n grid around a center location."""
    _check_variable(variable)
    _check_years(start_year, end_year)

    points = grid_points(lat, lon, size, n)
    limiter = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)

    async def scan(point_lat: float, point_lon: float) -> dict:
        async with limiter:
            try:
                res = await analyze_point(variable, point_lat, point_lon, start_year, end_year, detail=False)
            except (AnalysisError, PowerError) as exc:
                return {"lat": point_lat, "lon": point_lon, "ok": False, "message": str(exc)}
        s = res["stats"]
        return {
            "lat": point_lat,
            "lon": point_lon,
            "ok": True,
            "sign": s["sign"],
            "direction": s["direction"],
            "significant": s["significant"],
            "significant_fdr": False,
            "p_value": s["p_value"],
            "slope_per_decade": s["slope_per_decade"],
            "total_change": s["total_change"],
            "signal_to_noise": s["signal_to_noise"],
            "_annual": {a["year"]: a["value"] for a in res["annual"]},
        }

    cells = await asyncio.gather(*(scan(la, lo) for la, lo in points))
    ok = [c for c in cells if c["ok"]]

    # Many cells are tested at once, so some would pass by luck: control the false-discovery rate.
    for cell, flag in zip(ok, benjamini_hochberg([c["p_value"] for c in ok], ALPHA)):
        cell["significant_fdr"] = flag

    composite = _composite(VARIABLES[variable], [(c["lat"], c["_annual"]) for c in ok], ok)
    for c in ok:
        c.pop("_annual", None)

    pool = [c for c in ok if c["significant_fdr"]] or [c for c in ok if c["significant"]]
    strongest_up = max((c for c in pool if c["slope_per_decade"] > 0), key=lambda c: c["slope_per_decade"], default=None)
    strongest_down = min((c for c in pool if c["slope_per_decade"] < 0), key=lambda c: c["slope_per_decade"], default=None)

    values = [c["slope_per_decade"] if c["ok"] else None for c in cells]
    spatial = morans_i(values, n)
    increase = sum(1 for c in ok if c["significant_fdr"] and c["slope_per_decade"] > 0)
    decrease = sum(1 for c in ok if c["significant_fdr"] and c["slope_per_decade"] < 0)

    return {
        "variable": {"id": variable, **VARIABLES[variable]},
        "period": {"start_year": start_year, "end_year": end_year},
        "alpha": ALPHA,
        "n": n,
        "size": size,
        "cells": cells,
        "counts": {
            "total": len(cells),
            "analyzed": len(ok),
            "failed": len(cells) - len(ok),
            "increase": increase,
            "decrease": decrease,
            "nominal_only": sum(1 for c in ok if c["significant"] and not c["significant_fdr"]),
            "none": sum(1 for c in ok if not c["significant"]),
        },
        "composite": composite,
        "strongest_increase": strongest_up,
        "strongest_decrease": strongest_down,
        "opposite_trends": strongest_up is not None and strongest_down is not None,
        "morans": None
        if spatial is None
        else {
            "i": spatial.i,
            "expected": spatial.expected,
            "p_value": spatial.p_value,
            "pattern": spatial.pattern,
            "cells_used": spatial.cells_used,
        },
    }


def _composite(info: dict, series: list[tuple[float, dict[int, float]]], cells: list[dict]) -> dict | None:
    """One regional series: the area-weighted (cos latitude) mean of every analyzed cell, then its trend."""
    if len(series) < 3:
        return None
    years = sorted(set.intersection(*(set(annual) for _, annual in series)))
    if len(years) < MIN_YEARS:
        return None
    weights = [max(math.cos(math.radians(lat)), 1e-6) for lat, _ in series]
    total = sum(weights)
    values = [sum(w * annual[y] for w, (_, annual) in zip(weights, series)) / total for y in years]
    if max(values) - min(values) <= 1e-12:
        return None
    s = annual_core(info, years, values)["stats"]
    same_sign = [c for c in cells if c["significant_fdr"] and (c["slope_per_decade"] > 0) == (s["slope_per_decade"] > 0)]
    return {
        "n_cells": len(series),
        "annual": [{"year": y, "value": v} for y, v in zip(years, values)],
        "stats": {k: s[k] for k in (
            "slope_per_decade", "ci_low_per_decade", "ci_high_per_decade", "total_change", "p_value",
            "significant", "sign", "signal_to_noise", "percent_of_mean", "n_years",
        )},
        "agreeing_share": len(same_sign) / len(series),
    }


@app.get("/api/suspects")
async def suspects(
    variable: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """What moves with this trend? Climate rhythms, global warming and an independent NASA cross-check."""
    _check_variable(variable)
    _check_years(start_year, end_year)
    try:
        res = await analyze_point(variable, lat, lon, start_year, end_year, detail=False)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PowerError as exc:
        raise HTTPException(502, str(exc)) from exc
    years = [a["year"] for a in res["annual"]]
    values = [a["value"] for a in res["annual"]]
    return await build_context(VARIABLES[variable], lat, years, values, res["stats"])


@app.get("/api/vitals")
async def vitals(
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Earth's vital signs: global temperature, CO2 and sea ice (trend tests) plus ENSO, PDO and NAO (status)."""
    _check_years(start_year, end_year)
    return await build_vitals(start_year, end_year)


@app.get("/api/places")
def places() -> list[dict]:
    """Well-known places and regions for search and the World view."""
    return PLACES


@app.get("/api/world")
async def world(
    variable: str,
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """One variable across every place in the gazetteer: where is it changing most? (Sample sites, not the whole globe.)"""
    _check_variable(variable)
    _check_years(start_year, end_year)
    limiter = asyncio.Semaphore(MAX_WORLD_CONCURRENCY)

    async def probe(place: dict) -> dict:
        base = {k: place[k] for k in ("id", "name", "kind", "lat", "lon")}
        async with limiter:
            try:
                res = await analyze_point(variable, place["lat"], place["lon"], start_year, end_year, detail=False)
            except (AnalysisError, PowerError) as exc:
                return {**base, "ok": False, "message": str(exc)}
        s = res["stats"]
        return {
            **base,
            "ok": True,
            "sign": s["sign"],
            "significant": s["significant"],
            "significant_fdr": False,
            "p_value": s["p_value"],
            "slope_per_decade": s["slope_per_decade"],
            "ci_low_per_decade": s["ci_low_per_decade"],
            "ci_high_per_decade": s["ci_high_per_decade"],
            "percent_of_mean": s["percent_of_mean"],
            "signal_to_noise": s["signal_to_noise"],
            # Yearly values as [year, value] pairs: the front-end's time-lapse colours each site by its own yearly anomaly.
            "series": [[a["year"], round(a["value"], 4)] for a in res["annual"]],
        }

    entries = await asyncio.gather(*(probe(p) for p in PLACES))
    ok = [e for e in entries if e["ok"]]
    for entry, flag in zip(ok, benjamini_hochberg([e["p_value"] for e in ok], ALPHA)):
        entry["significant_fdr"] = flag
    solid = [e for e in ok if e["significant_fdr"]]
    return {
        "variable": {"id": variable, **VARIABLES[variable]},
        "period": {"start_year": start_year, "end_year": end_year},
        "places": entries,
        "counts": {
            "total": len(entries),
            "analyzed": len(ok),
            "rising": sum(1 for e in solid if e["slope_per_decade"] > 0),
            "falling": sum(1 for e in solid if e["slope_per_decade"] < 0),
            "nominal_only": sum(1 for e in ok if e["significant"] and not e["significant_fdr"]),
            "none": sum(1 for e in ok if not e["significant"]),
            "failed": len(entries) - len(ok),
        },
        "top_rising": sorted((e for e in solid if e["slope_per_decade"] > 0), key=lambda e: -e["slope_per_decade"])[:5],
        "top_falling": sorted((e for e in solid if e["slope_per_decade"] < 0), key=lambda e: e["slope_per_decade"])[:5],
        "note": "These are sample sites around the world, not an evenly spaced or complete picture of the planet.",
    }


@app.get("/api/ledger")
async def ledger(
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
    limit: int = Query(300, ge=20, le=1500, description="How many of the top-ranked trends to return"),
) -> dict:
    """The trend ledger: every variable at every sample place plus the planet's vital signs, ranked by evidence."""
    _check_years(start_year, end_year)
    return await build_ledger(start_year, end_year, limit=limit)


@app.get("/api/forecast")
async def forecast(
    variable: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Forecast lab: backtested 1-5 year forecast with conformal error bands, and how it compares with naive baselines."""
    _check_variable(variable)
    _check_years(start_year, end_year)
    try:
        res = await analyze_point(variable, lat, lon, start_year, end_year, detail=False)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PowerError as exc:
        raise HTTPException(502, str(exc)) from exc
    years = [a["year"] for a in res["annual"]]
    values = [a["value"] for a in res["annual"]]
    lab = run_forecast_lab(years, values)
    return {"variable": {"id": variable, **VARIABLES[variable]}, "location": {"lat": lat, "lon": lon}, **lab}


@app.get("/api/archetypes")
async def archetypes(
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
    k: int | None = Query(None, ge=2, le=6, description="Number of archetypes; defaults to the best-separated choice"),
) -> dict:
    """Trend archetypes: cluster the sample places by how all their variables are changing, and find climate twins."""
    _check_years(start_year, end_year)
    return await build_archetypes(start_year, end_year, k=k)


@app.get("/api/duel")
async def duel(
    variable: str,
    lat_a: float = Query(..., ge=-90, le=90),
    lon_a: float = Query(..., ge=-180, le=180),
    lat_b: float = Query(..., ge=-90, le=90),
    lon_b: float = Query(..., ge=-180, le=180),
    start_year: int = Query(FIRST_YEAR),
    end_year: int = Query(date.today().year - 1),
) -> dict:
    """Compare the same variable at two locations and test whether the trends differ."""
    _check_variable(variable)
    _check_years(start_year, end_year)
    try:
        a, b = await asyncio.gather(
            analyze_point(variable, lat_a, lon_a, start_year, end_year),
            analyze_point(variable, lat_b, lon_b, start_year, end_year),
        )
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PowerError as exc:
        raise HTTPException(502, str(exc)) from exc

    mean_a, mean_b = a["stats"]["mean_value"], b["stats"]["mean_value"]
    values_b = {row["year"]: row["value"] for row in b["annual"]}
    overlay = [
        {"year": row["year"], "a": row["value"] - mean_a, "b": values_b[row["year"]] - mean_b}
        for row in a["annual"]
        if row["year"] in values_b
    ]
    return {
        "variable": a["variable"],
        "a": a,
        "b": b,
        "overlay": overlay,
        "difference": _trend_difference(a, b),
    }


def _trend_difference(a: dict, b: dict) -> dict:
    """Do two regression slopes differ more than chance allows?

    Welch's t-test on the two slopes (each with its own standard error and degrees of freedom). Approximate in one
    way, stated to the user: it treats the two places as independent, but nearby places share weather, so the test
    errs on the cautious side.
    """
    unit = a["variable"]["units"]
    diff = a["ols"]["slope_per_decade"] - b["ols"]["slope_per_decade"]
    se_a, se_b = a["ols"]["se_per_decade"], b["ols"]["se_per_decade"]
    se = math.hypot(se_a, se_b)
    if se > 0:
        z = diff / se
        # Welch-Satterthwaite degrees of freedom for the difference of two estimates.
        df = se**4 / (se_a**4 / a["ols"]["df"] + se_b**4 / b["ols"]["df"])
        p_value = t_two_sided_p(z, df)
        half = t_critical(ALPHA, df) * se
        low, high = diff - half, diff + half
    else:
        z, p_value, low, high = (math.inf if diff != 0 else 0.0), (0.0 if diff != 0 else 1.0), diff, diff
    significant = p_value < ALPHA
    if significant:
        leader = "A" if diff > 0 else "B"
        text = (
            f"The trend at {leader} is higher than at the other place by {abs(diff):.3g} {unit} per decade "
            f"(95% range {low:+.3g} to {high:+.3g} for A minus B). The two places are changing at "
            "significantly different rates."
        )
    else:
        text = (
            f"The difference between the two trends is {diff:+.3g} {unit} per decade (95% range {low:+.3g} to "
            f"{high:+.3g}), which is within what chance could produce. The data do not show different rates."
        )
    return {
        "slope_diff_per_decade": diff,
        "ci_low": low,
        "ci_high": high,
        "z": None if math.isinf(z) else z,
        "p_value": p_value,
        "significant": significant,
        "text": text,
    }
