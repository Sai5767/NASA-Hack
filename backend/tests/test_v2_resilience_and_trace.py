"""Offline tests for V2 Deliverable A: resilience layer, secret redaction, /api/trend evidence_trace, and /api/health/details."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app import nasa_power
from app.analysis import VERDICT_LADDER, analyze_series, map_verdict
from app.main import app
from app.resilience import (
    BoundedTTLCache,
    HEALTH_REGISTRY,
    SlidingWindowRateLimiter,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
    make_case_signature,
    parse_case_signature,
    redact_secrets,
    request_with_resilience,
)
from tests.conftest import make_monthly

client = TestClient(app)


def test_secret_redaction_strips_keys_tokens_and_env_values(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-SuperSecretKeyValue999999")
    monkeypatch.setenv("NEWS_API_KEY", "azure-news-key-abc123456")

    raw = (
        "Error calling https://api.openai.com/v1/responses?api_key=my_query_secret "
        "with Authorization: Bearer sk-proj-SuperSecretKeyValue999999 and azure-news-key-abc123456"
    )
    cleaned = redact_secrets(raw)
    assert "SuperSecretKeyValue999999" not in cleaned
    assert "azure-news-key-abc123456" not in cleaned
    assert "my_query_secret" not in cleaned
    assert "[REDACTED" in cleaned


def test_case_signature_round_trips_and_rejects_tampering():
    sig = make_case_signature("T2M", 42.0, -93.6, 1981, 2024)
    unpacked = parse_case_signature(sig)
    assert unpacked["variable"] == "T2M"
    assert unpacked["lat"] == pytest.approx(42.0)
    assert unpacked["lon"] == pytest.approx(-93.6)
    assert unpacked["start_year"] == 1981
    assert unpacked["end_year"] == 2024

    tampered = sig.replace("|1981|", "|1990|")
    with pytest.raises(ValueError, match="verification"):
        parse_case_signature(tampered)

    with pytest.raises(ValueError):
        parse_case_signature("invalid-token")


def test_bounded_ttl_cache_respects_ttl_lru_and_stale_lookup():
    cache: BoundedTTLCache[str, int] = BoundedTTLCache("test", max_entries=2, ttl_seconds=10.0)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1  # refreshes "a" as most recent
    cache.put("c", 3)           # evicts "b"
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3

    # Force expiry via ttl_override=0
    assert cache.get("a", allow_stale=False, ttl_override=0.0) is None
    stale_entry = cache.get_entry("a", allow_stale=True, ttl_override=0.0)
    assert stale_entry is not None
    assert stale_entry.value == 1
    assert stale_entry.stale is True


def test_sliding_window_rate_limiter_enforces_quota():
    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60)
    ok1, retry1, rem1 = limiter.check("client-1")
    ok2, retry2, rem2 = limiter.check("client-1")
    ok3, retry3, rem3 = limiter.check("client-1")
    assert ok1 is True and rem1 == 1 and retry1 == 0
    assert ok2 is True and rem2 == 0 and retry2 == 0
    assert ok3 is False and rem3 == 0 and retry3 >= 1
    # Different client has independent quota
    ok_other, _, _ = limiter.check("client-2")
    assert ok_other is True


def test_request_with_resilience_handles_timeout_and_429():
    HEALTH_REGISTRY.clear()

    async def timeout_transport(**kwargs):
        raise httpx.ReadTimeout("read timed out")

    with pytest.raises(UpstreamTimeoutError) as exc_info:
        asyncio.run(
            request_with_resilience(
                "test_svc",
                "GET",
                "https://example.org/data",
                timeout_seconds=1.0,
                retry_delays=(0.01,),
                transport_call=timeout_transport,
            )
        )
    assert exc_info.value.code == "timeout"
    assert HEALTH_REGISTRY.snapshot("test_svc")["last_error_code"] == "timeout"

    async def rate_limit_transport(**kwargs):
        return httpx.Response(429, request=httpx.Request("GET", kwargs["url"]))

    with pytest.raises(UpstreamRateLimitError):
        asyncio.run(
            request_with_resilience(
                "test_svc",
                "GET",
                "https://example.org/data",
                timeout_seconds=1.0,
                retry_delays=(),
                transport_call=rate_limit_transport,
            )
        )


def test_nasa_power_stale_cache_fallback_when_upstream_fails(monkeypatch):
    nasa_power.clear_cache()
    key = ("T2M", 42.0, -93.6, 1981, 2024)
    sample = {"198101": 10.5, "198102": 11.0}
    nasa_power._cache_put(key, sample)
    # Age the cache entry past TTL
    nasa_power._cache_timestamps[key] -= 999999.0

    async def failing_request(params):
        raise nasa_power.PowerError("NASA POWER timeout")

    monkeypatch.setattr(nasa_power, "_request", failing_request)
    res = asyncio.run(nasa_power.fetch_monthly_multi(["T2M"], 42.0, -93.6, 1981, 2024))
    assert res["T2M"] == sample
    nasa_power.clear_cache()


def test_verdict_ladder_mapping():
    assert map_verdict("strong", True, 44)["code"] == "strong_evidence"
    assert map_verdict("moderate", True, 44)["code"] == "some_evidence"
    assert map_verdict("weak", True, 44)["code"] == "some_evidence"
    assert map_verdict("weak", False, 44)["code"] == "no_clear_evidence"
    assert map_verdict("none", False, 44)["code"] == "no_clear_evidence"
    assert map_verdict("strong", True, 12)["code"] == "insufficient_data"
    assert len(VERDICT_LADDER) == 4


def test_trend_endpoint_includes_consistent_evidence_trace(fake_power):
    res = client.get("/api/trend", params={"variable": "T2M", "lat": 42.0, "lon": -93.6, "start_year": 1981, "end_year": 2024})
    assert res.status_code == 200
    body = res.json()

    assert "evidence_trace" in body
    assert "case_signature" in body
    trace = body["evidence_trace"]

    # Every value in evidence_trace must match the primary analysis output exactly
    assert trace["completeness"]["years_used"] == body["quality"]["years_used"]
    assert trace["completeness"]["valid_months"] == body["quality"]["valid_months"]
    assert trace["completeness"]["complete_years"] == [a["year"] for a in body["annual"]]

    assert trace["slope_and_interval"]["slope_per_decade"] == body["stats"]["slope_per_decade"]
    assert trace["slope_and_interval"]["ci_low_per_decade"] == body["stats"]["ci_low_per_decade"]
    assert trace["slope_and_interval"]["ci_high_per_decade"] == body["stats"]["ci_high_per_decade"]
    assert trace["slope_and_interval"]["total_change"] == body["stats"]["total_change"]

    assert trace["mann_kendall"]["s"] == body["stats"]["mann_kendall_s"]
    assert trace["mann_kendall"]["z"] == body["stats"]["z"]
    assert trace["mann_kendall"]["p_value"] == body["stats"]["p_value"]
    assert trace["mann_kendall"]["raw_p_value"] == body["stats"]["p_naive"]
    assert trace["mann_kendall"]["significant"] == body["stats"]["significant"]

    reg = trace["regression_and_serial_correlation"]
    assert reg["ols"] == body["ols"]
    assert reg["tests_agree"] == body["agreement"]["tests_agree"]
    assert reg["serial_correlation"]["lag1_r1"] == body["stats"]["autocorr"]["r1"]
    assert reg["serial_correlation"]["variance_factor"] == body["stats"]["autocorr"]["factor"]
    assert reg["serial_correlation"]["adjusted"] == body["stats"]["autocorr"]["adjusted"]

    assert trace["grade"] == body["grade"]
    assert trace["checks"] == body["checks"]
    assert trace["caveats"] == body["caveats"]
    assert len(trace["steps"]) == 5


def test_health_details_reports_features_without_leaking_secrets(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-never-expose-987654321")
    monkeypatch.setenv("NEWS_API_KEY", "secret-news-token-12345")

    res = client.get("/api/health/details")
    assert res.status_code == 200
    raw_text = res.text
    assert "sk-secret-never-expose-987654321" not in raw_text
    assert "secret-news-token-12345" not in raw_text

    body = res.json()
    assert body["status"] in ("ok", "degraded")
    features = body["features"]
    assert {"nasa_power", "planet_streams", "ai_explanations", "news", "monthly_forecast"} <= set(features)
    assert features["ai_explanations"]["configured"] is True
    assert features["monthly_forecast"]["supported_variables"] == ["T2M", "PRECTOTCORR", "CLOUD_AMT"]


def test_cors_allows_post_explanations():
    res = client.options(
        "/api/explanations",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert res.status_code == 200
    allow_methods = res.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods


def _client_serving(monkeypatch, handler):
    """Make request_with_resilience talk to an in-memory fake server instead of the network."""
    real = httpx.AsyncClient
    monkeypatch.setattr("app.resilience.httpx.AsyncClient", lambda *a, **kw: real(*a, transport=httpx.MockTransport(handler), **kw))


def test_real_http_path_returns_small_responses_normally(monkeypatch):
    _client_serving(monkeypatch, lambda request: httpx.Response(200, json={"ok": True}))
    resp = asyncio.run(request_with_resilience("demo", "GET", "https://example.org/data", retry_delays=()))
    assert resp.status_code == 200 and resp.json() == {"ok": True}


def test_oversized_upstream_responses_are_refused(monkeypatch):
    from app import resilience

    big = b"x" * (resilience.MAX_RESPONSE_BYTES + 1)
    _client_serving(monkeypatch, lambda request: httpx.Response(200, content=big))
    with pytest.raises(UpstreamServiceError) as caught:
        asyncio.run(request_with_resilience("demo", "GET", "https://example.org/huge", retry_delays=()))
    assert caught.value.code == "response_too_large"
    assert caught.value.retryable is False
