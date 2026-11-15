import sys, random
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from app import stats, explanations, reasons
from app.analysis import analyze_series

def monthly_from_annual(years, vals):
    return {f"{y}{m:02d}": v for y, v in zip(years, vals) for m in range(1, 13)}

years = list(range(1981, 2025))
for seed in range(2000):
    rng = random.Random(seed)
    late = [0.0]*10 + [round(rng.uniform(0.1, 0.8), 2) for _ in range(10)]
    rng.shuffle(late)
    vals = [0.0]*24 + late
    mk = stats.mann_kendall(vals, [float(y) for y in years])
    if mk.significant and mk.sens_slope == 0:
        print("seed", seed, "vals", vals)
        res = analyze_series("PRECSNOLAND", 45.0, 10.0, monthly_from_annual(years, vals), 1981, 2024)
        s = res["stats"]
        print("p", s["p_value"], "significant", s["significant"], "slope/dec", s["slope_per_decade"], "direction", s["direction"], "sign", s["sign"])
        print("grade", res["grade"], "verdict", res["evidence_trace"]["verdict"]["code"])
        print("summary:", res["summary"])
        print("checks:", [(c["id"], c["passed"]) for c in res["checks"]])
        print("ols p", res["ols"]["p_value"], "ols slope", res["ols"]["slope_per_decade"])
        fb = explanations._build_curated_fallback(res, "sig", status="no_key", fallback_reason="missing_api_key")
        print("curated fallback status", fb["status"], fb["fallback_reason"], "| summary:", fb["summary"][:160])
        break
else:
    print("none found")
