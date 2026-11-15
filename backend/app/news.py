"""Live-news context provider interface and default adapter for GET /api/news (V2).

Design rules:
  1. News is context, not scientific evidence. Every item carries `label = "news context, not scientific evidence"`.
  2. Queries a bounded set of user-saved locations (up to 5) plus a fixed global rotation set.
  3. Deduplicates by canonical URL and normalized title, rejects unusable URLs or dates, and never scrapes HTML.
  4. Applies deterministic keyword rules for category and severity (`green` / `amber` / `red`) — never an LLM.
  5. Caches results for at least 15 minutes (900s). On upstream failure, returns the last successful cache marked
     `stale: True` or an honest empty result — never synthetic headlines.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .places import PLACES
from .resilience import (
    BoundedTTLCache,
    HEALTH_REGISTRY,
    UpstreamServiceError,
    load_config,
    redact_secrets,
    request_with_resilience,
    utc_now_iso,
)

NEWS_CONTEXT_LABEL = "news context, not scientific evidence"
MIN_NEWS_CACHE_TTL_SECONDS = 900  # 15 minutes minimum
MAX_SAVED_LOCATIONS = 5
MAX_TOTAL_QUERIES = 6
MAX_NEWS_CONCURRENCY = 2
NEWS_TOTAL_BUDGET_SECONDS = 20.0  # whole request: slow locations are reported as timeouts instead of holding the page up

GLOBAL_ROTATION_PLACE_IDS = ("delhi", "phoenix", "amazon", "london", "sydney")
_PLACES_BY_ID = {p["id"]: p for p in PLACES}
_PLACES_BY_NAME = {p["name"].lower(): p for p in PLACES}

_TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "msclkid",
    "ref",
    " _hsenc",
}

# Deterministic category rules checked in order
CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    (
        "heat_wildfire",
        (
            "heatwave", "heat wave", "extreme heat", "record heat", "record high temperature",
            "wildfire", "bushfire", "forest fire", "brush fire", "heat advisory", "heat dome",
        ),
    ),
    (
        "flood_storm",
        (
            "flood", "flash flood", "inundation", "hurricane", "cyclone", "typhoon", "storm surge",
            "monsoon", "torrential rain", "extreme rainfall", "atmospheric river", "landslide",
        ),
    ),
    (
        "drought_water",
        (
            "drought", "megadrought", "water shortage", "water crisis", "reservoir", "arid",
            "dry spell", "groundwater depletion", "crop failure", "water restriction",
        ),
    ),
    (
        "cryosphere_ocean",
        (
            "sea ice", "glacier", "ice sheet", "permafrost", "iceberg", "coral bleaching",
            "marine heatwave", "sea level", "ocean warming",
        ),
    ),
    (
        "air_atmosphere",
        (
            "air quality", "smog", "wildfire smoke", "haze", "dust storm", "aerosol", "air pollution",
            "ozone", "particulate",
        ),
    ),
]

# Deterministic severity keyword rules (transparent editorial triage, never an LLM)
RED_SEVERITY_KEYWORDS = (
    "evacuation",
    "evacuate",
    "state of emergency",
    "emergency declared",
    "catastrophic",
    "deadly",
    "fatalities",
    "death toll",
    "red alert",
    "extreme heat warning",
    "major flood",
    "flash flood emergency",
    "category 4",
    "category 5",
    "out-of-control wildfire",
    "disaster declaration",
)

AMBER_SEVERITY_KEYWORDS = (
    # Warning-style words only count as part of a weather phrase: a bare "watch" or "alert" would mark "Watch: how
    # scientists measure sea level" as a hazard.
    "weather warning",
    "weather advisory",
    "weather alert",
    "heat warning",
    "heat advisory",
    "heat alert",
    "flood warning",
    "flood watch",
    "flood alert",
    "storm warning",
    "storm watch",
    "storm alert",
    "tornado warning",
    "tornado watch",
    "fire warning",
    "air quality alert",
    "heatwave",
    "heat wave",
    "wildfire",
    "bushfire",
    "flood",
    "drought",
    "water shortage",
    "water restriction",
    "cyclone",
    "hurricane",
    "typhoon",
    "severe storm",
    "storm surge",
    "torrential",
    "smog",
    "smoke",
    "coral bleaching",
    "landslide",
)

SEVERITY_LABELS = {
    "red": "Major reported hazard",
    "amber": "Weather / environmental watch",
    "green": "Informational science / environment context",
}

# Words that make a story about weather, climate or the environment at all. A story matching none of them (a royal
# visit, a film list, a comic) is dropped instead of being shown as "environment context". Severity words such as
# "deadly" or "warning" are deliberately NOT here: on their own they would let crime or sport stories through.
GENERIC_RELEVANCE_KEYWORDS = (
    "climate", "weather", "temperature", "rainfall", "rain", "snowfall", "global warming", "greenhouse",
    "emissions", "el nino", "el niño", "la nina", "la niña", "environment", "environmental", "ecosystem",
    "pollution", "monsoon", "tornado", "blizzard", "cold snap", "sea level", "biodiversity", "deforestation",
    "rainforest", "glacier", "thunderstorm", "snowstorm", "windstorm", "tropical storm", "winter storm",
    "severe storm", "storm surge", "bushfire", "wildfire", "heatwave", "heat wave", "flood", "drought",
    "cyclone", "hurricane", "typhoon", "landslide", "coral bleaching", "water shortage", "water restriction",
    "smog", "torrential",
)


def _word_regex(words) -> "re.Pattern[str]":
    """Whole-word (optionally plural) matcher, so "flood" does not fire inside "floodlight"."""
    alternatives = "|".join(re.escape(w) for w in sorted(set(words), key=len, reverse=True))
    return re.compile(rf"(?<![a-z0-9])(?:{alternatives})(?:s|es)?(?![a-z0-9])")


# Relevance = the environmental category words plus the generic list above. Severity words ("warning", "watch",
# "alert") only raise severity on a story that already passed this check; they never make a story relevant.
_RELEVANCE_RE = _word_regex(list(GENERIC_RELEVANCE_KEYWORDS) + [kw for _, kws in CATEGORY_RULES for kw in kws])
_CATEGORY_RES = [(code, _word_regex(kws)) for code, kws in CATEGORY_RULES]
_RED_RE = _word_regex(RED_SEVERITY_KEYWORDS)
_AMBER_RE = _word_regex(AMBER_SEVERITY_KEYWORDS)


def is_environmentally_relevant(title: str, snippet: str = "") -> bool:
    """True when a story is plausibly about weather, climate or the environment (deterministic keyword rule)."""
    return bool(_RELEVANCE_RE.search(f"{title} {snippet}".lower()))


@dataclass(frozen=True)
class NewsLocationQuery:
    id: str
    name: str
    lat: float
    lon: float
    kind: str
    coordinate_precision: str
    uncertainty_km: int
    source: str  # "saved_location" | "global_rotation"


class NewsProvider(Protocol):
    """Interface for pluggable news context adapters (e.g. GDELT demo adapter or future Azure provider)."""

    provider_id: str

    async def fetch_for_location(self, query: NewsLocationQuery, timeout_seconds: float) -> list[dict]:
        """Return raw candidate articles for a single location query without scraping publisher HTML."""
        ...


_news_cache: BoundedTTLCache[str, dict] = BoundedTTLCache(
    "news_context", max_entries=120, ttl_seconds=MIN_NEWS_CACHE_TTL_SECONDS
)


def clear_news_cache() -> None:
    _news_cache.clear()


def news_health() -> dict:
    """Non-secret health and cache telemetry for the live-news feature."""
    cfg = load_config()
    ttl = max(MIN_NEWS_CACHE_TTL_SECONDS, cfg.news_cache_ttl_seconds)
    c_stats = _news_cache.stats(ttl_override=ttl)
    snap = HEALTH_REGISTRY.snapshot("news")
    if not cfg.news_enabled:
        status = "disabled"
    elif snap["consecutive_failures"] > 0:
        status = "degraded"
    else:
        status = "available"
    return {
        "status": status,
        "configured": cfg.news_enabled,
        "provider": cfg.news_provider,
        "stale_available": c_stats["entries"] > 0,
        "timeout_seconds": cfg.news_timeout_seconds,
        **c_stats,
        **snap,
    }


def _precision_for_kind(kind: str) -> tuple[str, int]:
    if kind == "city":
        return "city_centroid", 50
    if kind == "custom":
        return "custom_pin", 75
    return "region_approximate", 250


def build_location_queries(locations_param: str | None = None) -> list[NewsLocationQuery]:
    """Build a deduplicated, bounded list of saved-location queries plus the fixed global rotation set."""
    queries: list[NewsLocationQuery] = []
    seen_ids: set[str] = set()

    if locations_param:
        tokens = [t.strip() for t in locations_param.split(",") if t.strip()]
        for token in tokens[:MAX_SAVED_LOCATIONS]:
            low = token.lower()
            place = _PLACES_BY_ID.get(low) or _PLACES_BY_NAME.get(low)
            if place is not None:
                if place["id"] in seen_ids:
                    continue
                seen_ids.add(place["id"])
                prec, unc = _precision_for_kind(place["kind"])
                queries.append(
                    NewsLocationQuery(
                        id=place["id"],
                        name=place["name"],
                        lat=place["lat"],
                        lon=place["lon"],
                        kind=place["kind"],
                        coordinate_precision=prec,
                        uncertainty_km=unc,
                        source="saved_location",
                    )
                )
                continue

            # Support custom Name:lat:lon or lat:lon specs
            parts = [p.strip() for p in token.split(":")]
            if len(parts) in (2, 3):
                try:
                    if len(parts) == 3:
                        name, lat_v, lon_v = parts[0], float(parts[1]), float(parts[2])
                    else:
                        lat_v, lon_v = float(parts[0]), float(parts[1])
                        name = f"Pin ({lat_v:.1f}, {lon_v:.1f})"
                    if -90.0 <= lat_v <= 90.0 and -180.0 <= lon_v <= 180.0 and name:
                        cid = f"custom_{round(lat_v, 2)}_{round(lon_v, 2)}"
                        if cid not in seen_ids:
                            seen_ids.add(cid)
                            prec, unc = _precision_for_kind("custom")
                            queries.append(
                                NewsLocationQuery(
                                    id=cid,
                                    name=name[:60],
                                    lat=round(lat_v, 4),
                                    lon=round(lon_v, 4),
                                    kind="custom",
                                    coordinate_precision=prec,
                                    uncertainty_km=unc,
                                    source="saved_location",
                                )
                            )
                except ValueError:
                    continue

    # Append fixed global rotation set up to MAX_TOTAL_QUERIES
    for pid in GLOBAL_ROTATION_PLACE_IDS:
        if len(queries) >= MAX_TOTAL_QUERIES:
            break
        if pid in seen_ids:
            continue
        place = _PLACES_BY_ID.get(pid)
        if place is None:
            continue
        seen_ids.add(pid)
        prec, unc = _precision_for_kind(place["kind"])
        queries.append(
            NewsLocationQuery(
                id=place["id"],
                name=place["name"],
                lat=place["lat"],
                lon=place["lon"],
                kind=place["kind"],
                coordinate_precision=prec,
                uncertainty_km=unc,
                source="global_rotation",
            )
        )

    return queries


def normalize_canonical_url(raw_url: str | None) -> str | None:
    """Validate and canonicalize an article URL (http/https only, stripped of tracking params and fragments)."""
    if not raw_url or not isinstance(raw_url, str):
        return None
    cleaned = raw_url.strip()
    if any(ch.isspace() for ch in cleaned):
        return None
    try:
        parsed = urlparse(cleaned)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None
    host = parsed.netloc.lower().split(":")[0]
    if "." not in host or host in ("localhost", "127.0.0.1"):
        return None

    filtered_q = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if k.lower().strip() not in _TRACKING_PARAMS and not k.lower().startswith("utm_")
    ]
    path = parsed.path or "/"
    return urlunparse((parsed.scheme.lower(), host, path, "", urlencode(filtered_q), ""))


def parse_published_time(raw_date: str | None) -> str | None:
    """Parse and validate a publication timestamp into ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)."""
    if not raw_date or not isinstance(raw_date, str):
        return None
    text = raw_date.strip()
    if not text:
        return None

    dt: datetime | None = None
    # GDELT compact timestamp: 20261114T153000Z or 20261114153000
    m_gdelt = re.match(r"^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$", text)
    if m_gdelt:
        try:
            yr, mo, dy, hh, mm, ss = (int(g) for g in m_gdelt.groups())
            dt = datetime(yr, mo, dy, hh, mm, ss, tzinfo=timezone.utc)
        except ValueError:
            return None
    else:
        iso_candidate = text.replace("Z", "+00:00") if text.endswith("Z") else text
        try:
            dt = datetime.fromisoformat(iso_candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
        except ValueError:
            return None

    now_utc = datetime.now(timezone.utc)
    if dt.year < 2020 or dt > now_utc + timedelta(days=2):
        return None
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def classify_category_and_severity(title: str, snippet: str = "") -> tuple[str, str, str]:
    """Deterministic keyword-based category and severity classification (never uses an LLM).

    Returns (category, severity, severity_label).
    """
    combined = f"{title} {snippet}".lower()

    category = "climate_science"
    for cat_code, pattern in _CATEGORY_RES:
        if pattern.search(combined):
            category = cat_code
            break

    if _RED_RE.search(combined):
        severity = "red"
    elif _AMBER_RE.search(combined):
        severity = "amber"
    else:
        severity = "green"

    return category, severity, SEVERITY_LABELS[severity]


def _normalize_title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def normalize_and_deduplicate_articles(raw_entries: list[tuple[NewsLocationQuery, dict]], limit: int = 18) -> list[dict]:
    """Validate, classify, geocode, and deduplicate raw provider articles."""
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    items: list[dict] = []

    for loc_query, raw in raw_entries:
        if not isinstance(raw, dict):
            continue
        title = " ".join(str(raw.get("title") or "").strip().split())
        if len(title) < 10:
            continue
        snippet = str(raw.get("snippet") or raw.get("description") or "").strip()
        if not is_environmentally_relevant(title, snippet):
            continue  # not about weather, climate or the environment: never shown as "environment context"
        canonical_url = normalize_canonical_url(raw.get("url") or raw.get("canonical_url"))
        if not canonical_url:
            continue
        published_at = parse_published_time(
            raw.get("published_at") or raw.get("seendate") or raw.get("date")
        )
        if not published_at:
            continue

        publisher = str(raw.get("publisher") or raw.get("domain") or "").strip()
        if not publisher:
            publisher = urlparse(canonical_url).netloc.lower()
            if publisher.startswith("www."):
                publisher = publisher[4:]
        if not publisher:
            continue

        title_key = _normalize_title_key(title)
        if canonical_url in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(canonical_url)
        seen_titles.add(title_key)

        category, severity, severity_label = classify_category_and_severity(title, snippet)
        item_id = "news_" + hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()[:12]

        items.append(
            {
                "id": item_id,
                "title": title[:220],
                "publisher": publisher[:100],
                "canonical_url": canonical_url,
                "url": canonical_url,
                "published_at": published_at,
                "category": category,
                "severity": severity,
                "severity_label": severity_label,
                "lat": loc_query.lat,
                "lon": loc_query.lon,
                "location_id": loc_query.id,
                "location_name": loc_query.name,
                "location_source": loc_query.source,
                "coordinate_precision": loc_query.coordinate_precision,
                "uncertainty_km": loc_query.uncertainty_km,
                "label": NEWS_CONTEXT_LABEL,
            }
        )

    items.sort(key=lambda x: x["published_at"], reverse=True)
    return items[:limit]


# --------------------------------------------------------------------------- Provider implementations


class GdeltNewsProvider:
    """Default keyless demo adapter querying GDELT Doc 2.0 JSON API (no HTML scraping)."""

    provider_id = "gdelt"

    def __init__(self, api_url: str = "https://api.gdeltproject.org/api/v2/doc/doc") -> None:
        self.api_url = api_url

    async def fetch_for_location(self, query: NewsLocationQuery, timeout_seconds: float) -> list[dict]:
        search_q = (
            f'"{query.name}" (climate OR weather OR temperature OR rainfall OR drought '
            f'OR flood OR heatwave OR wildfire OR storm) sourcelang:english'
        )
        params = {
            "query": search_q,
            "mode": "ArtList",
            "maxrecords": "8",
            "format": "json",
            "sort": "DateDesc",
        }
        resp = await request_with_resilience(
            "news",
            "GET",
            self.api_url,
            params=params,
            timeout_seconds=timeout_seconds,
            retry_delays=(0.4,),
        )
        try:
            payload = resp.json()
        except ValueError as exc:
            raise UpstreamServiceError("news", "invalid_json", "GDELT returned non-JSON body.") from exc
        if not isinstance(payload, dict):
            return []
        articles = payload.get("articles", [])
        return articles if isinstance(articles, list) else []


class ConfigurableJsonNewsProvider:
    """Adapter for an Azure-hosted or custom JSON news feed configured via NEWS_API_URL / NEWS_API_KEY."""

    provider_id = "json_feed"

    def __init__(self, api_url: str, api_key: str | None = None) -> None:
        self.api_url = api_url
        self.api_key = api_key

    async def fetch_for_location(self, query: NewsLocationQuery, timeout_seconds: float) -> list[dict]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["Ocp-Apim-Subscription-Key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        params = {"q": f"{query.name} climate weather environment", "lat": query.lat, "lon": query.lon}
        resp = await request_with_resilience(
            "news",
            "GET",
            self.api_url,
            params=params,
            headers=headers,
            timeout_seconds=timeout_seconds,
            retry_delays=(0.4,),
        )
        try:
            payload = resp.json()
        except ValueError as exc:
            raise UpstreamServiceError("news", "invalid_json", "News provider returned non-JSON body.") from exc
        if isinstance(payload, dict):
            items = payload.get("articles") or payload.get("items") or payload.get("value") or []
            return items if isinstance(items, list) else []
        return []


class DisabledNewsProvider:
    """No-op provider used when NEWS_PROVIDER=disabled."""

    provider_id = "disabled"

    async def fetch_for_location(self, query: NewsLocationQuery, timeout_seconds: float) -> list[dict]:
        return []


def get_news_provider() -> NewsProvider:
    """Instantiate the configured NewsProvider adapter."""
    cfg = load_config()
    if not cfg.news_enabled:
        return DisabledNewsProvider()
    if cfg.news_provider in ("json_feed", "azure", "custom"):
        return ConfigurableJsonNewsProvider(cfg.news_api_url, cfg.news_api_key)
    return GdeltNewsProvider(cfg.news_api_url)


async def fetch_news_context(
    locations: str | None = None,
    limit: int = 18,
    *,
    provider: NewsProvider | None = None,
) -> dict:
    """Fetch, validate, deduplicate, and cache live-news context items near saved and global locations."""
    cfg = load_config()
    ttl = max(MIN_NEWS_CACHE_TTL_SECONDS, cfg.news_cache_ttl_seconds)
    active_provider = provider or get_news_provider()
    queries = build_location_queries(locations)
    cache_key = f"{active_provider.provider_id}|" + ",".join(q.id for q in queries)

    if active_provider.provider_id == "disabled":
        return {
            "items": [],
            "fetched_at": utc_now_iso(),
            "stale": False,
            "cache_age_seconds": 0.0,
            "provider": "disabled",
            "partial_failures": [],
            "locations_queried": [
                {"id": q.id, "name": q.name, "lat": q.lat, "lon": q.lon, "source": q.source}
                for q in queries
            ],
            "empty_reason": "Live news context is disabled in server configuration.",
            "context_note": "News markers provide regional environmental context only; they are not scientific trend evidence.",
        }

    # Serve fresh cache if within TTL (>= 15 minutes)
    fresh = _news_cache.get_entry(cache_key, allow_stale=False, ttl_override=ttl)
    if fresh is not None:
        cached_payload = dict(fresh.value)
        cached_payload["items"] = cached_payload["items"][:limit]
        cached_payload["stale"] = False
        cached_payload["cache_age_seconds"] = fresh.age_seconds
        return cached_payload

    limiter = asyncio.Semaphore(MAX_NEWS_CONCURRENCY)

    async def _run_query(q: NewsLocationQuery) -> tuple[NewsLocationQuery, list[dict] | None, dict | None]:
        async with limiter:
            try:
                rows = await active_provider.fetch_for_location(q, cfg.news_timeout_seconds)
                return q, rows, None
            except Exception as exc:
                safe_msg = redact_secrets(str(exc)) or "Upstream news provider error."
                code = exc.code if isinstance(exc, UpstreamServiceError) else "provider_error"
                return q, None, {"location_id": q.id, "location_name": q.name, "code": code, "message": safe_msg}

    # One overall time budget: a provider that is slow (or rate-limiting) must not hold the page up for a minute. Locations
    # that have not answered by then are reported as timeouts, and whatever did arrive is used.
    tasks = [asyncio.ensure_future(_run_query(q)) for q in queries]
    done, pending = await asyncio.wait(tasks, timeout=NEWS_TOTAL_BUDGET_SECONDS)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    results = []
    for q, task in zip(queries, tasks):
        if task in done and not task.cancelled():
            results.append(task.result())
        else:
            results.append(
                (q, None, {"location_id": q.id, "location_name": q.name, "code": "timeout", "message": "News for this location did not arrive in time."})
            )

    raw_pairs: list[tuple[NewsLocationQuery, dict]] = []
    partial_failures: list[dict] = []
    succeeded_queries = 0

    for q, rows, err in results:
        if err is not None:
            partial_failures.append(err)
            continue
        succeeded_queries += 1
        for article in rows or []:
            raw_pairs.append((q, article))

    # If all upstream queries failed, serve stale cache if available; otherwise return honest empty state
    if succeeded_queries == 0 and partial_failures:
        HEALTH_REGISTRY.record_failure("news", partial_failures[0]["code"])
        stale_entry = _news_cache.get_entry(cache_key, allow_stale=True, ttl_override=ttl)
        if stale_entry is not None:
            stale_payload = dict(stale_entry.value)
            stale_payload["items"] = stale_payload["items"][:limit]
            stale_payload["stale"] = True
            stale_payload["cache_age_seconds"] = stale_entry.age_seconds
            stale_payload["partial_failures"] = partial_failures
            return stale_payload

        return {
            "items": [],
            "fetched_at": utc_now_iso(),
            "stale": False,
            "cache_age_seconds": None,
            "provider": active_provider.provider_id,
            "partial_failures": partial_failures,
            "locations_queried": [
                {"id": q.id, "name": q.name, "lat": q.lat, "lon": q.lon, "source": q.source}
                for q in queries
            ],
            "empty_reason": "Live news provider is temporarily unavailable. Saved location markers remain active.",
            "context_note": "News markers provide regional environmental context only; they are not scientific trend evidence.",
        }

    HEALTH_REGISTRY.record_success("news")
    normalized_items = normalize_and_deduplicate_articles(raw_pairs, limit=50)
    now_iso = utc_now_iso()

    payload_to_cache = {
        "items": normalized_items,
        "fetched_at": now_iso,
        "stale": False,
        "cache_age_seconds": 0.0,
        "provider": active_provider.provider_id,
        "partial_failures": partial_failures,
        "locations_queried": [
            {"id": q.id, "name": q.name, "lat": q.lat, "lon": q.lon, "source": q.source}
            for q in queries
        ],
        "empty_reason": (
            None
            if normalized_items
            else "No verified environmental or weather headlines matched these locations right now."
        ),
        "context_note": "News markers provide regional environmental context only; they are not scientific trend evidence.",
    }
    _news_cache.put(cache_key, payload_to_cache)

    out = dict(payload_to_cache)
    out["items"] = normalized_items[:limit]
    return out
