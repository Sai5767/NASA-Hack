"""Correlation, change-point and step-fit statistics, plus the shape check built on them."""

import random

import pytest

from app.analysis import analyze_series
from app.stats import (
    best_step,
    correlation_p_value,
    effective_sample_size,
    linear_detrend,
    ols,
    pearson,
    pettitt,
)


def test_pearson_reference_values():
    assert pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]) == pytest.approx(0.7746, abs=1e-3)  # sqrt(0.6)
    assert pearson([1, 2, 3, 4], [8, 6, 4, 2]) == pytest.approx(-1.0)
    assert pearson([1, 2, 3, 4], [5, 5, 5, 5]) is None
    with pytest.raises(ValueError):
        pearson([1, 2], [1, 2])


def test_effective_sample_size():
    assert effective_sample_size(40, 0.0, 0.0) == 40
    assert effective_sample_size(40, 0.5, 0.5) == pytest.approx(24.0)  # 40 * 0.75 / 1.25
    assert effective_sample_size(40, -0.8, 0.9) == 40                  # negative persistence never adds information
    assert effective_sample_size(40, 0.99, 0.99) >= 3                  # floor keeps the t-test defined


def test_correlation_p_value_matches_t_table():
    # r = 0.5 with 30 independent samples: t = 3.055, df = 28 -> p ~ 0.0049
    assert correlation_p_value(0.5, 30) == pytest.approx(0.0049, abs=1e-3)
    assert correlation_p_value(0.0, 30) == pytest.approx(1.0)
    assert correlation_p_value(0.5, 30) < correlation_p_value(0.5, 10)  # fewer independent samples, less evidence
    assert correlation_p_value(1.0, 20) == 0.0
    assert correlation_p_value(0.9, 2) == 1.0


def test_linear_detrend_removes_the_line():
    rng = random.Random(3)
    times = [float(t) for t in range(1981, 2021)]
    values = [0.3 * (t - 1981) + rng.gauss(0, 0.2) for t in times]
    flat = linear_detrend(values, times)
    assert sum(flat) / len(flat) == pytest.approx(0.0, abs=1e-9)
    assert abs(ols(flat, times).slope) < 1e-9


def test_pettitt_finds_a_step():
    values = [0.0] * 15 + [1.0] * 15
    split, p = pettitt(values)
    assert split == 15
    assert p < 0.001


def test_pettitt_does_not_find_a_step_in_noise():
    rng = random.Random(21)
    _, p = pettitt([rng.gauss(0, 1) for _ in range(40)])
    assert p > 0.1
    with pytest.raises(ValueError):
        pettitt([1.0] * 5)


def test_best_step_recovers_levels():
    fit = best_step([2.0] * 12 + [5.0] * 18)
    assert fit.split == 12
    assert fit.mean_before == 2.0 and fit.mean_after == 5.0
    assert fit.r2 == pytest.approx(1.0)
    assert best_step([1.0] * 8) is None  # too short for two segments of five


# ---- the shape check on a full analysis ------------------------------------------------------


def _flat_months(annual: dict[int, float]) -> dict[str, float | None]:
    return {f"{y}{m:02d}": v for y, v in annual.items() for m in range(1, 13)}


def test_step_record_is_labeled_step_like_with_a_caveat():
    rng = random.Random(5)
    annual = {y: (10.0 if y < 2001 else 11.5) + rng.gauss(0, 0.2) for y in range(1981, 2025)}
    result = analyze_series("T2M", 0.0, 0.0, _flat_months(annual), 1981, 2024)
    shape = result["shape"]
    assert shape["label"] == "step"
    assert 1999 <= shape["step_year"] <= 2003
    assert shape["mean_after"] - shape["mean_before"] == pytest.approx(1.5, abs=0.3)
    assert shape["r2_step"] > shape["r2_line"] + 0.05
    assert "step change" in result["caveats"][0] or any("step change" in c for c in result["caveats"])


def test_steady_ramp_is_labeled_steady():
    rng = random.Random(6)
    annual = {y: 10.0 + 0.06 * (y - 1981) + rng.gauss(0, 0.15) for y in range(1981, 2025)}
    result = analyze_series("T2M", 0.0, 0.0, _flat_months(annual), 1981, 2024)
    assert result["shape"]["label"] == "steady"
    assert not any("step change" in c for c in result["caveats"])


def test_noise_has_no_clear_shape():
    rng = random.Random(8)
    annual = {y: 10.0 + rng.gauss(0, 1.0) for y in range(1981, 2025)}
    result = analyze_series("T2M", 0.0, 0.0, _flat_months(annual), 1981, 2024)
    assert result["shape"]["label"] == "unclear"


def test_planet_streams_reuse_the_engine_with_their_own_wording():
    info = {"label": "Global surface temperature", "units": "°C", "group": "Planet", "ratio": False, "land_only": False,
            "description": "x", "source": "x", "kind": "trend"}
    rng = random.Random(9)
    annual = {y: 0.02 * (y - 1981) + rng.gauss(0, 0.05) for y in range(1981, 2025)}
    result = analyze_series("gistemp_global", None, None, _flat_months(annual), 1981, 2024, info=info, where="worldwide")
    assert result["stats"]["significant"]
    assert "worldwide" in result["summary"]
    assert result["location"] == {"lat": None, "lon": None}
