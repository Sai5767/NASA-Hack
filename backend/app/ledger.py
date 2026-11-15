"""The trend ledger: every trend the app can measure, ranked by strength of evidence.

Each of the sample places is tested for every NASA POWER variable, and the planet's own vital signs are added. All of these
tests (over a thousand) are corrected for multiple testing *together* with Benjamini-Hochberg, then ranked by p-value. Only
trends that survive the correction are given published context for why they might exist (see reasons.py).
"""

from __future__ import annotations

import asyncio
import time

from . import streams
from .analysis import ALPHA, AnalysisError, analyze_many, analyze_series
from .nasa_power import VARIABLES, PowerError
from .places import PLACES
from .planet import TREND_VITALS, WHERE
from .reasons import CONTEXT_NOTE, reason_for
from .stats import benjamini_hochberg

MAX_CONCURRENCY = 4
CACHE_SECONDS = 6 * 3600
_cache: dict[tuple, tuple[float, dict]] = {}


def clear_cache() -> None:
    _cache.clear()


def _row(stats: dict, **fields) -> dict:
    return {
        **fields,
        "sign": stats["sign"],
        "slope_per_decade": stats["slope_per_decade"],
        "percent_of_mean": stats["percent_of_mean"],
        "signal_to_noise": stats["signal_to_noise"],
        "p_value": stats["p_value"],
        "significant": stats["significant"],
        "significant_fdr": False,
        "reason": None,
    }


async def _compute(start_year: int, end_year: int, places: list[dict]) -> dict:
    limiter = asyncio.Semaphore(MAX_CONCURRENCY)
    variables = list(VARIABLES)

    async def probe(place: dict):
        async with limiter:
            try:
                return place, await analyze_many(variables, place["lat"], place["lon"], start_year, end_year, detail=False), ""
            except PowerError as exc:
                return place, None, str(exc)

    gathered = await asyncio.gather(*(probe(p) for p in places))

    rows: list[dict] = []
    failed_places: list[dict] = []
    not_measurable = 0
    for place, results, error in gathered:
        if results is None:
            failed_places.append({"id": place["id"], "name": place["name"], "reason": error})
            continue
        for vid, res in results.items():
            if isinstance(res, AnalysisError):
                not_measurable += 1  # for example a land-only variable over open ocean
                continue
            info = VARIABLES[vid]
            rows.append(
                _row(
                    res["stats"],
                    id=f"{place['id']}:{vid}", kind="place", place_id=place["id"], place=place["name"], place_kind=place["kind"],
                    lat=place["lat"], lon=place["lon"], variable=vid, label=info["label"], group=info["group"], units=info["units"],
                )
            )

    for stream_id in TREND_VITALS:
        info = streams.STREAMS[stream_id]
        try:
            full = await streams.get_monthly(stream_id)
            window = streams.clip_years(full, start_year, end_year)
            res = analyze_series(stream_id, None, None, window, start_year, end_year, detail=False, info=info, where=WHERE[stream_id])
        except (streams.StreamError, AnalysisError):
            not_measurable += 1
            continue
        rows.append(
            _row(
                res["stats"],
                id=f"planet:{stream_id}", kind="planet", place_id=None, place=WHERE[stream_id].replace("at ", "").replace("in the ", "the "),
                place_kind="planet", lat=None, lon=None, variable=stream_id, label=info["label"], group="Planet", units=info["units"],
            )
        )

    # One correction over every test, so "survives" means survives all of them. A row with no direction (a zero median
    # slope, "flat") is never significant, even when its p-value would pass (see stats.mann_kendall, review item B1).
    for row, flag in zip(rows, benjamini_hochberg([r["p_value"] for r in rows], ALPHA)):
        row["significant_fdr"] = flag and row["significant"]
    ranked = sorted(rows, key=lambda r: (r["p_value"], -abs(r["signal_to_noise"] or 0.0)))
    for i, row in enumerate(ranked, start=1):
        row["rank"] = i
        if row["significant_fdr"]:
            row["reason"] = reason_for(row["variable"], row["lat"], row["lon"], row["sign"], stream=row["variable"] if row["kind"] == "planet" else None)

    solid = [r for r in ranked if r["significant_fdr"]]
    by_variable = []
    for vid in variables:
        mine = [r for r in rows if r["kind"] == "place" and r["variable"] == vid]
        if not mine:
            continue
        up = sum(1 for r in mine if r["significant_fdr"] and r["sign"] == "up")
        down = sum(1 for r in mine if r["significant_fdr"] and r["sign"] == "down")
        by_variable.append(
            {"id": vid, "label": VARIABLES[vid]["label"], "group": VARIABLES[vid]["group"], "tested": len(mine), "rising": up, "falling": down}
        )
    by_variable.sort(key=lambda v: -(v["rising"] + v["falling"]))

    return {
        "period": {"start_year": start_year, "end_year": end_year},
        "ranked": ranked,
        "counts": {
            "tests": len(rows),
            "places": len(places) - len(failed_places),
            "variables": len(variables),
            "nominal": sum(1 for r in rows if r["significant"]),
            "survive_correction": len(solid),
            "rising": sum(1 for r in solid if r["sign"] == "up"),
            "falling": sum(1 for r in solid if r["sign"] == "down"),
            "not_measurable": not_measurable,
            "failed_places": len(failed_places),
        },
        "by_variable": by_variable,
        "failed_places": failed_places,
    }


async def build_ledger(start_year: int, end_year: int, places: list[dict] | None = None, limit: int = 300) -> dict:
    places = places or PLACES
    key = (start_year, end_year, tuple(p["id"] for p in places))
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        full = hit[1]
    else:
        full = await _compute(start_year, end_year, places)
        _cache[key] = (time.monotonic(), full)
    return {
        "period": full["period"],
        "counts": full["counts"],
        "by_variable": full["by_variable"],
        "failed_places": full["failed_places"],
        "rows": full["ranked"][:limit],
        "truncated": len(full["ranked"]) > limit,
        "note": (
            "Every variable at every sample place, plus the planet's vital signs, tested together with false-discovery control and "
            "ranked by p-value (ties broken by signal vs noise). Sample sites, not an evenly spaced picture of the planet."
        ),
        "context_note": CONTEXT_NOTE,
    }
