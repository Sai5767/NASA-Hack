"""Offline unit and integration tests for the Meteomatics live-weather adapter (GET /api/live-weather)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.meteomatics import (
    MAX_RESPONSE_BYTES,
    METEOMATICS_PARAMETERS,
    MeteomaticsProvider,
    build_meteomatics_url,
    clear_meteomatics_cache,
    fetch_live_weather,
    meteomatics_health,
    parse_meteomatics_json,
)
from app.resilience import HEALTH_REGISTRY, redact_secrets

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_meteomatics_state(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_meteomatics_cache()
    HEALTH_REGISTRY.clear()
    monkeypatch.delenv("METEOMATICS_USERNAME", raising=False)
    monkeypatch.delenv("METEOMATICS_PASSWORD", raising=False)
    monkeypatch.delenv("METEOMATICS_BASE_URL", raising=False)


def _sample_meteomatics_payload(username_in_response: str = "secret_meteomatics_user_99") -> dict:
    return {
        "version": "3.0",
        "user": username_in_response,
        "dateGenerated": "2026-11-15T13:00:00Z",
        "status": "OK",
        "data": [
            {
                "parameter": "t_2m:C",
                "coordinates": [
                    {
                        "lat": 52.5206,
                        "lon": 13.4618,
                        "dates": [
                            {"date": "2026-11-15T13:00:00Z", "value": 9.4},
                            {"date": "2026-11-15T14:00:00Z", "value": 10.1},
                            {"date": "2026-11-15T15:00:00Z", "value": -999.0},
                        ],
                    }
                ],
            },
            {
                "parameter": "precip_1h:mm",
                "coordinates": [
                    {
                        "lat": 52.5206,
                        "lon": 13.4618,
                        "dates": [
                            {"date": "2026-11-15T13:00:00Z", "value": 0.0},
                            {"date": "2026-11-15T14:00:00Z", "value": 1.25},
                            {"date": "2026-11-15T15:00:00Z", "value": None},
                        ],
                    }
                ],
            },
            {
                "parameter": "total_cloud_cover:p",
                "coordinates": [
                    {
                        "lat": 52.5206,
                        "lon": 13.4618,
                        "dates": [
                            {"date": "2026-11-15T13:00:00Z", "value": 64.0},
                            {"date": "2026-11-15T14:00:00Z", "value": 78.5},
                            {"date": "2026-11-15T15:00:00Z", "value": -666.0},
                        ],
                    }
                ],
            },
            {
                "parameter": "wind_speed_10m:ms",
                "coordinates": [
                    {
                        "lat": 52.5206,
                        "lon": 13.4618,
                        "dates": [
                            {"date": "2026-11-15T13:00:00Z", "value": 4.2},
                            {"date": "2026-11-15T14:00:00Z", "value": 5.1},
                        ],
                    }
                ],
            },
        ],
    }


def test_url_construction_and_no_embedded_credentials() -> None:
    start = datetime(2026, 11, 15, 13, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 11, 16, 13, 0, 0, tzinfo=timezone.utc)
    url = build_meteomatics_url("https://api.meteomatics.com", start, end, 52.520551, 13.461804)
    assert url == (
        "https://api.meteomatics.com/"
        "2026-11-15T13:00:00Z--2026-11-16T13:00:00Z:PT1H/"
        "t_2m:C,precip_1h:mm,total_cloud_cover:p,wind_speed_10m:ms/"
        "52.5206,13.4618/json"
    )
    with pytest.raises(ValueError, match="embedded credentials"):
        build_meteomatics_url("https://user:pass@api.meteomatics.com", start, end, 52.52, 13.46)


def test_missing_credentials_returns_typed_unconfigured_state() -> None:
    res = client.get("/api/live-weather", params={"lat": 52.520551, "lon": 13.461804, "hours": 24})
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is False
    assert body["status"] == "unconfigured"
    assert body["provider"] == "Meteomatics"
    assert body["series"] == []
    assert body["current"] is None
    assert "METEOMATICS_USERNAME" in body["reason"]
    assert "NASA POWER" in body["source_note"]

    health = client.get("/api/health/details").json()
    mm_health = health["features"]["meteomatics"]
    assert mm_health["status"] == "unconfigured"
    assert mm_health["configured"] is False
    assert mm_health["available"] is False


@pytest.mark.anyio
async def test_basic_auth_and_json_normalization_strip_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    secret_user = "mm_test_account_user_42"
    secret_pass = "mm_test_super_secret_pw_99"
    monkeypatch.setenv("METEOMATICS_USERNAME", secret_user)
    monkeypatch.setenv("METEOMATICS_PASSWORD", secret_pass)

    captured: dict = {}

    async def fake_transport(**kwargs) -> httpx.Response:
        captured.update(kwargs)
        payload = _sample_meteomatics_payload(username_in_response=secret_user)
        return httpx.Response(200, content=json.dumps(payload).encode("utf-8"))

    now = datetime(2026, 11, 15, 13, 27, 45, tzinfo=timezone.utc)
    result = await fetch_live_weather(
        52.520551,
        13.461804,
        24,
        transport_call=fake_transport,
        now_utc=now,
    )

    # Verify Basic Auth object was used and URL has no credentials
    assert isinstance(captured["auth"], httpx.BasicAuth)
    assert secret_user not in captured["url"]
    assert secret_pass not in captured["url"]
    assert captured["url"].endswith("/52.5206,13.4618/json")

    # Verify all four parameters and missing/sentinel handling
    assert result["available"] is True
    assert result["status"] == "available"
    assert result["stale"] is False
    assert result["parameters"] == METEOMATICS_PARAMETERS
    assert len(result["series"]) == 3

    first = result["series"][0]
    assert first == {
        "time": "2026-11-15T13:00:00Z",
        "temperature_c": 9.4,
        "precipitation_1h_mm": 0.0,
        "cloud_cover_percent": 64.0,
        "wind_speed_10m_ms": 4.2,
    }
    assert result["current"] == first

    # Third hour had sentinel (-999, -666, None, omitted wind) -> all preserved as None, never interpolated
    third = result["series"][2]
    assert third == {
        "time": "2026-11-15T15:00:00Z",
        "temperature_c": None,
        "precipitation_1h_mm": None,
        "cloud_cover_percent": None,
        "wind_speed_10m_ms": None,
    }

    # Verify neither username nor password appears anywhere in serialized response or health details
    serialized = json.dumps(result)
    assert secret_user not in serialized
    assert secret_pass not in serialized
    assert "user" not in result["provider_metadata"]

    health_serialized = json.dumps(meteomatics_health())
    assert secret_user not in health_serialized
    assert secret_pass not in health_serialized


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status_code", "expected_substr"),
    [
        (401, "authentication failed"),
        (403, "authentication failed"),
        (429, "rate limit"),
        (400, "rejected the requested parameter or forecast range"),
        (503, "HTTP 503"),
    ],
)
async def test_upstream_http_errors_never_leak_secrets(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    expected_substr: str,
) -> None:
    secret_user = "mm_secret_user_abc"
    secret_pass = "mm_secret_pass_xyz"
    monkeypatch.setenv("METEOMATICS_USERNAME", secret_user)
    monkeypatch.setenv("METEOMATICS_PASSWORD", secret_pass)

    async def failing_transport(**kwargs) -> httpx.Response:
        # Upstream body deliberately echoes credentials to verify our adapter never forwards it
        body = f"Upstream error for user={secret_user} pass={secret_pass}"
        return httpx.Response(status_code, content=body.encode("utf-8"))

    result = await fetch_live_weather(52.52, 13.46, 24, transport_call=failing_transport)
    assert result["available"] is False
    assert result["status"] == "unavailable"
    assert result["series"] == []
    assert expected_substr.lower() in result["reason"].lower()

    dumped = json.dumps(result)
    assert secret_user not in dumped
    assert secret_pass not in dumped


@pytest.mark.anyio
async def test_timeout_malformed_json_and_oversized_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_user_timeout")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_pass_timeout")

    async def timeout_transport(**kwargs) -> httpx.Response:
        raise httpx.ReadTimeout("Read timed out connecting to api.meteomatics.com")

    res_timeout = await fetch_live_weather(40.0, -74.0, 12, transport_call=timeout_transport)
    assert res_timeout["available"] is False
    assert "timed out" in res_timeout["reason"].lower()

    async def malformed_transport(**kwargs) -> httpx.Response:
        return httpx.Response(200, content=b"<html>Not JSON</html>")

    res_malformed = await fetch_live_weather(41.0, -74.0, 12, transport_call=malformed_transport)
    assert res_malformed["available"] is False
    assert "malformed json" in res_malformed["reason"].lower()

    async def huge_transport(**kwargs) -> httpx.Response:
        return httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 100))

    res_huge = await fetch_live_weather(42.0, -74.0, 12, transport_call=huge_transport)
    assert res_huge["available"] is False
    assert "maximum allowed size" in res_huge["reason"].lower()


@pytest.mark.anyio
async def test_stale_cache_fallback_on_provider_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_cache_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_cache_pass")
    monkeypatch.setenv("METEOMATICS_CACHE_TTL_SECONDS", "60")

    should_fail = False

    async def toggle_transport(**kwargs) -> httpx.Response:
        if should_fail:
            return httpx.Response(503, content=b"Service Unavailable")
        return httpx.Response(200, content=json.dumps(_sample_meteomatics_payload()).encode("utf-8"))

    # 1. Populate fresh cache
    first = await fetch_live_weather(52.52, 13.46, 24, transport_call=toggle_transport)
    assert first["available"] is True
    assert first["stale"] is False

    # 2. Expire the cache entry artificially by setting its monotonic timestamp into the past
    from app.meteomatics import _WEATHER_CACHE

    for k, (_, epoch_ts, val) in list(_WEATHER_CACHE._store.items()):
        _WEATHER_CACHE._store[k] = (-10_000.0, epoch_ts, val)

    # 3. Trigger upstream failure -> should serve stale cached weather with stale=True
    should_fail = True
    second = await fetch_live_weather(52.52, 13.46, 24, transport_call=toggle_transport)
    assert second["available"] is True
    assert second["stale"] is True
    assert second["status"] == "stale"
    assert len(second["series"]) == 3
    assert "cached meteomatics weather" in second["reason"].lower()


def test_coordinate_and_hours_validation() -> None:
    assert client.get("/api/live-weather", params={"lat": 95, "lon": 0, "hours": 24}).status_code == 422
    assert client.get("/api/live-weather", params={"lat": 0, "lon": -190, "hours": 24}).status_code == 422
    assert client.get("/api/live-weather", params={"lat": 0, "lon": 0, "hours": 0}).status_code == 422
    assert client.get("/api/live-weather", params={"lat": 0, "lon": 0, "hours": 73}).status_code == 422


def test_redact_secrets_scrubs_meteomatics_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "my_meteomatics_login")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "my_meteomatics_secret_987")

    raw = (
        "Error calling https://my_meteomatics_login:my_meteomatics_secret_987@api.meteomatics.com "
        "with Authorization: Basic dXNlcjpwYXNz and username=my_meteomatics_login password=my_meteomatics_secret_987"
    )
    scrubbed = redact_secrets(raw)
    assert "my_meteomatics_login" not in scrubbed
    assert "my_meteomatics_secret_987" not in scrubbed
    assert "dXNlcjpwYXNz" not in scrubbed
