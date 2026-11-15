"""Observed monthly local grid frames and backtested 1–3 month forecasting (V2).

Routes supported:
  * GET /api/monthly-frames:
      Observed monthly values and anomalies on a tightly bounded local grid around a selected place.
      Never fabricates or interpolates missing cells; reports source provenance, resolution, and coverage.
  * GET /api/monthly-forecast:
      Honest 1–3 month forecasts for T2M, PRECTOTCORR, and CLOUD_AMT only.
      Uses rolling-origin backtests against a seasonal-naive baseline with split-conformal calibration.
      Forecast frames are returned only when `eligible` is True; otherwise they are withheld with an explicit reason.
"""

from __future__ import annotations

import asyncio
import math
from datetime import date
from statistics import mean

from . import analysis
from .ml import fit_ridge
from .nasa_power import VARIABLES, PowerError
from .resilience import load_config, utc_now_iso
from .stats import lag1_autocorrelation

MAX_MONTHLY_GRID_SIDE = 3            # tightly bounded local grid: up to 3 x 3 = 9 cells
MAX_MONTHLY_GRID_SIZE_DEG = 12.0     # maximum span in degrees
DEFAULT_MONTHLY_GRID_SIZE_DEG = 2.0
MAX_FRAME_YEARS = 10                 # at most 10 years (120 monthly frames) per request
CLIMATOLOGY_MIN_YEARS = 20           # fetch at least 20 years when computing monthly anomalies
FORECAST_VARIABLES = ("T2M", "PRECTOTCORR", "CLOUD_AMT")
MAX_FORECAST_HORIZON = 3
MIN_FORECAST_MONTHS = 120            # at least 10 complete years of contiguous monthly observations
MAX_MISSING_FRACTION = 0.05
BACKTEST_ORIGINS = 24                # 24 rolling monthly origins (2 full seasonal cycles)
MIN_BACKTEST_ORIGINS = 12
SKILL_MARGIN = 0.015                 # minimum overall MAE improvement (1.5%) over seasonal-naive
NOMINAL_COVERAGE = 0.80
MIN_EMPIRICAL_COVERAGE = 0.60
CALIBRATION_SPLIT = 0.60

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _month_label(year: int, month: int) -> str:
    return f"{MONTH_NAMES[month - 1]} {year}"


