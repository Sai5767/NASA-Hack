"""Trend statistics for equally or unequally spaced annual series.

Tools provided:
  * Mann-Kendall trend test (non-parametric, tie-corrected) with Sen's slope and its
    confidence interval (Gilbert, 1987).
  * Ordinary least-squares trend with a t-test and confidence interval.
  * Adjustment for lag-1 serial correlation: when years resemble their neighbors, a
    chance trend looks more convincing than it is, so the variance is inflated by
    (1+phi)/(1-phi), where phi is the bias-corrected lag-1 autocorrelation. It is applied
    whenever phi is positive, because a significance gate leaves the false-alarm rate near 10%.
  * Benjamini-Hochberg false-discovery-rate control for many simultaneous tests.

Everything is pure Python (no SciPy), including the Student-t distribution.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from statistics import NormalDist, median

_NORMAL = NormalDist()
AUTOCORR_CAP = 0.8  # keeps the variance inflation finite for very persistent series
NOTICE_FACTOR = 1.2  # variance inflation at which the app says the p-value was widened (phi of about 0.1)


# --------------------------------------------------------------------------- distributions


def normal_two_sided_p(z: float) -> float:
    """Two-sided p-value for a standard-normal statistic."""
    return math.erfc(abs(z) / math.sqrt(2.0))


def _betacf(a: float, b: float, x: float, max_iter: int = 300, eps: float = 3e-14) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz's method)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    """I_x(a, b), the regularized incomplete beta function."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    log_front = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    front = math.exp(log_front)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def t_two_sided_p(t: float, df: float) -> float:
    """Two-sided p-value for a Student-t statistic with `df` degrees of freedom."""
    if df <= 0:
        raise ValueError("Degrees of freedom must be positive.")
    if math.isinf(t):
        return 0.0
    return regularized_incomplete_beta(df / 2.0, 0.5, df / (df + t * t))


def t_critical(alpha: float, df: float) -> float:
    """Two-sided critical value: the t with P(|T| > t) = alpha."""
    low, high = 0.0, 1000.0
    for _ in range(100):
        mid = (low + high) / 2.0
        if t_two_sided_p(mid, df) > alpha:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


# --------------------------------------------------------------------------- helpers


def lag1_autocorrelation(x: list[float]) -> float:
    """Lag-1 autocorrelation of a series (0.0 when the series has no variation)."""
    n = len(x)
    if n < 3:
        return 0.0
    mean = sum(x) / n
    denom = sum((v - mean) ** 2 for v in x)
    if denom <= 0:
        return 0.0
    num = sum((x[i] - mean) * (x[i + 1] - mean) for i in range(n - 1))
    return num / denom


def sample_std(x: list[float]) -> float:
    n = len(x)
    if n < 2:
        return 0.0
    mean = sum(x) / n
    return math.sqrt(sum((v - mean) ** 2 for v in x) / (n - 1))


def bias_corrected_autocorr(r1: float, n: int) -> float:
    """Undo the small-sample bias of the lag-1 autocorrelation of a detrended series.

    In a short record the autocorrelation of residuals about a fitted line is biased low, by roughly (2 + 4*phi) / n
    (the mean-removed result of Marriott and Pope, 1954, plus one more 1/n for the fitted slope). Solving
    r1 = phi - (2 + 4*phi) / n for phi gives the estimate below. The audit in docs/STATS_AUDIT.md checks it by simulation.
    """
    return max(-0.95, min(0.95, (r1 + 2.0 / n) / (1.0 - 4.0 / n)))


def variance_factor_from_autocorr(r1: float, n: int) -> float:
    """Variance inflation (1+phi)/(1-phi) for positive serial correlation, using the bias-corrected phi.

    Applied continuously (no significance gate), because a gate lets weakly persistent series through unadjusted and
    leaves the false-alarm rate near 10%. Negative autocorrelation never deflates the variance (that would only add
    risk of false alarms). Too-short series (n < 8) are left alone because r1 is too uncertain to correct.
    """
    if n < 8:
        return 1.0
    phi = bias_corrected_autocorr(r1, n)
    if phi <= 0.0:
        return 1.0
    phi = min(phi, AUTOCORR_CAP)
    return (1.0 + phi) / (1.0 - phi)


