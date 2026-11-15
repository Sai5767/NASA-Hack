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
from .stats import (
    adjustment_is_material,
    benjamini_hochberg,
    best_step,
    mann_kendall,
    ols,
    pettitt,
    sample_std,
    zero_slope_with_low_p,
)

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
    # 12 simultaneous tests: control the false-discovery rate. A month whose median slope is exactly 0 has no direction,
    # so it never counts as significant (the same rule as the headline test, see stats.mann_kendall).
    for idx, flag in zip(tested, benjamini_hochberg(p_values, ALPHA)):
        rows[idx]["significant"] = flag and rows[idx]["sign"] != 0
    return rows


def _emergence(years: list[int], values: list[float]) -> tuple[list[dict], int | None]:
    """Mann-Kendall z-score as years are added; the year after which significance holds.

    Each prefix is tested exactly like the headline (serial-correlation-adjusted p, and a zero median slope is never
    significant), so the last point equals the headline result and an emergence year exists only when the headline
    trend is significant (docs/STATS_AUDIT.md, B2).
    """
    series = []
    for k in range(EMERGENCE_MIN_YEARS, len(values) + 1):
        res = mann_kendall(values[:k], [float(y) for y in years[:k]], alpha=ALPHA)
        series.append({"end_year": years[k - 1], "z": res.z, "p": res.p_value, "significant": res.significant})
    emergence_year = None
    if series and series[-1]["significant"]:
        idx = len(series) - 1
        while idx > 0 and series[idx - 1]["significant"]:
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
        "autocorr": {"r1": mk.r1, "adjusted": adjustment_is_material(mk.variance_factor), "factor": mk.variance_factor},
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
    if mk.significant:
        verb = "rose" if mk.sens_slope > 0 else "fell"
        text = f"{info['label']} {where} {verb} over {span}: {rate}, about {_num(total_change)} {unit} in total."
        if snr is not None:
            text += f" That change is roughly {abs(snr):.1f}× the normal year-to-year swing."
    elif zero_slope_with_low_p(mk, ALPHA):
        text = (
            f"{info['label']} {where} shows no statistically significant trend over {span}. "
            f"Many years have identical values (for example none at all), so the typical rate of change is {rate}. "
            f"The Mann–Kendall p-value is {_p(mk.p_value)}, but with a median rate of exactly zero no direction can be claimed."
        )
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
            "detail": (
                f"p = {_p(mk.p_value)}, but the median rate is exactly 0 (many tied years), so no trend is claimed"
                if zero_slope_with_low_p(mk, ALPHA)
                else f"p = {_p(mk.p_value)} (needs < {ALPHA})"
            ),
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
    if adjustment_is_material(mk.variance_factor):
        caveats.insert(
            0,
            f"Neighboring years resemble each other here (autocorrelation {mk.r1:.2f}), so uncertainty was "
            f"widened. The unadjusted p-value would be {_p(mk.p_naive)}.",
        )

    summary_text = _summary(info, where, years, mk, total_change, snr, grade_label, passed, len(checks))
    tests_agree = ols_res.significant == mk.significant and (not mk.significant or _sign(ols_res.slope) == full_sign)
    grade_block = {"code": grade_code, "label": grade_label, "passed": passed, "total": len(checks)}
    agreement_block = {"tests_agree": tests_agree}

    from .resilience import make_case_signature

    case_sig = make_case_signature(variable, lat, lon, years[0], years[-1])
    evidence_trace = _build_evidence_trace(
        info=info,
        years=years,
        quality=quality,
        stats=stats,
        ols_block=result["ols"],
        grade_block=grade_block,
        checks=checks,
        ok_months=ok_months,
        month_agree=agree,
        tests_agree=tests_agree,
        summary_text=summary_text,
        caveats=caveats,
    )

    result.update(
        {
            "case_signature": case_sig,
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
            "grade": grade_block,
            "agreement": agreement_block,
            "summary": summary_text,
            "caveats": caveats,
            "evidence_trace": evidence_trace,
        }
    )
    return result


VERDICT_LADDER = [
    {"code": "strong_evidence", "label": "Strong evidence of a trend", "tier": 3},
    {"code": "some_evidence", "label": "Some evidence — investigate carefully", "tier": 2},
    {"code": "no_clear_evidence", "label": "No clear evidence yet", "tier": 1},
    {"code": "insufficient_data", "label": "Not enough data to tell", "tier": 0},
]


def map_verdict(grade_code: str, significant: bool, years_used: int) -> dict:
    """Map the server's statistical grade and significance into the V2 visual verdict ladder."""
    if years_used < MIN_YEARS:
        return dict(VERDICT_LADDER[3])
    if grade_code == "strong":
        return dict(VERDICT_LADDER[0])
    if grade_code == "moderate" or (grade_code == "weak" and significant):
        return dict(VERDICT_LADDER[1])
    return dict(VERDICT_LADDER[2])


