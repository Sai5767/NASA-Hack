"""Reference-value tests for the hand-written distributions, regression and corrections."""

import math
import random

import pytest

from app.stats import (
    adjustment_is_material,
    bias_corrected_autocorr,
    benjamini_hochberg,
    lag1_autocorrelation,
    mann_kendall,
    mk_z_and_p,
    normal_two_sided_p,
    ols,
    t_critical,
    t_two_sided_p,
    variance_factor_from_autocorr,
)


# ---- distributions: values from standard statistical tables -------------------------------


def test_normal_two_sided_p_reference_values():
    assert normal_two_sided_p(1.96) == pytest.approx(0.05, abs=5e-4)
    assert normal_two_sided_p(2.576) == pytest.approx(0.01, abs=2e-4)
    assert normal_two_sided_p(0.0) == pytest.approx(1.0)


@pytest.mark.parametrize(
    "t,df,expected",
    [
        (2.228, 10, 0.0500),
        (2.0, 10, 0.0734),
        (1.0, 20, 0.3293),
        (3.169, 10, 0.0100),
        (12.706, 1, 0.0500),
        (2.1213, 3, 0.1240),
    ],
)
def test_t_two_sided_p_matches_tables(t, df, expected):
    assert t_two_sided_p(t, df) == pytest.approx(expected, abs=1.5e-3)


def test_t_is_symmetric_and_approaches_normal_for_large_df():
    assert t_two_sided_p(-2.0, 10) == pytest.approx(t_two_sided_p(2.0, 10))
    assert t_two_sided_p(1.96, 200000) == pytest.approx(0.05, abs=5e-4)


@pytest.mark.parametrize("df,expected", [(1, 12.706), (10, 2.228), (43, 2.017), (1000, 1.962)])
def test_t_critical_matches_tables(df, expected):
    assert t_critical(0.05, df) == pytest.approx(expected, abs=2e-3)


def test_t_critical_inverts_t_p():
    crit = t_critical(0.01, 25)
    assert t_two_sided_p(crit, 25) == pytest.approx(0.01, abs=1e-6)


# ---- Mann-Kendall ------------------------------------------------------------------------------


def test_mk_perfectly_increasing_five_points():
    # S = 10, Var(S) = 5*4*15/18, z = (10-1)/sqrt(Var) = 2.2045, p = 0.0275
    result = mann_kendall([1, 2, 3, 4, 5], ac_correct=False)
    assert result.s == 10
    assert result.z == pytest.approx(2.2045, abs=1e-3)
    assert result.p_value == pytest.approx(0.0275, abs=1e-3)


def test_mk_handles_uneven_times():
    times = [1981.0, 1982.0, 1985.0, 1990.0, 1991.0, 2000.0]
    values = [2.0 * (t - 1981.0) + 5.0 for t in times]
    result = mann_kendall(values, times)
    assert result.sens_slope == pytest.approx(2.0)
    assert result.sens_intercept == pytest.approx(5.0)


def test_mk_fast_helper_matches_full_test_when_not_adjusted():
    rng = random.Random(11)
    values = [0.05 * i + rng.gauss(0, 0.5) for i in range(40)]
    z, p = mk_z_and_p(values)
    full = mann_kendall(values, ac_correct=False)
    assert z == pytest.approx(full.z)
    assert p == pytest.approx(full.p_value)


# ---- Ordinary least squares ----------------------------------------------------------------


def test_ols_textbook_example():
    # x = 1..5, y = 2,4,5,4,5 -> slope 0.6, intercept 2.2, r^2 = 0.6, SE = 0.2828, t = 2.1213 (df 3)
    result = ols([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])
    assert result.slope == pytest.approx(0.6)
    assert result.intercept == pytest.approx(2.8)  # fitted value at x = 1
    assert result.r2 == pytest.approx(0.6)
    assert result.se == pytest.approx(math.sqrt(2.4 / 3 / 10))
    assert result.t == pytest.approx(2.1213, abs=1e-3)
    assert result.p_value == pytest.approx(0.124, abs=3e-3)
    assert not result.significant
    assert result.ci_low < 0.6 < result.ci_high


