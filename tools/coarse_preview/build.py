"""Build the coarse whole-Earth preview assets for the Trend Detective globe.

Fetches NASA POWER *monthly* point data on a deliberately coarse grid
(15 degrees, latitudes -75..75, ~264 points), one request per point that asks
for T2M, PRECTOTCORR and CLOUD_AMT together, for the last three full calendar
years. Writes one quantised, compact JSON file per variable into
frontend/public/coarse/.

This is an *approximate pattern* layer only. It is never used for statistics,
trends or p-values in the app; detailed local cells always come from the
backend's own per-place pipeline.

Usage (from the repo root):
    python tools/coarse_preview/build.py [--step 15] [--years 3] [--workers 4]

Requires: httpx (pip install httpx).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

API = "https://power.larc.nasa.gov/api/temporal/monthly/point"
COMMUNITY = "RE"
FILL = -999.0

VARIABLES = {
    # key: (unit, quantisation scale, label)
    "T2M": ("°C", 0.1, "Air temperature at 2 m"),
    "PRECTOTCORR": ("mm/day", 0.01, "Precipitation (corrected)"),
    "CLOUD_AMT": ("%", 0.1, "Cloud amount"),
}

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "coarse"


def grid(step: float):
    lats = []
    v = -75.0
    while v <= 75.0 + 1e-9:
        lats.append(round(v, 4))
        v += step
    lons = []
    v = -180.0
    while v < 180.0 - 1e-9:
        lons.append(round(v, 4))
        v += step
    return lats, lons


def fetch_point(client: httpx.Client, lat: float, lon: float, start: int, end: int, retries: int = 4):
    params = {
        "parameters": ",".join(VARIABLES),
        "community": COMMUNITY,
        "latitude": lat,
        "longitude": lon,
        "start": start,
        "end": end,
        "format": "JSON",
    }
    delay = 2.0
    last = None
    for attempt in range(retries + 1):
        try:
            r = client.get(API, params=params)
            if r.status_code == 200:
                return r.json()["properties"]["parameter"]
            last = f"HTTP {r.status_code}"
            if r.status_code not in (429, 500, 502, 503, 504):
                break
        except Exception as exc:  # network errors, JSON errors
            last = repr(exc)
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(f"point {lat},{lon} failed: {last}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=float, default=15.0)
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    workers = max(1, min(4, args.workers))  # polite: never more than 4

    today = dt.date.today()
    end = today.year - 1
    start = end - args.years + 1
    months = [f"{y}-{m:02d}" for y in range(start, end + 1) for m in range(1, 13)]
    lats, lons = grid(args.step)
    points = [(la, lo) for la in lats for lo in lons]
    print(f"{len(points)} points, years {start}-{end}, {workers} workers", flush=True)

    results: dict[tuple[float, float], dict] = {}
    failed = []
    t0 = time.time()
    with httpx.Client(timeout=60.0, headers={"User-Agent": "trend-detective-coarse-preview/1.0"}) as client:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(fetch_point, client, la, lo, start, end): (la, lo) for la, lo in points}
            for i, fut in enumerate(as_completed(futs), 1):
                key = futs[fut]
                try:
                    results[key] = fut.result()
                except Exception as exc:
                    failed.append(key)
                    print(f"  ! {exc}", flush=True)
                if i % 20 == 0:
                    print(f"  {i}/{len(points)} ({time.time() - t0:.0f}s)", flush=True)

    if not results:
        print("No points fetched; NASA POWER unreachable. Nothing written.", flush=True)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    retrieved = today.isoformat()
    manifest = {"source": "NASA POWER", "endpoint": API, "community": COMMUNITY,
                "retrieved": retrieved, "months": months, "variables": {}}
    for var, (unit, scale, label) in VARIABLES.items():
        frames = []
        for mo in months:
            key = mo.replace("-", "")
            row = []
            for la in lats:
                for lo in lons:
                    p = results.get((la, lo))
                    v = None if p is None else p.get(var, {}).get(key)
                    if v is None or v <= FILL + 1:
                        row.append(None)
                    else:
                        row.append(int(round(v / scale)))
            frames.append(row)
        doc = {
            "variable": var,
            "label": label,
            "unit": unit,
            "scale": scale,
            "source": "NASA POWER monthly point API (community RE)",
            "sourceUrl": API,
            "retrieved": retrieved,
            "note": "Coarse global preview; approximate pattern only. Not for statistics.",
            "grid": {"lat0": lats[0], "dlat": args.step, "nlat": len(lats),
                     "lon0": lons[0], "dlon": args.step, "nlon": len(lons)},
            "months": months,
            "values": frames,
        }
        path = OUT / f"{var}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        manifest["variables"][var] = {"file": f"{var}.json", "unit": unit, "label": label,
                                      "bytes": path.stat().st_size}
        print(f"wrote {path} ({path.stat().st_size} bytes)", flush=True)
    manifest["points"] = len(points)
    manifest["failedPoints"] = len(failed)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"done in {time.time() - t0:.0f}s; failed points: {len(failed)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
