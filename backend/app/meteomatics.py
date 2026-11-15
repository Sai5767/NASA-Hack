"""Meteomatics live and short-range operational weather adapter for V2.

Design & security guarantees:
  * Complements NASA POWER long-term climate analysis; never averaged with, substituted for,
    or labelled as NASA historical data or Trend Detective's internal monthly climate forecast.
  * Server-only authentication via HTTPS Basic Auth (`httpx.BasicAuth(username, password)`);
    credentials are read strictly from `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`
    and never embedded in URLs, returned in payloads, or written to logs.
  * Requests JSON format (`.../json`), validates and normalizes units/timestamps/metadata,
    strips upstream `"user"` fields so account identifiers never reach the client, and preserves
    `null` for missing or sentinel values without interpolation.
  * Bounded TTL cache with stale-on-error fallback and response-size protection.
"""

from __future__ import annotations

import asyncio
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol

import httpx

from .resilience import (
    BoundedTTLCache,
    HEALTH_REGISTRY,
    LoopBoundSemaphore,
    SlidingWindowRateLimiter,
    UpstreamRateLimitError,
    UpstreamResponseError,
    UpstreamServiceError,
    UpstreamTimeoutError,
    decoded_headers,
    load_config,
    parse_retry_after,
    read_capped_body,
    redact_secrets,
    utc_now_iso,
)

SERVICE_NAME = "meteomatics"
PROVIDER_LABEL = "Meteomatics"
LAYER_LABEL = "Meteomatics weather forecast — not NASA trend data"
SOURCE_NOTE = "Meteomatics operational weather data. It is separate from NASA POWER climate-trend analysis."

MIN_HOURS = 1
MAX_HOURS = 72
DEFAULT_HOURS = 24
INTERVAL = "PT1H"
MAX_RESPONSE_BYTES = 524_288  # 512 KB cap

METEOMATICS_PARAMETERS: dict[str, str] = {
    "temperature_c": "t_2m:C",
    "precipitation_1h_mm": "precip_1h:mm",
    "cloud_cover_percent": "total_cloud_cover:p",
    "wind_speed_10m_ms": "wind_speed_10m:ms",
}

PARAMETER_TO_FIELD: dict[str, str] = {v: k for k, v in METEOMATICS_PARAMETERS.items()}

PARAMETER_DETAILS: dict[str, dict[str, str]] = {
    "temperature_c": {
        "parameter": "t_2m:C",
        "label": "Air temperature (2 m)",
        "unit": "°C",
    },
    "precipitation_1h_mm": {
        "parameter": "precip_1h:mm",
        "label": "Hourly precipitation",
        "unit": "mm",
    },
    "cloud_cover_percent": {
        "parameter": "total_cloud_cover:p",
        "label": "Total cloud cover",
        "unit": "%",
    },
    "wind_speed_10m_ms": {
        "parameter": "wind_speed_10m:ms",
        "label": "10 m wind speed",
        "unit": "m/s",
    },
}

_SENTINEL_VALUES = {-999.0, -666.0, -9999.0}
# Process-wide cap on parallel Meteomatics requests, safe across event loops (a bare module-level asyncio.Semaphore binds
# to the first loop that waits on it).
_CONCURRENCY = LoopBoundSemaphore(lambda: 4)
# Public-quota protection (Phase 0 item B). Only requests that would reach Meteomatics are counted: cache hits are free.
# Both limiters are bounded (LRU of at most max_keys visitor buckets, each holding at most `limit` timestamps).
_VISITOR_LIMITER = SlidingWindowRateLimiter(max_requests=30, window_seconds=300, max_keys=2000)
_GLOBAL_LIMITER = SlidingWindowRateLimiter(max_requests=300, window_seconds=3600, max_keys=1)
_GLOBAL_KEY = "__all_visitors__"
_WEATHER_CACHE: BoundedTTLCache[tuple[float, float, int], dict] = BoundedTTLCache(
    name="meteomatics_live_weather",
    max_entries=128,
    ttl_seconds=900.0,
)


def _utc_hour_floor(dt: datetime | None = None) -> datetime:
    now = dt or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0)