def test_ols_perfect_line_has_zero_p_value():
    values = [2.0 * t + 1.0 for t in range(12)]
    result = ols(values)
    assert result.slope == pytest.approx(2.0)
    assert result.p_value == 0.0
    assert result.significant
    assert result.ci_low == pytest.approx(2.0)


def test_ols_flat_noise_is_not_significant():
    rng = random.Random(5)
    values = [rng.gauss(0, 1) for _ in range(40)]
    assert not ols(values).significant


def test_ols_variance_factor_widens_interval():
    rng = random.Random(2)
    values = [0.1 * i + rng.gauss(0, 1) for i in range(40)]
    narrow = ols(values)
    wide = ols(values, variance_factor=4.0)
    assert wide.se == pytest.approx(2 * narrow.se)                    # variance x4 means standard error x2
    assert wide.df == pytest.approx(40 / 4.0 - 2.0)                   # only ~10 independent years remain
    assert (wide.ci_high - wide.ci_low) > 2 * (narrow.ci_high - narrow.ci_low)  # fewer df, so a bigger t multiplier too
    assert wide.p_value >= narrow.p_value


# ---- serial correlation ---------------------------------------------------------------------


def test_lag1_autocorrelation_signs():
    assert lag1_autocorrelation([1, -1] * 10) < -0.8
    assert lag1_autocorrelation([float(i) for i in range(20)]) > 0.8
    assert lag1_autocorrelation([3.0] * 10) == 0.0


def test_variance_factor_uses_the_bias_corrected_positive_autocorrelation():
    assert variance_factor_from_autocorr(-0.6, 45) == 1.0     # negative never inflates
    assert variance_factor_from_autocorr(0.5, 7) == 1.0       # too short to correct
    phi = (0.5 + 2 / 45) / (1 - 4 / 45)                       # a raw 0.5 hides a larger true persistence
    assert variance_factor_from_autocorr(0.5, 45) == pytest.approx((1 + phi) / (1 - phi))
    assert variance_factor_from_autocorr(0.99, 45) == pytest.approx(1.8 / 0.2)  # capped at phi = 0.8
    assert variance_factor_from_autocorr(0.05, 45) > 1.0      # no significance gate: a small positive r1 still counts


def test_bias_correction_undoes_the_expected_downward_bias():
    n, phi = 44, 0.5
    expected_raw = phi - (2 + 4 * phi) / n                    # what a short detrended record tends to show
    assert bias_corrected_autocorr(expected_raw, n) == pytest.approx(phi)


def test_only_a_material_adjustment_is_reported():
    assert not adjustment_is_material(1.05)
    assert adjustment_is_material(1.2)
    assert adjustment_is_material(3.0)


def test_persistent_series_gets_a_more_cautious_p_value():
    rng = random.Random(4)
    level, values = 0.0, []
    for _ in range(45):  # random walk: neighboring years strongly resemble each other
        level += rng.gauss(0, 0.5)
        values.append(level)
    result = mann_kendall(values)
    assert result.r1 > 0.3
    assert result.variance_factor > 1.0
    assert result.p_value >= result.p_naive


def test_adjusted_p_value_is_never_smaller_than_the_naive_one():
    rng = random.Random(8)
    for _ in range(30):
        values = [rng.gauss(0, 1) + 0.02 * i for i in range(45)]
        result = mann_kendall(values)
        assert result.variance_factor >= 1.0
        assert result.p_value >= result.p_naive - 1e-12


# ---- false-discovery rate -------------------------------------------------------------------


def test_benjamini_hochberg_rejects_everything_when_all_small():
    assert benjamini_hochberg([0.01, 0.04, 0.03, 0.005], q=0.05) == [True, True, True, True]


def test_benjamini_hochberg_is_stricter_than_raw_threshold():
    flags = benjamini_hochberg([0.001, 0.2, 0.3, 0.04, 0.9], q=0.05)
    assert flags == [True, False, False, False, False]  # 0.04 is < 0.05 raw but not after correction


def test_benjamini_hochberg_empty_and_none():
    assert benjamini_hochberg([]) == []
    assert benjamini_hochberg([0.5, 0.6, 0.7]) == [False, False, False]
