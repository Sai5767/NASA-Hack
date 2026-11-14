import pytest

from app.analysis import AnalysisError, _grade, analyze_series
from app.nasa_power import annual_means, parse_series
from tests.conftest import make_monthly


def test_parse_series_ignores_annual_summary_month_and_missing_values():
    raw = {"199001": 1.5, "199012": 2.5, "199013": 99.0, "199002": -999.0, "ANN": 5.0}
    series = parse_series(raw)
    assert set(series) == {"199001", "199012", "199002"}
    assert series["199002"] is None


def test_annual_means_require_all_twelve_months():
    monthly = {f"2000{m:02d}": 1.0 for m in range(1, 13)}
    monthly.update({f"2001{m:02d}": 1.0 for m in range(1, 12)})  # 11 months: seasonally biased, so dropped
    assert list(annual_means(monthly)) == [2000]


def test_clear_trend_produces_a_strong_case_file():
    monthly = make_monthly(trend_per_year=0.05, noise_sd=0.3, seed=2)
    result = analyze_series("T2M", 42.0, -93.6, monthly, 1981, 2024)

    stats = result["stats"]
    assert stats["significant"]
    assert stats["slope_per_decade"] == pytest.approx(0.5, abs=0.1)
    assert stats["ci_low_per_decade"] < stats["slope_per_decade"] < stats["ci_high_per_decade"]
    assert stats["signal_to_noise"] > 1
    assert stats["percent_of_mean"] is None  # temperature in °C has no meaningful "percent of average"

    assert result["ols"]["significant"]
    assert result["grade"]["code"] in ("strong", "moderate")
    assert len(result["checks"]) == 5
    assert len(result["robustness"]) == 3
    assert result["emergence"]["year"] is not None
    assert result["emergence"]["year"] <= 2024
    assert result["agreement"]["tests_agree"]

    # Every calendar month rises in this synthetic data.
    ok = [m for m in result["fingerprint"] if m["ok"]]
    assert len(ok) == 12
    assert result["month_agreement"] == {"agree": 12, "total": 12} or result["month_agreement"]["agree"] >= 10

    # Trend line passes through the pivot point.
    line = result["trend_line"]
    expected_pivot = line["intercept"] + line["slope_per_year"] * (line["pivot_year"] - line["t0"])
    assert line["pivot_value"] == pytest.approx(expected_pivot)


def test_monthly_anomalies_remove_the_seasonal_cycle():
    monthly = make_monthly(trend_per_year=0.0, noise_sd=0.2, seed=3)
    result = analyze_series("T2M", 0.0, 0.0, monthly, 1981, 2024)
    by_month: dict[int, list[float]] = {}
    for row in result["monthly"]:
        by_month.setdefault(row["m"], []).append(row["a"])
    for month, anomalies in by_month.items():
        assert sum(anomalies) / len(anomalies) == pytest.approx(0.0, abs=1e-3)
    # Raw values swing by ~16 degrees across the year; anomalies stay small.
    assert max(abs(row["a"]) for row in result["monthly"]) < 3


def test_pure_noise_is_not_called_a_trend():
    monthly = make_monthly(trend_per_year=0.0, noise_sd=1.0, seed=9)
    result = analyze_series("T2M", 0.0, 0.0, monthly, 1981, 2024)
    assert not result["stats"]["significant"]
    assert result["grade"]["code"] in ("none", "weak")
    assert result["stats"]["direction"] == "no significant trend"
    assert "no statistically significant trend" in result["summary"]


def test_percent_of_mean_only_for_ratio_variables():
    monthly = make_monthly(base=5.0, seasonal_amplitude=1.0, trend_per_year=0.02, noise_sd=0.1, seed=4)
    rain = analyze_series("PRECTOTCORR", 0.0, 0.0, monthly, 1981, 2024, detail=False)
    assert rain["stats"]["percent_of_mean"] == pytest.approx(
        rain["stats"]["total_change"] / rain["stats"]["mean_value"] * 100
    )
    temp = analyze_series("T2M", 0.0, 0.0, monthly, 1981, 2024, detail=False)
    assert temp["stats"]["percent_of_mean"] is None


def test_land_only_variable_over_ocean_explains_itself():
    monthly = {f"{y}{m:02d}": None for y in range(1981, 2025) for m in range(1, 13)}
    with pytest.raises(AnalysisError, match="only measured over land"):
        analyze_series("EVLAND", 0.0, -160.0, monthly, 1981, 2024)


def test_constant_series_is_rejected_with_a_reason():
    monthly = {f"{y}{m:02d}": 0.0 for y in range(1981, 2025) for m in range(1, 13)}
    with pytest.raises(AnalysisError, match="does not vary"):
        analyze_series("PRECSNOLAND", 0.0, 0.0, monthly, 1981, 2024)


def test_too_few_years_is_rejected():
    monthly = make_monthly(start_year=2010, end_year=2020)
    with pytest.raises(AnalysisError, match="at least 20"):
        analyze_series("T2M", 0.0, 0.0, monthly, 2010, 2020)


def test_incomplete_final_year_is_not_used():
    monthly = make_monthly(start_year=1981, end_year=2025)
    for month in range(7, 13):
        monthly[f"2025{month:02d}"] = None  # year not finished
    result = analyze_series("T2M", 0.0, 0.0, monthly, 1981, 2025, detail=False)
    assert result["period"]["end_year"] == 2024
    assert result["quality"]["years_used"] == 44


def test_detail_false_skips_heavy_sections():
    result = analyze_series("T2M", 0.0, 0.0, make_monthly(), 1981, 2024, detail=False)
    assert "stats" in result and "ols" in result
    assert "fingerprint" not in result and "monthly" not in result


@pytest.mark.parametrize(
    "p,significant,passed,expected",
    [
        (0.001, True, 5, "strong"),
        (0.001, True, 4, "moderate"),
        (0.03, True, 5, "moderate"),
        (0.03, True, 3, "weak"),
        (0.08, False, 3, "weak"),
        (0.08, False, 2, "none"),
        (0.5, False, 1, "none"),
    ],
)
def test_grade_rules(p, significant, passed, expected):
    assert _grade(p, significant, passed, 5) == expected
