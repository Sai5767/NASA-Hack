"""The trend ledger and the published-context rules, all offline."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import ledger as ledger_module
from app.main import app
from app.places import PLACES
from app.reasons import PLANET_RULES, RULES, reason_for
from app.stats import benjamini_hochberg

client = TestClient(app)
PERIOD = (1981, 2024)


@pytest.fixture(autouse=True)
def _fresh_cache():
    ledger_module.clear_cache()
    yield
    ledger_module.clear_cache()


def _build(places=None, limit=300):
    return asyncio.run(ledger_module.build_ledger(*PERIOD, places=places or PLACES[:6], limit=limit))


def test_rows_are_ranked_by_p_value_with_consecutive_ranks(fake_power, fake_streams):
    out = _build(limit=1500)
    rows = out["rows"]
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
    assert [r["p_value"] for r in rows] == sorted(r["p_value"] for r in rows)
    assert out["counts"]["tests"] == len(rows)
    assert not out["truncated"]


def test_the_correction_is_applied_across_every_test_together(fake_power, fake_streams):
    out = _build(limit=1500)
    rows = out["rows"]
    # rows are sorted by p, and BH is order-independent, so recomputing over the same p-values must agree flag for flag
    # (a row with no direction never counts, see test_a_flat_row_never_survives_correction_even_with_a_tiny_p)
    expected = [f and r["significant"] for f, r in zip(benjamini_hochberg([r["p_value"] for r in rows], 0.05), rows)]
    assert [r["significant_fdr"] for r in rows] == expected
    assert out["counts"]["survive_correction"] == sum(expected)
    assert out["counts"]["survive_correction"] <= out["counts"]["nominal"] <= out["counts"]["tests"]


def test_only_trends_that_survive_correction_get_published_context(fake_power, fake_streams):
    rows = _build(limit=1500)["rows"]
    solid = [r for r in rows if r["significant_fdr"]]
    assert solid, "the synthetic data trend strongly, so some must survive"
    for row in solid:
        assert row["reason"]["text"] and row["reason"]["confidence"] in {"well established", "plausible", "uncertain"}
    assert all(r["reason"] is None for r in rows if not r["significant_fdr"])


def test_planet_vital_signs_join_the_ledger(fake_power, fake_streams):
    rows = _build(limit=1500)["rows"]
    planet = {r["variable"]: r for r in rows if r["kind"] == "planet"}
    assert set(planet) == {"gistemp_global", "co2_mlo", "arctic_ice", "antarctic_ice"}
    assert planet["co2_mlo"]["sign"] == "up" and planet["co2_mlo"]["significant_fdr"]
    assert "CO2" in planet["co2_mlo"]["reason"]["text"]
    assert planet["arctic_ice"]["sign"] == "down" and "sea ice" in planet["arctic_ice"]["reason"]["text"]
    assert planet["gistemp_global"]["lat"] is None


def test_limit_truncates_and_says_so(fake_power, fake_streams):
    out = _build(limit=20)
    assert len(out["rows"]) == 20 and out["truncated"]
    assert out["rows"][0]["rank"] == 1


def test_a_failed_place_is_reported_not_silently_dropped(fake_power, fake_streams, monkeypatch):
    real = ledger_module.analyze_many

    async def flaky(variables, lat, lon, *args, **kwargs):
        if lat == PLACES[0]["lat"] and lon == PLACES[0]["lon"]:
            raise ledger_module.PowerError("NASA POWER is down for this place")
        return await real(variables, lat, lon, *args, **kwargs)

    monkeypatch.setattr(ledger_module, "analyze_many", flaky)
    out = _build()
    assert out["counts"]["failed_places"] == 1 and out["failed_places"][0]["id"] == PLACES[0]["id"]
    assert all(r["place_id"] != PLACES[0]["id"] for r in out["rows"] if r["kind"] == "place")


def test_results_are_cached_so_a_second_call_does_no_new_work(fake_power, fake_streams, monkeypatch):
    first = _build()
    calls = []
    monkeypatch.setattr(ledger_module, "analyze_many", lambda *a, **k: calls.append(1))
    second = _build()
    assert not calls and second["counts"] == first["counts"]


def test_endpoint_returns_the_ranked_ledger(fake_power, fake_streams):
    res = client.get("/api/ledger", params={"limit": 50})
    assert res.status_code == 200
    body = res.json()
    assert len(body["rows"]) == 50 and body["truncated"]
    assert body["counts"]["variables"] == 19 and body["counts"]["places"] == len(PLACES)
    assert body["by_variable"][0]["rising"] + body["by_variable"][0]["falling"] >= body["by_variable"][-1]["rising"] + body["by_variable"][-1]["falling"]
    assert "cannot show why" in body["context_note"]
    assert client.get("/api/ledger", params={"limit": 5}).status_code == 422
    assert client.get("/api/ledger", params={"start_year": 2000, "end_year": 2005}).status_code in (400, 422)


# ---- the published-context rules -------------------------------------------------------------


def test_region_specific_context_beats_the_general_rule():
    arctic = reason_for("T2M", 70, -150, "up")
    assert "Arctic amplification" in arctic["text"] and arctic["confidence"] == "well established"
    general = reason_for("T2M", 20, 10, "up")
    assert "greenhouse gas" in general["text"] and "Arctic" not in general["text"]
    assert "haze" in reason_for("ALLSKY_SFC_SW_DWN", 28.6, 77.2, "down")["text"].lower()
    assert "pollution" in reason_for("ALLSKY_SFC_SW_DWN", 50, 10, "up")["text"]  # brightening
    assert "dry season" in reason_for("PRECTOTCORR", -3.1, -60, "down")["text"]


def test_direction_matters_and_unknowns_get_an_honest_default():
    assert reason_for("WS2M", 40, -100, "down")["text"] != reason_for("WS2M", 40, -100, "up")["text"]
    assert "cooling" in reason_for("T2M", 20, 10, "down")["text"] and reason_for("T2M", 20, 10, "down")["confidence"] == "uncertain"
    unknown = reason_for("T2M_RANGE", 20, 10, "up")  # no rule for a rising day-night swing
    assert unknown["confidence"] == "uncertain" and "nothing in this app's knowledge base" in unknown["text"]


def test_planet_streams_use_their_own_rules():
    assert "fossil fuels" in reason_for("gistemp_global", None, None, "up", stream="gistemp_global")["text"]
    assert reason_for("antarctic_ice", None, None, "up", stream="antarctic_ice")["confidence"] == "uncertain"
    assert reason_for("antarctic_ice", None, None, "down", stream="antarctic_ice")["text"]


def test_every_rule_is_hedged_and_sourced_where_the_claim_is_strong():
    assert len(RULES) >= 20
    for region, variables, sign, text, confidence, sources in RULES:
        assert confidence in {"well established", "plausible", "uncertain"}
        assert sign in {"up", "down", None} and variables and len(text) > 40
        if confidence == "well established":
            assert sources, f"a well-established claim needs a source: {text[:50]}"
    for stream, rules in PLANET_RULES.items():
        assert all(sources for _, _, _, sources in rules), stream


def test_a_flat_row_never_survives_correction_even_with_a_tiny_p(fake_power, fake_streams, monkeypatch):
    """Review item B1: a zero median slope (sign "flat") is not a trend, whatever its p-value."""
    real = ledger_module.analyze_many

    async def with_a_flat_row(variables, lat, lon, *args, **kwargs):
        out = await real(variables, lat, lon, *args, **kwargs)
        if lat == PLACES[0]["lat"] and lon == PLACES[0]["lon"]:
            res = out["T2M"]
            out["T2M"] = {**res, "stats": {**res["stats"], "p_value": 1e-12, "significant": False, "sign": "flat", "slope_per_decade": 0.0}}
        return out

    monkeypatch.setattr(ledger_module, "analyze_many", with_a_flat_row)
    out = _build(limit=1500)
    flat = next(r for r in out["rows"] if r["id"] == f"{PLACES[0]['id']}:T2M")
    assert flat["p_value"] == 1e-12              # still listed, with its p-value unchanged
    assert flat["significant_fdr"] is False and flat["reason"] is None
    assert all(r["sign"] in ("up", "down") for r in out["rows"] if r["significant_fdr"])
