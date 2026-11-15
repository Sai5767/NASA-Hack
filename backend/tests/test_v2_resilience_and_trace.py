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
_REAL_ASYNC_CLIENT = httpx.AsyncClient  # captured before any test patches it, so a helper can be applied twice


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


def test_bounded_ttl_cache_respects_ttl_lru_and_stale_lookup(monkeypatch):
    # A3: the clock is driven by the test, so the result never depends on clock resolution (Windows' monotonic clock
    # ticks every 15.6 ms, so put() and get() used to land on the same tick and "age 0 > ttl 0" was False).
    from app import resilience

    clock = {"now": 1000.0}
    monkeypatch.setattr(resilience.time, "monotonic", lambda: clock["now"])
    cache: BoundedTTLCache[str, int] = BoundedTTLCache("test", max_entries=2, ttl_seconds=10.0)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1  # refreshes "a" as most recent
    cache.put("c", 3)           # evicts "b"
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3

    # A TTL of zero means nothing is fresh, even at age exactly 0
    assert cache.get("a", allow_stale=False, ttl_override=0.0) is None
    stale_entry = cache.get_entry("a", allow_stale=True, ttl_override=0.0)
    assert stale_entry is not None
    assert stale_entry.value == 1
    assert stale_entry.stale is True

    # Ordinary expiry: fresh at exactly the TTL, stale just after it
    clock["now"] += 10.0
    assert cache.get("c") == 3
    clock["now"] += 0.5
    assert cache.get("c") is None
    assert cache.get_entry("c", allow_stale=True).stale is True


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

    calls = {"n": 0}

    async def rate_limit_transport(**kwargs):
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "42"}, request=httpx.Request("GET", kwargs["url"]))

    # A15: a 429 is never retried (retry delays are available but unused) and Retry-After travels with the error.
    with pytest.raises(UpstreamRateLimitError) as limited:
        asyncio.run(
            request_with_resilience(
                "test_svc",
                "GET",
                "https://example.org/data",
                timeout_seconds=1.0,
                retry_delays=(0.01, 0.01),
                transport_call=rate_limit_transport,
            )
        )
    assert calls["n"] == 1
    assert limited.value.retry_after_seconds == 42
    assert HEALTH_REGISTRY.snapshot("test_svc")["last_error_code"] == "rate_limited"


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
    monkeypatch.setenv("OPENAI_EXPLANATION_MODEL", "owner-chosen-model")

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
    monkeypatch.setattr(
        "app.resilience.httpx.AsyncClient",
        lambda *a, **kw: _REAL_ASYNC_CLIENT(*a, transport=httpx.MockTransport(handler), **kw),
    )


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


# --------------------------------------------------------------------------- Phase 0 repair tests (A1, A4, A7, A14, A15, B)


def test_gzip_and_deflate_upstream_replies_are_decoded_exactly_once(monkeypatch):
    # A1: aiter_bytes() already decodes the body; the rebuilt Response must not carry content-encoding, or httpx decodes
    # the plain bytes again and raises DecodingError (every OpenAI and GDELT reply failed this way).
    import gzip
    import zlib

    body = b'{"ok": true, "text": "' + b"a" * 2000 + b'"}'
    for encoding, packed in (("gzip", gzip.compress(body)), ("deflate", zlib.compress(body))):
        _client_serving(
            monkeypatch,
            lambda request, enc=encoding, data=packed: httpx.Response(
                200, headers={"content-encoding": enc, "content-type": "application/json"}, content=data
            ),
        )
        resp = asyncio.run(request_with_resilience("demo", "GET", "https://example.org/data", retry_delays=()))
        assert resp.status_code == 200
        assert resp.json()["ok"] is True and len(resp.json()["text"]) == 2000, encoding
        assert "content-encoding" not in resp.headers


def test_a_small_gzip_reply_that_inflates_past_the_cap_is_refused(monkeypatch):
    import gzip

    from app import resilience

    bomb = gzip.compress(b"0" * (resilience.MAX_RESPONSE_BYTES + 10))
    assert len(bomb) < resilience.MAX_RESPONSE_BYTES // 100  # tiny on the wire
    HEALTH_REGISTRY.clear()
    _client_serving(monkeypatch, lambda request: httpx.Response(200, headers={"content-encoding": "gzip"}, content=bomb))
    with pytest.raises(UpstreamServiceError) as caught:
        asyncio.run(request_with_resilience("demo", "GET", "https://example.org/bomb", retry_delays=()))
    assert caught.value.code == "response_too_large"
    # A15: a refused oversize reply is recorded in health telemetry too
    assert HEALTH_REGISTRY.snapshot("demo")["last_error_code"] == "response_too_large"


def test_transient_5xx_is_still_retried_once_but_429_is_not(monkeypatch):
    calls = {"n": 0}

    def flaky(request):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] == 1 else httpx.Response(200, json={"ok": True})

    _client_serving(monkeypatch, flaky)
    resp = asyncio.run(request_with_resilience("demo", "GET", "https://example.org/x", retry_delays=(0.0,)))
    assert resp.status_code == 200 and calls["n"] == 2

    calls["n"] = 0
    _client_serving(monkeypatch, lambda request: (calls.__setitem__("n", calls["n"] + 1), httpx.Response(429))[1])
    with pytest.raises(UpstreamRateLimitError):
        asyncio.run(request_with_resilience("demo", "GET", "https://example.org/x", retry_delays=(0.0, 0.0)))
    assert calls["n"] == 1


