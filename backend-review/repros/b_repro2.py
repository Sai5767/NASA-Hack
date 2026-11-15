import sys, random, math
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from app import stats, analysis, context, ledger, reasons, explanations
from app.analysis import analyze_series, grid_points
from app.nasa_power import VARIABLES

def monthly_from_annual(years, vals):
    return {f"{y}{m:02d}": v for y, v in zip(years, vals) for m in range(1, 13)}

print("=== R1b: significant MK with Sen slope exactly 0 ===")
years = list(range(1981, 2025))
vals = [0.0]*34 + [0.2, 0.5, 0.3, 0.6, 0.4, 0.7, 0.35, 0.45, 0.55, 0.25]
res = analyze_series("PRECSNOLAND", 45.0, 10.0, monthly_from_annual(years, vals), 1981, 2024)
s = res["stats"]
print("p", s["p_value"], "significant", s["significant"], "slope", s["slope_per_decade"], "direction", s["direction"], "sign", s["sign"])
print("CI", s["ci_low_per_decade"], s["ci_high_per_decade"])
print("grade", res["grade"], "verdict", res["evidence_trace"]["verdict"]["code"])
print("summary:", res["summary"])
print("checks:", [(c["id"], c["passed"]) for c in res["checks"]])
print("reason_for flat:", reasons.reason_for("PRECSNOLAND", 45.0, 10.0, s["sign"])["text"][:60])
fb = explanations._build_curated_fallback(res, "sig", status="no_key", fallback_reason="missing_api_key")
print("fallback status", fb["status"], fb["fallback_reason"])

print("\n=== R8: ENSO-adjusted trend absorbs part of the time trend when ONI itself drifts ===")
rng = random.Random(4)
yrs = list(range(1981, 2025))
oni = {y: 0.015*(y-1981) + rng.gauss(0, 0.8) for y in yrs}   # index with a small drift
local = {y: 0.03*(y-1981) + 0.0*oni[y] + rng.gauss(0, 0.2) for y in yrs}  # local has NO ENSO dependence
out = context._enso_adjusted(VARIABLES["T2M"], local, oni)
print({k: round(v, 4) if isinstance(v, float) else v for k, v in out.items()})
# Correct partial regression (y ~ t + oni)
import itertools
t = [float(y) for y in yrs]; y = [local[k] for k in yrs]; d = [oni[k] for k in yrs]
d_flat = stats.linear_detrend(d, t); y_flat = stats.linear_detrend(y, t)
b = sum(a*c for a, c in zip(d_flat, y_flat)) / sum(a*a for a in d_flat)
print("ENSO coefficient from raw regression vs partial (detrended) regression:", round(stats.ols(y, d).slope, 4), round(b, 4))

print("\n=== R6b: grid_points duplicate cells ===")
for args in [(88.0, 0.0, 10.0, 5), (0.0, 178.0, 10.0, 3)]:
    pts = grid_points(*args)
    print(args, "points", len(pts), "distinct", len(set(pts)), sorted({p[0] for p in pts}), sorted({p[1] for p in pts}))
