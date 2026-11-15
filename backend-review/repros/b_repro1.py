import sys, random, math
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from app import stats, analysis, news, ml, archetypes, context
from app.analysis import analyze_series, grid_points

def monthly_from_annual(years, vals, seasonal=None):
    out = {}
    for y, v in zip(years, vals):
        for m in range(1, 13):
            out[f"{y}{m:02d}"] = v + (seasonal[m-1] if seasonal else 0.0)
    return out

print("=== R1: significant MK but zero Sen slope (snowfall-like) ===")
years = list(range(1981, 2011))
vals = [0.0]*25 + [0.2, 0.5, 0.3, 0.6, 0.4]
mk = stats.mann_kendall(vals, [float(y) for y in years])
print("S", mk.s, "p", mk.p_value, "sig", mk.significant, "sens", mk.sens_slope, "dir", mk.direction)
res = analyze_series("PRECSNOLAND", 45.0, 10.0, monthly_from_annual(years, vals), 1981, 2010)
s = res["stats"]
print("stats.significant", s["significant"], "direction", s["direction"], "sign", s["sign"])
print("grade", res["grade"], "verdict", res["evidence_trace"]["verdict"]["code"])
print("summary:", res["summary"])
print("checks:", [(c["id"], c["passed"]) for c in res["checks"]])

print("\n=== R2: emergence year reported although headline trend is not significant ===")
found = 0
for seed in range(400):
    rng = random.Random(seed)
    x = 0.0; vals = []
    for i in range(40):
        x = 0.7*x + rng.gauss(0, 1)
        vals.append(0.02*i + x)
    yrs = list(range(1981, 2021))
    mk = stats.mann_kendall(vals, [float(y) for y in yrs])
    if not mk.significant and mk.p_naive < 0.05:
        res = analyze_series("T2M", 10.0, 10.0, monthly_from_annual(yrs, vals), 1981, 2020)
        print("seed", seed, "p_adj", round(mk.p_value,4), "p_naive", round(mk.p_naive,4),
              "significant", res["stats"]["significant"], "emergence.year", res["emergence"]["year"],
              "factor", round(mk.variance_factor,2))
        found += 1
        if found >= 3: break

print("\n=== R3: OLS 'perfect line' threshold is absolute, tiny-scale data ===")
rng = random.Random(3)
small = [1e-14*rng.gauss(0,1) for _ in range(30)]
fit = stats.ols(small, [float(i) for i in range(30)])
fit_scaled = stats.ols([v*1e14 for v in small], [float(i) for i in range(30)])
print("tiny: slope", fit.slope, "p", fit.p_value, "sig", fit.significant, "| same data x1e14: p", fit_scaled.p_value, fit_scaled.significant)

print("\n=== R4: news relevance misses common inflected forms ===")
for t in ["Flooding swamps Delhi streets after record downpour",
          "Storm Ciaran batters London with 90mph winds",
          "Flooded homes evacuated in Sydney suburbs",
          "Heavy rains lash Phoenix as monsoon arrives",
          "Wildfires rage near Sydney"]:
    print(news.is_environmentally_relevant(t), "|", t, "|", news.classify_category_and_severity(t))

print("\n=== R5: tracking param _hsenc not stripped; port dropped ===")
print(news.normalize_canonical_url("https://ex.com/a?_hsenc=abc&id=1"))
print(news.normalize_canonical_url("https://ex.com:8443/a?id=1"))

print("\n=== R6: grid_points clamps (duplicates near pole / antimeridian) ===")
pts = grid_points(88.0, 178.0, 10.0, 3)
print(pts, "distinct:", len(set(pts)))

print("\n=== R7: kmeans can leave an empty cluster -> cluster_places ZeroDivisionError ===")
pts = [[0.0]*15 for _ in range(9)] + [[1.0]*15]
labels, centers, inertia = ml.kmeans(pts, 3, seed=7)
print("labels", labels, "distinct", sorted(set(labels)))
entries = [{"id": f"p{i}", "name": f"p{i}", "kind": "city", "lat": 0, "lon": 0, "features": [0.0]*15} for i in range(9)]
entries.append({"id": "p9", "name": "p9", "kind": "city", "lat": 0, "lon": 0, "features": [1.0]*15})
try:
    out = archetypes.cluster_places(entries, chosen_k=3)
    print("cluster_places ok k=", out["k"], [c["size"] for c in out["clusters"]])
except Exception as e:
    print("cluster_places raised", type(e).__name__, e)
