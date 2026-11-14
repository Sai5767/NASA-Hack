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
