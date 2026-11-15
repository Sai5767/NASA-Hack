import math

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.nasa_power import annual_means
from app.stats import mann_kendall


def test_clear_upward_trend_is_significant():
    values = [i * 0.5 + (0.1 if i % 2 else -0.1) for i in range(30)]
    result = mann_kendall(values)
    assert result.significant
    assert result.direction == "increasing"
    assert result.sens_slope == pytest.approx(0.5, abs=0.05)


def test_clear_downward_trend_is_decreasing():
    values = [100 - i for i in range(25)]
    result = mann_kendall(values)
    assert result.direction == "decreasing"
    assert result.sens_slope == pytest.approx(-1.0)
    assert result.p_value < 0.001


def test_noise_is_not_significant():
    # Alternating values with no drift.
    values = [1.0, -1.0] * 15
    result = mann_kendall(values)
    assert not result.significant
    assert result.direction == "no significant trend"


def test_constant_series_has_p_of_one():
    result = mann_kendall([5.0] * 20)
    assert result.p_value == 1.0
    assert result.sens_slope == 0.0


def test_too_short_series_raises():
    with pytest.raises(ValueError):
        mann_kendall([1.0, 2.0, 3.0])


def test_annual_means_skip_years_with_too_few_months():
    monthly = {f"2000{m:02d}": float(m) for m in range(1, 13)}
    monthly.update({f"2001{m:02d}": None for m in range(1, 13)})
    monthly.update({f"2002{m:02d}": 1.0 for m in range(1, 6)})  # only 5 months
    means = annual_means(monthly)
    assert list(means) == [2000]
    assert means[2000] == pytest.approx(6.5)


def test_variables_endpoint_lists_all_variables():
    client = TestClient(app)
    response = client.get("/api/variables")
    assert response.status_code == 200
    ids = {v["id"] for v in response.json()}
    assert {"T2M", "PRECTOTCORR"} <= ids


def test_trend_rejects_unknown_variable():
    client = TestClient(app)
    response = client.get("/api/trend", params={"variable": "NOPE", "lat": 0, "lon": 0})
    assert response.status_code == 404


def test_trend_rejects_short_period():
    client = TestClient(app)
    response = client.get(
        "/api/trend",
        params={"variable": "T2M", "lat": 0, "lon": 0, "start_year": 2000, "end_year": 2005},
    )
    assert response.status_code == 400


# ---- review item B1: a zero median slope is never a significant trend ---------------------------------------------

# 44 years: 26 zero-snowfall years, then scattered small values among more zeros. Mann-Kendall's S is clearly positive
# (p = 0.011), but more than half of the pairwise slopes are exactly 0, so Sen's slope and its interval are 0 to 0.
HEAVY_TIES = [0.0] * 26 + [0.28, 0.69, 0.51, 0.0, 0.0, 0.63, 0.0, 0.46, 0.0, 0.38, 0.43, 0.0, 0.39, 0.31, 0.0, 0.0, 0.65, 0.0]


def test_heavy_ties_with_zero_sen_slope_are_not_significant():
    from app.stats import zero_slope_with_low_p

    result = mann_kendall(HEAVY_TIES, [float(y) for y in range(1981, 2025)])
    assert result.p_value < 0.05          # the reported p-value itself is unchanged
    assert result.sens_slope == 0.0
    assert result.significant is False    # but there is no direction, so no trend is claimed
    assert result.direction == "no significant trend"
    assert zero_slope_with_low_p(result)


# ---- review item B10: the OLS perfect-fit test is relative, so it does not depend on units -------------------------


def test_ols_p_value_does_not_depend_on_the_scale_of_the_data():
    import random

    from app.stats import ols

    rng = random.Random(3)
    tiny = [1e-14 * rng.gauss(0, 1) for _ in range(30)]
    times = [float(i) for i in range(30)]
    small, scaled = ols(tiny, times), ols([v * 1e14 for v in tiny], times)
    assert small.se > 0                                  # noisy data are not a "perfect line"
    assert small.p_value == pytest.approx(scaled.p_value, rel=1e-9)
    assert small.significant == scaled.significant


def test_ols_on_a_constant_series_finds_no_trend_and_a_perfect_line_still_has_p_zero():
    from app.stats import ols

    times = [float(i) for i in range(20)]
    flat = ols([0.1] * 20, times)
    assert flat.slope == 0.0 and flat.p_value == 1.0 and not flat.significant
    line = ols([2.0 + 0.5 * t for t in times], times)
    assert line.se == 0.0 and line.p_value == 0.0 and line.slope == pytest.approx(0.5)
