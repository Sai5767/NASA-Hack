import pytest
from fastapi.testclient import TestClient

from app.analysis import grid_points
from app.main import app


def test_grid_has_n_squared_points_centered_on_request():
    points = grid_points(40.0, -100.0, size=10.0, n=3)
    assert len(points) == 9
    lats = sorted({la for la, _ in points})
    lons = sorted({lo for _, lo in points})
    assert lats == pytest.approx([35.0, 40.0, 45.0])
    assert lons == pytest.approx([-105.0, -100.0, -95.0])


def test_grid_points_stay_within_valid_coordinates():
    points = grid_points(89.0, 179.0, size=20.0, n=3)
    assert all(-90 <= la <= 90 and -180 <= lo <= 180 for la, lo in points)


def test_grid_rejects_too_many_points_per_side():
    client = TestClient(app)
    response = client.get("/api/grid", params={"variable": "T2M", "lat": 0, "lon": 0, "n": 9})
    assert response.status_code == 422


def test_grid_rejects_unknown_variable():
    client = TestClient(app)
    response = client.get("/api/grid", params={"variable": "NOPE", "lat": 0, "lon": 0})
    assert response.status_code == 404
