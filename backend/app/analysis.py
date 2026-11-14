"""Turns monthly series (NASA POWER or the public planet streams) into a full "case file" of trend evidence.

For one series this module produces:
  * annual means, monthly anomalies (seasonal cycle removed) and a 12-month average
  * Sen's slope with a 95% interval, Mann-Kendall significance, and a regression t-test
  * signal vs noise (how big the change is compared with normal year-to-year swings)
  * a 12-month "fingerprint" (which calendar months drive the trend)
  * trend emergence (how the evidence builds as years are added)
  * robustness checks (trimming years from either end) and a transparent evidence grade
  * a shape check: is it a steady ramp, or more like a step change?
"""

from __future__ import annotations

import math
from statistics import mean

from .nasa_power import VARIABLES, annual_means, fetch_monthly_multi
from .stats import benjamini_hochberg, best_step, mann_kendall, mk_z_and_p, ols, pettitt, sample_std

FIRST_YEAR = 1981            # first year of NASA POWER monthly data
MIN_YEARS = 20               # a trend over fewer complete years is not meaningful
ALPHA = 0.05
EMERGENCE_MIN_YEARS = 10
TRIM_YEARS = 5
MIN_TRIMMED_YEARS = 15
MIN_MONTH_VALUES = 15
MONTH_AGREEMENT_TARGET = 0.75
SIGNAL_TO_NOISE_TARGET = 1.0
STEP_ADVANTAGE = 0.05        # a step must explain this much more variance than a line to be called step-like

GRADE_LABELS = {
    "strong": "Strong evidence",
    "moderate": "Moderate evidence",
    "weak": "Weak evidence",
    "none": "No clear evidence",
}

BASE_CAVEATS = [
    "Trends are straight-line summaries of annual averages. They cannot capture cycles, sudden jumps or curved change.",
    "NASA POWER blends satellite observations with computer models (reanalysis) on a grid about half a degree wide, "
    "so points that are close together can share the same values.",
    "A significant trend shows a consistent direction over this period, not its cause. "
    "A different start or end year can change the answer.",
]


class AnalysisError(Exception):
    """A location cannot be analyzed (for example, too little data)."""


# --------------------------------------------------------------------------- formatting helpers


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _num(v: float) -> str:
    """Signed number with about three significant digits."""
    if v == 0:
        return "0"
    if abs(v) >= 1000:
        return f"{v:+,.0f}"
    if abs(v) < 1e-4:
        return f"{v:+.2e}"
    return f"{v:+.3g}"