def _format_ym(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _format_stamp(year: int, month: int) -> str:
    return f"{year:04d}{month:02d}"


def _advance_month(year: int, month: int, steps: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + steps
    return total // 12, (total % 12) + 1


def _clamp_physical(variable: str, value: float) -> float:
    if variable == "PRECTOTCORR":
        return max(0.0, value)
    if variable == "CLOUD_AMT":
        return min(100.0, max(0.0, value))
    return value


def _grid_coordinates(lat: float, lon: float, size: float, n: int) -> list[dict]:
    """Generate an n x n local analysis grid with row/col indices and cell IDs."""
    if n == 1:
        return [{"cell_id": "r0_c0", "row": 0, "col": 0, "lat": round(lat, 4), "lon": round(lon, 4)}]
    pts = analysis.grid_points(lat, lon, size, n)
    cells = []
    idx = 0
    for r in range(n):
        for c in range(n):
            la, lo = pts[idx]
            cells.append({"cell_id": f"r{r}_c{c}", "row": r, "col": c, "lat": la, "lon": lo})
            idx += 1
    return cells


def _provenance_block(variable: str, start_year: int, end_year: int, *, is_forecast: bool = False) -> dict:
    info = VARIABLES[variable]
    base_caveat = info.get(
        "note",
        "NASA POWER blends satellite observations with MERRA-2 reanalysis on a ~0.5° grid; nearby points can share grid cells.",
    )
    return {
        "source_id": "nasa_power",
        "source_name": "NASA Langley Research Center (LaRC) POWER Project",
        "source_url": "https://power.larc.nasa.gov/",
        "variable_id": variable,
        "variable_label": info["label"],
        "units": info["units"],
        "observation_state": "statistical_forecast_from_reanalysis" if is_forecast else "observed_reanalysis",
        "spatial_resolution": "0.5° x 0.625° MERRA-2 / 1.0° radiation grid (coarse local analysis grid, not a satellite image)",
        "temporal_resolution": "monthly",
        "requested_period": {"start_year": start_year, "end_year": end_year},
        "fetched_at": utc_now_iso(),
        "stale": False,
        "caveat": (
            f"Forecast — not observed data. Statistical extrapolation from NASA POWER monthly records. {base_caveat}"
            if is_forecast
            else base_caveat
        ),
    }


def _compute_cell_climatology(monthly: dict[str, float | None]) -> dict[int, float]:
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for stamp, val in monthly.items():
        if val is None or len(stamp) != 6 or not stamp.isdigit():
            continue
        m = int(stamp[4:])
        if 1 <= m <= 12:
            by_month[m].append(float(val))
    return {m: round(mean(vals), 4) for m, vals in by_month.items() if vals}


# --------------------------------------------------------------------------- Observed monthly frames


async def build_monthly_frames(
    variable: str,
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    *,
    n: int = 3,
    size: float = DEFAULT_MONTHLY_GRID_SIZE_DEG,
) -> dict:
    """Fetch observed monthly values and anomalies across a small local grid around (lat, lon)."""
    cfg = load_config()
    grid_meta = _grid_coordinates(lat, lon, size, n)
    clim_start = min(start_year, max(analysis.FIRST_YEAR, end_year - (CLIMATOLOGY_MIN_YEARS - 1)))
    limiter = asyncio.Semaphore(cfg.nasa_max_concurrency)

    async def _fetch_cell(cell: dict) -> dict:
        async with limiter:
            try:
                series_map = await analysis.fetch_monthly_multi(
                    [variable], cell["lat"], cell["lon"], clim_start, end_year
                )
                return {**cell, "ok": True, "series": series_map.get(variable, {}), "error": None}
            except PowerError as exc:
                return {**cell, "ok": False, "series": {}, "error": str(exc)}

    fetched_cells = await asyncio.gather(*(_fetch_cell(c) for c in grid_meta))

    months_in_range: list[tuple[int, int, str, str]] = []
    for yr in range(start_year, end_year + 1):
        for mo in range(1, 13):
            months_in_range.append((yr, mo, _format_ym(yr, mo), _format_stamp(yr, mo)))

    expected_per_cell = len(months_in_range)
    cell_summaries: list[dict] = []
    cell_clims: dict[str, dict[int, float]] = {}

    total_valid_obs = 0
    total_missing_obs = 0
    cells_with_missing = 0

    for c in fetched_cells:
        cid = c["cell_id"]
        if not c["ok"]:
            cell_clims[cid] = {}
            total_missing_obs += expected_per_cell
            cells_with_missing += 1
            cell_summaries.append(
                {
                    "cell_id": cid,
                    "row": c["row"],
                    "col": c["col"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "ok": False,
                    "valid_months": 0,
                    "missing_months": expected_per_cell,
                    "expected_months": expected_per_cell,
                    "missing_fraction": 1.0,
                    "climatology": {},
                    "error": c["error"],
                }
            )
            continue

        series = c["series"]
        clim = _compute_cell_climatology(series)
        cell_clims[cid] = clim
        valid_count = sum(1 for _, _, _, st in months_in_range if series.get(st) is not None)
        missing_count = expected_per_cell - valid_count
        total_valid_obs += valid_count
        total_missing_obs += missing_count
        if missing_count > 0:
            cells_with_missing += 1

        cell_summaries.append(
            {
                "cell_id": cid,
                "row": c["row"],
                "col": c["col"],
                "lat": c["lat"],
                "lon": c["lon"],
                "ok": True,
                "valid_months": valid_count,
                "missing_months": missing_count,
                "expected_months": expected_per_cell,
                "missing_fraction": round(missing_count / expected_per_cell, 4) if expected_per_cell else 0.0,
                "climatology": clim,
                "error": None,
            }
        )

    succeeded_cells = sum(1 for c in cell_summaries if c["ok"])
    failed_cells = len(cell_summaries) - succeeded_cells
    if succeeded_cells == 0:
        first_err = next((c["error"] for c in cell_summaries if c["error"]), "Could not reach NASA POWER.")
        raise PowerError(first_err)

    frames: list[dict] = []
    for yr, mo, ym, stamp in months_in_range:
        frame_cells: list[dict] = []
        valid_vals: list[float] = []
        valid_anoms: list[float] = []

        for c in fetched_cells:
            cid = c["cell_id"]
            raw_val = c["series"].get(stamp) if c["ok"] else None
            clim_val = cell_clims[cid].get(mo)
            if raw_val is None:
                frame_cells.append(
                    {
                        "cell_id": cid,
                        "row": c["row"],
                        "col": c["col"],
                        "lat": c["lat"],
                        "lon": c["lon"],
                        "value": None,
                        "anomaly": None,
                        "missing": True,
                    }
                )
            else:
                val_r = round(float(raw_val), 4)
                anom_r = round(val_r - clim_val, 4) if clim_val is not None else None
                valid_vals.append(val_r)
                if anom_r is not None:
                    valid_anoms.append(anom_r)
                frame_cells.append(
                    {
                        "cell_id": cid,
                        "row": c["row"],
                        "col": c["col"],
                        "lat": c["lat"],
                        "lon": c["lon"],
                        "value": val_r,
                        "anomaly": anom_r,
                        "missing": False,
                    }
                )

        frames.append(
            {
                "month": ym,
                "stamp": stamp,
                "year": yr,
                "month_num": mo,
                "label": _month_label(yr, mo),
                "kind": "observed",
                "badge": "Observed (NASA POWER)",
                "valid_cells": len(valid_vals),
                "missing_cells": len(frame_cells) - len(valid_vals),
                "mean_value": round(mean(valid_vals), 4) if valid_vals else None,
                "mean_anomaly": round(mean(valid_anoms), 4) if valid_anoms else None,
                "cells": frame_cells,
            }
        )

    total_expected_obs = len(cell_summaries) * expected_per_cell
    return {
        "variable": {"id": variable, **VARIABLES[variable]},
        "location": {"lat": lat, "lon": lon},
        "grid": {
            "n": n,
            "size_degrees": size,
            "total_cells": len(cell_summaries),
            "resolution_note": (
                "Coarse local analysis grid around the selected location (~0.5° NASA POWER reanalysis), "
                "not a global satellite raster. Missing cells are shown as missing and never interpolated."
            ),
        },
        "period": {
            "start_year": start_year,
            "end_year": end_year,
            "climatology_start_year": clim_start,
            "climatology_end_year": end_year,
            "start_month": _format_ym(start_year, 1),
            "end_month": _format_ym(end_year, 12),
            "total_months": expected_per_cell,
        },
        "provenance": _provenance_block(variable, start_year, end_year, is_forecast=False),
        "coverage": {
            "cells_requested": len(cell_summaries),
            "cells_succeeded": succeeded_cells,
            "cells_failed": failed_cells,
            "cells_with_missing_months": cells_with_missing,
            "total_cell_months_expected": total_expected_obs,
            "total_cell_months_valid": total_valid_obs,
            "total_cell_months_missing": total_missing_obs,
            "coverage_fraction": round(total_valid_obs / total_expected_obs, 4) if total_expected_obs else 0.0,
            "partial_failure": failed_cells > 0 or total_missing_obs > 0,
        },
        "cells": cell_summaries,
        "frames": frames,
    }


# --------------------------------------------------------------------------- Monthly candidate forecasters


def _extract_contiguous_monthly(
    monthly: dict[str, float | None], start_year: int, end_year: int
) -> tuple[list[tuple[int, int]], list[float], int, int]:
    """Return (contiguous_ym_pairs, contiguous_values, total_valid, total_expected) over [start_year..end_year]."""
    all_pairs: list[tuple[int, int, float | None]] = []
    for yr in range(start_year, end_year + 1):
        for mo in range(1, 13):
            all_pairs.append((yr, mo, monthly.get(_format_stamp(yr, mo))))

    # Trim trailing missing months (for example an unfinished current year)
    while all_pairs and all_pairs[-1][2] is None:
        all_pairs.pop()

    # Trim leading missing months too: before a variable's own record begins (cloud cover starts in 1984, for example)
    # there is no data to be missing. Gaps *inside* the record still count against it.
    first_valid = next((i for i, (_, _, v) in enumerate(all_pairs) if v is not None), len(all_pairs))
    all_pairs = all_pairs[first_valid:]

    total_expected = len(all_pairs)
    total_valid = sum(1 for _, _, v in all_pairs if v is not None)
    if not all_pairs:
        return [], [], 0, (end_year - start_year + 1) * 12

    # Find longest contiguous run ending at the latest available month
    idx = len(all_pairs) - 1
    while idx > 0 and all_pairs[idx - 1][2] is not None:
        idx -= 1

    contiguous = all_pairs[idx:]
    ym = [(yr, mo) for yr, mo, _ in contiguous]
    vals = [float(v) for _, _, v in contiguous if v is not None]
    return ym, vals, total_valid, total_expected


def _month_means(ym: list[tuple[int, int]], values: list[float]) -> dict[int, float]:
    buckets: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for (_, mo), val in zip(ym, values):
        buckets[mo].append(val)
    overall = mean(values) if values else 0.0
    return {m: (mean(buckets[m]) if buckets[m] else overall) for m in range(1, 13)}


def model_seasonal_naive(ym: list[tuple[int, int]], train: list[float], horizon: int, variable: str) -> list[float]:
    """Baseline: repeat the value observed in the same calendar month 12 months earlier."""
    n = len(train)
    out: list[float] = []
    for h in range(1, horizon + 1):
        idx = n - 12 + (h - 1)
        pred = train[idx] if 0 <= idx < n else train[-1]
        out.append(_clamp_physical(variable, pred))
    return out


def model_harmonic_damped_trend(ym: list[tuple[int, int]], train: list[float], horizon: int, variable: str) -> list[float]:
    """Harmonic/calendar seasonal decomposition + damped Holt linear trend on deseasonalized anomalies."""
    n = len(train)
    if n < 24:
        return model_seasonal_naive(ym, train, horizon, variable)

    clim = _month_means(ym, train)
    # Smooth calendar-month means with 2-harmonic Fourier projection + 70% empirical month mean blend
    mean_c = mean(clim.values())
    a1 = sum((clim[m] - mean_c) * math.cos(2 * math.pi * (m - 1) / 12) for m in range(1, 13)) / 6.0
    b1 = sum((clim[m] - mean_c) * math.sin(2 * math.pi * (m - 1) / 12) for m in range(1, 13)) / 6.0
    a2 = sum((clim[m] - mean_c) * math.cos(4 * math.pi * (m - 1) / 12) for m in range(1, 13)) / 6.0
    b2 = sum((clim[m] - mean_c) * math.sin(4 * math.pi * (m - 1) / 12) for m in range(1, 13)) / 6.0
    seasonal: dict[int, float] = {}
    for m in range(1, 13):
        harm = (
            mean_c
            + a1 * math.cos(2 * math.pi * (m - 1) / 12)
            + b1 * math.sin(2 * math.pi * (m - 1) / 12)
            + a2 * math.cos(4 * math.pi * (m - 1) / 12)
            + b2 * math.sin(4 * math.pi * (m - 1) / 12)
        )
        seasonal[m] = 0.75 * clim[m] + 0.25 * harm

    anomalies = [v - seasonal[mo] for (_, mo), v in zip(ym, train)]

    # Damped Holt smoothing on anomalies over candidate parameters
    best = None
    tail = anomalies[-min(n, 180):]
    for alpha in (0.15, 0.30, 0.50):
        for beta in (0.02, 0.06):
            for phi in (0.85, 0.94, 0.98):
                level = tail[0]
                trend = (tail[min(12, len(tail) - 1)] - tail[0]) / max(1, min(12, len(tail) - 1))
                sse = 0.0
                for y in tail[1:]:
                    expected = level + phi * trend
                    sse += (y - expected) ** 2
                    new_level = alpha * y + (1.0 - alpha) * expected
                    trend = beta * (new_level - level) + (1.0 - beta) * phi * trend
                    level = new_level
                if best is None or sse < best[0]:
                    best = (sse, level, trend, phi)

    _, level, trend, phi = best  # type: ignore[misc]
    last_yr, last_mo = ym[-1]
    out: list[float] = []
    damp = 0.0
    for h in range(1, horizon + 1):
        damp += phi**h
        _, target_mo = _advance_month(last_yr, last_mo, h)
        pred = seasonal[target_mo] + level + damp * trend
        out.append(_clamp_physical(variable, pred))
    return out


def model_seasonal_trend_ar1(ym: list[tuple[int, int]], train: list[float], horizon: int, variable: str) -> list[float]:
    """Deseasonalized linear trend + AR(1) residual persistence."""
    n = len(train)
    if n < 24:
        return model_seasonal_naive(ym, train, horizon, variable)

    clim = _month_means(ym, train)
    anoms = [v - clim[mo] for (_, mo), v in zip(ym, train)]
    xm = (n - 1) / 2.0
    ym_val = mean(anoms)
    sxx = sum((i - xm) ** 2 for i in range(n)) or 1.0
    slope = sum((i - xm) * (a - ym_val) for i, a in enumerate(anoms)) / sxx
    intercept = ym_val - slope * xm
    residuals = [a - (intercept + slope * i) for i, a in enumerate(anoms)]
    phi = max(0.0, min(0.90, lag1_autocorrelation(residuals)))

    last_yr, last_mo = ym[-1]
    out: list[float] = []
    for h in range(1, horizon + 1):
        _, target_mo = _advance_month(last_yr, last_mo, h)
        pred_anom = intercept + slope * (n - 1 + h) + (phi**h) * residuals[-1]
        out.append(_clamp_physical(variable, clim[target_mo] + pred_anom))
    return out


def model_regularised_ar(ym: list[tuple[int, int]], train: list[float], horizon: int, variable: str) -> list[float]:
    """Ridge-regularised autoregression on deseasonalized monthly anomalies and seasonal harmonics."""
    n = len(train)
    max_lag = 12
    if n - max_lag < 24:
        return model_seasonal_naive(ym, train, horizon, variable)

    clim = _month_means(ym, train)
    anoms = [v - clim[mo] for (_, mo), v in zip(ym, train)]

    start_idx = max(max_lag, n - 240)
    x_rows: list[list[float]] = []
    y_vals: list[float] = []
    for t in range(start_idx, n):
        _, mo = ym[t]
        angle = 2.0 * math.pi * (mo - 1) / 12.0
        x_rows.append(
            [
                t / float(n),
                anoms[t - 1],
                anoms[t - 2],
                anoms[t - 3],
                anoms[t - 12],
                math.sin(angle),
                math.cos(angle),
            ]
        )
        y_vals.append(anoms[t])

    try:
        model = fit_ridge(x_rows, y_vals, lam=6.0)
    except ValueError:
        return model_seasonal_trend_ar1(ym, train, horizon, variable)

    hist_anoms = list(anoms)
    last_yr, last_mo = ym[-1]
    out: list[float] = []
    for step in range(1, horizon + 1):
        t_idx = n - 1 + step
        _, target_mo = _advance_month(last_yr, last_mo, step)
        angle = 2.0 * math.pi * (target_mo - 1) / 12.0
        feat = [
            t_idx / float(n),
            hist_anoms[-1],
            hist_anoms[-2],
            hist_anoms[-3],
            hist_anoms[-12],
            math.sin(angle),
            math.cos(angle),
        ]
        pred_anom = model.predict(feat)
        hist_anoms.append(pred_anom)
        out.append(_clamp_physical(variable, clim[target_mo] + pred_anom))
    return out


def model_monthly_ensemble(ym: list[tuple[int, int]], train: list[float], horizon: int, variable: str) -> list[float]:
    """Deterministic ensemble of harmonic damped trend, regularised AR, and seasonal trend+AR(1)."""
    m1 = model_harmonic_damped_trend(ym, train, horizon, variable)
    m2 = model_regularised_ar(ym, train, horizon, variable)
    m3 = model_seasonal_trend_ar1(ym, train, horizon, variable)
    return [_clamp_physical(variable, (a + b + c) / 3.0) for a, b, c in zip(m1, m2, m3)]


MONTHLY_MODELS = [
    {"id": "seasonal_naive", "label": "Seasonal naive (same month last year)", "kind": "baseline", "fn": model_seasonal_naive},
    {"id": "harmonic_damped_trend", "label": "Harmonic seasonality + damped trend", "kind": "statistical", "fn": model_harmonic_damped_trend},
    {"id": "regularised_ar", "label": "Regularised seasonal autoregression (Ridge)", "kind": "learned", "fn": model_regularised_ar},
    {"id": "seasonal_trend_ar1", "label": "Seasonal trend + AR(1) persistence", "kind": "statistical", "fn": model_seasonal_trend_ar1},
    {"id": "monthly_ensemble", "label": "Seasonal trend + Ridge AR ensemble", "kind": "ensemble", "fn": model_monthly_ensemble},
]


def _conformal_quantile(abs_errors: list[float], coverage: float = NOMINAL_COVERAGE) -> float | None:
    m = len(abs_errors)
    if m < 4:
        return None
    k = min(m, math.ceil((m + 1) * coverage))
    return sorted(abs_errors)[k - 1]


def _empty_calibration(horizons: int) -> dict:
    """The calibration object when no backtest ran. Same keys as a scored one (A10), with nothing measured."""
    return {
        "nominal_coverage": NOMINAL_COVERAGE,
        "empirical_coverage": None,
        "min_required_coverage": MIN_EMPIRICAL_COVERAGE,
        "n_test_origins": 0,
        "n_test_pairs": 0,
        "interval_half_width_by_horizon": [None] * int(horizons),
        "passed": False,
    }


def evaluate_monthly_series(
    ym: list[tuple[int, int]],
    values: list[float],
    variable: str,
    horizons: int = MAX_FORECAST_HORIZON,
) -> dict:
    """Run rolling-origin backtests on one monthly series and check the V2 quality gate."""
    n = len(values)
    if n < MIN_FORECAST_MONTHS:
        return {
            "eligible": False,
            "reason_code": "insufficient_history",
            "reason": (
                f"Forecast withheld: only {n} contiguous valid months were found; "
                f"at least {MIN_FORECAST_MONTHS} months (10 years) are required for seasonal backtesting."
            ),
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": _empty_calibration(horizons),
            "training_range": (
                {"start_month": _format_ym(*ym[0]), "end_month": _format_ym(*ym[-1]), "n_months": n}
                if ym
                else None
            ),
            "forecasts": [],
        }

    if max(values) - min(values) <= 1e-9:
        return {
            "eligible": False,
            "reason_code": "constant_series",
            "reason": "Forecast withheld: the historical series has near-zero variation here.",
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": _empty_calibration(horizons),
            "training_range": {"start_month": _format_ym(*ym[0]), "end_month": _format_ym(*ym[-1]), "n_months": n},
            "forecasts": [],
        }

    # A11: defensive only. With MIN_FORECAST_MONTHS = 120 and horizons <= 3, n - 72 - horizons >= 45 > BACKTEST_ORIGINS, so
    # this branch cannot be reached with today's constants. It is kept (and its reason_code stays in the contract) so that
    # lowering MIN_FORECAST_MONTHS or raising the horizon can never silently run a backtest with too few origins.
    max_origins = min(BACKTEST_ORIGINS, n - 72 - horizons)
    if max_origins < MIN_BACKTEST_ORIGINS:
        return {
            "eligible": False,
            "reason_code": "insufficient_backtest_origins",
            "reason": "Forecast withheld: not enough backtest origins to verify 1–3 month skill.",
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": _empty_calibration(horizons),
            "training_range": {"start_month": _format_ym(*ym[0]), "end_month": _format_ym(*ym[-1]), "n_months": n},
            "forecasts": [],
        }

    origins = list(range(n - max_origins - horizons + 1, n - horizons + 1))

    preds: dict[str, dict[int, list[float]]] = {
        m["id"]: {o: m["fn"](ym[:o], values[:o], horizons, variable) for o in origins}
        for m in MONTHLY_MODELS
    }

    errors: dict[str, list[tuple[int, int, float]]] = {}
    for m in MONTHLY_MODELS:
        mid = m["id"]
        e_list: list[tuple[int, int, float]] = []
        for o in origins:
            for h in range(1, horizons + 1):
                target_idx = o + h - 1
                if target_idx < n:
                    e_list.append((o, h, preds[mid][o][h - 1] - values[target_idx]))
        errors[mid] = e_list

    def _mae(mid: str, h: int | None = None) -> float:
        vals = [abs(e) for (_, hh, e) in errors[mid] if h is None or hh == h]
        return mean(vals) if vals else 0.0

    def _rmse(mid: str, h: int | None = None) -> float:
        vals = [e * e for (_, hh, e) in errors[mid] if h is None or hh == h]
        return math.sqrt(mean(vals)) if vals else 0.0

    base_mae = _mae("seasonal_naive")
    base_by_h = [_mae("seasonal_naive", h) for h in range(1, horizons + 1)]

    scoreboard: list[dict] = []
    for m in MONTHLY_MODELS:
        mid = m["id"]
        overall_mae = _mae(mid)
        overall_rmse = _rmse(mid)
        mae_h = [_mae(mid, h) for h in range(1, horizons + 1)]
        rmse_h = [_rmse(mid, h) for h in range(1, horizons + 1)]
        skill_overall = 1.0 - (overall_mae / base_mae) if base_mae > 1e-12 else 0.0
        skill_h = [1.0 - (mh / bh) if bh > 1e-12 else 0.0 for mh, bh in zip(mae_h, base_by_h)]
        scoreboard.append(
            {
                "id": mid,
                "label": m["label"],
                "kind": m["kind"],
                "mae": round(overall_mae, 4),
                "rmse": round(overall_rmse, 4),
                "mae_by_horizon": [round(x, 4) for x in mae_h],
                "rmse_by_horizon": [round(x, 4) for x in rmse_h],
                "skill_vs_seasonal_naive": round(skill_overall, 4),
                "skill_by_horizon": [round(x, 4) for x in skill_h],
                "beats_baseline_all_horizons": m["kind"] != "baseline" and all(x > 0.0 for x in skill_h),
                "is_selected": False,
            }
        )

    non_baseline = [s for s in scoreboard if s["kind"] != "baseline"]
    best = min(non_baseline, key=lambda s: (s["mae"], [m["id"] for m in MONTHLY_MODELS].index(s["id"])))
    best_id = best["id"]

    # Check whether best model beats seasonal_naive overall AND on every requested horizon
    beats_overall = best["mae"] < base_mae and best["skill_vs_seasonal_naive"] >= SKILL_MARGIN
    beats_each_horizon = all(
        best["mae_by_horizon"][h - 1] < base_by_h[h - 1] for h in range(1, horizons + 1)
    )

    for s in scoreboard:
        if beats_overall and beats_each_horizon:
            s["is_selected"] = s["id"] == best_id
        else:
            s["is_selected"] = s["id"] == "seasonal_naive"

    # Split-conformal calibration check on the candidate winner
    abs_by_h = {
        h: [(o, abs(e)) for (o, hh, e) in errors[best_id] if hh == h]
        for h in range(1, horizons + 1)
    }
    q_full = {h: _conformal_quantile([e for _, e in rows], NOMINAL_COVERAGE) for h, rows in abs_by_h.items()}

    cut_idx = max(4, math.floor(len(origins) * CALIBRATION_SPLIT))
    cut_origin = origins[min(cut_idx, len(origins) - 2)]
    hits = total_test = 0
    test_origins: set[int] = set()
    for h, rows in abs_by_h.items():
        q_cal = _conformal_quantile([e for o, e in rows if o <= cut_origin], NOMINAL_COVERAGE)
        if q_cal is None:
            continue
        for o, e in rows:
            if o > cut_origin:
                total_test += 1
                test_origins.add(o)
                if e <= q_cal:
                    hits += 1

    emp_cov = round(hits / total_test, 4) if total_test > 0 else None
    cov_passed = emp_cov is not None and emp_cov >= MIN_EMPIRICAL_COVERAGE

    calibration = {
        "nominal_coverage": NOMINAL_COVERAGE,
        "empirical_coverage": emp_cov,
        "min_required_coverage": MIN_EMPIRICAL_COVERAGE,
        # n_test_origins = distinct held-out origins; n_test_pairs = scored (origin, horizon) pairs (A10: the old
        # "n_test_origins" actually counted pairs).
        "n_test_origins": len(test_origins),
        "n_test_pairs": total_test,
        "interval_half_width_by_horizon": [
            round(q_full[h], 4) if q_full[h] is not None else None for h in range(1, horizons + 1)
        ],
        "passed": cov_passed,
    }

    training_range = {
        "start_month": _format_ym(*ym[0]),
        "end_month": _format_ym(*ym[-1]),
        "n_months": n,
        "n_backtest_origins": len(origins),
    }

    if not (beats_overall and beats_each_horizon):
        return {
            "eligible": False,
            "reason_code": "no_skill_over_seasonal_naive",
            "reason": (
                f"Forecast withheld: the best candidate model ({best['label']}) did not beat the "
                f"seasonal-naive baseline across all 1–{horizons} month rolling backtests "
                f"(overall skill {best['skill_vs_seasonal_naive'] * 100:+.1f}%)."
            ),
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": scoreboard,
            "calibration": calibration,
            "training_range": training_range,
            "forecasts": [],
        }

    if not cov_passed:
        return {
            "eligible": False,
            "reason_code": "poor_calibration_coverage",
            "reason": (
                f"Forecast withheld: out-of-sample prediction interval coverage ({emp_cov}) fell below "
                f"the minimum calibration threshold ({MIN_EMPIRICAL_COVERAGE})."
            ),
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": scoreboard,
            "calibration": calibration,
            "training_range": training_range,
            "forecasts": [],
        }

    clim = _month_means(ym, values)
    winner_fn = next(m["fn"] for m in MONTHLY_MODELS if m["id"] == best_id)
    point_preds = winner_fn(ym, values, horizons, variable)
    last_yr, last_mo = ym[-1]

    forecasts = []
    for h, val in enumerate(point_preds, start=1):
        f_yr, f_mo = _advance_month(last_yr, last_mo, h)
        q = q_full[h] or 0.0
        lo = _clamp_physical(variable, val - q)
        hi = _clamp_physical(variable, val + q)
        anom = val - clim[f_mo]
        forecasts.append(
            {
                "horizon": h,
                "year": f_yr,
                "month_num": f_mo,
                "month": _format_ym(f_yr, f_mo),
                "stamp": _format_stamp(f_yr, f_mo),
                "label": _month_label(f_yr, f_mo),
                "value": round(val, 4),
                "anomaly": round(anom, 4),
                "lo": round(lo, 4),
                "hi": round(hi, 4),
            }
        )

    return {
        "eligible": True,
        "reason_code": "eligible",
        "reason": None,
        "selected_model": best_id,
        "selected_model_label": best["label"],
        "baseline_model": "seasonal_naive",
        "models": scoreboard,
        "calibration": calibration,
        "training_range": training_range,
        "forecasts": forecasts,
    }


async def build_monthly_forecast(
    variable: str,
    lat: float,
    lon: float,
    start_year: int = analysis.FIRST_YEAR,
    end_year: int | None = None,
    *,
    horizons: int = MAX_FORECAST_HORIZON,
    n: int = 3,
    size: float = DEFAULT_MONTHLY_GRID_SIZE_DEG,
) -> dict:
    """Evaluate and produce 1–3 month forecast frames for T2M, PRECTOTCORR, or CLOUD_AMT on a local grid."""
    if end_year is None:
        end_year = date.today().year - 1
    info = VARIABLES[variable]
    grid_meta = _grid_coordinates(lat, lon, size, n)

    if variable not in FORECAST_VARIABLES:
        return {
            "variable": {"id": variable, **info},
            "location": {"lat": lat, "lon": lon},
            "supported_variables": list(FORECAST_VARIABLES),
            "eligible": False,
            "reason_code": "unsupported_variable",
            "reason": (
                f"Forecast withheld: monthly forecasting is only enabled for Air temperature (T2M), "
                f"Rainfall and snowfall (PRECTOTCORR), and Cloud cover (CLOUD_AMT), not {info['label']} ({variable})."
            ),
            "horizons_requested": horizons,
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": None,
            "training_range": None,
            "alignment": None,
            "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
            "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
            "cells": [],
            "frames": [],
        }

    cfg = load_config()
    limiter = asyncio.Semaphore(cfg.nasa_max_concurrency)

    async def _fetch_cell(cell: dict) -> dict:
        async with limiter:
            try:
                series_map = await analysis.fetch_monthly_multi(
                    [variable], cell["lat"], cell["lon"], start_year, end_year
                )
                return {**cell, "ok": True, "series": series_map.get(variable, {}), "error": None}
            except PowerError as exc:
                return {**cell, "ok": False, "series": {}, "error": str(exc)}

    fetched = await asyncio.gather(*(_fetch_cell(c) for c in grid_meta))
    failed_cells = [c for c in fetched if not c["ok"]]

    if len(failed_cells) == len(fetched):
        raise PowerError(failed_cells[0]["error"] or "Could not reach NASA POWER.")

    if failed_cells:
        return {
            "variable": {"id": variable, **info},
            "location": {"lat": lat, "lon": lon},
            "supported_variables": list(FORECAST_VARIABLES),
            "eligible": False,
            "reason_code": "grid_cell_failure",
            "reason": (
                f"Forecast withheld: {len(failed_cells)} of {len(fetched)} local grid cells failed to load from NASA POWER. "
                "Forecasts are disabled when any local grid cell is incomplete rather than interpolating missing cells."
            ),
            "horizons_requested": horizons,
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": None,
            "training_range": None,
            "alignment": None,
            "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
            "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
            "cells": [
                {"cell_id": c["cell_id"], "row": c["row"], "col": c["col"], "lat": c["lat"], "lon": c["lon"], "ok": c["ok"], "error": c["error"]}
                for c in fetched
            ],
            "frames": [],
        }

    # Check missingness and extract contiguous series per cell
    cell_records: list[dict] = []
    for c in fetched:
        ym, vals, valid_cnt, expected_cnt = _extract_contiguous_monthly(c["series"], start_year, end_year)
        miss_frac = (expected_cnt - valid_cnt) / expected_cnt if expected_cnt > 0 else 1.0
        cell_records.append(
            {
                **c,
                "ym": ym,
                "vals": vals,
                "valid_months": valid_cnt,
                "expected_months": expected_cnt,
                "missing_fraction": round(miss_frac, 4),
            }
        )

    # A2: every cell must forecast the SAME calendar months. Each cell's series ends at its own last valid month, so trim
    # all of them to the earliest common last month before any backtest; otherwise a frame labelled "2025-01" could hold
    # some cells' 2024-12 forecast.
    ends = [c["ym"][-1] for c in cell_records if c["ym"]]
    common_end = min(ends) if ends else None
    trimmed_cells = 0
    if common_end is not None:
        for c in cell_records:
            if c["ym"] and c["ym"][-1] > common_end:
                keep = sum(1 for ym_pair in c["ym"] if ym_pair <= common_end)
                c["ym"], c["vals"] = c["ym"][:keep], c["vals"][:keep]
                trimmed_cells += 1
    alignment = {
        "common_end_month": _format_ym(*common_end) if common_end else None,
        "cells_trimmed_to_common_end": trimmed_cells,
    }

    sparse_cells = [
        c for c in cell_records if len(c["vals"]) < MIN_FORECAST_MONTHS or c["missing_fraction"] > MAX_MISSING_FRACTION
    ]
    if sparse_cells:
        worst = sparse_cells[0]
        return {
            "variable": {"id": variable, **info},
            "location": {"lat": lat, "lon": lon},
            "supported_variables": list(FORECAST_VARIABLES),
            "eligible": False,
            "reason_code": "sparse_monthly_data",
            "reason": (
                f"Forecast withheld: cell {worst['cell_id']} at ({worst['lat']}, {worst['lon']}) has only "
                f"{len(worst['vals'])} contiguous valid months (missing fraction {worst['missing_fraction'] * 100:.1f}%). "
                f"At least {MIN_FORECAST_MONTHS} contiguous months with <= {MAX_MISSING_FRACTION * 100:.0f}% missingness are required."
            ),
            "horizons_requested": horizons,
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": None,
            "training_range": None,
            "alignment": alignment,
            "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
            "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
            "cells": [
                {
                    "cell_id": c["cell_id"],
                    "row": c["row"],
                    "col": c["col"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "ok": True,
                    "contiguous_months": len(c["vals"]),
                    "missing_fraction": c["missing_fraction"],
                }
                for c in cell_records
            ],
            "frames": [],
        }

    # Evaluate each cell with rolling-origin backtests. This is pure-Python CPU work (over a second for a 3 x 3 grid), so it
    # runs in a worker thread (A5): the event loop keeps serving other requests, health checks included, meanwhile.
    def _evaluate_all() -> list[dict]:
        return [evaluate_monthly_series(c["ym"], c["vals"], variable, horizons=horizons) for c in cell_records]

    cell_evals = await asyncio.to_thread(_evaluate_all)
    center_idx = len(cell_records) // 2
    primary_eval = cell_evals[center_idx]

    ineligible_idx = next((i for i, ev in enumerate(cell_evals) if not ev["eligible"]), None)
    if ineligible_idx is not None:
        failed_ev = cell_evals[ineligible_idx]
        failed_cell = cell_records[ineligible_idx]
        return {
            "variable": {"id": variable, **info},
            "location": {"lat": lat, "lon": lon},
            "supported_variables": list(FORECAST_VARIABLES),
            "eligible": False,
            "reason_code": failed_ev["reason_code"],
            "reason": failed_ev["reason"],
            "horizons_requested": horizons,
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            # A10: the scoreboard, calibration and training range all describe the cell that failed (failed_cell_id),
            # never the centre cell's numbers next to another cell's reason.
            "models": failed_ev["models"],
            "calibration": failed_ev["calibration"],
            "training_range": failed_ev["training_range"],
            "alignment": alignment,
            "failed_cell_id": failed_cell["cell_id"],
            "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
            "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
            "cells": [
                {
                    "cell_id": c["cell_id"],
                    "row": c["row"],
                    "col": c["col"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "ok": True,
                    "eligible": ev["eligible"],
                    "selected_model": ev["selected_model"],
                    "reason": ev["reason"],
                }
                for c, ev in zip(cell_records, cell_evals)
            ],
            "frames": [],
        }

    # Defensive second check for A2: after trimming, every cell's forecast months must match the reference cell's.
    ref_months = [fc["month"] for fc in primary_eval["forecasts"]]
    misaligned = [
        c["cell_id"] for c, ev in zip(cell_records, cell_evals) if [fc["month"] for fc in ev["forecasts"]] != ref_months
    ]
    if misaligned:
        return {
            "variable": {"id": variable, **info},
            "location": {"lat": lat, "lon": lon},
            "supported_variables": list(FORECAST_VARIABLES),
            "eligible": False,
            "reason_code": "misaligned_cells",
            "reason": (
                "Forecast withheld: local grid cells would forecast different calendar months "
                f"({', '.join(misaligned)} differ from the centre cell), so frames cannot be labelled honestly."
            ),
            "horizons_requested": horizons,
            "selected_model": None,
            "selected_model_label": None,
            "baseline_model": "seasonal_naive",
            "models": [],
            "calibration": None,
            "training_range": None,
            "alignment": alignment,
            "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
            "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
            "cells": [
                {"cell_id": c["cell_id"], "row": c["row"], "col": c["col"], "lat": c["lat"], "lon": c["lon"], "ok": True}
                for c in cell_records
            ],
            "frames": [],
        }

    # All cells passed the quality gate: assemble forecast frames for horizons 1..H
    frames: list[dict] = []
    for h_idx in range(horizons):
        ref_fc = primary_eval["forecasts"][h_idx]
        frame_cells: list[dict] = []
        vals_h: list[float] = []
        anoms_h: list[float] = []

        for c, ev in zip(cell_records, cell_evals):
            fc = ev["forecasts"][h_idx]
            vals_h.append(fc["value"])
            anoms_h.append(fc["anomaly"])
            frame_cells.append(
                {
                    "cell_id": c["cell_id"],
                    "row": c["row"],
                    "col": c["col"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "value": fc["value"],
                    "anomaly": fc["anomaly"],
                    "lo": fc["lo"],
                    "hi": fc["hi"],
                    "model_id": ev["selected_model"],
                    "missing": False,
                }
            )

        frames.append(
            {
                "horizon": h_idx + 1,
                "month": ref_fc["month"],
                "stamp": ref_fc["stamp"],
                "year": ref_fc["year"],
                "month_num": ref_fc["month_num"],
                "label": ref_fc["label"],
                "kind": "forecast",
                "badge": "Forecast — not observed data",
                "valid_cells": len(frame_cells),
                "missing_cells": 0,
                "mean_value": round(mean(vals_h), 4) if vals_h else None,
                "mean_anomaly": round(mean(anoms_h), 4) if anoms_h else None,
                "cells": frame_cells,
            }
        )

    return {
        "variable": {"id": variable, **info},
        "location": {"lat": lat, "lon": lon},
        "supported_variables": list(FORECAST_VARIABLES),
        "eligible": True,
        "reason_code": "eligible",
        "reason": None,
        "label": "Forecast — not observed data",
        "horizons_requested": horizons,
        "selected_model": primary_eval["selected_model"],
        "selected_model_label": primary_eval["selected_model_label"],
        "baseline_model": "seasonal_naive",
        "models": primary_eval["models"],
        "calibration": primary_eval["calibration"],
        "training_range": primary_eval["training_range"],
        "alignment": alignment,
        "grid": {"n": n, "size_degrees": size, "total_cells": len(grid_meta)},
        "provenance": _provenance_block(variable, start_year, end_year, is_forecast=True),
        "cells": [
            {
                "cell_id": c["cell_id"],
                "row": c["row"],
                "col": c["col"],
                "lat": c["lat"],
                "lon": c["lon"],
                "ok": True,
                "eligible": True,
                "selected_model": ev["selected_model"],
                "selected_model_label": ev["selected_model_label"],
                "forecasts": ev["forecasts"],
            }
            for c, ev in zip(cell_records, cell_evals)
        ],
        "frames": frames,
    }