def _build_evidence_trace(
    *,
    info: dict,
    years: list[int],
    quality: dict,
    stats: dict,
    ols_block: dict,
    grade_block: dict,
    checks: list[dict],
    ok_months: list[dict],
    month_agree: int,
    tests_agree: bool,
    summary_text: str,
    caveats: list[str],
) -> dict:
    """Assemble the complete, non-duplicated calculation trace from existing analysis outputs."""
    unit = info["units"]
    verdict = map_verdict(grade_block["code"], stats["significant"], quality["years_used"])
    months_fdr = sum(1 for row in ok_months if row["significant"])
    autocorr = stats["autocorr"]

    steps = [
        {
            "step": 1,
            "id": "completeness",
            "title": "Count complete 12-month years",
            "plain_explanation": (
                f"Used {quality['years_used']} complete 12-month years ({years[0]}–{years[-1]}) "
                f"from {quality['valid_months']} valid monthly observations so no single season biases the annual average."
            ),
            "method_label": "Complete-year annual aggregation (12 valid months required per year)",
            "values": {
                "years_used": quality["years_used"],
                "years_requested": quality["years_requested"],
                "valid_months": quality["valid_months"],
                "expected_months": quality["expected_months"],
                "start_year": years[0],
                "end_year": years[-1],
            },
        },
        {
            "step": 2,
            "id": "sen_slope",
            "title": "Estimate rate of change (Theil–Sen slope & 95% interval)",
            "plain_explanation": (
                f"Compared every pair of years to find the median rate of change: {_num(stats['slope_per_decade'])} {unit}/decade "
                f"(95% interval {_num(stats['ci_low_per_decade'])} to {_num(stats['ci_high_per_decade'])} {unit}/decade)."
            ),
            "method_label": "Theil–Sen estimator with Gilbert (1987) 95% confidence interval",
            "values": {
                "slope_per_year": stats["slope_per_year"],
                "slope_per_decade": stats["slope_per_decade"],
                "ci_low_per_decade": stats["ci_low_per_decade"],
                "ci_high_per_decade": stats["ci_high_per_decade"],
                "total_change": stats["total_change"],
                "units": unit,
            },
        },
        {
            "step": 3,
            "id": "serial_correlation",
            "title": "Check whether neighboring years resemble each other",
            "plain_explanation": (
                f"Measured year-to-year persistence (lag-1 autocorrelation r1 = {autocorr['r1']:.2f}) and "
                + (
                    f"widened uncertainty by a variance factor of {autocorr['factor']:.2f}× so persistent swings do not cause a false alarm."
                    if autocorr["adjusted"]
                    else f"applied a variance factor of {autocorr['factor']:.2f}× (no material persistence widening needed)."
                )
            ),
            "method_label": "Marriott–Pope (1954) bias-corrected lag-1 autocorrelation adjustment (1+phi)/(1-phi)",
            "values": {
                "lag1_r1": autocorr["r1"],
                "variance_factor": autocorr["factor"],
                "adjusted": autocorr["adjusted"],
                "raw_p_value": stats["p_naive"],
                "adjusted_p_value": stats["p_value"],
            },
        },
        {
            "step": 4,
            "id": "significance_tests",
            "title": "Run non-parametric and regression significance tests",
            "plain_explanation": (
                f"Mann–Kendall p = {_p(stats['p_value'])} (raw unadjusted p = {_p(stats['p_naive'])}) and "
                f"OLS regression t-test p = {_p(ols_block['p_value'])} with {ols_block['df']:.1f} effective degrees of freedom."
            ),
            "method_label": "Tie-corrected Mann–Kendall test + effective-df Student-t OLS regression",
            "values": {
                "mann_kendall_s": stats["mann_kendall_s"],
                "mann_kendall_z": stats["z"],
                "p_value": stats["p_value"],
                "raw_p_value": stats["p_naive"],
                "ols_t": ols_block["t"],
                "ols_df": ols_block["df"],
                "ols_p_value": ols_block["p_value"],
                "alpha": stats["alpha"],
                "significant": stats["significant"],
                "tests_agree": tests_agree,
            },
        },
        {
            "step": 5,
            "id": "evidence_grade",
            "title": "Combine five robustness checks into the evidence verdict",
            "plain_explanation": (
                f"Passed {grade_block['passed']} of {grade_block['total']} evidence checks → {verdict['label']}."
            ),
            "method_label": "Five-check evidence rubric + Benjamini–Hochberg FDR on calendar months",
            "values": {
                "verdict_code": verdict["code"],
                "verdict_label": verdict["label"],
                "grade_code": grade_block["code"],
                "checks_passed": grade_block["passed"],
                "checks_total": grade_block["total"],
                "month_agreement": month_agree,
                "months_tested": len(ok_months),
                "months_significant_fdr": months_fdr,
            },
        },
    ]

    return {
        "verdict": {
            **verdict,
            "direction": stats["direction"],
            "sign": stats["sign"],
            "summary": summary_text,
            "ladder": VERDICT_LADDER,
        },
        "completeness": {
            "start_year": years[0],
            "end_year": years[-1],
            "complete_years": years,
            "years_used": quality["years_used"],
            "years_requested": quality["years_requested"],
            "valid_months": quality["valid_months"],
            "expected_months": quality["expected_months"],
            "min_months_per_year": 12,
            "min_years_required": MIN_YEARS,
            "source": info.get("source", "NASA Langley Research Center (LaRC) POWER Project"),
        },
        "slope_and_interval": {
            "method": "Theil–Sen median pairwise slope with Gilbert (1987) 95% confidence interval",
            "units": unit,
            "slope_per_year": stats["slope_per_year"],
            "slope_per_decade": stats["slope_per_decade"],
            "ci_low_per_decade": stats["ci_low_per_decade"],
            "ci_high_per_decade": stats["ci_high_per_decade"],
            "confidence_level": 1.0 - ALPHA,
            "total_change": stats["total_change"],
            "span_years": stats["span_years"],
            "mean_value": stats["mean_value"],
            "percent_of_mean": stats["percent_of_mean"],
            "noise_sd": stats["noise_sd"],
            "signal_to_noise": stats["signal_to_noise"],
        },
        "mann_kendall": {
            "method": "Two-sided Mann–Kendall non-parametric trend test (tie- and continuity-corrected)",
            "s": stats["mann_kendall_s"],
            "z": stats["z"],
            "p_value": stats["p_value"],
            "raw_p_value": stats["p_naive"],
            "alpha": stats["alpha"],
            "significant": stats["significant"],
            "direction": stats["direction"],
            "sign": stats["sign"],
        },
        "regression_and_serial_correlation": {
            "ols": ols_block,
            "tests_agree": tests_agree,
            "serial_correlation": {
                "method": "Marriott–Pope (1954) bias-corrected lag-1 autocorrelation variance inflation (1+phi)/(1-phi)",
                "lag1_r1": autocorr["r1"],
                "variance_factor": autocorr["factor"],
                "adjusted": autocorr["adjusted"],
                "effective_df": ols_block["df"],
                "raw_p_value": stats["p_naive"],
                "adjusted_p_value": stats["p_value"],
            },
        },
        "correction_status": {
            "method": "Benjamini–Hochberg false-discovery rate (FDR) control",
            "alpha": ALPHA,
            "primary_test_scope": "single_series",
            "primary_p_fdr_adjusted": False,
            "calendar_months_fdr_applied": True,
            "calendar_months_tested": len(ok_months),
            "calendar_months_significant_fdr": months_fdr,
            "explanation": (
                "A single requested point trend is tested at alpha = 0.05 using the serial-correlation-adjusted p-value. "
                "Simultaneous families of tests (the 12 calendar months here, plus Sweep, Scan, World, and Ledger) "
                "apply Benjamini–Hochberg false-discovery control at q = 0.05."
            ),
        },
        "grade": grade_block,
        "checks": checks,
        "steps": steps,
        "caveats": caveats,
    }


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


