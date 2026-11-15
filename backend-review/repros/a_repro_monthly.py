import asyncio, math, random, sys, time, os
os.environ["TD_LOAD_ENV_FILE"] = "0"
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from app import monthly, analysis
from tests.conftest import make_monthly

# 1. clamp test eligibility
ym = [(yr, mo) for yr in range(2000, 2025) for mo in range(1, 13)]
rng = random.Random(42)
vals = [min(100.0, 75.0 + 0.08 * i + 5.0 * math.sin(2 * math.pi * (ym[i][1] - 1) / 12) + rng.gauss(0, 0.4)) for i in range(len(ym))]
ev = monthly.evaluate_monthly_series(ym, vals, "CLOUD_AMT", horizons=3)
print("clamp test eligible:", ev["eligible"], ev["reason_code"])

# 2. cells ending at different months
async def fetch(parameters, lat, lon, start, end):
    s = make_monthly(start, end, trend_per_year=0.06, noise_sd=0.5, seed=int(abs(lat*100+lon)) % 1000)
    if lat > 33.45:   # northern cells lack the last month
        s[f"{end}12"] = None
    return {p: s for p in parameters}
analysis.fetch_monthly_multi = fetch
t = time.perf_counter()
res = asyncio.run(monthly.build_monthly_forecast("T2M", 33.45, -112.07, 1981, 2024, horizons=3, n=3, size=2.0))
print("elapsed s (9 cells, 44y):", round(time.perf_counter()-t, 2))
print("eligible:", res["eligible"], res["reason_code"])
if res["eligible"]:
    f0 = res["frames"][0]
    print("frame0 month:", f0["month"])
    for c in res["cells"]:
        print(c["cell_id"], c["lat"], [fc["month"] for fc in c["forecasts"]])
