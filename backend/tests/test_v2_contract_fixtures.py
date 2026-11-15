"""Contract and fixture tests for V2 routes.

Verifies that `backend/tests/fixtures/v2_fixtures.json` contains deterministic fixture payloads
for every new/extended V2 route and that their schemas match the live FastAPI responses.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import news as news_module
from app.main import app
from app.meteomatics import clear_meteomatics_cache, fetch_live_weather

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "v2_fixtures.json"
client = TestClient(app)


class _FixtureWeather:
    """A fixed three-hour Meteomatics reply, so the 'available' fixture needs no network and no credentials."""

    async def fetch_hourly(self, lat, lon, hours, *, now_utc=None):
        series = [
            {
                "time": f"2026-11-15T{14 + i}:00:00Z",
                "temperature_c": 8.0 + 0.5 * i,
                "precipitation_1h_mm": 0.0,
                "cloud_cover_percent": 40.0 + 5.0 * i,
                "wind_speed_10m_ms": None if i == 2 else 3.2,  # a value the provider did not supply stays null
            }
            for i in range(3)
        ]
        return series, {"note": "fixture"}, "2026-11-15T14:00:00Z", "2026-11-15T17:00:00Z"


def build_deterministic_fixtures() -> dict:
    """Produce deterministic fixture responses for all V2 routes (offline)."""
    # This is called with fake_power active in tests or to refresh the saved fixture file.
    trend_resp = client.get(
        "/api/trend",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 1981, "end_year": 2024},
    ).json()
    trend_resp["case_signature"] = "v2|T2M|33.450|-112.070|1981|2024|fixture000000000000000000"

    frames_resp = client.get(
        "/api/monthly-frames",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 2024, "end_year": 2024, "n": 2, "size": 2.0},
    ).json()
    frames_resp["provenance"]["fetched_at"] = "2026-11-15T00:00:00Z"

    forecast_eligible = client.get(
        "/api/monthly-forecast",
        params={"variable": "T2M", "lat": 33.45, "lon": -112.07, "start_year": 1981, "end_year": 2024, "horizons": 3, "n": 2, "size": 2.0},
    ).json()
    forecast_eligible["provenance"]["fetched_at"] = "2026-11-15T00:00:00Z"

    forecast_withheld = client.get(
        "/api/monthly-forecast",
        params={"variable": "WS2M", "lat": 33.45, "lon": -112.07, "start_year": 1981, "end_year": 2024, "horizons": 3, "n": 2, "size": 2.0},
    ).json()
    forecast_withheld["provenance"]["fetched_at"] = "2026-11-15T00:00:00Z"

    explanation_fallback = client.post(
        "/api/explanations",
        json={"variable": "T2M", "lat": 70.0, "lon": -150.0, "start_year": 1981, "end_year": 2024, "question": "Why is the Arctic warming?"},
    ).json()
    explanation_fallback["generated_at"] = "2026-11-15T00:00:00Z"
    explanation_fallback["case_signature"] = "v2|T2M|70.000|-150.000|1981|2024|fixture000000000000000000"

    explanation_ok = {
        **explanation_fallback,
        "status": "ok",
        "fallback": False,
        "fallback_reason": None,
    }

    health_resp = client.get("/api/health/details").json()
    health_resp["checked_at"] = "2026-11-15T00:00:00Z"
    health_resp["version"] = "v2-fixture"

    news_resp = {
        "items": [
            {
                "id": "news_9f4b2c8e1a20",
                "title": "Severe heatwave advisory issued across northern India as temperatures surge",
                "publisher": "BBC News",
                "canonical_url": "https://www.bbc.com/news/science-environment-101",
                "url": "https://www.bbc.com/news/science-environment-101",
                "published_at": "2026-11-14T12:00:00Z",
                "category": "heat_wildfire",
                "severity": "amber",
                "severity_label": "Weather / environmental watch",
                "lat": 28.61,
                "lon": 77.21,
                "location_id": "delhi",
                "location_name": "Delhi",
                "location_source": "saved_location",
                "coordinate_precision": "city_centroid",
                "uncertainty_km": 50,
                "label": news_module.NEWS_CONTEXT_LABEL,
            },
            {
                "id": "news_3d1a7e904b11",
                "title": "NASA and NOAA researchers publish new satellite study on long-term regional climate trends",
                "publisher": "NASA Earth Observatory",
                "canonical_url": "https://earthobservatory.nasa.gov/images/150001/climate-study",
                "url": "https://earthobservatory.nasa.gov/images/150001/climate-study",
                "published_at": "2026-11-14T09:00:00Z",
                "category": "climate_science",
                "severity": "green",
                "severity_label": "Informational science / environment context",
                "lat": 33.45,
                "lon": -112.07,
                "location_id": "phoenix",
                "location_name": "Phoenix",
                "location_source": "saved_location",
                "coordinate_precision": "city_centroid",
                "uncertainty_km": 50,
                "label": news_module.NEWS_CONTEXT_LABEL,
            },
        ],
        "fetched_at": "2026-11-15T00:00:00Z",
        "stale": False,
        "cache_age_seconds": 0.0,
        "provider": "gdelt",
        "partial_failures": [],
        "locations_queried": [
            {"id": "delhi", "name": "Delhi", "lat": 28.61, "lon": 77.21, "source": "saved_location"},
            {"id": "phoenix", "name": "Phoenix", "lat": 33.45, "lon": -112.07, "source": "saved_location"},
        ],
        "empty_reason": None,
        "context_note": "News markers provide regional environmental context only; they are not scientific trend evidence.",
    }

    fixed_now = datetime(2026, 11, 15, 14, 5, tzinfo=timezone.utc)
    clear_meteomatics_cache()
    with patch.dict(os.environ):
        for name in ("METEOMATICS_USERNAME", "METEOMATICS_PASSWORD"):
            os.environ.pop(name, None)
        live_weather_unconfigured = asyncio.run(fetch_live_weather(52.52, 13.46, 3, now_utc=fixed_now))
    live_weather_unconfigured["fetched_at"] = "2026-11-15T14:05:00Z"

    clear_meteomatics_cache()
    live_weather_available = asyncio.run(fetch_live_weather(52.52, 13.46, 3, provider=_FixtureWeather(), now_utc=fixed_now))
    live_weather_available["fetched_at"] = "2026-11-15T14:05:00Z"
    clear_meteomatics_cache()

    return {
        "trend_with_evidence_trace": {
            "variable": trend_resp["variable"],
            "location": trend_resp["location"],
            "period": trend_resp["period"],
            "quality": trend_resp["quality"],
            "stats": trend_resp["stats"],
            "ols": trend_resp["ols"],
            "grade": trend_resp["grade"],
            "checks": trend_resp["checks"],
            "caveats": trend_resp["caveats"],
            "case_signature": trend_resp["case_signature"],
            "evidence_trace": trend_resp["evidence_trace"],
        },
        "monthly_frames": frames_resp,
        "monthly_forecast_eligible": forecast_eligible,
        "monthly_forecast_withheld": forecast_withheld,
        "explanations_ok": explanation_ok,
        "explanations_fallback": explanation_fallback,
        "news": news_resp,
        "health_details": health_resp,
        "live_weather_unconfigured": live_weather_unconfigured,
        "live_weather_available": live_weather_available,
    }


def test_saved_v2_fixtures_exist_and_match_contract_keys(fake_power):
    assert FIXTURE_PATH.is_file(), f"Missing fixture file at {FIXTURE_PATH}"
    saved = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    live = build_deterministic_fixtures()

    assert set(saved.keys()) == set(live.keys())
    for route_key in live:
        assert set(saved[route_key].keys()) == set(live[route_key].keys()), route_key

    # Verify nested evidence_trace keys match
    assert set(saved["trend_with_evidence_trace"]["evidence_trace"].keys()) == set(
        live["trend_with_evidence_trace"]["evidence_trace"].keys()
    )
    assert saved["monthly_frames"]["frames"][0]["kind"] == "observed"
    assert saved["monthly_forecast_eligible"]["eligible"] is True
    assert saved["monthly_forecast_eligible"]["frames"][0]["badge"] == "Forecast — not observed data"
    assert saved["monthly_forecast_withheld"]["eligible"] is False
    assert saved["monthly_forecast_withheld"]["frames"] == []
    assert saved["explanations_ok"]["disclaimer"] == "These are possible explanations, not proof that one cause created this local trend."
    assert saved["news"]["items"][0]["label"] == "news context, not scientific evidence"

    # Live weather: both states exist, are labelled as a separate source, and never carry a credential
    unconfigured, available = saved["live_weather_unconfigured"], saved["live_weather_available"]
    assert (unconfigured["available"], unconfigured["status"], unconfigured["series"]) == (False, "unconfigured", [])
    assert (available["available"], available["status"], available["stale"]) == (True, "available", False)
    assert available["current"] == available["series"][0]
    assert available["series"][2]["wind_speed_10m_ms"] is None  # null preserved, never interpolated
    for payload in (unconfigured, available):
        assert payload["label"] == "Meteomatics weather forecast — not NASA trend data"
        assert "separate from NASA POWER" in payload["source_note"]
        assert "password" not in json.dumps(payload).lower().replace("meteomatics_password", "")

    # The health report lists Meteomatics too
    assert "meteomatics" in saved["health_details"]["features"]
