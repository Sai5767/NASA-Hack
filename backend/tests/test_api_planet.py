"""Vitals, suspects, places, world and composite endpoints, with the network replaced by synthetic data."""

from fastapi.testclient import TestClient

from app import streams
from app.main import app
from app.places import PLACES

client = TestClient(app)
PERIOD = {"start_year": 1981, "end_year": 2024}


def test_vitals_run_the_same_engine_on_planet_streams(fake_streams):
    body = client.get("/api/vitals", params={"start_year": 1981, "end_year": 2025}).json()
    assert [v["id"] for v in body["vitals"]] == ["gistemp_global", "co2_mlo", "arctic_ice", "antarctic_ice"]
    assert all(v["ok"] for v in body["vitals"])

    co2 = next(v for v in body["vitals"] if v["id"] == "co2_mlo")
    assert co2["grade"]["code"] == "strong"
    assert co2["stats"]["slope_per_decade"] == __import__("pytest").approx(18.0, abs=1.5)  # built in: 1.8 ppm per year
    assert "at Mauna Loa" in co2["summary"]
    assert co2["latest"]["label"] == "Dec 2025"

    ice = next(v for v in body["vitals"] if v["id"] == "arctic_ice")
    assert ice["stats"]["sign"] == "down" and ice["stats"]["significant"]
    assert ice["source"].startswith("NSIDC")

    assert [r["id"] for r in body["rhythms"]] == ["oni", "pdo", "nao"]
    assert all(r["ok"] and r["latest"]["phase"] for r in body["rhythms"])
    assert body["rhythms"][0]["latest"]["phase"] in {"El Niño", "La Niña", "Neutral"}


def test_one_failing_stream_does_not_break_the_other_vitals(fake_streams, monkeypatch):
    real = streams.get_monthly

    async def flaky(stream_id):
        if stream_id == "co2_mlo":
            raise streams.StreamError("NOAA is down")
        return await real(stream_id)

    monkeypatch.setattr(streams, "get_monthly", flaky)
    body = client.get("/api/vitals", params=PERIOD).json()
    by_id = {v["id"]: v for v in body["vitals"]}
    assert by_id["co2_mlo"]["ok"] is False and "NOAA is down" in by_id["co2_mlo"]["message"]
    assert by_id["gistemp_global"]["ok"] and by_id["arctic_ice"]["ok"]


def test_vitals_validate_years():
    assert client.get("/api/vitals", params={"start_year": 1960, "end_year": 2000}).status_code == 400


def test_suspects_endpoint(fake_power, fake_streams):
    body = client.get("/api/suspects", params={"variable": "T2M", "lat": 42, "lon": -93.6, **PERIOD}).json()
    assert [s["id"] for s in body["suspects"]] == ["oni", "pdo", "nao"]
    assert body["zonal"]["band"] == "24N-44N"
    assert body["amplification"] is not None
    assert body["enso_adjusted"] is not None


def test_suspects_for_a_non_temperature_variable(fake_power, fake_streams):
    body = client.get("/api/suspects", params={"variable": "PRECTOTCORR", "lat": 42, "lon": -93.6, **PERIOD}).json()
    assert body["amplification"] is None and body["zonal"] is None


def test_suspects_rejects_bad_input():
    assert client.get("/api/suspects", params={"variable": "NOPE", "lat": 0, "lon": 0}).status_code == 404


def test_places_are_unique_and_valid():
    rows = client.get("/api/places").json()
    assert len(rows) == len(PLACES) >= 50
    assert len({r["id"] for r in rows}) == len(rows)
    assert all(-90 <= r["lat"] <= 90 and -180 <= r["lon"] <= 180 for r in rows)
    assert {"city", "polar", "ocean", "desert", "rainforest"} <= {r["kind"] for r in rows}


def test_world_ranks_sample_sites_and_applies_fdr(fake_power):
    body = client.get("/api/world", params={"variable": "T2M", **PERIOD}).json()
    assert body["counts"]["total"] == len(PLACES) == len(body["places"])
    assert body["counts"]["analyzed"] == len(PLACES)
    assert "sample sites" in body["note"]
    rising = body["top_rising"]
    assert rising and [p["slope_per_decade"] for p in rising] == sorted((p["slope_per_decade"] for p in rising), reverse=True)
    assert all(p["lat"] >= 0 and p["significant_fdr"] for p in rising)  # fake data rise in the north, fall in the south
    assert all(p["lat"] < 0 for p in body["top_falling"])
    assert body["counts"]["rising"] + body["counts"]["falling"] <= body["counts"]["analyzed"]
    # every analyzed place carries its yearly values, for the time-lapse
    for place in body["places"]:
        assert len(place["series"]) >= 40 and all(len(pair) == 2 for pair in place["series"])
        assert [y for y, _ in place["series"]] == sorted(y for y, _ in place["series"])


def test_world_reports_land_only_variables_over_ocean_as_failed(monkeypatch):
    from tests.conftest import make_monthly

    async def fake_fetch(parameters, lat, lon, start, end):
        ocean = lat == 0.0 and lon == -160.0
        series = make_monthly(start, end, trend_per_year=0.05, seed=3)
        return {p: ({k: None for k in series} if ocean else series) for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", fake_fetch)
    body = client.get("/api/world", params={"variable": "EVLAND", **PERIOD}).json()
    pacific = next(p for p in body["places"] if p["id"] == "eq-pacific")
    assert pacific["ok"] is False and "only measured over land" in pacific["message"]
    assert body["counts"]["failed"] >= 1


def test_grid_includes_an_area_weighted_regional_composite(fake_power):
    body = client.get(
        "/api/grid", params={"variable": "T2M", "lat": 45.0, "lon": 10, "size": 10, "n": 3, **PERIOD}
    ).json()
    comp = body["composite"]
    assert comp["n_cells"] == 9
    assert comp["stats"]["significant"] and comp["stats"]["sign"] == "up"
    assert comp["agreeing_share"] > 0.8
    assert len(comp["annual"]) == 44
    assert all("_annual" not in c for c in body["cells"])  # internal working data must not leak into the response


def test_composite_is_absent_when_too_few_places_have_data(monkeypatch):
    async def fake_fetch(parameters, lat, lon, start, end):
        return {p: {} for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", fake_fetch)
    body = client.get("/api/grid", params={"variable": "T2M", "lat": 0, "lon": 0, "size": 10, "n": 3, **PERIOD}).json()
    assert body["composite"] is None