def adjustment_is_material(factor: float) -> bool:
    """True when the serial-correlation adjustment is big enough to tell the user about (a few percent is not)."""
    return factor >= NOTICE_FACTOR


def benjamini_hochberg(p_values: list[float], q: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg procedure: which hypotheses to reject at false-discovery rate q."""
    m = len(p_values)
    if m == 0:
        return []
    order = sorted(range(m), key=lambda i: p_values[i])
    cutoff_rank = 0
    for rank, idx in enumerate(order, start=1):
        if p_values[idx] <= rank / m * q:
            cutoff_rank = rank
    reject = [False] * m
    for rank, idx in enumerate(order, start=1):
        if rank <= cutoff_rank:
            reject[idx] = True
    return reject


# --------------------------------------------------------------------------- Mann-Kendall


@dataclass(frozen=True)
class TrendResult:
    n: int
    s: float
    z: float
    p_value: float             # used for decisions; adjusted for serial correlation when detected
    p_naive: float             # same test assuming independent years
    sens_slope: float          # units per time unit (median of pairwise slopes)
    sens_intercept: float      # Sen line value at times[0]
    sens_ci_low: float         # lower bound of the 95% confidence interval for the slope
    sens_ci_high: float        # upper bound of the 95% confidence interval for the slope
    significant: bool
    direction: str             # "increasing" | "decreasing" | "no significant trend"
    r1: float                  # lag-1 autocorrelation of residuals about the Sen line
    variance_factor: float     # 1.0 when no serial-correlation adjustment was applied


def _mk_s_and_variance(values: list[float]) -> tuple[float, float]:
    n = len(values)
    s = 0.0
    for i in range(n - 1):
        vi = values[i]
        for j in range(i + 1, n):
            diff = values[j] - vi
            if diff > 0:
                s += 1
            elif diff < 0:
                s -= 1
    tie_term = sum(t * (t - 1) * (2 * t + 5) for t in Counter(values).values())
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    return s, var_s


def _z_and_p(s: float, var_s: float) -> tuple[float, float]:
    if var_s <= 0:
        return 0.0, 1.0
    if s > 0:
        z = (s - 1) / math.sqrt(var_s)
    elif s < 0:
        z = (s + 1) / math.sqrt(var_s)
    else:
        z = 0.0
    return z, normal_two_sided_p(z)


def mk_z_and_p(values: list[float]) -> tuple[float, float]:
    """Fast Mann-Kendall z-score and two-sided p-value (no Sen slope, no adjustment)."""
    if len(values) < 4:
        raise ValueError("At least 4 values are needed for a trend test.")
    s, var_s = _mk_s_and_variance(values)
    return _z_and_p(s, var_s)


def _sens_confidence_interval(slopes: list[float], var_s: float, alpha: float) -> tuple[float, float]:
    """Confidence interval for Sen's slope (Gilbert, 1987)."""
    if var_s <= 0:
        return 0.0, 0.0
    ordered = sorted(slopes)
    n_pairs = len(ordered)
    c = _NORMAL.inv_cdf(1 - alpha / 2) * math.sqrt(var_s)
    # Ranks are 1-based in the literature: the M1-th and (M2+1)-th smallest of the N ordered slopes, where
    # M1 = (N - c) / 2 and M2 = (N + c) / 2 (Gilbert 1987; the same rule as the R "trend" package).
    lower_rank = min(max(round((n_pairs - c) / 2) - 1, 0), n_pairs - 1)
    upper_rank = min(max(round((n_pairs + c) / 2 + 1) - 1, 0), n_pairs - 1)
    return ordered[lower_rank], ordered[upper_rank]


def mann_kendall(
    values: list[float],
    times: list[float] | None = None,
    alpha: float = 0.05,
    ac_correct: bool = True,
) -> TrendResult:
    """Two-sided Mann-Kendall test (tie-corrected) plus Sen's slope and its confidence interval.

    `times` are the x-values (for example years); they default to 0, 1, 2, ...
    """
    n = len(values)
    if n < 4:
        raise ValueError("At least 4 values are needed for a trend test.")
    if times is None:
        times = list(range(n))
    if len(times) != n:
        raise ValueError("times and values must have the same length.")

    s, var_s = _mk_s_and_variance(values)

    slopes: list[float] = []
    for i in range(n - 1):
        for j in range(i + 1, n):
            dt = times[j] - times[i]
            if dt != 0:
                slopes.append((values[j] - values[i]) / dt)
    sens = median(slopes)
    t0 = times[0]
    intercept = median([v - sens * (t - t0) for v, t in zip(values, times)])

    residuals = [v - (intercept + sens * (t - t0)) for v, t in zip(values, times)]
    r1 = lag1_autocorrelation(residuals)
    factor = variance_factor_from_autocorr(r1, n) if ac_correct else 1.0

    z_naive, p_naive = _z_and_p(s, var_s)
    z, p_value = _z_and_p(s, var_s * factor)
    ci_low, ci_high = _sens_confidence_interval(slopes, var_s * factor, alpha)

    # A trend is significant only when the test rejects AND the rate estimate has a direction. With many tied values
    # (zero-snowfall or zero-rain years) S can be significant while more than half the pairwise slopes are exactly 0, so
    # Sen's slope is 0 and the 95% interval can be 0 to 0. Calling that "significant" would contradict the direction,
    # sign, summary and checks, so a zero median slope never counts as a significant trend (docs/STATS_AUDIT.md, B1).
    # p_value is reported unchanged; `zero_slope_with_low_p` lets callers explain why it did not count.
    significant = p_value < alpha and sens != 0
    if not significant:
        direction = "no significant trend"
    else:
        direction = "increasing" if sens > 0 else "decreasing"

    return TrendResult(
        n=n,
        s=s,
        z=z,
        p_value=p_value,
        p_naive=p_naive,
        sens_slope=sens,
        sens_intercept=intercept,
        sens_ci_low=ci_low,
        sens_ci_high=ci_high,
        significant=significant,
        direction=direction,
        r1=r1,
        variance_factor=factor,
    )


def zero_slope_with_low_p(result: TrendResult, alpha: float = 0.05) -> bool:
    """True when Mann-Kendall's p is below alpha but Sen's slope is exactly 0 (heavy ties), so no trend is claimed."""
    return result.p_value < alpha and result.sens_slope == 0


# --------------------------------------------------------------------------- least squares


@dataclass(frozen=True)
class OLSResult:
    slope: float
    intercept: float           # fitted value at times[0]
    se: float                  # standard error of the slope (inflated when serial correlation was adjusted)
    t: float
    df: float                  # n - 2, shrunk to the effective number of independent years when the variance was inflated
    p_value: float
    ci_low: float
    ci_high: float
    r2: float
    significant: bool


def ols(
    values: list[float],
    times: list[float] | None = None,
    alpha: float = 0.05,
    variance_factor: float = 1.0,
) -> OLSResult:
    """Straight-line fit with a two-sided t-test and confidence interval for the slope."""
    n = len(values)
    if n < 4:
        raise ValueError("At least 4 values are needed for a regression.")
    if times is None:
        times = list(range(n))
    if len(times) != n:
        raise ValueError("times and values must have the same length.")

    t_mean = sum(times) / n
    y_mean = sum(values) / n
    sxx = sum((t - t_mean) ** 2 for t in times)
    if sxx <= 0:
        raise ValueError("times must not all be equal.")
    sxy = sum((t - t_mean) * (v - y_mean) for t, v in zip(times, values))
    slope = sxy / sxx
    intercept_mean = y_mean - slope * (t_mean - times[0])  # value of the line at times[0]

    sse = sum((v - (y_mean + slope * (t - t_mean))) ** 2 for t, v in zip(times, values))
    syy = sum((v - y_mean) ** 2 for v in values)
    r2 = 1.0 - sse / syy if syy > 0 else 0.0
    df = float(n - 2)
    if variance_factor > 1.0:
        # Serially correlated years carry less information: n / factor independent years remain, so the t distribution
        # should use that many degrees of freedom. (Simulation: false alarms 9.7% -> 6.9% at phi = 0.7.)
        df = max(n / variance_factor - 2.0, 2.0)

    # Both tests are relative, so the answer does not depend on the units (B10): an absolute floor such as
    # 1e-24 * max(syy, 1) called noisy data around 1e-14 a perfect line with p = 0.
    sum_sq = sum(v * v for v in values)
    if syy <= 1e-28 * sum_sq:  # no variation beyond floating-point rounding (a constant series)
        slope = 0.0
        intercept_mean = y_mean
        se = 0.0
        t_stat = 0.0
        p_value = 1.0
        ci_low = ci_high = 0.0
        r2 = 0.0
    elif sse <= 1e-24 * syy:  # perfect line
        se = 0.0
        t_stat = math.inf if slope != 0 else 0.0
        p_value = 0.0 if slope != 0 else 1.0
        ci_low = ci_high = slope
    else:
        se = math.sqrt(sse / (n - 2) / sxx * variance_factor)
        t_stat = slope / se
        p_value = t_two_sided_p(t_stat, df)
        half_width = t_critical(alpha, df) * se
        ci_low, ci_high = slope - half_width, slope + half_width

    return OLSResult(
        slope=slope,
        intercept=intercept_mean,
        se=se,
        t=t_stat,
        df=df,
        p_value=p_value,
        ci_low=ci_low,
        ci_high=ci_high,
        r2=r2,
        significant=p_value < alpha,
    )


# --------------------------------------------------------------------------- correlation


def pearson(x: list[float], y: list[float]) -> float | None:
    """Pearson correlation, or None when either series has no variation."""
    n = len(x)
    if n != len(y) or n < 3:
        raise ValueError("Need two series of equal length (at least 3).")
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx <= 0 or syy <= 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / math.sqrt(sxx * syy)


def effective_sample_size(n: int, r1_x: float, r1_y: float) -> float:
    """Bretherton et al. (1999) effective sample size for correlating two autocorrelated series."""
    product = max(0.0, r1_x) * max(0.0, r1_y)  # only positive persistence reduces information
    n_eff = n * (1.0 - product) / (1.0 + product)
    return min(float(n), max(3.0, n_eff))


def correlation_p_value(r: float, n_eff: float) -> float:
    """Two-sided p-value for a correlation using the effective number of independent samples."""
    if n_eff <= 2:
        return 1.0
    if abs(r) >= 1.0:
        return 0.0
    t = r * math.sqrt((n_eff - 2.0) / (1.0 - r * r))
    return t_two_sided_p(t, n_eff - 2.0)


def linear_detrend(values: list[float], times: list[float]) -> list[float]:
    """Residuals of a least-squares line (the series with its straight-line trend removed)."""
    fit = ols(values, times)
    t_mean = sum(times) / len(times)
    y_mean = sum(values) / len(values)
    return [v - (y_mean + fit.slope * (t - t_mean)) for v, t in zip(values, times)]


# --------------------------------------------------------------------------- shape of a record


@dataclass(frozen=True)
class StepFit:
    split: int            # index of the first value of the second segment
    mean_before: float
    mean_after: float
    r2: float             # share of variance explained by "two flat levels"


def pettitt(values: list[float]) -> tuple[int, float]:
    """Pettitt (1979) change-point test.

    Returns (index of the first value after the most likely shift, approximate two-sided p-value).
    """
    n = len(values)
    if n < 8:
        raise ValueError("At least 8 values are needed to look for a change point.")
    u = 0.0
    best_abs, best_t = -1.0, 0
    for t in range(n - 1):
        xt = values[t]
        u += sum((xt > xj) - (xt < xj) for xj in values)  # V_t = sum_j sign(x_t - x_j)
        if abs(u) > best_abs:
            best_abs, best_t = abs(u), t
    p_value = min(1.0, 2.0 * math.exp(-6.0 * best_abs**2 / (n**3 + n**2)))
    return best_t + 1, p_value


def best_step(values: list[float], min_segment: int = 5) -> StepFit | None:
    """Best split of the record into two flat levels (least squares). None if the record is too short."""
    n = len(values)
    if n < 2 * min_segment:
        return None
    y_mean = sum(values) / n
    sst = sum((v - y_mean) ** 2 for v in values)
    best: tuple[float, int] | None = None
    for k in range(min_segment, n - min_segment + 1):
        a, b = values[:k], values[k:]
        ma, mb = sum(a) / len(a), sum(b) / len(b)
        sse = sum((v - ma) ** 2 for v in a) + sum((v - mb) ** 2 for v in b)
        if best is None or sse < best[0]:
            best = (sse, k)
    sse, k = best
    a, b = values[:k], values[k:]
    return StepFit(split=k, mean_before=sum(a) / len(a), mean_after=sum(b) / len(b), r2=1.0 - sse / sst if sst > 0 else 0.0)
