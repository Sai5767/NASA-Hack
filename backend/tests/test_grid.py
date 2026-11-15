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


# ---- review item A6: wrap longitude, never collapse rows onto a pole --------------------------------------------


def _assert_regular(points, n):
    assert len(points) == n * n and len(set(points)) == n * n  # every cell is distinct
    lats = sorted({la for la, _ in points})
    assert len(lats) == n
    gaps = [b - a for a, b in zip(lats, lats[1:])]
    assert max(gaps) - min(gaps) < 1e-3                         # even spacing survives the shift
    assert all(-90 < la < 90 and -180 <= lo < 180 for la, lo in points)


@pytest.mark.parametrize("lat", [85.0, 88.0, 89.0, 90.0, -85.0, -90.0])
def test_grid_near_a_pole_shifts_instead_of_duplicating_rows(lat):
    for size, n in [(40.0, 5), (10.0, 5), (20.0, 3), (40.0, 8)]:
        _assert_regular(grid_points(lat, 0.0, size, n), n)


def test_grid_wraps_across_the_antimeridian():
    points = grid_points(0.0, 178.0, 10.0, 3)
    assert [lo for _, lo in points[:3]] == pytest.approx([173.0, 178.0, -177.0])
    points = grid_points(0.0, -179.0, 4.0, 3)
    assert [lo for _, lo in points[:3]] == pytest.approx([179.0, -179.0, -177.0])
    _assert_regular(grid_points(89.0, 179.0, 20.0, 3), 3)


def test_grid_row_major_order_is_south_to_north_west_to_east():
    points = grid_points(88.0, 178.0, 10.0, 3)
    rows = [points[i * 3 : (i + 1) * 3] for i in range(3)]
    assert [r[0][0] for r in rows] == sorted(r[0][0] for r in rows)
    assert all(len({la for la, _ in r}) == 1 for r in rows)
    assert max(la for la, _ in points) == pytest.approx(89.75)
