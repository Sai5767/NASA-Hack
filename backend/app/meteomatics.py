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
    UpstreamRateLimitError,
    UpstreamResponseError,
    UpstreamServiceError,
    UpstreamTimeoutError,
    load_config,
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
_CONCURRENCY_SEMAPHORE = asyncio.Semaphore(4)
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
        url = build_meteomatics_url(self.base_url, start_dt, end_dt, lat, lon)
        basic_auth = httpx.BasicAuth(self._username, self._password)
        headers = {"Accept": "application/json"}

        retry_delays = (0.35,)
        last_error: UpstreamServiceError | None = None

        for attempt in range(len(retry_delays) + 1):
            try:
                async with _CONCURRENCY_SEMAPHORE:
                    if self._transport_call is not None:
                        resp = await self._transport_call(
                            method="GET",
                            url=url,
                            headers=headers,
                            auth=basic_auth,
                            timeout=self.timeout_seconds,
                        )
                    else:
                        async with httpx.AsyncClient(
                            timeout=self.timeout_seconds,
                            follow_redirects=False,
                        ) as client:
                            resp = await client.get(url, headers=headers, auth=basic_auth)

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
        "source_note": SOURCE_NOTE,
        "provider_metadata": {},
    }


async def fetch_live_weather(
    lat: float,
    lon: float,
    hours: int = DEFAULT_HOURS,
    *,
    provider: WeatherProvider | None = None,
    transport_call: Callable | None = None,
    now_utc: datetime | None = None,
) -> dict:
    """Fetch current and short-range hourly weather from Meteomatics with caching and safe fallback."""
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

    # Check fresh cache first
    fresh = _WEATHER_CACHE.get_entry(
        cache_key,
        allow_stale=False,
        ttl_override=cfg.meteomatics_cache_ttl_seconds,
    )
    if fresh is not None:
        cached_payload = dict(fresh.value)
        cached_payload["fetched_at"] = fresh.fetched_at
        cached_payload["stale"] = False
        cached_payload["status"] = "available"
        return cached_payload

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
            "source_note": SOURCE_NOTE,
            "provider_metadata": metadata,
        }
        stored = _WEATHER_CACHE.put(cache_key, payload)
        payload["fetched_at"] = stored.fetched_at
        return payload

    except UpstreamServiceError as exc:
        stale_entry = _WEATHER_CACHE.get_entry(
            cache_key,
            allow_stale=True,
            ttl_override=cfg.meteomatics_cache_ttl_seconds,
        )
        if stale_entry is not None:
            stale_payload = dict(stale_entry.value)
            stale_payload["available"] = True
            stale_payload["status"] = "stale"
            stale_payload["stale"] = True
            stale_payload["fetched_at"] = stale_entry.fetched_at
            stale_payload["reason"] = redact_secrets(
                f"Serving cached Meteomatics weather because the live refresh failed ({exc.message})"
            )
            return stale_payload

        return _unavailable_payload(
            lat=norm_lat,
            lon=norm_lon,
            hours=hours,
            start_iso=start_iso,
            end_iso=end_iso,
            status="unavailable",
            reason=exc.message,
        )


def clear_meteomatics_cache() -> None:
    _WEATHER_CACHE.clear()


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
        "telemetry": snap,
    }
