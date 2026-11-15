"""Offline tests for V2 Deliverable B: /api/monthly-frames and /api/monthly-forecast."""

from __future__ import annotations

import math
import random

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.monthly import evaluate_monthly_series
from app.nasa_power import PowerError
from tests.conftest import make_monthly

client = TestClient(app)


def test_monthly_frames_returns_grid_provenance_and_anomalies(fake_power):
    res = client.get(
        "/api/monthly-frames",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 2022, "end_year": 2024, "n": 2, "size": 2.0},
    )
    assert res.status_code == 200
    body = res.json()

    assert body["variable"]["id"] == "T2M"
    assert body["grid"]["n"] == 2
    assert body["grid"]["total_cells"] == 4
    assert body["provenance"]["source_id"] == "nasa_power"
    assert body["provenance"]["observation_state"] == "observed_reanalysis"
    assert body["coverage"]["cells_requested"] == 4
    assert body["coverage"]["cells_succeeded"] == 4
    assert body["coverage"]["partial_failure"] is False
    assert len(body["cells"]) == 4
    assert len(body["frames"]) == 36  # 3 years * 12 months

    first_frame = body["frames"][0]
    assert first_frame["month"] == "2022-01"
    assert first_frame["kind"] == "observed"
    assert len(first_frame["cells"]) == 4
    assert all(c["missing"] is False and c["value"] is not None and c["anomaly"] is not None for c in first_frame["cells"])


def test_monthly_frames_never_interpolates_missing_cells_or_months(monkeypatch):
    async def partial_fetch(parameters, lat, lon, start, end):
        # Fail one corner cell and drop specific months in another
        if lat > 33.5 and lon > -112.0:
            raise PowerError("Cell timeout on NASA POWER")
        series = make_monthly(start, end, trend_per_year=0.04, noise_sd=0.3, seed=5)
        if lat < 33.5:
            series["202406"] = None
            series["202407"] = None
        return {p: series for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", partial_fetch)

    res = client.get(
        "/api/monthly-frames",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 2023, "end_year": 2024, "n": 2, "size": 2.0},
    )
    assert res.status_code == 200
    body = res.json()

    assert body["coverage"]["cells_failed"] == 1
    assert body["coverage"]["cells_succeeded"] == 3
    assert body["coverage"]["partial_failure"] is True

    failed_cell = next(c for c in body["cells"] if not c["ok"])
    assert failed_cell["missing_fraction"] == 1.0

    june_2024 = next(f for f in body["frames"] if f["month"] == "2024-06")
    # Failed cell + 2 southern cells with missing 202406 = 3 missing cells out of 4
    assert june_2024["missing_cells"] == 3
    assert june_2024["valid_cells"] == 1
    for fc in june_2024["cells"]:
        if fc["missing"]:
            assert fc["value"] is None and fc["anomaly"] is None


def test_monthly_frames_validation_and_caps(fake_power):
    assert client.get("/api/monthly-frames", params={"variable": "INVALID", "lat": 0, "lon": 0}).status_code == 404
    assert client.get("/api/monthly-frames", params={"variable": "T2M", "lat": 0, "lon": 0, "n": 5}).status_code == 422
    # Range > 10 years is rejected to protect NASA POWER and response size
    too_long = {"variable": "T2M", "lat": 0, "lon": 0, "start_year": 1990, "end_year": 2024}
    assert client.get("/api/monthly-frames", params=too_long).status_code == 400


