"""Endpoint tests with the NASA POWER call replaced by synthetic data (no network needed)."""

from fastapi.testclient import TestClient

from app.main import app
from app.nasa_power import VARIABLES

client = TestClient(app)
PERIOD = {"start_year": 1981, "end_year": 2024}


def test_variables_include_groups_and_flags():
    rows = client.get("/api/variables").json()
    assert len(rows) == len(VARIABLES)
    assert all({"id", "label", "units", "group", "description", "ratio", "land_only"} <= set(r) for r in rows)
    solar = next(r for r in rows if r["id"] == "ALLSKY_SFC_SW_DWN")
    assert solar["units"] == "MJ/m²/day"  # the unit NASA POWER returns, not kWh


def test_trend_returns_full_case_file(fake_power):
    res = client.get("/api/trend", params={"variable": "T2M", "lat": 42, "lon": -93.6, **PERIOD})
    assert res.status_code == 200
    body = res.json()
    for key in ("stats", "ols", "annual", "monthly", "rolling", "trend_line", "fingerprint",
                "emergence", "robustness", "checks", "grade", "summary", "caveats", "quality"):
        assert key in body, key
    assert body["stats"]["significant"]
    assert len(body["fingerprint"]) == 12


def test_sweep_ranks_every_variable_and_applies_fdr(fake_power):
    body = client.get("/api/sweep", params={"lat": 42, "lon": -93.6, **PERIOD}).json()
    assert body["counts"]["total"] == len(VARIABLES)
    ok = [r for r in body["rows"] if r["ok"]]
    assert ok, "expected analyzable variables"
    ranks = {"strong": 3, "moderate": 2, "weak": 1, "none": 0}
    grades = [ranks[r["grade"]["code"]] for r in ok]
    assert grades == sorted(grades, reverse=True)  # best evidence first
    assert body["counts"]["significant_fdr"] <= body["counts"]["significant"]
    assert all(len(r["years"]) == len(r["annual"]) for r in ok)


def test_grid_flags_fdr_and_finds_opposite_trends(fake_power):
    # Straddling the equator: northern cells rise, southern cells fall in the synthetic data.
    body = client.get(
        "/api/grid", params={"variable": "T2M", "lat": 0.0, "lon": 20, "size": 20, "n": 4, **PERIOD}
    ).json()
    assert body["counts"]["total"] == 16
    assert body["counts"]["analyzed"] == 16
    assert body["opposite_trends"]
    assert body["strongest_increase"]["slope_per_decade"] > 0
    assert body["strongest_decrease"]["slope_per_decade"] < 0
    assert body["morans"] is not None
    assert body["morans"]["pattern"] == "clustered"  # north rises, south falls: neighbors agree
    fdr = [c for c in body["cells"] if c["significant_fdr"]]
    assert fdr and all(c["significant"] for c in fdr)


def test_duel_detects_different_trends(fake_power):
    params = {"variable": "T2M", "lat_a": 60, "lon_a": 10, "lat_b": -30, "lon_b": 10, **PERIOD}
    body = client.get("/api/duel", params=params).json()
    diff = body["difference"]
    assert diff["slope_diff_per_decade"] > 0
    assert diff["significant"]
    assert diff["ci_low"] < diff["slope_diff_per_decade"] < diff["ci_high"]
    assert len(body["overlay"]) == 44
    assert "significantly different rates" in diff["text"]


def test_duel_same_place_shows_no_difference(fake_power):
    params = {"variable": "T2M", "lat_a": 60, "lon_a": 10, "lat_b": 60, "lon_b": 10, **PERIOD}
    diff = client.get("/api/duel", params=params).json()["difference"]
    assert diff["slope_diff_per_decade"] == 0
    assert not diff["significant"]


def test_invalid_inputs_are_rejected_before_any_network_call():
    assert client.get("/api/trend", params={"variable": "NOPE", "lat": 0, "lon": 0}).status_code == 404
    assert client.get("/api/trend", params={"variable": "T2M", "lat": 99, "lon": 0}).status_code == 422
    short = {"variable": "T2M", "lat": 0, "lon": 0, "start_year": 2000, "end_year": 2005}
    assert client.get("/api/trend", params=short).status_code == 400
    assert client.get("/api/sweep", params={"lat": 0, "lon": 0, "start_year": 1970, "end_year": 2020}).status_code == 400
    assert client.get("/api/grid", params={"variable": "T2M", "lat": 0, "lon": 0, "n": 9}).status_code == 422



def test_default_end_year_follows_todays_date_not_the_import_date(fake_power, monkeypatch):
    # A12: Query(date.today().year - 1) froze the default when the module was imported (a server running over New Year
    # kept last year's default). The default is now resolved on every request.
    import datetime as real_datetime

    from app import main

    class FakeDate(real_datetime.date):
        @classmethod
        def today(cls):
            return real_datetime.date(2031, 3, 1)

    monkeypatch.setattr(main, "date", FakeDate)
    body = client.get("/api/trend", params={"variable": "T2M", "lat": 42.0, "lon": -93.6}).json()
    assert body["period"]["end_year"] == 2030
    frames = client.get("/api/monthly-frames", params={"variable": "T2M", "lat": 42.0, "lon": -93.6, "n": 1}).json()
    assert frames["period"]["start_year"] == 2028 and frames["period"]["end_year"] == 2030


def test_a_flat_row_is_never_counted_as_fdr_significant(monkeypatch):
    # Agent 0B's B1 rule: Sen's slope 0 means not significant. BH runs on p-values alone, so main.py also requires
    # `significant` before setting significant_fdr (sweep, grid, world).
    from app import main

    async def fake_many(variables, lat, lon, start, end, detail=True):
        out = {}
        for v in variables:
            res = await main.analyze_point(v, lat, lon, start, end, detail=True)
            res["stats"]["significant"] = False  # e.g. heavy ties: p < 0.05 but slope exactly 0
            res["stats"]["p_value"] = 0.0001
            out[v] = res
        return out

    async def fetch(parameters, lat, lon, start, end):
        from tests.conftest import make_monthly

        return {p: make_monthly(start, end, trend_per_year=0.08, noise_sd=0.2, seed=5) for p in parameters}

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", fetch)
    monkeypatch.setattr(main, "analyze_many", fake_many)
    body = client.get("/api/sweep", params={"lat": 42.0, "lon": -93.6, **PERIOD}).json()
    assert body["counts"]["significant_fdr"] == 0
    assert all(r["significant_fdr"] is False for r in body["rows"] if r["ok"])
