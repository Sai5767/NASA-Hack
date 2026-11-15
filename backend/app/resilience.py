"""Common resilience, configuration, caching, rate-limiting, and health-tracking layer for V2.

All external dependencies share this foundation:
  * Configuration read strictly from environment variables (never hard-coded secrets).
  * Secret redaction so API keys or tokens can never leak into error messages, logs, or responses.
  * Structured, typed, non-secret error classes.
  * In-memory bounded TTL + LRU caches (no writeable local disk dependency).
  * Sliding-window per-client rate limiting with bounded state.
  * Lightweight service health & cache telemetry for GET /api/health/details without upstream probing.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Generic, TypeVar

import httpx

K = TypeVar("K")
V = TypeVar("V")

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)(basic\s+)[A-Za-z0-9+/=._\-]+"),
    re.compile(r"(https?://)[^/\s:@]+:[^/\s@]+@"),
    re.compile(r"(?i)((?:api[_-]?key|token|secret|password|username|authorization)\s*[=:]\s*)([^\s&\"',;]+)"),
]

_PROCESS_EPHEMERAL_SECRET = os.urandom(32).hex()


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string with Z suffix."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def epoch_to_iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _env_float(name: str, default: float, low: float, high: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        val = float(raw)
    except ValueError:
        return default
    return max(low, min(high, val))


def _env_int(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        val = int(raw)
    except ValueError:
        return default
    return max(low, min(high, val))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


@dataclass(frozen=True)
class AppConfig:
    """Server configuration loaded from environment variables. Secrets are never serialized."""

    nasa_timeout_seconds: float
    nasa_max_concurrency: int
    nasa_cache_ttl_seconds: int
    streams_timeout_seconds: float
    streams_cache_ttl_seconds: int
    openai_api_key: str | None = field(repr=False)
    openai_explanation_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1/responses"
    openai_timeout_seconds: float = 20.0
    openai_web_search_enabled: bool = True
    explanation_cache_ttl_seconds: int = 86400
    explanation_rate_limit_max: int = 15
    explanation_rate_limit_window_seconds: int = 300
    news_provider: str = "gdelt"
    news_api_url: str = "https://api.gdeltproject.org/api/v2/doc/doc"
    news_api_key: str | None = field(default=None, repr=False)
    news_timeout_seconds: float = 12.0
    news_cache_ttl_seconds: int = 900
    meteomatics_username: str | None = field(default=None, repr=False)
    meteomatics_password: str | None = field(default=None, repr=False)
    meteomatics_base_url: str = "https://api.meteomatics.com"
    meteomatics_timeout_seconds: float = 10.0
    meteomatics_cache_ttl_seconds: int = 900
    case_signing_secret: str = field(default=_PROCESS_EPHEMERAL_SECRET, repr=False)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_api_key.strip())

    @property
    def news_enabled(self) -> bool:
        return self.news_provider not in ("disabled", "none", "off")

    @property
    def meteomatics_configured(self) -> bool:
        return bool(
            self.meteomatics_username
            and self.meteomatics_username.strip()
            and self.meteomatics_password
            and self.meteomatics_password.strip()
        )


def load_config() -> AppConfig:
    """Read current configuration from environment variables."""
    raw_openai_key = os.environ.get("OPENAI_API_KEY", "").strip() or None
    raw_news_key = os.environ.get("NEWS_API_KEY", "").strip() or None
    raw_model = os.environ.get("OPENAI_EXPLANATION_MODEL", "").strip() or "gpt-4o-mini"
    raw_openai_url = os.environ.get("OPENAI_BASE_URL", "").strip() or "https://api.openai.com/v1/responses"
    raw_provider = (os.environ.get("NEWS_PROVIDER", "").strip() or "gdelt").lower()
    raw_news_url = os.environ.get("NEWS_API_URL", "").strip() or "https://api.gdeltproject.org/api/v2/doc/doc"
    raw_mm_user = os.environ.get("METEOMATICS_USERNAME", "").strip() or None
    raw_mm_pass = os.environ.get("METEOMATICS_PASSWORD", "").strip() or None
    raw_mm_url = (os.environ.get("METEOMATICS_BASE_URL", "").strip() or "https://api.meteomatics.com").rstrip("/")
    raw_case_secret = os.environ.get("TD_CASE_SECRET", "").strip() or _PROCESS_EPHEMERAL_SECRET

    return AppConfig(
        nasa_timeout_seconds=_env_float("NASA_POWER_TIMEOUT_SECONDS", 30.0, 2.0, 60.0),
        nasa_max_concurrency=_env_int("NASA_POWER_MAX_CONCURRENCY", 3, 1, 8),
        nasa_cache_ttl_seconds=_env_int("NASA_POWER_CACHE_TTL_SECONDS", 6 * 3600, 60, 7 * 86400),
        streams_timeout_seconds=_env_float("STREAMS_TIMEOUT_SECONDS", 30.0, 2.0, 60.0),
        streams_cache_ttl_seconds=_env_int("STREAMS_CACHE_TTL_SECONDS", 12 * 3600, 60, 7 * 86400),
        openai_api_key=raw_openai_key,
        openai_explanation_model=raw_model,
        openai_base_url=raw_openai_url,
        openai_timeout_seconds=_env_float("OPENAI_TIMEOUT_SECONDS", 20.0, 2.0, 45.0),
        openai_web_search_enabled=_env_bool("OPENAI_WEB_SEARCH", True),
        explanation_cache_ttl_seconds=_env_int("EXPLANATION_CACHE_TTL_SECONDS", 24 * 3600, 60, 7 * 86400),
        explanation_rate_limit_max=_env_int("EXPLANATION_RATE_LIMIT_MAX", 15, 1, 500),
        explanation_rate_limit_window_seconds=_env_int("EXPLANATION_RATE_LIMIT_WINDOW_SECONDS", 300, 10, 86400),
        news_provider=raw_provider,
        news_api_url=raw_news_url,
        news_api_key=raw_news_key,
        news_timeout_seconds=_env_float("NEWS_TIMEOUT_SECONDS", 12.0, 2.0, 30.0),
        news_cache_ttl_seconds=_env_int("NEWS_CACHE_TTL_SECONDS", 900, 900, 86400),
        meteomatics_username=raw_mm_user,
        meteomatics_password=raw_mm_pass,
        meteomatics_base_url=raw_mm_url,
        meteomatics_timeout_seconds=_env_float("METEOMATICS_TIMEOUT_SECONDS", 10.0, 2.0, 30.0),
        meteomatics_cache_ttl_seconds=_env_int("METEOMATICS_CACHE_TTL_SECONDS", 900, 60, 86400),
        case_signing_secret=raw_case_secret,
    )


def redact_secrets(text: str | None) -> str:
    """Remove any secret values or token-like strings from text before logging or returning."""
    if not text:
        return ""
    cleaned = str(text)
    for env_name in (
        "OPENAI_API_KEY",
        "NEWS_API_KEY",
        "METEOMATICS_USERNAME",
        "METEOMATICS_PASSWORD",
        "TD_CASE_SECRET",
    ):
        secret_val = os.environ.get(env_name, "").strip()
        if secret_val and len(secret_val) >= 3:
            cleaned = cleaned.replace(secret_val, "[REDACTED]")
    cleaned = _SECRET_PATTERNS[0].sub("[REDACTED_KEY]", cleaned)
    cleaned = _SECRET_PATTERNS[1].sub(r"\1[REDACTED]", cleaned)
    cleaned = _SECRET_PATTERNS[2].sub(r"\1[REDACTED]", cleaned)
    cleaned = _SECRET_PATTERNS[3].sub(r"\1[REDACTED]@", cleaned)
    cleaned = _SECRET_PATTERNS[4].sub(r"\1[REDACTED]", cleaned)
    return cleaned


# --------------------------------------------------------------------------- case signature


def make_case_signature(variable: str, lat: float | None, lon: float | None, start_year: int, end_year: int) -> str:
    """Deterministic, server-signed token binding a trend case's coordinates, variable, and period."""
    cfg = load_config()
    lat_part = "global" if lat is None else f"{round(float(lat), 3):.3f}"
    lon_part = "global" if lon is None else f"{round(float(lon), 3):.3f}"
    payload = f"v2|{variable}|{lat_part}|{lon_part}|{int(start_year)}|{int(end_year)}"
    mac = hmac.new(cfg.case_signing_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
    return f"{payload}|{mac}"


def parse_case_signature(signature: str) -> dict:
    """Verify and unpack a case_signature token. Raises ValueError if tampered or malformed."""
    if not signature or not isinstance(signature, str):
        raise ValueError("Missing or invalid case_signature.")
    parts = signature.strip().split("|")
    if len(parts) != 7 or parts[0] != "v2":
        raise ValueError("Malformed case_signature format.")
    _, variable, lat_str, lon_str, start_str, end_str, provided_mac = parts
    try:
        lat = None if lat_str == "global" else float(lat_str)
        lon = None if lon_str == "global" else float(lon_str)
        start_year = int(start_str)
        end_year = int(end_str)
    except ValueError as exc:
        raise ValueError("Malformed coordinates or years in case_signature.") from exc
    expected = make_case_signature(variable, lat, lon, start_year, end_year)
    expected_mac = expected.rsplit("|", 1)[-1]
    if not hmac.compare_digest(provided_mac, expected_mac):
        raise ValueError("Invalid case_signature verification code.")
    return {
        "variable": variable,
        "lat": lat,
        "lon": lon,
        "start_year": start_year,
        "end_year": end_year,
        "case_signature": expected,
    }


# --------------------------------------------------------------------------- typed non-secret errors


class UpstreamServiceError(RuntimeError):
    """Structured error from an upstream dependency with guaranteed secret redaction."""

    def __init__(
        self,
        service: str,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        status_code: int | None = None,
    ) -> None:
        safe_message = redact_secrets(message)
        super().__init__(safe_message)
        self.service = service
        self.code = code
        self.message = safe_message
        self.retryable = retryable
        self.status_code = status_code

    def to_dict(self) -> dict:
        return {
            "service": self.service,
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "status_code": self.status_code,
        }


class UpstreamTimeoutError(UpstreamServiceError):
    def __init__(self, service: str, message: str = "The upstream service timed out.") -> None:
        super().__init__(service, "timeout", message, retryable=True, status_code=504)


class UpstreamRateLimitError(UpstreamServiceError):
    def __init__(self, service: str, message: str = "The upstream service rate-limited the request.") -> None:
        super().__init__(service, "rate_limited", message, retryable=True, status_code=429)


class UpstreamResponseError(UpstreamServiceError):
    def __init__(
        self,
        service: str,
        message: str = "The upstream service returned an invalid response.",
        *,
        code: str = "invalid_response",
        retryable: bool = False,
        status_code: int | None = 502,
    ) -> None:
        super().__init__(service, code, message, retryable=retryable, status_code=status_code)


# --------------------------------------------------------------------------- bounded TTL cache


@dataclass(frozen=True)
class CacheLookup(Generic[V]):
    value: V
    age_seconds: float
    stale: bool
    fetched_at: str


class BoundedTTLCache(Generic[K, V]):
    """In-memory LRU cache with TTL expiry and optional stale-on-error retrieval."""

    def __init__(self, name: str, max_entries: int = 500, ttl_seconds: float = 3600.0) -> None:
        self.name = name
        self.max_entries = max(1, max_entries)
        self.ttl_seconds = max(1.0, float(ttl_seconds))
        self._store: OrderedDict[K, tuple[float, float, V]] = OrderedDict()
        self.hits = 0
        self.misses = 0
        self.stale_hits = 0

    def get_entry(self, key: K, *, allow_stale: bool = False, ttl_override: float | None = None) -> CacheLookup[V] | None:
        item = self._store.get(key)
        if item is None:
            self.misses += 1
            return None
        mono_ts, epoch_ts, val = item
        age = max(0.0, time.monotonic() - mono_ts)
        ttl = self.ttl_seconds if ttl_override is None else float(ttl_override)
        is_stale = age > ttl
        if is_stale and not allow_stale:
            self.misses += 1
            return None
        self._store.move_to_end(key)
        if is_stale:
            self.stale_hits += 1
        else:
            self.hits += 1
        return CacheLookup(
            value=val,
            age_seconds=round(age, 2),
            stale=is_stale,
            fetched_at=epoch_to_iso(epoch_ts) or utc_now_iso(),
        )

    def get(self, key: K, *, allow_stale: bool = False, ttl_override: float | None = None) -> V | None:
        lookup = self.get_entry(key, allow_stale=allow_stale, ttl_override=ttl_override)
        return None if lookup is None else lookup.value

    def put(self, key: K, value: V) -> CacheLookup[V]:
        now_mono = time.monotonic()
        now_epoch = time.time()
        self._store[key] = (now_mono, now_epoch, value)
        self._store.move_to_end(key)
        while len(self._store) > self.max_entries:
            self._store.popitem(last=False)
        return CacheLookup(
            value=value,
            age_seconds=0.0,
            stale=False,
            fetched_at=epoch_to_iso(now_epoch) or utc_now_iso(),
        )

    def clear(self) -> None:
        self._store.clear()
        self.hits = 0
        self.misses = 0
        self.stale_hits = 0

    def stats(self, *, ttl_override: float | None = None) -> dict:
        now = time.monotonic()
        ttl = self.ttl_seconds if ttl_override is None else float(ttl_override)
        ages = [max(0.0, now - mono) for mono, _, _ in self._store.values()]
        fresh_count = sum(1 for a in ages if a <= ttl)
        stale_count = len(ages) - fresh_count
        return {
            "entries": len(self._store),
            "fresh_entries": fresh_count,
            "stale_entries": stale_count,
            "max_entries": self.max_entries,
            "ttl_seconds": int(ttl),
            "newest_age_seconds": round(min(ages), 1) if ages else None,
            "oldest_age_seconds": round(max(ages), 1) if ages else None,
            "hits": self.hits,
            "misses": self.misses,
            "stale_hits": self.stale_hits,
        }


# --------------------------------------------------------------------------- sliding-window rate limiter


class SlidingWindowRateLimiter:
    """Per-key sliding-window rate limiter stored in bounded memory."""

    def __init__(self, max_requests: int = 15, window_seconds: int = 300, max_keys: int = 2000) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._buckets: OrderedDict[str, list[float]] = OrderedDict()

    def check(self, client_key: str, *, max_requests: int | None = None, window_seconds: int | None = None) -> tuple[bool, int, int]:
        """Return (allowed, retry_after_seconds, remaining_in_window)."""
        limit = self.max_requests if max_requests is None else max_requests
        window = float(self.window_seconds if window_seconds is None else window_seconds)
        now = time.monotonic()
        cutoff = now - window

        key = (client_key or "anonymous").strip()[:120]
        timestamps = [ts for ts in self._buckets.get(key, []) if ts > cutoff]

        if len(timestamps) >= limit:
            self._buckets[key] = timestamps
            self._buckets.move_to_end(key)
            retry_after = max(1, int(round(timestamps[0] + window - now)))
            return False, retry_after, 0

        timestamps.append(now)
        self._buckets[key] = timestamps
        self._buckets.move_to_end(key)
        while len(self._buckets) > self.max_keys:
            self._buckets.popitem(last=False)
        return True, 0, max(0, limit - len(timestamps))

    def clear(self) -> None:
        self._buckets.clear()


# --------------------------------------------------------------------------- service health telemetry


class ServiceHealthRegistry:
    """Tracks non-secret operational telemetry per service without triggering network probes."""

    def __init__(self) -> None:
        self._records: dict[str, dict] = {}

    def record_success(self, service: str) -> None:
        rec = self._records.setdefault(service, {})
        rec["last_success_epoch"] = time.time()
        rec["last_status"] = "healthy"
        rec["consecutive_failures"] = 0

    def record_failure(self, service: str, code: str) -> None:
        rec = self._records.setdefault(service, {})
        rec["last_error_epoch"] = time.time()
        rec["last_error_code"] = redact_secrets(code)[:80]
        rec["last_status"] = "degraded"
        rec["consecutive_failures"] = rec.get("consecutive_failures", 0) + 1

    def snapshot(self, service: str) -> dict:
        rec = self._records.get(service, {})
        return {
            "last_status": rec.get("last_status", "idle"),
            "last_success_at": epoch_to_iso(rec.get("last_success_epoch")),
            "last_error_at": epoch_to_iso(rec.get("last_error_epoch")),
            "last_error_code": rec.get("last_error_code"),
            "consecutive_failures": rec.get("consecutive_failures", 0),
        }

    def clear(self) -> None:
        self._records.clear()


HEALTH_REGISTRY = ServiceHealthRegistry()


# --------------------------------------------------------------------------- resilient HTTP helper


RETRYABLE_HTTP_STATUS = {408, 429, 500, 502, 503, 504}


async def request_with_resilience(
    service: str,
    method: str,
    url: str,
    *,
    params: dict | None = None,
    json_body: dict | None = None,
    headers: dict | None = None,
    timeout_seconds: float = 20.0,
    retry_delays: tuple[float, ...] = (0.4, 1.0),
    semaphore: asyncio.Semaphore | None = None,
    transport_call: Callable | None = None,
) -> httpx.Response:
    """Execute an HTTP request with bounded concurrency, strict timeout, retries, and redacted errors."""

    async def _do_attempt() -> httpx.Response:
        if transport_call is not None:
            return await transport_call(
                method=method,
                url=url,
                params=params,
                json=json_body,
                headers=headers,
                timeout=timeout_seconds,
            )
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
            return await client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=headers,
            )

    last_error: UpstreamServiceError | None = None
    max_attempts = len(retry_delays) + 1

    for attempt in range(max_attempts):
        try:
            if semaphore is not None:
                async with semaphore:
                    resp = await _do_attempt()
            else:
                resp = await _do_attempt()

            if resp.status_code in RETRYABLE_HTTP_STATUS and attempt < len(retry_delays):
                await asyncio.sleep(retry_delays[attempt])
                continue

            if resp.status_code == 429:
                err = UpstreamRateLimitError(service, f"{service} rate-limited the request (HTTP 429).")
                HEALTH_REGISTRY.record_failure(service, err.code)
                raise err

            if resp.status_code >= 400:
                err = UpstreamResponseError(
                    service,
                    f"{service} returned HTTP {resp.status_code}.",
                    code=f"http_{resp.status_code}",
                    retryable=resp.status_code in RETRYABLE_HTTP_STATUS,
                    status_code=resp.status_code,
                )
                HEALTH_REGISTRY.record_failure(service, err.code)
                raise err

            HEALTH_REGISTRY.record_success(service)
            return resp

        except asyncio.CancelledError:
            raise
        except UpstreamServiceError as exc:
            last_error = exc
            if exc.retryable and attempt < len(retry_delays):
                await asyncio.sleep(retry_delays[attempt])
                continue
            raise
        except httpx.TimeoutException as exc:
            last_error = UpstreamTimeoutError(service, f"{service} timed out after {timeout_seconds:.1f}s.")
            if attempt < len(retry_delays):
                await asyncio.sleep(retry_delays[attempt])
                continue
            HEALTH_REGISTRY.record_failure(service, "timeout")
            raise last_error from exc
        except httpx.TransportError as exc:
            last_error = UpstreamServiceError(
                service,
                "network_error",
                f"Could not reach {service}: {redact_secrets(str(exc))}",
                retryable=True,
                status_code=502,
            )
            if attempt < len(retry_delays):
                await asyncio.sleep(retry_delays[attempt])
                continue
            HEALTH_REGISTRY.record_failure(service, "network_error")
            raise last_error from exc
        except httpx.HTTPError as exc:
            err = UpstreamServiceError(
                service,
                "http_error",
                f"HTTP error from {service}: {redact_secrets(str(exc))}",
                retryable=False,
                status_code=502,
            )
            HEALTH_REGISTRY.record_failure(service, "http_error")
            raise err from exc

    err = last_error or UpstreamServiceError(service, "unknown_error", f"Could not reach {service}.")
    HEALTH_REGISTRY.record_failure(service, err.code)
    raise err
