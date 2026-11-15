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

# The sample payload below starts at 13:00 UTC on 2026-11-15; served replies always start at the current UTC hour (A8).
_SAMPLE_NOW = datetime(2026, 11, 15, 13, 5, tzinfo=timezone.utc)


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
    first = await fetch_live_weather(52.52, 13.46, 24, transport_call=toggle_transport, now_utc=_SAMPLE_NOW)
    assert first["available"] is True
    assert first["stale"] is False

    # 2. Expire the cache entry artificially by setting its monotonic timestamp into the past
    from app.meteomatics import _WEATHER_CACHE

    for k, (_, epoch_ts, val) in list(_WEATHER_CACHE._store.items()):
        _WEATHER_CACHE._store[k] = (-10_000.0, epoch_ts, val)

    # 3. Trigger upstream failure -> should serve stale cached weather with stale=True
    should_fail = True
    second = await fetch_live_weather(52.52, 13.46, 24, transport_call=toggle_transport, now_utc=_SAMPLE_NOW)
    assert second["available"] is True
    assert second["stale"] is True
    assert second["status"] == "stale"
    assert len(second["series"]) == 3
    assert "cached meteomatics weather" in second["reason"].lower()


@pytest.mark.anyio
async def test_rate_limit_is_not_retried_but_a_transient_503_is_retried_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_retry_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_retry_pass")
    calls = {"n": 0}

    async def rate_limited(**kwargs) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, content=b"slow down")

    limited = await fetch_live_weather(10.0, 10.0, 6, transport_call=rate_limited)
    assert limited["status"] == "unavailable" and "rate limit" in limited["reason"].lower()
    assert calls["n"] == 1  # a used-up quota is not hit again straight away

    calls["n"] = 0

    async def flaky(**kwargs) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, content=b"busy")
        return httpx.Response(200, content=json.dumps(_sample_meteomatics_payload()).encode("utf-8"))

    recovered = await fetch_live_weather(11.0, 11.0, 6, transport_call=flaky)
    assert recovered["available"] is True
    assert calls["n"] == 2  # one bounded retry for a transient server error


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


# --------------------------------------------------------------------------- Phase 0 item B, A8, A9


def _ok_transport(counter: dict):
    async def transport(**kwargs) -> httpx.Response:
        counter["n"] = counter.get("n", 0) + 1
        return httpx.Response(200, content=json.dumps(_sample_meteomatics_payload()).encode("utf-8"))

    return transport


