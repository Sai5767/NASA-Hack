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