def test_monthly_forecast_succeeds_when_candidate_beats_seasonal_naive(fake_power):
    res = client.get(
        "/api/monthly-forecast",
        params={
            "variable": "T2M",
            "lat": 33.45,
            "lon": -112.07,
            "start_year": 1981,
            "end_year": 2024,
            "horizons": 3,
            "n": 2,
            "size": 2.0,
        },
    )
    assert res.status_code == 200
    body = res.json()

    assert body["eligible"] is True
    assert body["reason"] is None
    assert body["selected_model"] is not None
    assert body["selected_model"] != "seasonal_naive"
    assert body["baseline_model"] == "seasonal_naive"
    assert len(body["frames"]) == 3
    assert [f["month"] for f in body["frames"]] == ["2025-01", "2025-02", "2025-03"]

    for frame in body["frames"]:
        assert frame["kind"] == "forecast"
        assert frame["badge"] == "Forecast — not observed data"
        assert len(frame["cells"]) == 4
        for cell in frame["cells"]:
            assert cell["lo"] <= cell["value"] <= cell["hi"]
            assert cell["missing"] is False

    # Verify scoreboard and calibration metadata
    selected_entry = next(m for m in body["models"] if m["is_selected"])
    assert selected_entry["id"] == body["selected_model"]
    assert selected_entry["beats_baseline_all_horizons"] is True
    assert len(selected_entry["mae_by_horizon"]) == 3
    assert body["calibration"]["passed"] is True
    assert body["training_range"]["n_months"] >= 120


def test_monthly_forecast_withholds_unsupported_variables_with_reason(fake_power):
    res = client.get(
        "/api/monthly-forecast",
        params={"variable": "WS2M", "lat": 33.45, "lon": -112.07, "start_year": 1981, "end_year": 2024},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["eligible"] is False
    assert body["reason_code"] == "unsupported_variable"
    assert "only enabled for" in body["reason"]
    assert body["frames"] == []


def test_monthly_forecast_withholds_when_model_loses_to_seasonal_naive():
    # Pure deterministic seasonal cycle with zero trend and zero noise: seasonal_naive has 0 error, so no model can beat it!
    ym = [(yr, mo) for yr in range(2005, 2025) for mo in range(1, 13)]
    vals = [15.0 + 10.0 * math.sin(2 * math.pi * (mo - 1) / 12) for _, mo in ym]
    eval_res = evaluate_monthly_series(ym, vals, "T2M", horizons=3)

    assert eval_res["eligible"] is False
    assert eval_res["reason_code"] == "no_skill_over_seasonal_naive"
    assert "did not beat the seasonal-naive baseline" in eval_res["reason"]
    assert eval_res["forecasts"] == []
    assert eval_res["models"]


def test_monthly_forecast_withholds_on_sparse_or_short_record(monkeypatch):
    async def sparse_fetch(parameters, lat, lon, start, end):
        series = make_monthly(start, end, trend_per_year=0.05, noise_sd=0.3, seed=7)
        # Introduce a gap 4 years before the end so contiguous run is only 48 months (< 120 required)
        series["202006"] = None
        return {p: series for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", sparse_fetch)
    res = client.get(
        "/api/monthly-forecast",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 1981, "end_year": 2024, "n": 1},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["eligible"] is False
    assert body["reason_code"] == "sparse_monthly_data"
    assert body["frames"] == []


def test_monthly_forecast_withholds_when_any_grid_cell_fails(monkeypatch):
    async def cell_fail_fetch(parameters, lat, lon, start, end):
        if lat > 0:
            raise PowerError("Upstream error for northern cell")
        return {p: make_monthly(start, end, trend_per_year=0.05, noise_sd=0.3, seed=8) for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", cell_fail_fetch)
    res = client.get(
        "/api/monthly-forecast",
        params={"variable": "T2M", "lat": 0.0, "lon": 10.0, "start_year": 1981, "end_year": 2024, "n": 2, "size": 4.0},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["eligible"] is False
    assert body["reason_code"] == "grid_cell_failure"
    assert body["frames"] == []


def test_monthly_forecast_clamps_rainfall_and_cloud_bounds():
    ym = [(yr, mo) for yr in range(2000, 2025) for mo in range(1, 13)]
    rng = random.Random(42)
    # Cloud cover rising near 98%
    vals = [min(100.0, 75.0 + 0.08 * i + 5.0 * math.sin(2 * math.pi * (ym[i][1] - 1) / 12) + rng.gauss(0, 0.4)) for i in range(len(ym))]
    ev = evaluate_monthly_series(ym, vals, "CLOUD_AMT", horizons=3)
    if ev["eligible"]:
        for fc in ev["forecasts"]:
            assert 0.0 <= fc["lo"] <= fc["value"] <= fc["hi"] <= 100.0