def _to_iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_iso_timestamp(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _clean_numeric_value(raw: object, field_name: str) -> float | None:
    if raw is None or isinstance(raw, bool):
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(val) or val in _SENTINEL_VALUES:
        return None
    if field_name == "cloud_cover_percent" and (val < 0.0 or val > 100.0):
        if -1.0 <= val <= 101.0:
            val = max(0.0, min(100.0, val))
        else:
            return None
    if field_name in ("precipitation_1h_mm", "wind_speed_10m_ms") and val < 0.0:
        return None
    return round(val, 2)


def build_meteomatics_url(
    base_url: str,
    start_dt: datetime,
    end_dt: datetime,
    lat: float,
    lon: float,
    parameters: tuple[str, ...] | None = None,
) -> str:
    """Build the canonical Meteomatics JSON query URL without credentials in the URL."""
    clean_base = (base_url or "https://api.meteomatics.com").strip().rstrip("/")
    if "@" in clean_base:
        raise ValueError("Meteomatics base URL must not contain embedded credentials.")
    start_iso = _to_iso_utc(start_dt)
    end_iso = _to_iso_utc(end_dt)
    params_tuple = parameters or tuple(METEOMATICS_PARAMETERS.values())
    param_segment = ",".join(params_tuple)
    lat_str = f"{round(float(lat), 4):.4f}".rstrip("0").rstrip(".") if round(float(lat), 4) != 0 else "0"
    lon_str = f"{round(float(lon), 4):.4f}".rstrip("0").rstrip(".") if round(float(lon), 4) != 0 else "0"
    return f"{clean_base}/{start_iso}--{end_iso}:{INTERVAL}/{param_segment}/{lat_str},{lon_str}/json"


def parse_meteomatics_json(payload: object) -> tuple[list[dict], dict]:
    """Validate and normalize a Meteomatics JSON response into an hourly series and safe metadata."""
    if not isinstance(payload, dict):
        raise UpstreamResponseError(
            SERVICE_NAME,
            "Meteomatics returned a non-object JSON payload.",
            code="malformed_payload",
        )

    status_str = str(payload.get("status", "OK")).strip()
    if status_str.upper() not in ("OK", "SUCCESS", "200"):
        raise UpstreamResponseError(
            SERVICE_NAME,
            f"Meteomatics returned non-OK payload status: {redact_secrets(status_str)[:60]}.",
            code="provider_status_error",
        )

    data_items = payload.get("data")
    if not isinstance(data_items, list) or not data_items:
        raise UpstreamResponseError(
            SERVICE_NAME,
            "Meteomatics payload is missing the 'data' array.",
            code="malformed_payload",
        )

    by_time: dict[str, dict[str, float | str | None]] = {}
    recognized_params = 0

    for entry in data_items:
        if not isinstance(entry, dict):
            continue
        param_name = str(entry.get("parameter", "")).strip()
        field_name = PARAMETER_TO_FIELD.get(param_name)
        if not field_name:
            continue
        coords = entry.get("coordinates")
        if not isinstance(coords, list) or not coords:
            continue
        first_coord = coords[0] if isinstance(coords[0], dict) else {}
        dates = first_coord.get("dates")
        if not isinstance(dates, list):
            continue
        recognized_params += 1
        for point in dates:
            if not isinstance(point, dict):
                continue
            ts = _normalize_iso_timestamp(point.get("date"))
            if not ts:
                continue
            row = by_time.setdefault(
                ts,
                {
                    "time": ts,
                    "temperature_c": None,
                    "precipitation_1h_mm": None,
                    "cloud_cover_percent": None,
                    "wind_speed_10m_ms": None,
                },
            )
            row[field_name] = _clean_numeric_value(point.get("value"), field_name)

    if recognized_params == 0 or not by_time:
        raise UpstreamResponseError(
            SERVICE_NAME,
            "Meteomatics payload contained no recognizable weather parameters or timestamps.",
            code="empty_series",
        )

    series = [by_time[k] for k in sorted(by_time.keys())]

    # Explicitly strip 'user' or any credential/account field from provider_metadata
    provider_metadata: dict[str, object] = {
        "status": status_str,
        "interval": INTERVAL,
    }
    if isinstance(payload.get("version"), (str, int, float)):
        provider_metadata["version"] = str(payload["version"])[:32]
    date_gen = _normalize_iso_timestamp(payload.get("dateGenerated"))
    if date_gen:
        provider_metadata["date_generated"] = date_gen
    if isinstance(payload.get("model"), str) and payload["model"].strip():
        provider_metadata["model"] = redact_secrets(payload["model"].strip())[:64]

    return series, provider_metadata


class WeatherProvider(Protocol):
    """Protocol for operational live-weather providers."""

    async def fetch_hourly(
        self,
        lat: float,
        lon: float,
        hours: int,
        *,
        now_utc: datetime | None = None,
    ) -> tuple[list[dict], dict, str, str]:
        ...


class MeteomaticsProvider:
    """Server-only Meteomatics operational weather provider using HTTPS Basic Auth."""

    def __init__(
        self,
        *,
        username: str,
        password: str,
        base_url: str = "https://api.meteomatics.com",
        timeout_seconds: float = 10.0,
        transport_call: Callable | None = None,
    ) -> None:
        self._username = username
        self._password = password
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._transport_call = transport_call

    def __repr__(self) -> str:
        return f"MeteomaticsProvider(base_url={self.base_url!r}, timeout_seconds={self.timeout_seconds})"

    async def _stream_get(self, url: str, headers: dict, auth: httpx.BasicAuth) -> httpx.Response:
        """GET with the body streamed and refused as soon as it passes MAX_RESPONSE_BYTES (never fully downloaded first).

        An error reply's body is never read: it is not used, and it is never passed on to the client.
        """
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=False) as client:
            async with client.stream("GET", url, headers=headers, auth=auth) as streamed:
                if streamed.status_code >= 400:
                    return httpx.Response(
                        streamed.status_code, headers=decoded_headers(streamed.headers), request=streamed.request
                    )
                body = await read_capped_body(streamed, SERVICE_NAME, MAX_RESPONSE_BYTES)
                return httpx.Response(
                    streamed.status_code,
                    headers=decoded_headers(streamed.headers),
                    content=body,
                    request=streamed.request,
                )

    async def fetch_hourly(
        self,
        lat: float,
        lon: float,
        hours: int,
        *,
        now_utc: datetime | None = None,
    ) -> tuple[list[dict], dict, str, str]:
        start_dt = _utc_hour_floor(now_utc)
        end_dt = start_dt + timedelta(hours=hours)
        try:
            url = build_meteomatics_url(self.base_url, start_dt, end_dt, lat, lon)
        except ValueError as exc:
            # A9: a bad METEOMATICS_BASE_URL is a server setup problem, reported as "unavailable", never as HTTP 500.
            err = UpstreamServiceError(
                SERVICE_NAME,
                "misconfigured",
                "Live weather is unavailable because the server's Meteomatics address setting is invalid.",
                retryable=False,
                status_code=None,
            )
            HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
            raise err from exc
        basic_auth = httpx.BasicAuth(self._username, self._password)
        headers = {"Accept": "application/json"}

        retry_delays = (0.35,)
        last_error: UpstreamServiceError | None = None

        for attempt in range(len(retry_delays) + 1):
            try:
                async with _CONCURRENCY.get():
                    if self._transport_call is not None:
                        resp = await self._transport_call(
                            method="GET",
                            url=url,
                            headers=headers,
                            auth=basic_auth,
                            timeout=self.timeout_seconds,
                        )
                    else:
                        resp = await self._stream_get(url, headers, basic_auth)

                status = resp.status_code
                if status in (502, 503, 504) and attempt < len(retry_delays):
                    await asyncio.sleep(retry_delays[attempt])
                    continue

                if status in (401, 403):
                    err = UpstreamResponseError(
                        SERVICE_NAME,
                        "Meteomatics authentication failed or account lacks permission for this query.",
                        code="auth_failed",
                        retryable=False,
                        status_code=status,
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err

                if status == 429:
                    err = UpstreamRateLimitError(
                        SERVICE_NAME,
                        "Meteomatics rate limit or subscription quota reached.",
                        retry_after_seconds=parse_retry_after(resp.headers.get("retry-after")),
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err

                if status in (400, 404, 422):
                    err = UpstreamResponseError(
                        SERVICE_NAME,
                        "Meteomatics rejected the requested parameter or forecast range for this subscription.",
                        code="unsupported_range",
                        retryable=False,
                        status_code=status,
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err

                if status >= 400:
                    err = UpstreamResponseError(
                        SERVICE_NAME,
                        f"Meteomatics returned HTTP {status}.",
                        code=f"http_{status}",
                        retryable=False,
                        status_code=status,
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err

                raw_bytes = resp.content or b""
                if len(raw_bytes) > MAX_RESPONSE_BYTES:
                    err = UpstreamResponseError(
                        SERVICE_NAME,
                        "Meteomatics response exceeded the maximum allowed size.",
                        code="response_too_large",
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err

                try:
                    payload = json.loads(raw_bytes.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    err = UpstreamResponseError(
                        SERVICE_NAME,
                        "Meteomatics returned malformed JSON.",
                        code="malformed_json",
                    )
                    HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
                    raise err from exc

                series, metadata = parse_meteomatics_json(payload)
                HEALTH_REGISTRY.record_success(SERVICE_NAME)
                return series, metadata, _to_iso_utc(start_dt), _to_iso_utc(end_dt)

            except asyncio.CancelledError:
                raise
            except UpstreamRateLimitError:
                # A rate limit or used-up quota is not retried: an immediate second request only spends more allowance.
                raise
            except UpstreamServiceError as exc:
                last_error = exc
                if exc.retryable and attempt < len(retry_delays):
                    await asyncio.sleep(retry_delays[attempt])
                    continue
                raise
            except httpx.TimeoutException as exc:
                last_error = UpstreamTimeoutError(
                    SERVICE_NAME,
                    f"Meteomatics request timed out after {self.timeout_seconds:.1f}s.",
                )
                if attempt < len(retry_delays):
                    await asyncio.sleep(retry_delays[attempt])
                    continue
                HEALTH_REGISTRY.record_failure(SERVICE_NAME, "timeout")
                raise last_error from exc
            except httpx.HTTPError as exc:
                last_error = UpstreamServiceError(
                    SERVICE_NAME,
                    "network_error",
                    f"Could not reach Meteomatics: {redact_secrets(str(exc))}",
                    retryable=True,
                    status_code=502,
                )
                if attempt < len(retry_delays):
                    await asyncio.sleep(retry_delays[attempt])
                    continue
                HEALTH_REGISTRY.record_failure(SERVICE_NAME, "network_error")
                raise last_error from exc

        err = last_error or UpstreamServiceError(
            SERVICE_NAME,
            "unknown_error",
            "Meteomatics request failed.",
        )
        HEALTH_REGISTRY.record_failure(SERVICE_NAME, err.code)
        raise err


def _unavailable_payload(
    *,
    lat: float,
    lon: float,
    hours: int,
    start_iso: str,
    end_iso: str,
    status: str,
    reason: str,
    retry_after_seconds: int | None = None,
) -> dict:
    return {
        "available": False,
        "status": status,
        "provider": PROVIDER_LABEL,
        "label": LAYER_LABEL,
        "location": {"lat": round(float(lat), 4), "lon": round(float(lon), 4)},
        "request": {
            "hours": int(hours),
            "interval": INTERVAL,
            "start": start_iso,
            "end": end_iso,
        },
        "parameters": dict(METEOMATICS_PARAMETERS),
        "parameter_details": dict(PARAMETER_DETAILS),
        "current": None,
        "series": [],
        "fetched_at": utc_now_iso(),
        "stale": False,
        "reason": redact_secrets(reason),
        "retry_after_seconds": retry_after_seconds,
        "source_note": SOURCE_NOTE,
        "provider_metadata": {},
    }


def _serve_cached(
    entry,
    *,
    lat: float,
    lon: float,
    start_iso: str,
    stale: bool,
    reason: str | None,
    retry_after_seconds: int | None = None,
) -> dict | None:
    """A cached payload re-based on the current UTC hour, for the current caller (A8).

    Rows before the current hour are dropped, so `series[0]`, `current` and `request.start` always describe the current
    hour as contract section 7 promises. `location` is the current caller's rounded coordinates, not the first caller's.
    Returns None when no row at or after the current hour is left.
    """
    payload = dict(entry.value)
    series = [
        row for row in payload.get("series") or [] if isinstance(row, dict) and str(row.get("time", "")) >= start_iso
    ]
    if not series:
        return None
    request = dict(payload.get("request") or {})
    request["start"] = start_iso
    payload.update(
        {
            "available": True,
            "status": "stale" if stale else "available",
            "stale": stale,
            "location": {"lat": round(float(lat), 4), "lon": round(float(lon), 4)},
            "request": request,
            "series": series,
            "current": series[0],
            "fetched_at": entry.fetched_at,
            "reason": reason,
            "retry_after_seconds": retry_after_seconds,
        }
    )
    return payload


def _check_quota(client_key: str) -> tuple[bool, int]:
    """Per-visitor first, then the whole-server budget. Returns (allowed, retry_after_seconds)."""
    cfg = load_config()
    ok, retry_after, _ = _VISITOR_LIMITER.check(
        client_key,
        max_requests=cfg.meteomatics_rate_limit_max,
        window_seconds=cfg.meteomatics_rate_limit_window_seconds,
    )
    if not ok:
        return False, retry_after
    ok, retry_after, _ = _GLOBAL_LIMITER.check(
        _GLOBAL_KEY,
        max_requests=cfg.meteomatics_global_rate_limit_max,
        window_seconds=cfg.meteomatics_global_rate_limit_window_seconds,
    )
    return ok, (0 if ok else retry_after)


async def fetch_live_weather(
    lat: float,
    lon: float,
    hours: int = DEFAULT_HOURS,
    *,
    provider: WeatherProvider | None = None,
    transport_call: Callable | None = None,
    now_utc: datetime | None = None,
    client_key: str = "anonymous",
) -> dict:
    """Fetch current and short-range hourly weather from Meteomatics with caching, quota protection and safe fallback.

    Order: validate -> fresh cache (free) -> unconfigured -> per-visitor and global quota -> provider. A visitor over quota
    gets the cached (stale) reply for that place if one exists, otherwise status "rate_limited"; neither ever contains a
    credential or any upstream body.
    """
    if not (-90.0 <= float(lat) <= 90.0):
        raise ValueError("lat must be between -90 and 90.")
    if not (-180.0 <= float(lon) <= 180.0):
        raise ValueError("lon must be between -180 and 180.")
    if not (MIN_HOURS <= int(hours) <= MAX_HOURS):
        raise ValueError(f"hours must be between {MIN_HOURS} and {MAX_HOURS}.")

    cfg = load_config()
    norm_lat = round(float(lat), 4)
    norm_lon = round(float(lon), 4)
    cache_key = (round(norm_lat, 2), round(norm_lon, 2), int(hours))

    start_dt = _utc_hour_floor(now_utc)
    end_dt = start_dt + timedelta(hours=int(hours))
    start_iso = _to_iso_utc(start_dt)
    end_iso = _to_iso_utc(end_dt)

    # Fresh cache first, but only a reply that starts at the current UTC hour counts as fresh (A8): one fetched at 10:55
    # is refreshed at 11:00 instead of serving the 10:00 row as "current" until 11:10.
    fresh = _WEATHER_CACHE.get_entry(cache_key, allow_stale=False, ttl_override=cfg.meteomatics_cache_ttl_seconds)
    if fresh is not None and (fresh.value.get("request") or {}).get("start") == start_iso:
        served = _serve_cached(fresh, lat=norm_lat, lon=norm_lon, start_iso=start_iso, stale=False, reason=None)
        if served is not None:
            return served

    def _stale_or(fallback: dict, reason: str, retry_after: int | None = None) -> dict:
        stale_entry = _WEATHER_CACHE.get_entry(cache_key, allow_stale=True, ttl_override=cfg.meteomatics_cache_ttl_seconds)
        if stale_entry is not None:
            served = _serve_cached(
                stale_entry,
                lat=norm_lat,
                lon=norm_lon,
                start_iso=start_iso,
                stale=True,
                reason=redact_secrets(reason),
                retry_after_seconds=retry_after,
            )
            if served is not None:
                return served
        return fallback

    # Check if credentials or custom provider are available
    active_provider = provider
    if active_provider is None:
        if not cfg.meteomatics_configured:
            return _unavailable_payload(
                lat=norm_lat,
                lon=norm_lon,
                hours=hours,
                start_iso=start_iso,
                end_iso=end_iso,
                status="unconfigured",
                reason="Live weather is unavailable because METEOMATICS_USERNAME and METEOMATICS_PASSWORD are not configured on the server.",
            )
        active_provider = MeteomaticsProvider(
            username=cfg.meteomatics_username or "",
            password=cfg.meteomatics_password or "",
            base_url=cfg.meteomatics_base_url,
            timeout_seconds=cfg.meteomatics_timeout_seconds,
            transport_call=transport_call,
        )

    allowed, retry_after = _check_quota(client_key)
    if not allowed:
        limited = _unavailable_payload(
            lat=norm_lat,
            lon=norm_lon,
            hours=hours,
            start_iso=start_iso,
            end_iso=end_iso,
            status="rate_limited",
            reason="Live weather is paused for a moment because too many live-weather requests were made. Try again shortly.",
            retry_after_seconds=retry_after,
        )
        return _stale_or(
            limited,
            "Serving cached Meteomatics weather because the live-weather request limit was reached.",
            retry_after,
        )

    try:
        series, metadata, req_start, req_end = await active_provider.fetch_hourly(
            norm_lat,
            norm_lon,
            int(hours),
            now_utc=now_utc,
        )
        payload = {
            "available": True,
            "status": "available",
            "provider": PROVIDER_LABEL,
            "label": LAYER_LABEL,
            "location": {"lat": norm_lat, "lon": norm_lon},
            "request": {
                "hours": int(hours),
                "interval": INTERVAL,
                "start": req_start,
                "end": req_end,
            },
            "parameters": dict(METEOMATICS_PARAMETERS),
            "parameter_details": dict(PARAMETER_DETAILS),
            "current": series[0] if series else None,
            "series": series,
            "fetched_at": utc_now_iso(),
            "stale": False,
            "reason": None,
            "retry_after_seconds": None,
            "source_note": SOURCE_NOTE,
            "provider_metadata": metadata,
        }
        stored = _WEATHER_CACHE.put(cache_key, payload)
        payload["fetched_at"] = stored.fetched_at
        return payload

    except UpstreamServiceError as exc:
        upstream_retry = getattr(exc, "retry_after_seconds", None)
        unavailable = _unavailable_payload(
            lat=norm_lat,
            lon=norm_lon,
            hours=hours,
            start_iso=start_iso,
            end_iso=end_iso,
            status="unavailable",
            reason=exc.message,
            retry_after_seconds=upstream_retry,
        )
        return _stale_or(
            unavailable,
            f"Serving cached Meteomatics weather because the live refresh failed ({exc.message})",
            upstream_retry,
        )


def clear_meteomatics_cache() -> None:
    """Clear the weather cache and both quota limiters (used by offline tests)."""
    _WEATHER_CACHE.clear()
    _VISITOR_LIMITER.clear()
    _GLOBAL_LIMITER.clear()


def meteomatics_health() -> dict:
    """Non-secret health and cache summary for GET /api/health/details without calling Meteomatics."""
    cfg = load_config()
    snap = HEALTH_REGISTRY.snapshot(SERVICE_NAME)
    cache_stats = _WEATHER_CACHE.stats(ttl_override=cfg.meteomatics_cache_ttl_seconds)
    configured = cfg.meteomatics_configured
    if not configured:
        status = "unconfigured"
    elif snap["last_status"] == "degraded":
        status = "degraded"
    else:
        status = "available"
    return {
        "status": status,
        "available": configured and snap["last_status"] != "degraded",
        "configured": configured,
        "provider": PROVIDER_LABEL,
        "parameters": list(METEOMATICS_PARAMETERS.values()),
        "cache": cache_stats,
        "rate_limit": {
            "per_visitor_max_requests": cfg.meteomatics_rate_limit_max,
            "per_visitor_window_seconds": cfg.meteomatics_rate_limit_window_seconds,
            "global_max_requests": cfg.meteomatics_global_rate_limit_max,
            "global_window_seconds": cfg.meteomatics_global_rate_limit_window_seconds,
            "tracked_visitors": len(_VISITOR_LIMITER),
            "trusted_proxy_hops": cfg.trusted_proxy_hops,
        },
        "telemetry": snap,
    }
