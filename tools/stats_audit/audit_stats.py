"""Cross-check backend/app/stats.py against reference implementations (scratch environment only)."""
import math
import random
import sys
import warnings

import numpy as np
import pymannkendall as pmk
from scipy import stats as ss

warnings.filterwarnings("ignore")
_BACKEND = __import__("pathlib").Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(_BACKEND))
from app import stats as ours  # noqa: E402

rng = random.Random(20261114)
np.random.seed(20261114)


def rel(a, b):
    return abs(a - b) / max(abs(b), 1e-300)


def report(name, worst, tol, extra=""):
    flag = "OK  " if worst <= tol else "FAIL"
    print(f"[{flag}] {name:<58} worst deviation {worst:.3g}  (tolerance {tol:g}) {extra}")


# ---------------------------------------------------------------- 1. distributions
worst = 0.0
for df in [1, 2, 3, 5, 10, 20, 42, 100, 12.7, 0.5 + 7]:
    for t in [0, 0.1, 0.5, 1, 2, 3, 5, 10, 20]:
        ref = 2 * ss.t.sf(t, df)
        if ref > 1e-250:
            worst = max(worst, rel(ours.t_two_sided_p(t, df), ref))
report("Student-t two-sided p vs scipy.stats.t (relative)", worst, 1e-8)

worst = 0.0
for df in [1, 2, 3, 5, 10, 20, 42, 100]:
    for alpha in [0.1, 0.05, 0.01]:
        worst = max(worst, rel(ours.t_critical(alpha, df), ss.t.ppf(1 - alpha / 2, df)))
report("t critical value vs scipy.stats.t.ppf (relative)", worst, 1e-8)

worst = max(rel(ours.normal_two_sided_p(z), 2 * ss.norm.sf(abs(z))) for z in [0, 0.5, 1, 1.96, 3, 5, 8])
report("normal two-sided p vs scipy.stats.norm (relative)", worst, 1e-10)


# ---------------------------------------------------------------- 2/3. Mann-Kendall, Sen slope, Sen CI
def make_series(n, ties):
    slope = rng.uniform(-0.05, 0.05)
    xs = [slope * i + rng.gauss(0, 1) for i in range(n)]
    return [round(v, 0 if ties == "heavy" else 1) for v in xs] if ties else xs


def r_trend_ci(values, var_s, alpha=0.05):
    """Confidence limits for Sen's slope exactly as the R 'trend' package computes them (1-based ranks)."""
    n = len(values)
    slopes = sorted((values[j] - values[i]) / (j - i) for i in range(n - 1) for j in range(i + 1, n))
    big_n = len(slopes)
    c = ss.norm.ppf(1 - alpha / 2) * math.sqrt(var_s)
    lo = max(round((big_n - c) / 2), 1)
    up = min(round((big_n + c) / 2 + 1), big_n)
    return slopes[lo - 1], slopes[up - 1]


w_s = w_z = w_p = w_slope = w_icpt = 0.0  # intercept: pymannkendall uses median(y) - slope*median(t); this project uses median(y - slope*(t - t0)), checked below
ci_lo_mismatch = ci_hi_mismatch = ci_total = 0
scipy_lo_gap = scipy_hi_gap = 0.0
for trial in range(400):
    n = rng.randint(8, 60)
    values = make_series(n, rng.choice([None, "light", "heavy"]))
    ref = pmk.original_test(values)
    mine = ours.mann_kendall(values, ac_correct=False)
    w_s = max(w_s, abs(mine.s - ref.s))
    w_z = max(w_z, abs(mine.z - ref.z))
    w_p = max(w_p, abs(mine.p_naive - ref.p))
    w_slope = max(w_slope, abs(mine.sens_slope - ref.slope))
    w_icpt = max(w_icpt, abs(mine.sens_intercept - float(np.median([v - ref.slope * i for i, v in enumerate(values)]))))
    _, var_s = ours._mk_s_and_variance(values)
    lo, hi = r_trend_ci(values, var_s)
    ci_total += 1
    ci_lo_mismatch += abs(mine.sens_ci_low - lo) > 1e-12
    ci_hi_mismatch += abs(mine.sens_ci_high - hi) > 1e-12
    if len(set(values)) == len(values) or True:
        t = ss.theilslopes(values, list(range(n)), alpha=0.95)
        scipy_lo_gap = max(scipy_lo_gap, abs(mine.sens_ci_low - t.low_slope))
        scipy_hi_gap = max(scipy_hi_gap, abs(mine.sens_ci_high - t.high_slope))
report("Mann-Kendall S vs pymannkendall (absolute)", w_s, 0)
report("Mann-Kendall z vs pymannkendall (absolute, ties incl.)", w_z, 1e-12)
report("Mann-Kendall p vs pymannkendall (absolute)", w_p, 1e-12)
report("Sen slope vs pymannkendall (absolute)", w_slope, 1e-12)
report("Sen intercept = median(y - slope*(t - t0)) (absolute)", w_icpt, 1e-12)
print(f"[INFO] Sen CI vs R 'trend' package rule: lower limit differs in {ci_lo_mismatch}/{ci_total} series, upper in {ci_hi_mismatch}/{ci_total}")
print(f"[INFO] Sen CI vs scipy.theilslopes: worst gap lower {scipy_lo_gap:.3g}, upper {scipy_hi_gap:.3g} (slope units)")