def test_retry_after_parsing_is_bounded():
    from app.resilience import parse_retry_after

    assert parse_retry_after("30") == 30
    assert parse_retry_after("999999") == 3600
    assert parse_retry_after("0") == 1
    assert parse_retry_after(None) is None and parse_retry_after("soon") is None
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 1  # a date in the past: retry as soon as allowed


def test_rate_limiter_with_a_zero_limit_denies_without_crashing_and_stays_bounded():
    # A14: limit 0 used to raise IndexError on timestamps[0]
    limiter = SlidingWindowRateLimiter(max_requests=0, window_seconds=60)
    allowed, retry_after, remaining = limiter.check("anyone")
    assert (allowed, remaining) == (False, 0) and retry_after >= 1

    small = SlidingWindowRateLimiter(max_requests=1, window_seconds=60, max_keys=3)
    for i in range(50):
        small.check(f"visitor-{i}")
    assert len(small) == 3  # least recently used buckets are dropped: memory is bounded
    for _ in range(20):
        small.check("visitor-49")
    assert len(small._buckets["visitor-49"]) <= 1  # one bucket never grows past its limit


def test_client_identity_trusts_forwarded_for_only_as_configured():
    from app.resilience import client_identity

    # Default (0 hops): the header is never read, so a visitor cannot pick their own rate-limit key.
    assert client_identity("10.0.0.5", "203.0.113.7", trusted_hops=0) == "10.0.0.5"
    # Azure App Service (1 hop): the front end appends "client:port"; anything the client wrote further left is ignored.
    assert client_identity("10.0.0.5", "203.0.113.7:51234", trusted_hops=1) == "203.0.113.7"
    assert client_identity("10.0.0.5", "1.1.1.1, 203.0.113.7:51234", trusted_hops=1) == "203.0.113.7"
    assert client_identity("10.0.0.5", "1.1.1.1, 203.0.113.7, 10.1.1.1", trusted_hops=2) == "203.0.113.7"
    # Missing, too short or junk header: fall back to the socket peer
    assert client_identity("10.0.0.5", None, trusted_hops=1) == "10.0.0.5"
    assert client_identity("10.0.0.5", "203.0.113.7", trusted_hops=2) == "10.0.0.5"
    assert client_identity("10.0.0.5", "not-an-ip", trusted_hops=1) == "10.0.0.5"
    # IPv6 visitors are bucketed per /64; bracketed form with a port is understood
    a = client_identity("10.0.0.5", "[2001:db8:1:2::aaaa]:443", trusted_hops=1)
    b = client_identity("10.0.0.5", "2001:db8:1:2:ffff::1", trusted_hops=1)
    assert a == b == "2001:db8:1:2::/64"
    assert client_identity(None, None, trusted_hops=0) == "anonymous"


def test_client_identity_reads_the_hop_count_from_the_environment(monkeypatch):
    from app.resilience import client_identity

    monkeypatch.setenv("TD_TRUSTED_PROXY_HOPS", "1")
    assert client_identity("10.0.0.5", "198.51.100.4") == "198.51.100.4"
    monkeypatch.delenv("TD_TRUSTED_PROXY_HOPS")
    assert client_identity("10.0.0.5", "198.51.100.4") == "10.0.0.5"


def test_health_routes_run_on_the_event_loop_and_cache_stats_survive_concurrent_writes():
    # A4: a sync handler ran in the threadpool and iterated caches the event loop was writing -> occasional HTTP 500.
    import threading

    from app import main

    assert asyncio.iscoroutinefunction(main.health_details)
    assert asyncio.iscoroutinefunction(main.version)

    cache: BoundedTTLCache[int, int] = BoundedTTLCache("race", max_entries=50, ttl_seconds=60)
    stop = threading.Event()

    def writer():
        i = 0
        while not stop.is_set():
            cache.put(i % 200, i)
            nasa_power._cache_put(("RACE", i % 300, 0, 1981, 2024), {})
            i += 1

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    try:
        for _ in range(300):
            cache.stats()
            nasa_power.cache_health()
    finally:
        stop.set()
        thread.join(timeout=5)
        nasa_power.clear_cache()


def test_nasa_power_concurrency_limit_is_global_across_requests(monkeypatch):
    # A7: NASA_POWER_MAX_CONCURRENCY bounds parallel NASA requests for the whole process, not per route call.
    monkeypatch.setenv("NASA_POWER_MAX_CONCURRENCY", "2")
    state = {"active": 0, "peak": 0}

    async def handler(request):
        state["active"] += 1
        state["peak"] = max(state["peak"], state["active"])
        await asyncio.sleep(0.02)
        state["active"] -= 1
        return httpx.Response(200, json={"properties": {"parameter": {}}})

    real = httpx.AsyncClient
    monkeypatch.setattr(
        "app.nasa_power.httpx.AsyncClient", lambda *a, **kw: real(*a, transport=httpx.MockTransport(handler), **kw)
    )

    async def many():
        await asyncio.gather(*(nasa_power._request({"latitude": i}) for i in range(8)))

    asyncio.run(many())
    assert state["peak"] == 2


def test_loop_bound_semaphore_works_across_event_loops():
    from app.resilience import LoopBoundSemaphore

    limit = LoopBoundSemaphore(lambda: 1)

    async def contend():
        async def one():
            async with limit.get():
                await asyncio.sleep(0.001)

        await asyncio.gather(one(), one(), one())

    # A plain module-level asyncio.Semaphore raises "bound to a different event loop" on the second run under contention.
    asyncio.run(contend())
    asyncio.run(contend())
