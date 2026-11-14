"""Planet Vitals: the same trend engine, pointed at Earth's own vital signs.

Four trend vitals (global temperature, CO2, Arctic and Antarctic sea ice) get a full case file. Three climate
rhythms (ENSO, PDO, NAO) are shown as status readouts only: they oscillate rather than trend, so testing them
for a trend would be misleading.
"""

from __future__ import annotations

import asyncio

from . import streams
from .analysis import AnalysisError, analyze_series
from .nasa_power import annual_means

TREND_VITALS = ["gistemp_global", "co2_mlo", "arctic_ice", "antarctic_ice"]
RHYTHM_VITALS = ["oni", "pdo", "nao"]
WHERE = {
    "gistemp_global": "worldwide",
    "co2_mlo": "at Mauna Loa",
    "arctic_ice": "in the Arctic",
    "antarctic_ice": "around Antarctica",
}


def _stamp_label(stamp: str) -> str:
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{months[int(stamp[4:]) - 1]} {stamp[:4]}"


def _strongest_month(fingerprint: list[dict]) -> dict | None:
    """The calendar month with the steepest trend, if it holds up after correcting for testing 12 months."""
    solid = [m for m in fingerprint if m["ok"] and m["significant"]]
    if not solid:
        return None
    best = max(solid, key=lambda m: abs(m["slope_per_decade"]))
    return {"month": best["month"], "slope_per_decade": best["slope_per_decade"], "p_value": best["p_value"]}


async def _trend_vital(stream_id: str, start: int, end: int) -> dict:
    info = streams.STREAMS[stream_id]
    base = {"id": stream_id, "label": info["label"], "units": info["units"], "source": info["source"], "description": info["description"]}
    try:
        full = await streams.get_monthly(stream_id)
        window = streams.clip_years(full, start, end)
        res = analyze_series(stream_id, None, None, window, start, end, detail=True, info=info, where=WHERE[stream_id])
    except (streams.StreamError, AnalysisError) as exc:
        return {**base, "ok": False, "message": str(exc)}
    latest = streams.latest_value(full)
    return {
        **base,
        "ok": True,
        "period": res["period"],
        "latest": {"label": _stamp_label(latest[0]), "value": latest[1]} if latest else None,
        "stats": res["stats"],
        "ols": res["ols"],
        "grade": res["grade"],
        "shape": res["shape"],
        "annual": res["annual"],
        "fingerprint": res["fingerprint"],
        "strongest_month": _strongest_month(res["fingerprint"]),
        "emergence_year": res["emergence"]["year"],
        "summary": res["summary"],
    }


def _phase(stream_id: str, value: float) -> str:
    if stream_id == "oni":
        return "El Niño" if value >= 0.5 else "La Niña" if value <= -0.5 else "Neutral"
    return "Positive phase" if value > 0 else "Negative phase"


async def _rhythm(stream_id: str, start: int, end: int) -> dict:
    info = streams.STREAMS[stream_id]
    base = {"id": stream_id, "label": info["label"], "units": info["units"], "source": info["source"], "description": info["description"]}
    try:
        full = await streams.get_monthly(stream_id)
    except streams.StreamError as exc:
        return {**base, "ok": False, "message": str(exc)}
    latest = streams.latest_value(full)
    annual = annual_means(streams.clip_years(full, start, end))
    return {
        **base,
        "ok": True,
        "latest": {"label": _stamp_label(latest[0]), "value": latest[1], "phase": _phase(stream_id, latest[1])} if latest else None,
        "annual": [{"year": y, "value": v} for y, v in annual.items()],
    }


async def build_vitals(start: int, end: int) -> dict:
    trends, rhythms = await asyncio.gather(
        asyncio.gather(*(_trend_vital(s, start, end) for s in TREND_VITALS)),
        asyncio.gather(*(_rhythm(s, start, end) for s in RHYTHM_VITALS)),
    )
    return {"period": {"start_year": start, "end_year": end}, "vitals": list(trends), "rhythms": list(rhythms)}
