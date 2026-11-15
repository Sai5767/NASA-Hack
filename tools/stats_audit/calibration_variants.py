import inspect, math, random, sys, warnings
import numpy as np
warnings.filterwarnings("ignore")
_BACKEND = __import__("pathlib").Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(_BACKEND))
from app import stats as ours
import pyhomogeneity as hg
from pyhomogeneity import pettitt_test

rng = random.Random(7)

# ------------------------------------------------------------- Pettitt: who is right?
print("=== Pettitt p-value: ours vs pyhomogeneity vs the published formula, computed by brute force ===")
for trial in range(5):
    n = rng.randint(20, 50)
    k = rng.randint(6, n - 6)
    ys = [(1.0 if i >= k else 0.0) * 1.2 + rng.gauss(0, 1) for i in range(n)]
    sgn = lambda a: (a > 0) - (a < 0)
    U = [sum(sgn(ys[i] - ys[j]) for i in range(t) for j in range(t, n)) for t in range(1, n)]
    K = max(abs(u) for u in U)
    formula = min(1.0, 2 * math.exp(-6 * K * K / (n ** 3 + n ** 2)))
    idx, p_ours = ours.pettitt(ys)
    res = pettitt_test(ys, alpha=0.05, sim=None)
    print(f"n={n:2d}  K(brute)={K:4d}  published formula p={formula:.4f}  ours p={p_ours:.4f}  pyhomogeneity p={res.p:.4f}  (their U={res.U})")
print("pyhomogeneity source for the p-value:")
src = inspect.getsource(hg)
for line in src.splitlines():
    if "exp" in line or "p =" in line.replace("  ", " ") and "pval" in line.lower():
        print("   ", line.strip())

# ------------------------------------------------------------- calibration variants for the serial-correlation adjustment
N, TRIALS = 44, 1500
xs = [float(i) for i in range(N)]
mean_x = sum(xs) / N
a = [x - mean_x for x in xs]
sxx = sum(v * v for v in a)


def exact_factor(phi):
    """Exact variance inflation of an OLS trend slope when errors are AR(1) with parameter phi (finite n)."""
    if abs(phi) < 1e-9:
        return 1.0
    total = 0.0
    for i in range(N):
        for j in range(N):
            total += a[i] * a[j] * phi ** abs(i - j)
    return total / sxx


def ar1(phi, slope):
    x, out = rng.gauss(0, 1), []
    for i in range(N):
        x = phi * x + math.sqrt(1 - phi * phi) * rng.gauss(0, 1)
        out.append(x + slope * i)
    return out


def p_with(ys, factor):
    s, var = ours._mk_s_and_variance(ys)
    return ours._z_and_p(s, var * factor)[1]


def phi_bc(r1):
    return max(-0.95, min(0.95, (r1 + 2.0 / N) / (1.0 - 4.0 / N)))


def asym(phi):
    phi = min(phi, 0.8)
    return (1 + phi) / (1 - phi) if phi > 0 else 1.0


variants = {
    "A current (gated, raw r1, asymptotic)": lambda r1: ours.variance_factor_from_autocorr(r1, N),
    "B no gate, raw r1, asymptotic": lambda r1: asym(r1),
    "C no gate, bias-corrected r1, asymptotic": lambda r1: asym(phi_bc(r1)),
    "D no gate, bias-corrected r1, exact finite-n": lambda r1: exact_factor(min(max(phi_bc(r1), 0.0), 0.9)),
}
print("\n=== rejection rates at alpha = 0.05 (n = 44, 1,500 series per row) ===")
header = f"{'scenario':<28}" + "".join(f"{k[:1]:>9}" for k in variants) + f"{'naive':>9}"
print(header)
rows = [("no trend, phi = 0", 0.0, 0.0), ("no trend, phi = 0.2", 0.2, 0.0), ("no trend, phi = 0.4", 0.4, 0.0),
        ("no trend, phi = 0.6", 0.6, 0.0), ("no trend, phi = 0.8", 0.8, 0.0), ("no trend, phi = -0.3", -0.3, 0.0),
        ("trend .03 sd/yr, phi = 0", 0.0, 0.03), ("trend .03 sd/yr, phi = 0.4", 0.4, 0.03), ("trend .06 sd/yr, phi = 0.4", 0.4, 0.06)]
for label, phi, slope in rows:
    counts = {k: 0 for k in variants}
    naive = 0
    for _ in range(TRIALS):
        ys = ar1(phi, slope)
        mk = ours.mann_kendall(ys, xs, ac_correct=False)
        naive += mk.p_naive < 0.05
        for k, f in variants.items():
            counts[k] += p_with(ys, f(mk.r1)) < 0.05
    print(f"{label:<28}" + "".join(f"{counts[k] / TRIALS:>9.3f}" for k in variants) + f"{naive / TRIALS:>9.3f}")
print("A=current, B=no gate/raw, C=bias-corrected, D=bias-corrected + exact finite-n factor")