def _p(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


def _round(v: float | None, digits: int = 4) -> float | None:
    if v is None or math.isinf(v) or math.isnan(v):
        return None
    return round(v, digits)


# --------------------------------------------------------------------------- monthly products


def _monthly_records(monthly: dict[str, float | None]) -> list[tuple[int, int, float]]:
    records = []
    for stamp in sorted(monthly):
        value = monthly[stamp]
        if value is not None:
            records.append((int(stamp[:4]), int(stamp[4:]), value))
    return records


def _climatology(records: list[tuple[int, int, float]]) -> dict[int, float]:
    sums: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for _, month, value in records:
        sums[month].append(value)
    return {m: mean(vals) for m, vals in sums.items() if vals}


def _month_time(year: int, month: int) -> float:
    return year + (month - 0.5) / 12.0


def _rolling_12(monthly: dict[str, float | None], clim: dict[int, float]) -> list[dict]:
    """12-month average of anomalies, centered on the window; only full, gap-free windows."""
    stamps = sorted(monthly)
    anomalies = []
    for stamp in stamps:
        value = monthly[stamp]
        month = int(stamp[4:])
        anomalies.append(None if value is None or month not in clim else value - clim[month])
    out = []
    for i in range(11, len(stamps)):
        window = anomalies[i - 11 : i + 1]
        if any(v is None for v in window):
            continue
        first, last = stamps[i - 11], stamps[i]
        t = (_month_time(int(first[:4]), int(first[4:])) + _month_time(int(last[:4]), int(last[4:]))) / 2
        out.append({"t": round(t, 3), "v": round(sum(window) / 12.0, 4)})
    return out


# --------------------------------------------------------------------------- evidence components


def _fingerprint(records: list[tuple[int, int, float]]) -> list[dict]:
    """Trend of each calendar month on its own (which months drive the change)."""
    by_month: dict[int, list[tuple[int, float]]] = {m: [] for m in range(1, 13)}
    for year, month, value in records:
        by_month[month].append((year, value))

    rows: list[dict] = []
    tested: list[int] = []
    p_values: list[float] = []
    for month in range(1, 13):
        pairs = by_month[month]
        if len(pairs) < MIN_MONTH_VALUES:
            rows.append({"month": month, "ok": False, "significant": False})
            continue
        res = mann_kendall([v for _, v in pairs], [float(y) for y, _ in pairs])
        rows.append(
            {
                "month": month,
                "ok": True,
                "n": len(pairs),
                "slope_per_decade": res.sens_slope * 10,
                "p_value": res.p_value,
                "sign": _sign(res.sens_slope),
                "significant": False,
            }
        )
        tested.append(len(rows) - 1)
        p_values.append(res.p_value)
    # 12 simultaneous tests: control the false-discovery rate.
    for idx, flag in zip(tested, benjamini_hochberg(p_values, ALPHA)):
        rows[idx]["significant"] = flag
    return rows


def _emergence(years: list[int], values: list[float]) -> tuple[list[dict], int | None]:
    """Mann-Kendall z-score as years are added; the year after which significance holds."""
    series = []
    for k in range(EMERGENCE_MIN_YEARS, len(values) + 1):
        z, p = mk_z_and_p(values[:k])
        series.append({"end_year": years[k - 1], "z": z, "p": p})
    emergence_year = None
    if series and series[-1]["p"] < ALPHA:
        idx = len(series) - 1
        while idx > 0 and series[idx - 1]["p"] < ALPHA:
            idx -= 1
        emergence_year = series[idx]["end_year"]
    return series, emergence_year


def _robustness(years: list[int], values: list[float], full_sign: int) -> list[dict]:
    """Re-run the trend after trimming years from either end (is it an endpoint artifact?)."""
    specs = [
        (f"Without the first {TRIM_YEARS} years", TRIM_YEARS, 0),
        (f"Without the last {TRIM_YEARS} years", 0, TRIM_YEARS),
        (f"Without {TRIM_YEARS} years at each end", TRIM_YEARS, TRIM_YEARS),
    ]
    out = []
    for label, cut_start, cut_end in specs:
        yrs = years[cut_start : len(years) - cut_end]
        vals = values[cut_start : len(values) - cut_end]
        if len(vals) < MIN_TRIMMED_YEARS:
            continue
        res = mann_kendall(vals, [float(y) for y in yrs])
        out.append(
            {
                "label": label,
                "start_year": yrs[0],
                "end_year": yrs[-1],
                "n_years": len(vals),
                "slope_per_decade": res.sens_slope * 10,
                "p_value": res.p_value,
                "significant": res.significant,
                "same_direction": full_sign != 0 and _sign(res.sens_slope) == full_sign,
            }
        )
    return out


def _shape(years: list[int], values: list[float], r2_line: float, significant_trend: bool) -> dict:
    """Is the record a steady ramp, a step change, or neither? (Pettitt test plus step-vs-line fit.)"""
    _, pettitt_p = pettitt(values)
    step = best_step(values)
    out = {
        "label": "unclear",
        "pettitt_p": pettitt_p,
        "r2_line": r2_line,
        "r2_step": None,
        "step_year": None,
        "mean_before": None,
        "mean_after": None,
    }
    if step is not None:
        out.update(r2_step=step.r2, step_year=years[step.split], mean_before=step.mean_before, mean_after=step.mean_after)
    if step is not None and pettitt_p < ALPHA and step.r2 > r2_line + STEP_ADVANTAGE:
        out["label"] = "step"
    elif significant_trend:
        out["label"] = "steady"
    return out


def _grade(p_value: float, significant: bool, passed: int, total: int) -> str:
    if p_value < 0.01 and passed == total:
        return "strong"
    if significant and passed >= total - 1:
        return "moderate"
    if significant or (p_value < 0.10 and passed >= total - 2):
        return "weak"
    return "none"


# --------------------------------------------------------------------------- annual core


def annual_core(info: dict, years: list[int], values: list[float]) -> dict:
    """Trend statistics for an annual series. Shared by single places, composites and planet streams."""
    times = [float(y) for y in years]
    mk = mann_kendall(values, times, alpha=ALPHA)
    ols_res = ols(values, times, alpha=ALPHA, variance_factor=mk.variance_factor)

    t0 = times[0]
    span = years[-1] - years[0]
    total_change = mk.sens_slope * span
    residuals = [v - (mk.sens_intercept + mk.sens_slope * (t - t0)) for v, t in zip(values, times)]
    noise_sd = sample_std(residuals)
    snr = total_change / noise_sd if noise_sd > 0 else None
    mean_value = mean(values)
    percent_of_mean = total_change / mean_value * 100.0 if info.get("ratio") and mean_value > 0 else None
    sign = "up" if mk.sens_slope > 0 else "down" if mk.sens_slope < 0 else "flat"

    stats = {
        "n_years": mk.n,
        "mann_kendall_s": mk.s,
        "z": mk.z,
        "p_value": mk.p_value,
        "p_naive": mk.p_naive,
        "alpha": ALPHA,
        "significant": mk.significant,
        "direction": mk.direction,
        "sign": sign,
        "slope_per_year": mk.sens_slope,
        "slope_per_decade": mk.sens_slope * 10,
        "ci_low_per_decade": mk.sens_ci_low * 10,
        "ci_high_per_decade": mk.sens_ci_high * 10,
        "total_change": total_change,
        "span_years": span,
        "percent_of_mean": percent_of_mean,
        "noise_sd": noise_sd,
        "signal_to_noise": snr,
        "mean_value": mean_value,
        "autocorr": {"r1": mk.r1, "adjusted": mk.variance_factor > 1.0, "factor": mk.variance_factor},
    }
    ols_block = {
        "slope_per_decade": ols_res.slope * 10,
        "se_per_decade": ols_res.se * 10,
        "ci_low_per_decade": ols_res.ci_low * 10,
        "ci_high_per_decade": ols_res.ci_high * 10,
        "t": _round(ols_res.t),
        "df": ols_res.df,
        "p_value": ols_res.p_value,
        "r2": ols_res.r2,
        "significant": ols_res.significant,
    }
    return {"mk": mk, "ols": ols_res, "stats": stats, "ols_block": ols_block, "snr": snr, "total_change": total_change}


# --------------------------------------------------------------------------- main assembly


def _summary(info, where, years, mk, total_change, snr, grade_label, passed, total) -> str:
    unit = info["units"]
    span = f"{years[0]}–{years[-1]}"
    rate = (
        f"{_num(mk.sens_slope * 10)} {unit} per decade "
        f"(95% range {_num(mk.sens_ci_low * 10)} to {_num(mk.sens_ci_high * 10)})"
    )
    if mk.significant and mk.sens_slope != 0:
        verb = "rose" if mk.sens_slope > 0 else "fell"
        text = f"{info['label']} {where} {verb} over {span}: {rate}, about {_num(total_change)} {unit} in total."
        if snr is not None:
            text += f" That change is roughly {abs(snr):.1f}× the normal year-to-year swing."
    else:
        text = (
            f"{info['label']} {where} shows no statistically significant trend over {span}. "
            f"The best estimate is {rate}, but the data are too variable to be confident in it."
        )
    return f"{text} {grade_label} ({passed} of {total} checks passed)."


def analyze_series(
    variable: str,
    lat: float | None,
    lon: float | None,
    monthly: dict[str, float | None],
    start_year: int,
    end_year: int,
    detail: bool = True,
    info: dict | None = None,
    where: str | None = None,
) -> dict:
    """Full analysis of one series' monthly values. Raises AnalysisError when it cannot be analyzed.

    `info` and `where` let planet-wide streams (not tied to a POWER variable or a point) reuse this engine.
    """
    info = info or VARIABLES[variable]
    if where is None:
        where = f"at ({lat:.2f}, {lon:.2f})" if lat is not None and lon is not None else "worldwide"
    annual = annual_means(monthly)
    valid_months = sum(1 for v in monthly.values() if v is not None)

    if len(annual) < MIN_YEARS:
        if valid_months == 0 and info.get("land_only"):
            raise AnalysisError(f"{info['label']} is only measured over land; this point has no data.")
        raise AnalysisError(
            f"Only {len(annual)} complete years of data were found here; at least {MIN_YEARS} are needed."
        )

    years = list(annual.keys())
    values = list(annual.values())
    if max(values) - min(values) <= 1e-12:
        raise AnalysisError(f"{info['label']} does not vary here (for example, no snowfall at this latitude).")

    core = annual_core(info, years, values)
    mk, ols_res, stats, snr = core["mk"], core["ols"], core["stats"], core["snr"]
    total_change = core["total_change"]

    expected_months = (end_year - start_year + 1) * 12
    quality = {
        "years_used": len(years),
        "years_requested": end_year - start_year + 1,
        "valid_months": valid_months,
        "expected_months": expected_months,
    }
    result: dict = {
        "variable": {"id": variable, **info},
        "location": {"lat": lat, "lon": lon},
        "period": {"start_year": years[0], "end_year": years[-1]},
        "quality": quality,
        "stats": stats,
        "ols": core["ols_block"],
        "annual": [{"year": y, "value": v} for y, v in zip(years, values)],
    }
    if not detail:
        return result

    times = [float(y) for y in years]
    t0 = times[0]
    records = _monthly_records(monthly)
    clim = _climatology(records)
    fingerprint = _fingerprint(records)
    ok_months = [row for row in fingerprint if row["ok"]]
    full_sign = _sign(mk.sens_slope)
    agree = sum(1 for row in ok_months if full_sign != 0 and row["sign"] == full_sign)
    emergence_series, emergence_year = _emergence(years, values)
    robustness = _robustness(years, values, full_sign)
    shape = _shape(years, values, ols_res.r2, mk.significant)

    ols_agrees = ols_res.significant and _sign(ols_res.slope) == full_sign
    month_fraction = agree / len(ok_months) if ok_months else 0.0
    n_same_dir = sum(1 for w in robustness if w["same_direction"])
    n_sig = sum(1 for w in robustness if w["significant"])
    stable = bool(robustness) and n_same_dir == len(robustness) and (n_sig == len(robustness) or not mk.significant)

    checks = [
        {
            "id": "mk",
            "label": "The Mann–Kendall test is significant",
            "passed": mk.significant,
            "detail": f"p = {_p(mk.p_value)} (needs < {ALPHA})",
        },
        {
            "id": "ols",
            "label": "A straight-line regression (t-test) agrees",
            "passed": ols_agrees,
            "detail": f"slope {_num(ols_res.slope * 10)} {info['units']}/decade, p = {_p(ols_res.p_value)}",
        },
        {
            "id": "months",
            "label": "Most calendar months move the same way",
            "passed": bool(ok_months) and month_fraction >= MONTH_AGREEMENT_TARGET,
            "detail": f"{agree} of {len(ok_months)} months share the overall direction",
        },
        {
            "id": "stable",
            "label": f"The trend survives trimming {TRIM_YEARS} years from the ends",
            "passed": stable,
            "detail": (
                f"{n_sig} of {len(robustness)} trimmed versions are still significant; "
                f"{n_same_dir} keep the direction"
                if robustness
                else "not enough years to trim"
            ),
        },
        {
            "id": "noise",
            "label": "The change is bigger than normal year-to-year swings",
            "passed": snr is not None and abs(snr) >= SIGNAL_TO_NOISE_TARGET,
            "detail": f"{abs(snr):.1f}× the typical swing" if snr is not None else "no variation to compare",
        },
    ]
    passed = sum(1 for c in checks if c["passed"])
    grade_code = _grade(mk.p_value, mk.significant, passed, len(checks))
    grade_label = GRADE_LABELS[grade_code]

    caveats = list(BASE_CAVEATS)
    if info.get("note"):
        caveats.insert(0, info["note"])
    if shape["label"] == "step":
        caveats.insert(
            0,
            f"The record looks more like a step change near {shape['step_year']} (average {shape['mean_before']:.3g} → "
            f"{shape['mean_after']:.3g}) than a steady ramp, so a straight-line trend may misdescribe it.",
        )
    if mk.variance_factor > 1.0:
        caveats.insert(
            0,
            f"Neighboring years resemble each other here (autocorrelation {mk.r1:.2f}), so uncertainty was "
            f"widened. The unadjusted p-value would be {_p(mk.p_naive)}.",
        )

    result.update(
        {
            "monthly": [
                {"y": y, "m": m, "v": round(v, 4), "a": round(v - clim[m], 4)} for y, m, v in records
            ],
            "rolling": _rolling_12(monthly, clim),
            "trend_line": {
                "t0": years[0],
                "intercept": mk.sens_intercept,
                "slope_per_year": mk.sens_slope,
                "ci_low_per_year": mk.sens_ci_low,
                "ci_high_per_year": mk.sens_ci_high,
                "pivot_year": mean(times),
                "pivot_value": mk.sens_intercept + mk.sens_slope * (mean(times) - t0),
                "mean_value": stats["mean_value"],
            },
            "fingerprint": fingerprint,
            "month_agreement": {"agree": agree, "total": len(ok_months)},
            "emergence": {"series": emergence_series, "year": emergence_year},
            "robustness": robustness,
            "shape": shape,
            "checks": checks,
            "grade": {"code": grade_code, "label": grade_label, "passed": passed, "total": len(checks)},
            "agreement": {
                "tests_agree": ols_res.significant == mk.significant
                and (not mk.significant or _sign(ols_res.slope) == full_sign),
            },
            "summary": _summary(info, where, years, mk, total_change, snr, grade_label, passed, len(checks)),
            "caveats": caveats,
        }
    )
    return result


# --------------------------------------------------------------------------- I/O wrappers


async def analyze_point(variable: str, lat: float, lon: float, start_year: int, end_year: int, detail: bool = True) -> dict:
    """Fetch one variable at one location and analyze it. Raises AnalysisError or PowerError."""
    series = (await fetch_monthly_multi([variable], lat, lon, start_year, end_year))[variable]
    return analyze_series(variable, lat, lon, series, start_year, end_year, detail)


async def analyze_many(
    variables: list[str], lat: float, lon: float, start_year: int, end_year: int, detail: bool = True
) -> dict[str, dict | AnalysisError]:
    """Analyze several variables at one location with a single NASA POWER request."""
    series = await fetch_monthly_multi(variables, lat, lon, start_year, end_year)
    out: dict[str, dict | AnalysisError] = {}
    for variable in variables:
        try:
            out[variable] = analyze_series(variable, lat, lon, series[variable], start_year, end_year, detail)
        except AnalysisError as exc:
            out[variable] = exc
    return out


def grid_points(lat: float, lon: float, size: float, n: int) -> list[tuple[float, float]]:
    """n x n points centered on (lat, lon) spanning `size` degrees, kept within valid ranges."""

    def axis(center: float, low: float, high: float) -> list[float]:
        start = center - size / 2
        step = size / (n - 1)
        values = [start + i * step for i in range(n)]
        return [round(min(max(v, low), high), 4) for v in values]

    lats = axis(lat, -90.0, 90.0)
    lons = axis(lon, -180.0, 180.0)
    return [(la, lo) for la in lats for lo in lons]
