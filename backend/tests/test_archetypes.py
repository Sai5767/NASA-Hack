"""Trend archetypes and climate twins, plus the ML endpoints."""

import asyncio
import random

import pytest
from fastapi.testclient import TestClient

from app.archetypes import CORE_VARIABLES, build_archetypes, cluster_places
from app.main import app
from app.places import PLACES

client = TestClient(app)
PERIOD = {"start_year": 1981, "end_year": 2024}


def _planted_entries(per_type=10, seed=3):
    """Three made-up kinds of place: heat rising, water falling, sunlight rising. Each with a little noise."""
    rng = random.Random(seed)
    hot = range(0, 5)        # the five heat variables come first in CORE_VARIABLES
    water = range(5, 9)
    sun = range(9, 13)
    entries, kinds = [], []
    for kind, dims, sign in (("hot", hot, 3.0), ("dry", water, -3.0), ("bright", sun, 3.0)):
        for i in range(per_type):
            row = [rng.gauss(0, 0.3) for _ in CORE_VARIABLES]
            for d in dims:
                row[d] += sign
            entries.append({"id": f"{kind}-{i}", "name": f"{kind} {i}", "kind": "city", "lat": 0.0, "lon": 0.0, "features": row})
            kinds.append(kind)
    return entries, kinds


def test_planted_archetypes_are_recovered_and_the_quality_scores_agree():
    entries, kinds = _planted_entries()
    result = cluster_places(entries)
    assert result["k"] == 3
    assert result["quality"]["silhouette"] > 0.5 and result["quality"]["structure"] == "strong"
    assert result["quality"]["stability"] > 0.8 and result["quality"]["steadiness"] == "stable"
    by_cluster = {}
    for place, kind in zip(result["places"], kinds):
        by_cluster.setdefault(place["cluster"], set()).add(kind)
    assert all(len(group) == 1 for group in by_cluster.values())  # no cluster mixes kinds
    assert sorted(c["size"] for c in result["clusters"]) == [10, 10, 10]


def test_clusters_describe_themselves_and_twins_come_from_the_same_kind():
    entries, kinds = _planted_entries()
    result = cluster_places(entries)
    hot_cluster = next(c for c in result["clusters"] if all(m.startswith("hot") for m in c["members"]))
    assert "Air temperature" in [v["label"] for v in hot_cluster["top_up"]]
    assert hot_cluster["top_down"] == []
    dry_cluster = next(c for c in result["clusters"] if all(m.startswith("dry") for m in c["members"]))
    assert dry_cluster["top_up"] == [] and dry_cluster["top_down"]
    for place in result["places"]:
        kind = place["id"].split("-")[0]
        assert len(place["twins"]) == 3
        assert all(t["id"].startswith(kind) for t in place["twins"])
        assert all(t["id"] != place["id"] for t in place["twins"])


def test_structureless_data_is_reported_as_weak():
    rng = random.Random(4)
    entries = [
        {"id": str(i), "name": str(i), "kind": "city", "lat": 0.0, "lon": 0.0, "features": [rng.gauss(0, 1) for _ in CORE_VARIABLES]}
        for i in range(40)
    ]
    quality = cluster_places(entries)["quality"]
    assert quality["silhouette"] < 0.25 and quality["structure"] == "weak"


def test_a_user_chosen_k_is_honored_and_the_quality_scores_follow_it():
    entries, _ = _planted_entries()
    best = cluster_places(entries)
    forced = cluster_places(entries, chosen_k=2)
    assert best["k"] == 3 == best["best_k"]
    assert forced["k"] == 2 and forced["best_k"] == 3                      # the best k is still reported
    assert len(forced["clusters"]) == 2
    assert forced["quality"]["silhouette"] < best["quality"]["silhouette"]  # merging real clusters scores worse
    assert cluster_places(entries, chosen_k=99)["k"] == 3                   # an impossible k falls back to the best


def test_core_variables_exclude_land_only_ones():
    assert len(CORE_VARIABLES) == 15
    assert not {"EVLAND", "GWETROOT", "GWETTOP", "PRECSNOLAND"} & set(CORE_VARIABLES)


def test_archetypes_split_a_world_where_the_two_hemispheres_trend_oppositely(fake_power):
    result = asyncio.run(build_archetypes(1981, 2024))
    assert result["ok"] and result["excluded"] == []
    assert len(result["places"]) == len(PLACES)
    groups = {}
    for p in result["places"]:
        groups.setdefault(p["cluster"], set()).add(p["lat"] >= 0)
    assert all(len(hemispheres) == 1 for hemispheres in groups.values())  # no cluster spans both hemispheres


def test_too_few_places_is_reported_not_faked(fake_power):
    result = asyncio.run(build_archetypes(1981, 2024, places=PLACES[:5]))
    assert result["ok"] is False and "Too few" in result["message"]


def test_archetypes_endpoint(fake_power):
    body = client.get("/api/archetypes", params=PERIOD).json()
    assert body["ok"] and body["k"] >= 2
    assert {"silhouette", "stability", "by_k", "structure", "steadiness"} <= set(body["quality"])
    assert len(body["variables"]) == 15
    assert client.get("/api/archetypes", params={"start_year": 1990, "end_year": 2000}).status_code == 400


def test_forecast_endpoint(fake_power):
    body = client.get("/api/forecast", params={"variable": "T2M", "lat": 45, "lon": 10, **PERIOD}).json()
    assert body["ok"] and body["variable"]["id"] == "T2M" and body["location"] == {"lat": 45.0, "lon": 10.0}
    assert len(body["forecast"]) == 5 and body["models"] and body["replays"]
    assert body["forecast"][0]["year"] == 2025


def test_forecast_endpoint_says_when_the_record_is_too_short(fake_power):
    body = client.get("/api/forecast", params={"variable": "T2M", "lat": 45, "lon": 10, "start_year": 2003, "end_year": 2024}).json()
    assert body["ok"] is False and "at least 25" in body["message"]


def test_forecast_endpoint_validates_input():
    assert client.get("/api/forecast", params={"variable": "NOPE", "lat": 0, "lon": 0}).status_code == 404
    assert client.get("/api/forecast", params={"variable": "T2M", "lat": 99, "lon": 0}).status_code == 422


def test_fewer_distinct_places_than_k_does_not_crash_and_reports_the_actual_k():
    # 9 identical places + 1 different one, k = 3 requested (review item B8): only two groups can exist.
    entries = [
        {"id": f"p{i}", "name": f"p{i}", "kind": "city", "lat": 0, "lon": 0, "features": [0.0] * len(CORE_VARIABLES)}
        for i in range(9)
    ]
    entries.append({"id": "p9", "name": "p9", "kind": "city", "lat": 0, "lon": 0, "features": [1.0] * len(CORE_VARIABLES)})
    out = cluster_places(entries, chosen_k=3)
    assert out["k"] == 2 and out["requested_k"] == 3
    assert sorted(c["size"] for c in out["clusters"]) == [1, 9]
    assert all(c["size"] > 0 for c in out["clusters"])
