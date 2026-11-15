"""Offline tests for V2 Deliverable D: GET /api/news and NewsProvider adapters."""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app import news as news_module
from app.main import app
from app.resilience import UpstreamTimeoutError

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_news_cache(monkeypatch):
    monkeypatch.delenv("NEWS_PROVIDER", raising=False)
    news_module.clear_news_cache()
    yield
    news_module.clear_news_cache()


class FakeNewsProvider:
    provider_id = "fake_demo"

    def __init__(self, by_location: dict[str, list[dict]] | None = None, fail_ids: set[str] | None = None) -> None:
        self.by_location = by_location or {}
        self.fail_ids = fail_ids or set()
        self.calls: list[str] = []

    async def fetch_for_location(self, query: news_module.NewsLocationQuery, timeout_seconds: float) -> list[dict]:
        self.calls.append(query.id)
        if query.id in self.fail_ids:
            raise UpstreamTimeoutError("news", f"Timeout fetching news for {query.name}")
        return self.by_location.get(query.id, [])


def test_url_canonicalization_and_date_validation():
    assert (
        news_module.normalize_canonical_url(
            "https://www.reuters.com/world/climate-story?id=42&utm_source=twitter&fbclid=abc#section"
        )
        == "https://www.reuters.com/world/climate-story?id=42"
    )
    assert news_module.normalize_canonical_url("javascript:alert(1)") is None
    assert news_module.normalize_canonical_url("http://localhost:8000/internal") is None
    assert news_module.normalize_canonical_url("https://user:pass@example.com/news") is None

    assert news_module.parse_published_time("20261114T153000Z") == "2026-11-14T15:30:00Z"
    assert news_module.parse_published_time("2026-11-14T08:00:00+00:00") == "2026-11-14T08:00:00Z"
    assert news_module.parse_published_time("1995-01-01T00:00:00Z") is None  # too old
    assert news_module.parse_published_time("not-a-date") is None


def test_deterministic_severity_and_category_rules():
    cat1, sev1, _ = news_module.classify_category_and_severity(
        "State of emergency and mandatory evacuation ordered as catastrophic wildfire spreads"
    )
    assert cat1 == "heat_wildfire" and sev1 == "red"

    cat2, sev2, _ = news_module.classify_category_and_severity(
        "Monsoon flood warning issued for coastal districts after heavy rain"
    )
    assert cat2 == "flood_storm" and sev2 == "amber"

    cat3, sev3, _ = news_module.classify_category_and_severity(
        "NASA and NOAA researchers publish new satellite study on long-term regional climate trends"
    )
    assert cat3 == "climate_science" and sev3 == "green"


def test_location_queries_combine_saved_places_and_global_rotation():
    queries = news_module.build_location_queries("tokyo,nairobi,CustomSpot:35.0:-120.0")
    ids = [q.id for q in queries]
    assert ids[:3] == ["tokyo", "nairobi", "custom_35.0_-120.0"]
    assert all(q.source == "saved_location" for q in queries[:3])
    assert any(q.source == "global_rotation" for q in queries[3:])
    assert len(queries) <= news_module.MAX_TOTAL_QUERIES


def test_news_deduplication_filtering_and_required_labels(monkeypatch):
    fake_articles = {
        "delhi": [
            {
                "title": "Severe heatwave advisory issued across northern India as temperatures surge",
                "url": "https://www.bbc.com/news/science-environment-101?utm_source=rss",
                "publisher": "BBC News",
                "seendate": "20261114T120000Z",
            },
            # Duplicate URL with different tracking params -> must be deduplicated
            {
                "title": "Severe heatwave advisory issued across northern India as temperatures surge",
                "url": "https://www.bbc.com/news/science-environment-101?utm_medium=social",
                "publisher": "BBC News",
                "seendate": "20261114T120000Z",
            },
            # Invalid URL -> must be rejected
            {
                "title": "Story with invalid URL",
                "url": "not-a-valid-url",
                "publisher": "BadSource",
                "seendate": "20261114T120000Z",
            },
        ],
        "phoenix": [
            {
                "title": "State of emergency declared as deadly flash flood hits desert valley",
                "url": "https://apnews.com/article/desert-flood-emergency-2026",
                "publisher": "Associated Press",
                "seendate": "20261114T160000Z",
            }
        ],
    }
    provider = FakeNewsProvider(by_location=fake_articles)
    monkeypatch.setattr(news_module, "get_news_provider", lambda: provider)

    res = client.get("/api/news", params={"locations": "delhi,phoenix"})
    assert res.status_code == 200
    body = res.json()

    assert body["stale"] is False
    assert body["provider"] == "fake_demo"
    assert len(body["items"]) == 2

    first, second = body["items"][0], body["items"][1]
    assert first["severity"] == "red"
    assert first["category"] == "flood_storm"
    assert first["location_id"] == "phoenix"
    assert first["label"] == "news context, not scientific evidence"
    assert first["coordinate_precision"] == "city_centroid"
    assert first["uncertainty_km"] == 50

    assert second["severity"] == "amber"
    assert second["canonical_url"] == "https://www.bbc.com/news/science-environment-101"
    assert second["label"] == "news context, not scientific evidence"

    # Second request within 15-minute TTL comes from cache without calling provider again
    call_count_before = len(provider.calls)
    res2 = client.get("/api/news", params={"locations": "delhi,phoenix"})
    assert res2.status_code == 200
    assert len(provider.calls) == call_count_before


