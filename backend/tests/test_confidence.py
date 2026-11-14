import random

from app.stats import mann_kendall


def test_interval_contains_true_slope_for_linear_data():
    values = [0.3 * i for i in range(30)]
    result = mann_kendall(values)
    assert result.sens_ci_low <= 0.3 <= result.sens_ci_high
    assert result.sens_ci_low <= result.sens_slope <= result.sens_ci_high


def test_interval_is_ordered():
    rng = random.Random(0)
    values = [0.1 * i + rng.gauss(0, 1) for i in range(40)]
    result = mann_kendall(values)
    assert result.sens_ci_low <= result.sens_ci_high


def test_noisier_data_gives_wider_interval():
    rng = random.Random(1)
    clean = [0.1 * i + rng.gauss(0, 0.05) for i in range(40)]
    noisy = [0.1 * i + rng.gauss(0, 2.0) for i in range(40)]
    clean_width = mann_kendall(clean).sens_ci_high - mann_kendall(clean).sens_ci_low
    noisy_width = mann_kendall(noisy).sens_ci_high - mann_kendall(noisy).sens_ci_low
    assert noisy_width > clean_width


def test_constant_series_interval_is_zero():
    result = mann_kendall([2.0] * 20)
    assert result.sens_ci_low == 0.0
    assert result.sens_ci_high == 0.0
