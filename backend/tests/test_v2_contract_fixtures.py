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

    # News items are produced by the real normaliser (news.normalize_and_deduplicate_articles) from fixed raw articles, so
    # the fixture always has exactly the live item shape, publisher_verified included (one verified, one not).
    delhi = news_module.NewsLocationQuery("delhi", "Delhi", 28.61, 77.21, "city", "city_centroid", 50, "saved_location")
    phoenix = news_module.NewsLocationQuery("phoenix", "Phoenix", 33.45, -112.07, "city", "city_centroid", 50, "saved_location")
    news_items = news_module.normalize_and_deduplicate_articles(
        [
            (
                delhi,
                {
                    "title": "Severe heatwave advisory issued across northern India as temperatures surge",
                    "url": "https://www.bbc.com/news/science-environment-101",
                    "publisher": "BBC News",
                    "seendate": "20261114T120000Z",
                },
            ),
            (
                phoenix,
                {
                    "title": "Local blog says flooding closed several desert roads after storms",
                    "url": "https://desert-weather-notes.example.org/2026/11/flooding",
                    "publisher": "Desert Weather Notes",
                    "seendate": "20261114T090000Z",
                },
            ),
        ]
    )
    news_resp = {
        "items": news_items,
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

    # Item-level shapes the frontend depends on (top-level keys alone would miss these)
    live_news_keys = set(live["news"]["items"][0])
    for item in saved["news"]["items"]:
        assert set(item) == live_news_keys
        assert isinstance(item["publisher_verified"], bool)
    assert [i["publisher_verified"] for i in saved["news"]["items"]] == [True, False]
    calibration_keys = {
        "nominal_coverage", "empirical_coverage", "min_required_coverage", "n_test_origins", "n_test_pairs",
        "interval_half_width_by_horizon", "passed",
    }
    assert set(saved["monthly_forecast_eligible"]["calibration"]) == calibration_keys
    assert set(live["monthly_forecast_eligible"]["calibration"]) == calibration_keys
    assert set(saved["monthly_forecast_eligible"]["alignment"]) == {"common_end_month", "cells_trimmed_to_common_end"}
    for key in ("explanations_ok", "explanations_fallback"):
        assert "retry_after_seconds" in saved[key]
    ai = saved["health_details"]["features"]["ai_explanations"]
    assert {"key_present", "model_configured", "web_search_tool", "search_context_size"} <= set(ai)
    assert ai["web_search_tool"] == "web_search"
    assert set(saved["health_details"]["features"]["meteomatics"]["rate_limit"]) == set(
        live["health_details"]["features"]["meteomatics"]["rate_limit"]
    )

    # Live weather: both states exist, are labelled as a separate source, and never carry a credential
    unconfigured, available = saved["live_weather_unconfigured"], saved["live_weather_available"]
    assert (unconfigured["available"], unconfigured["status"], unconfigured["series"]) == (False, "unconfigured", [])
    assert (available["available"], available["status"], available["stale"]) == (True, "available", False)
    assert available["current"] == available["series"][0]
    assert available["series"][2]["wind_speed_10m_ms"] is None  # null preserved, never interpolated
    for payload in (unconfigured, available):
        assert set(payload) == set(live["live_weather_available"])
        assert "retry_after_seconds" in payload
        assert payload["label"] == "Meteomatics weather forecast — not NASA trend data"
        assert "separate from NASA POWER" in payload["source_note"]
        assert "password" not in json.dumps(payload).lower().replace("meteomatics_password", "")

    # The health report lists Meteomatics too
    assert "meteomatics" in saved["health_details"]["features"]


DOCS = Path(__file__).resolve().parents[2] / "docs"


def test_backend_docs_contain_no_control_characters():
    # A16: docs/V2_BACKEND_HANDOFF.md held literal backspace bytes where "\b" was meant ("ackend/.env").
    for name in ("V2_API_CONTRACT.md", "V2_BACKEND_HANDOFF.md", "V2_BACKEND_REPAIR_HANDOFF.md"):
        path = DOCS / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        bad = sorted({hex(ord(c)) for c in text if ord(c) < 32 and c not in "\n\r\t"})
        assert not bad, f"{name} contains control characters {bad}"
    assert "`backend/.env`" in (DOCS / "V2_BACKEND_HANDOFF.md").read_text(encoding="utf-8")


def test_no_openai_model_name_is_hard_coded_in_the_backend():
    # Phase 0 item A: the model is the owner's choice (OPENAI_EXPLANATION_MODEL), never a default in code.
    import re

    app_dir = Path(__file__).resolve().parents[1] / "app"
    pattern = re.compile(r"""["'](gpt-[\w.\-]+|o\d[\w.\-]*|chatgpt-[\w.\-]+)["']""")
    for source in app_dir.glob("*.py"):
        found = pattern.findall(source.read_text(encoding="utf-8"))
        assert not found, f"{source.name} hard-codes a model name: {found}"
