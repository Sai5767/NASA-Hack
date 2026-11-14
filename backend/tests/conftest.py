"""Shared helpers: synthetic monthly series so the whole pipeline can be tested offline."""

import math
import random
import zlib

import pytest


def make_monthly(
    start_year: int = 1981,
    end_year: int = 2024,
    trend_per_year: float = 0.05,
    noise_sd: float = 0.4,
    seed: int = 1,
    base: float = 10.0,
    seasonal_amplitude: float = 8.0,
) -> dict[str, float | None]:
    """Monthly values = base + seasonal cycle + linear trend + noise, keyed like NASA POWER ("YYYYMM")."""
    rng = random.Random(seed)
    series: dict[str, float | None] = {}
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            seasonal = seasonal_amplitude * math.sin(2 * math.pi * (month - 1) / 12)
            value = base + seasonal + trend_per_year * (year - start_year) + rng.gauss(0, noise_sd)
            series[f"{year}{month:02d}"] = value
    return series


@pytest.fixture
def fake_power(monkeypatch):
    """Replace the NASA POWER call: trend sign follows latitude, noise is seeded by variable name."""

    async def fake_fetch(parameters, lat, lon, start, end):
        out = {}
        for parameter in parameters:
            seed = zlib.crc32(f"{parameter}{lat}{lon}".encode()) % 10_000
            trend = 0.06 if lat >= 0 else -0.06
            out[parameter] = make_monthly(start, end, trend_per_year=trend, noise_sd=0.5, seed=seed)
        return out

    monkeypatch.setattr("app.analysis.fetch_monthly_multi", fake_fetch)
    return fake_fetch


STREAM_SPECS = {
    # id: (first year, last year, trend per year, noise sd, seasonal amplitude, base value)
    "gistemp_global": (1880, 2025, 0.012, 0.08, 0.0, 0.0),
    "co2_mlo": (1958, 2025, 1.8, 0.4, 3.0, 320.0),
    "arctic_ice": (1979, 2025, -0.05, 0.25, 4.5, 11.0),
    "antarctic_ice": (1979, 2025, 0.0, 0.5, 7.0, 11.0),
    "oni": (1950, 2025, 0.0, 1.0, 0.0, 0.0),
    "pdo": (1950, 2025, 0.0, 1.0, 0.0, 0.0),
    "nao": (1950, 2025, 0.0, 1.0, 0.0, 0.0),
}


@pytest.fixture
def fake_streams(monkeypatch):
    """Replace the public planet streams with synthetic monthly series and zonal bands."""
    import random

    async def fake_monthly(stream_id):
        first, last, trend, noise, amp, base = STREAM_SPECS[stream_id]
        seed = zlib.crc32(stream_id.encode()) % 10_000
        return make_monthly(first, last, trend_per_year=trend, noise_sd=noise, seed=seed, base=base, seasonal_amplitude=amp)

    async def fake_zonal():
        rng = random.Random(4)
        return {
            name: {y: 0.02 * (y - 1950) + rng.gauss(0, 0.2) for y in range(1950, 2026)}
            for _, _, name in __import__("app.streams", fromlist=["ZONAL_BANDS"]).ZONAL_BANDS
        }

    monkeypatch.setattr("app.streams.get_monthly", fake_monthly)
    monkeypatch.setattr("app.streams.get_zonal", fake_zonal)
    return fake_monthly