GRID_LAT_LIMIT = 89.75  # half a NASA POWER cell short of the pole: every longitude meets at ±90, so a row there is one point


def _wrap_lon(v: float) -> float:
    """Longitude in [-180, 180): 181 -> -179, so a grid crossing the antimeridian keeps its spacing."""
    wrapped = ((v + 180.0) % 360.0) - 180.0
    return 0.0 if wrapped == 0 else wrapped  # no -0.0


def grid_points(lat: float, lon: float, size: float, n: int) -> list[tuple[float, float]]:
    """n x n points (row-major, south to north, west to east) spanning `size` degrees around (lat, lon).

    Every point is distinct and evenly spaced (A6 in the backend review):
      * longitude wraps across the antimeridian instead of clamping at ±180;
      * near a pole the whole latitude window is shifted (not clamped) so it fits inside ±GRID_LAT_LIMIT, which keeps
        the spacing and the row count. The grid is then no longer centered on `lat`, but no two rows collapse onto
        the same latitude, so multiple-testing counts, the composite and Moran's I never see duplicate cells.
    A window wider than 2 * GRID_LAT_LIMIT (impossible at the API's size <= 40) is centered on the equator.
    """
    if n < 2:
        raise ValueError("A grid needs at least 2 points per side.")
    step = size / (n - 1)
    half = size / 2
    center_lat = lat
    if half >= GRID_LAT_LIMIT:
        center_lat = 0.0
    elif center_lat + half > GRID_LAT_LIMIT:
        center_lat = GRID_LAT_LIMIT - half
    elif center_lat - half < -GRID_LAT_LIMIT:
        center_lat = -GRID_LAT_LIMIT + half
    lats = [round(center_lat - half + i * step, 4) for i in range(n)]
    lons = [_wrap_lon(round(_wrap_lon(round(lon - half + i * step, 6)), 4)) for i in range(n)]
    return [(la, lo) for la in lats for lo in lons]