@pytest.mark.anyio
async def test_per_visitor_quota_stops_upstream_calls_and_returns_a_safe_rate_limited_reply(monkeypatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_quota_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_quota_pass_77")
    monkeypatch.setenv("METEOMATICS_RATE_LIMIT_MAX", "2")
    calls: dict = {}
    transport = _ok_transport(calls)

    for lat in (10.0, 11.0):
        ok = await fetch_live_weather(lat, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="visitor-a")
        assert ok["status"] == "available"
    # A cache hit is free: it does not count against the quota
    again = await fetch_live_weather(10.0, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="visitor-a")
    assert again["status"] == "available" and calls["n"] == 2

    limited = await fetch_live_weather(12.0, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="visitor-a")
    assert calls["n"] == 2  # Meteomatics was not called
    assert limited["available"] is False and limited["status"] == "rate_limited"
    assert limited["retry_after_seconds"] >= 1 and limited["series"] == [] and limited["current"] is None
    assert "mm_quota" not in json.dumps(limited)
    assert limited["label"] == "Meteomatics weather forecast — not NASA trend data"

    # Another visitor has an independent allowance
    other = await fetch_live_weather(12.0, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="visitor-b")
    assert other["status"] == "available" and calls["n"] == 3


@pytest.mark.anyio
async def test_a_rate_limited_visitor_still_gets_the_cached_reply_for_that_place(monkeypatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_quota_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_quota_pass_77")
    monkeypatch.setenv("METEOMATICS_RATE_LIMIT_MAX", "1")
    calls: dict = {}
    transport = _ok_transport(calls)
    await fetch_live_weather(10.0, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="v")

    from app.meteomatics import _WEATHER_CACHE

    for k, (_, epoch_ts, val) in list(_WEATHER_CACHE._store.items()):
        _WEATHER_CACHE._store[k] = (-10_000.0, epoch_ts, val)  # expired, but kept for stale use

    stale = await fetch_live_weather(10.0, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key="v")
    assert calls["n"] == 1
    assert stale["available"] is True and stale["status"] == "stale" and stale["stale"] is True
    assert stale["retry_after_seconds"] >= 1
    assert "request limit" in stale["reason"].lower()


@pytest.mark.anyio
async def test_a_whole_server_budget_caps_meteomatics_calls_across_all_visitors(monkeypatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_quota_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_quota_pass_77")
    monkeypatch.setenv("METEOMATICS_GLOBAL_RATE_LIMIT_MAX", "3")
    calls: dict = {}
    transport = _ok_transport(calls)
    statuses = [
        (await fetch_live_weather(10.0 + i, 10.0, 6, transport_call=transport, now_utc=_SAMPLE_NOW, client_key=f"v{i}"))["status"]
        for i in range(5)
    ]
    assert statuses == ["available"] * 3 + ["rate_limited"] * 2
    assert calls["n"] == 3


@pytest.mark.anyio
async def test_cached_weather_is_rebased_on_the_current_utc_hour(monkeypatch) -> None:
    # A8: a reply fetched at 13:55 must not be served as "current" at 14:05.
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_hour_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_hour_pass")
    calls: dict = {}
    fail = {"on": False}

    async def transport(**kwargs) -> httpx.Response:
        calls["n"] = calls.get("n", 0) + 1
        if fail["on"]:
            return httpx.Response(503)
        return httpx.Response(200, content=json.dumps(_sample_meteomatics_payload()).encode("utf-8"))

    at_1355 = datetime(2026, 11, 15, 13, 55, tzinfo=timezone.utc)
    at_1405 = datetime(2026, 11, 15, 14, 5, tzinfo=timezone.utc)
    first = await fetch_live_weather(52.52, 13.46, 24, transport_call=transport, now_utc=at_1355)
    assert first["current"]["time"] == "2026-11-15T13:00:00Z"
    # Same hour, a nearby caller: served from cache with that caller's own coordinates
    near = await fetch_live_weather(52.5211, 13.4599, 24, transport_call=transport, now_utc=at_1355)
    assert calls["n"] == 1 and near["location"] == {"lat": 52.5211, "lon": 13.4599}

    # Next hour: the cached reply is not fresh any more, so Meteomatics is asked again...
    fail["on"] = True
    later = await fetch_live_weather(52.52, 13.46, 24, transport_call=transport, now_utc=at_1405)
    assert calls["n"] > 1
    # ...and when that refresh fails, the stale copy is trimmed to start at the current hour.
    assert later["status"] == "stale"
    assert later["request"]["start"] == "2026-11-15T14:00:00Z"
    assert later["current"]["time"] == "2026-11-15T14:00:00Z" == later["series"][0]["time"]
    assert all(row["time"] >= "2026-11-15T14:00:00Z" for row in later["series"])


@pytest.mark.anyio
async def test_a_malformed_base_url_is_reported_unavailable_not_a_server_error(monkeypatch) -> None:
    # A9
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_cfg_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_cfg_pass")
    monkeypatch.setenv("METEOMATICS_BASE_URL", "https://someone@api.meteomatics.com")
    res = client.get("/api/live-weather", params={"lat": 52.52, "lon": 13.46, "hours": 6})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "unavailable" and body["available"] is False
    assert "address setting is invalid" in body["reason"]
    assert "someone" not in res.text and "mm_cfg_pass" not in res.text


_REAL_ASYNC_CLIENT = httpx.AsyncClient  # captured once, so the helper below can be applied twice in one test


def _serve_meteomatics(monkeypatch, handler) -> None:
    monkeypatch.setattr(
        "app.meteomatics.httpx.AsyncClient",
        lambda *a, **kw: _REAL_ASYNC_CLIENT(*a, transport=httpx.MockTransport(handler), **kw),
    )


@pytest.mark.anyio
async def test_real_path_streams_and_refuses_an_oversize_body_without_a_length_header(monkeypatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_stream_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_stream_pass")
    produced = {"bytes": 0}

    async def endless():
        for _ in range(200):  # would be 200 x 64 KB = 12.8 MB if fully downloaded
            produced["bytes"] += 65536
            yield b"x" * 65536

    _serve_meteomatics(monkeypatch, lambda request: httpx.Response(200, content=endless()))
    res = await fetch_live_weather(52.52, 13.46, 6, now_utc=_SAMPLE_NOW)
    assert res["available"] is False and "larger than the allowed size" in res["reason"]
    assert produced["bytes"] <= MAX_RESPONSE_BYTES + 2 * 65536  # stopped soon after the cap, not after 12.8 MB


@pytest.mark.anyio
async def test_real_path_sends_basic_auth_reads_gzip_and_never_reads_error_bodies(monkeypatch) -> None:
    import gzip

    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_stream_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_stream_pass")
    seen = {}

    def ok(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        seen["url"] = str(request.url)
        data = gzip.compress(json.dumps(_sample_meteomatics_payload()).encode())
        return httpx.Response(200, headers={"content-encoding": "gzip"}, content=data)

    _serve_meteomatics(monkeypatch, ok)
    res = await fetch_live_weather(52.52, 13.46, 6, now_utc=_SAMPLE_NOW)
    assert res["status"] == "available" and len(res["series"]) == 3
    assert seen["auth"].startswith("Basic ") and "mm_stream" not in seen["url"]

    clear_meteomatics_cache()
    _serve_meteomatics(monkeypatch, lambda request: httpx.Response(401, content=b"bad login for mm_stream_user"))
    denied = await fetch_live_weather(52.52, 13.46, 6, now_utc=_SAMPLE_NOW)
    assert denied["status"] == "unavailable" and "mm_stream_user" not in json.dumps(denied)


def test_the_endpoint_keys_the_quota_on_the_trusted_visitor_address(monkeypatch) -> None:
    monkeypatch.setenv("TD_TRUSTED_PROXY_HOPS", "1")
    seen = []

    async def fake_fetch(*, lat, lon, hours, client_key="anonymous"):
        seen.append(client_key)
        return {"status": "unconfigured"}

    monkeypatch.setattr("app.main.fetch_live_weather", fake_fetch)
    client.get("/api/live-weather", params={"lat": 1, "lon": 1}, headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.9:4000"})
    monkeypatch.setenv("TD_TRUSTED_PROXY_HOPS", "0")
    client.get("/api/live-weather", params={"lat": 1, "lon": 1}, headers={"X-Forwarded-For": "203.0.113.9"})
    assert seen[0] == "203.0.113.9"
    assert seen[1] != "203.0.113.9"  # header ignored without a configured proxy: TestClient's own peer address is used


def test_health_reports_the_quota_settings_without_secrets(monkeypatch) -> None:
    monkeypatch.setenv("METEOMATICS_USERNAME", "mm_health_user")
    monkeypatch.setenv("METEOMATICS_PASSWORD", "mm_health_pass")
    info = meteomatics_health()
    assert info["rate_limit"]["per_visitor_max_requests"] == 30
    assert info["rate_limit"]["global_max_requests"] == 300
    assert "mm_health" not in json.dumps(info)