# ---------------------------------------------------------------- 4. OLS
worst_slope = worst_se = worst_p = worst_ci = 0.0
for trial in range(300):
    n = rng.randint(6, 60)
    ys = make_series(n, None)
    xs = [float(1981 + i) for i in range(n)]
    lr = ss.linregress(xs, ys)
    mine = ours.ols(ys, xs)
    tc = ss.t.ppf(0.975, n - 2)
    worst_slope = max(worst_slope, rel(mine.slope, lr.slope))
    worst_se = max(worst_se, rel(mine.se, lr.stderr))
    worst_p = max(worst_p, abs(mine.p_value - lr.pvalue))
    worst_ci = max(worst_ci, abs(mine.ci_low - (lr.slope - tc * lr.stderr)), abs(mine.ci_high - (lr.slope + tc * lr.stderr)))
report("OLS slope vs scipy.linregress (relative)", worst_slope, 1e-9)
report("OLS standard error vs scipy.linregress (relative)", worst_se, 1e-9)
report("OLS p-value vs scipy.linregress (absolute)", worst_p, 1e-9)
report("OLS 95% interval vs scipy t quantiles (absolute)", worst_ci, 1e-8)

# ---------------------------------------------------------------- 5. Benjamini-Hochberg
bad = 0
for trial in range(300):
    m = rng.randint(1, 80)
    p = [rng.random() ** rng.choice([1, 3, 6]) for _ in range(m)]
    q = rng.choice([0.05, 0.1, 0.2])
    adj = ss.false_discovery_control(p, method="bh")
    ref = [a <= q for a in adj]
    bad += ours.benjamini_hochberg(p, q) != ref
report("Benjamini-Hochberg decisions vs scipy.false_discovery_control", bad, 0, f"({bad} mismatches in 300 runs)")

# ---------------------------------------------------------------- 6. correlation p
worst = 0.0
for trial in range(200):
    n = rng.randint(6, 60)
    x = [rng.gauss(0, 1) for _ in range(n)]
    y = [0.4 * a + rng.gauss(0, 1) for a in x]
    r = ours.pearson(x, y)
    worst = max(worst, abs(ours.correlation_p_value(r, n) - ss.pearsonr(x, y).pvalue))
report("Correlation p-value vs scipy.pearsonr (absolute)", worst, 1e-9)

# ---------------------------------------------------------------- 7. Pettitt
import pyhomogeneity as hg  # noqa: E402

w_p = 0.0
cp_diff = collections = 0
cp_offsets = {}
for trial in range(150):
    n = rng.randint(10, 60)
    k = rng.randint(4, n - 4)
    ys = [(1.0 if i >= k else 0.0) * rng.uniform(0, 1.5) + rng.gauss(0, 1) for i in range(n)]
    idx, p = ours.pettitt(ys)
    res = hg.pettitt_test(ys, alpha=0.05, sim=None)
    w_p = max(w_p, abs(p - min(1.0, res.p)))  # the reference does not cap its approximate p at 1; this project does
    off = int(idx) - int(res.cp)
    cp_offsets[off] = cp_offsets.get(off, 0) + 1
report("Pettitt p-value vs pyhomogeneity (absolute)", w_p, 1e-9)
print(f"[INFO] Pettitt change-point index minus pyhomogeneity's: {cp_offsets} (a constant offset only reflects the indexing convention)")

# ---------------------------------------------------------------- 8. calibration by simulation
print("\nType-I error and power by simulation (n = 44 years, 1,500 series each, nominal alpha = 0.05)")
N, TRIALS = 44, 1500


def ar1(phi, slope):
    x, out = rng.gauss(0, 1), []
    for i in range(N):
        x = phi * x + math.sqrt(1 - phi * phi) * rng.gauss(0, 1)
        out.append(x + slope * i)
    return out


def ols_eff_df_p(ys, factor):
    xs = [float(i) for i in range(N)]
    fit = ours.ols(ys, xs, variance_factor=factor)
    df_eff = max(N / factor - 2.0, 2.0)
    return ours.t_two_sided_p(fit.t, df_eff) if not math.isinf(fit.t) else 0.0


print(f"{'scenario':<34}{'MK naive':>10}{'MK adjusted':>13}{'OLS (now)':>11}{'OLS eff-df':>12}{'adj. factor used':>18}")
for label, phi, slope in [
    ("no trend, independent years", 0.0, 0.0),
    ("no trend, AR(1) phi = 0.3", 0.3, 0.0),
    ("no trend, AR(1) phi = 0.5", 0.5, 0.0),
    ("no trend, AR(1) phi = 0.7", 0.7, 0.0),
    ("real trend 0.03 sd/yr, indep.", 0.0, 0.03),
    ("real trend 0.03 sd/yr, phi 0.5", 0.5, 0.03),
]:
    naive = adj = olsnow = olseff = 0
    factors = []
    for _ in range(TRIALS):
        ys = ar1(phi, slope)
        mk = ours.mann_kendall(ys, [float(i) for i in range(N)])
        naive += mk.p_naive < 0.05
        adj += mk.p_value < 0.05
        fit = ours.ols(ys, [float(i) for i in range(N)], variance_factor=mk.variance_factor)
        olsnow += fit.p_value < 0.05
        olseff += ols_eff_df_p(ys, mk.variance_factor) < 0.05
        factors.append(mk.variance_factor)
    print(f"{label:<34}{naive / TRIALS:>10.3f}{adj / TRIALS:>13.3f}{olsnow / TRIALS:>11.3f}{olseff / TRIALS:>12.3f}{sum(factors) / TRIALS:>18.2f}")
print("(For the no-trend rows a well-calibrated test shows about 0.05; for the trend rows higher is better.)")

