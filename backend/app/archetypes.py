"""Trend archetypes and climate twins (unsupervised learning).

Every sample place gets a feature vector: for each core variable, its signal-vs-noise ratio (total change divided
by normal year-to-year swing), which is unitless and signed, so a rise in temperature and a fall in cloud cover
are directly comparable. Places are then clustered with k-means. Because five of the fifteen variables are
temperatures, each group is down-weighted by 1/sqrt(group size) so heat cannot dominate the clustering.

Honesty checks are part of the result: the silhouette score says how well separated the clusters are, and a
bootstrap stability score says whether they survive resampling. Weak structure is reported as weak.
"""

from __future__ import annotations

import asyncio
import math

from .analysis import AnalysisError, analyze_many
from .ml import cluster_stability, cosine_similarity, kmeans, silhouette
from .nasa_power import VARIABLES, PowerError
from .places import PLACES

CORE_VARIABLES = [vid for vid, info in VARIABLES.items() if not info["land_only"] and vid != "GWETTOP"]
SNR_CLIP = 4.0
MIN_FEATURES = 12          # a place needs at least this many of the core variables to be clustered
MAX_CONCURRENCY = 4
SEED = 7


def _group_weights() -> dict[str, float]:
    sizes: dict[str, int] = {}
    for vid in CORE_VARIABLES:
        group = VARIABLES[vid]["group"]
        sizes[group] = sizes.get(group, 0) + 1
    return {vid: 1.0 / math.sqrt(sizes[VARIABLES[vid]["group"]]) for vid in CORE_VARIABLES}


def _quality_words(silhouette_score: float, stability: float) -> dict:
    structure = "strong" if silhouette_score >= 0.5 else "reasonable" if silhouette_score >= 0.25 else "weak"
    steadiness = "stable" if stability >= 0.75 else "moderately stable" if stability >= 0.5 else "unstable"
    return {"structure": structure, "steadiness": steadiness}


def cluster_places(entries: list[dict], k_range: range = range(2, 7), chosen_k: int | None = None) -> dict:
    """Cluster places from their feature vectors. `entries` need 'id', 'name', 'kind', 'lat', 'lon', 'features' (list).

    By default the number of clusters with the best silhouette is used; `chosen_k` lets a user explore other
    values while the quality scores for every k stay visible.
    """
    weights = [_group_weights()[v] for v in CORE_VARIABLES]
    raw = [e["features"] for e in entries]
    points = [[f * w for f, w in zip(row, weights)] for row in raw]

    scores = []
    for k in k_range:
        if k >= len(points):
            break
        labels, _, _ = kmeans(points, k, seed=SEED)
        scores.append({"k": k, "silhouette": silhouette(points, labels)})
    best = max(scores, key=lambda s: s["silhouette"])
    chosen = next((s for s in scores if s["k"] == chosen_k), best)
    k = chosen["k"]
    labels, _, _ = kmeans(points, k, seed=SEED)
    stability = cluster_stability(points, k, seed=SEED)

    clusters = []
    for c in range(k):
        members = [i for i, lab in enumerate(labels) if lab == c]
        means = [sum(raw[i][v] for i in members) / len(members) for v in range(len(CORE_VARIABLES))]
        ranked = sorted(range(len(CORE_VARIABLES)), key=lambda v: means[v])
        describe = lambda idxs: [  # noqa: E731
            {"id": CORE_VARIABLES[v], "label": VARIABLES[CORE_VARIABLES[v]]["label"], "value": means[v]} for v in idxs
        ]
        clusters.append(
            {
                "id": c,
                "size": len(members),
                "members": [entries[i]["id"] for i in members],
                "top_up": describe([v for v in reversed(ranked[-3:]) if means[v] > 0.5]),
                "top_down": describe([v for v in ranked[:3] if means[v] < -0.5]),
                "mean_snr": {CORE_VARIABLES[v]: means[v] for v in range(len(CORE_VARIABLES))},
            }
        )

    places = []
    for i, e in enumerate(entries):
        sims = sorted(
            ((cosine_similarity(points[i], points[j]), j) for j in range(len(entries)) if j != i), reverse=True
        )[:3]
        places.append(
            {
                "id": e["id"], "name": e["name"], "kind": e["kind"], "lat": e["lat"], "lon": e["lon"], "cluster": labels[i],
                "twins": [{"id": entries[j]["id"], "name": entries[j]["name"], "similarity": s} for s, j in sims],
            }
        )

    return {
        "k": k,
        "best_k": best["k"],
        "quality": {
            "silhouette": chosen["silhouette"],
            "stability": stability,
            "by_k": scores,
            "n_places": len(entries),
            **_quality_words(chosen["silhouette"], stability),
        },
        "clusters": clusters,
        "places": places,
    }


async def build_archetypes(start_year: int, end_year: int, places: list[dict] | None = None, k: int | None = None) -> dict:
    places = places or PLACES
    limiter = asyncio.Semaphore(MAX_CONCURRENCY)

    async def features_for(place: dict) -> tuple[dict, list[float | None] | None, str]:
        async with limiter:
            try:
                results = await analyze_many(CORE_VARIABLES, place["lat"], place["lon"], start_year, end_year, detail=False)
            except PowerError as exc:
                return place, None, str(exc)
        row: list[float | None] = []
        for vid in CORE_VARIABLES:
            res = results[vid]
            snr = None if isinstance(res, AnalysisError) else res["stats"]["signal_to_noise"]
            row.append(None if snr is None else max(-SNR_CLIP, min(SNR_CLIP, snr)))
        return place, row, ""

    gathered = await asyncio.gather(*(features_for(p) for p in places))

    entries, excluded = [], []
    for place, row, error in gathered:
        base = {k: place[k] for k in ("id", "name", "kind", "lat", "lon")}
        if row is None:
            excluded.append({**base, "reason": error or "Data unavailable."})
        elif sum(v is not None for v in row) < MIN_FEATURES:
            excluded.append({**base, "reason": "Too few variables could be analyzed here."})
        else:
            entries.append({**base, "features": [0.0 if v is None else v for v in row]})  # no signal = neutral

    variables = [{"id": v, "label": VARIABLES[v]["label"], "group": VARIABLES[v]["group"]} for v in CORE_VARIABLES]
    meta = {"period": {"start_year": start_year, "end_year": end_year}, "variables": variables, "excluded": excluded}
    if len(entries) < 8:
        return {**meta, "ok": False, "message": "Too few places had data to look for archetypes."}
    return {
        **meta,
        "ok": True,
        **cluster_places(entries, chosen_k=k),
        "caveat": (
            "Archetypes are a way of grouping 68 sample sites by how all their variables are changing together. They are "
            "not official climate regimes: different sites or variables could group differently, which is why the "
            "stability score is shown."
        ),
    }