def test_news_returns_stale_cache_when_provider_fails_after_warm_cache():
    warm_provider = FakeNewsProvider(
        by_location={
            "delhi": [
                {
                    "title": "New satellite observations track seasonal rainfall shifts in South Asia",
                    "url": "https://earthobservatory.nasa.gov/images/150001/south-asia-rain",
                    "publisher": "NASA Earth Observatory",
                    "seendate": "20261114T100000Z",
                }
            ]
        }
    )
    warm = asyncio.run(news_module.fetch_news_context(locations="delhi", provider=warm_provider))
    assert len(warm["items"]) == 1 and warm["stale"] is False

    # Force cache entry to expire
    for key in list(news_module._news_cache._store.keys()):
        mono, epoch, val = news_module._news_cache._store[key]
        news_module._news_cache._store[key] = (mono - 99999.0, epoch - 99999.0, val)

    # Now all upstream queries fail
    all_ids = {q.id for q in news_module.build_location_queries("delhi")}
    failing_provider = FakeNewsProvider(fail_ids=all_ids)
    failing_provider.provider_id = warm_provider.provider_id

    stale_resp = asyncio.run(news_module.fetch_news_context(locations="delhi", provider=failing_provider))
    assert stale_resp["stale"] is True
    assert len(stale_resp["items"]) == 1
    assert stale_resp["partial_failures"]


def _story(title: str, slug: str) -> dict:
    return {"title": title, "url": f"https://www.example-news.com/{slug}", "publisher": "Example News", "seendate": "20261114T120000Z"}


def test_stories_not_about_weather_or_climate_are_dropped_not_shown_as_environment_context():
    provider = FakeNewsProvider(
        by_location={
            "delhi": [
                _story("Princess to join husband on India visit in biggest foreign trip", "royal"),
                _story("15 Best Hard Sci-Fi Movies Of All Time, Ranked", "movies"),
                _story("Deadly shooting leaves five dead outside a Delhi nightclub", "crime"),  # severity words, not environment
                _story("New floodlights installed at the city stadium", "floodlights"),  # "flood" inside another word
                _story("Delhi heatwave pushes power demand to a record high", "heat"),
            ]
        }
    )
    resp = asyncio.run(news_module.fetch_news_context(locations="delhi", provider=provider))
    titles = [item["title"] for item in resp["items"]]
    assert titles == ["Delhi heatwave pushes power demand to a record high"]


def test_severity_words_are_matched_as_whole_phrases_not_loose_substrings():
    # "Watch:" at the start of a headline is not a hazard watch; a real flood warning is.
    _, sev, _ = news_module.classify_category_and_severity("Watch: how scientists measure sea level from space")
    assert sev == "green"
    _, sev, _ = news_module.classify_category_and_severity("Flood warning issued for the river valley")
    assert sev == "amber"
    assert news_module.is_environmentally_relevant("Drought deepens across the plains")
    assert not news_module.is_environmentally_relevant("Miami Heat beat the Celtics in overtime")
    assert not news_module.is_environmentally_relevant("Deadly attack condemned by leaders")


def test_news_request_returns_within_its_time_budget_and_reports_slow_locations(monkeypatch):
    monkeypatch.setattr(news_module, "NEWS_TOTAL_BUDGET_SECONDS", 0.3)

    class SlowProvider(FakeNewsProvider):
        async def fetch_for_location(self, query, timeout_seconds):
            if query.id == "phoenix":
                await asyncio.sleep(30)  # an upstream that never answers in time
            return await super().fetch_for_location(query, timeout_seconds)

    provider = SlowProvider(by_location={"delhi": [_story("Delhi heatwave pushes power demand to a record high", "heat")]})
    started = time.monotonic()
    resp = asyncio.run(news_module.fetch_news_context(locations="delhi,phoenix", provider=provider))
    assert time.monotonic() - started < 5.0  # the 30-second sleeper was cut off at the 0.3-second budget
    assert [i["location_id"] for i in resp["items"]] == ["delhi"]
    slow = [f for f in resp["partial_failures"] if f["location_id"] == "phoenix"]
    assert slow and slow[0]["code"] == "timeout"


def test_news_returns_honest_empty_result_on_cold_failure_never_synthetic():
    all_ids = {q.id for q in news_module.build_location_queries("delhi")}
    failing_provider = FakeNewsProvider(fail_ids=all_ids)

    cold_resp = asyncio.run(news_module.fetch_news_context(locations="delhi", provider=failing_provider))
    assert cold_resp["items"] == []
    assert cold_resp["stale"] is False
    assert cold_resp["empty_reason"] is not None
    assert len(cold_resp["partial_failures"]) == len(all_ids)
