"""Suspect lineup, ENSO-adjusted trend, global amplification and the independent zonal check."""

import asyncio
import random

import pytest

from app import streams
from app.analysis import annual_core
from app.context import build_context
from app.nasa_power import VARIABLES

YEARS = list(range(1981, 2026))


def _months(annual: dict[int, float]) -> dict[str, float | None]:
    return {f"{y}{m:02d}": v for y, v in annual.items() for m in range(1, 13)}


@pytest.fixture
def world(monkeypatch):
    """A made-up world where local temperature = 1.5 x global warming + 0.8 x ENSO + noise."""
    rng = random.Random(11)
    oni = {y: rng.gauss(0, 1) for y in range(1950, 2026)}
    pdo = {y: random.Random(y + 1).gauss(0, 1) for y in range(1950, 2026)}
    nao = {y: random.Random(y + 2).gauss(0, 1) for y in range(1950, 2026)}
    glob = {y: 0.02 * (y - 1950) + rng.gauss(0, 0.03) for y in range(1950, 2026)}
    local = {y: 1.5 * glob[y] + 0.8 * oni[y] + rng.gauss(0, 0.2) for y in YEARS}
    bands = {name: {y: 0.03 * (y - 1950) + rng.gauss(0, 0.15) for y in range(1950, 2026)} for _, _, name in streams.ZONAL_BANDS}
    series = {"oni": oni, "pdo": pdo, "nao": nao, "gistemp_global": glob}

    async def fake_monthly(stream_id):
        return _months(series[stream_id])

    async def fake_zonal():
        return bands

    monkeypatch.setattr(streams, "get_monthly", fake_monthly)
    monkeypatch.setattr(streams, "get_zonal", fake_zonal)
    return {"local": local, "series": series, "bands": bands}


def _run(world, lat=42.0):
    info = VARIABLES["T2M"]
    values = [world["local"][y] for y in YEARS]
    stats = annual_core(info, YEARS, values)["stats"]
    return asyncio.run(build_context(info, lat, YEARS, values, stats))


def test_enso_is_linked_and_independent_rhythms_are_not(world):
    ctx = _run(world)
    by_id = {s["id"]: s for s in ctx["suspects"]}
    assert by_id["oni"]["verdict"] == "linked"
    assert by_id["oni"]["r"] > 0.6
    assert by_id["oni"]["explained"] == pytest.approx(by_id["oni"]["r"] ** 2 * 100)
    assert by_id["pdo"]["verdict"] != "linked"
    assert by_id["nao"]["verdict"] != "linked"
    assert all(s["n_eff"] <= s["n_years"] for s in ctx["suspects"] if s["ok"])
    assert "correlations" in ctx["caveat"]


def test_removing_enso_recovers_the_underlying_trend(world):
    ctx = _run(world)
    adj = ctx["enso_adjusted"]
    true_slope = 1.5 * 0.02 * 10  # local trend per decade built into the made-up world
    assert adj["enso_share"] > 50
    assert adj["slope_after"] == pytest.approx(true_slope, abs=0.1)
    # ENSO noise made the raw estimate less precise; the adjusted interval should be tighter.
    assert (adj["ci_high_after"] - adj["ci_low_after"]) < 0.4
    assert adj["significant_after"]


def test_amplification_interval_covers_the_truth_even_with_heavy_noise(world):
    # ENSO adds a lot of year-to-year noise here, so the factor is only loosely pinned down, but it must be honest about that.
    amp = _run(world)["amplification"]
    assert amp["ci_low"] <= 1.5 <= amp["ci_high"]
    assert amp["ci_high"] - amp["ci_low"] > 0.5
    assert amp["n_years"] == len(YEARS)


def test_amplification_is_accurate_when_the_data_are_clean():
    from app.context import _amplification

    rng = random.Random(2)
    glob = {y: 0.02 * (y - 1981) + rng.gauss(0, 0.04) for y in YEARS}
    local = {y: 1.5 * glob[y] + rng.gauss(0, 0.03) for y in YEARS}
    amp = _amplification(local, glob)
    assert amp["beta"] == pytest.approx(1.5, abs=0.1)
    assert amp["ci_low"] < 1.5 < amp["ci_high"]
    assert amp["r2"] > 0.9
    assert _amplification({1981: 1.0, 1982: 2.0}, {1981: 1.0, 1982: 2.0}) is None  # too few shared years


def test_zonal_check_picks_the_right_band_and_compares_ranges(world):
    z = _run(world, lat=42.0)["zonal"]
    assert z["band"] == "24N-44N"
    assert z["band_label"] == "24°N–44°N"
    assert z["band_slope_per_decade"] == pytest.approx(0.3, abs=0.1)
    assert z["ranges_overlap"] is True
    assert _run(world, lat=-60.0)["zonal"]["band"] == "64S-44S"


def test_non_temperature_variables_skip_global_and_zonal(world):
    info = VARIABLES["PRECTOTCORR"]
    values = [world["local"][y] + 5 for y in YEARS]
    stats = annual_core(info, YEARS, values)["stats"]
    ctx = asyncio.run(build_context(info, 42.0, YEARS, values, stats))
    assert ctx["amplification"] is None and ctx["zonal"] is None
    assert ctx["suspects"]  # rhythms still apply


def test_a_failing_stream_is_reported_not_fatal(world, monkeypatch):
    real = streams.get_monthly

    async def flaky(stream_id):
        if stream_id == "oni":
            raise streams.StreamError("down")
        return await real(stream_id)

    monkeypatch.setattr(streams, "get_monthly", flaky)
    ctx = _run(world)
    oni = next(s for s in ctx["suspects"] if s["id"] == "oni")
    assert oni["ok"] is False
    assert ctx["enso_adjusted"] is None
    assert any("ENSO" in e for e in ctx["errors"])
    assert next(s for s in ctx["suspects"] if s["id"] == "pdo")["ok"]  # others unaffected
    assert ctx["amplification"] is not None
