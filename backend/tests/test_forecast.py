"""Forecast lab: models, backtest, conformal bands, and refusing to claim skill that is not there."""

import random

import pytest

from app.forecast import (
    MODELS,
    conformal_quantile,
    damped_holt,
    linear_trend,
    long_run_mean,
    persistence,
    ridge_on_lags,
    run_forecast_lab,
    theil_sen,
    trend_plus_ar1,
    trim_to_consecutive,
)

YEARS = list(range(1981, 2026))


def _trend_series(slope=0.05, noise=0.3, seed=1, n=45):
    rng = random.Random(seed)
    return [10 + slope * i + rng.gauss(0, noise) for i in range(n)]


# ---- helpers ------------------------------------------------------------------------------------


def test_trim_keeps_the_unbroken_run_ending_at_the_latest_year():
    years = [1990, 1991, 1993, 1994, 1995]
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert trim_to_consecutive(years, values) == ([1993, 1994, 1995], [3.0, 4.0, 5.0])
    assert trim_to_consecutive([2000, 2001], [1.0, 2.0]) == ([2000, 2001], [1.0, 2.0])


def test_conformal_quantile():
    assert conformal_quantile([float(i) for i in range(1, 11)], 0.8) == 9.0  # ceil(11 * 0.8) = 9th smallest
    assert conformal_quantile([1.0, 2.0, 3.0], 0.8) is None                  # too few errors to calibrate a band
    assert conformal_quantile([5.0, 1.0, 3.0, 2.0], 0.5) == 3.0              # order does not matter


# ---- individual models --------------------------------------------------------------------------


def test_trend_models_continue_a_perfect_line():
    line = [2.0 + 0.5 * i for i in range(30)]
    expected = [2.0 + 0.5 * (29 + k) for k in range(1, 6)]
    assert linear_trend(line, 5) == pytest.approx(expected)
    assert theil_sen(line, 5) == pytest.approx(expected)
    assert trend_plus_ar1(line, 5) == pytest.approx(expected, abs=1e-6)  # residuals are all zero, so no persistence term


def test_baselines():
    series = [1.0, 2.0, 3.0, 4.0]
    assert persistence(series, 3) == [4.0, 4.0, 4.0]
    assert long_run_mean(series, 2) == [2.5, 2.5]


def test_every_model_returns_finite_forecasts_of_the_right_length():
    series = _trend_series()
    for model in MODELS:
        out = model["fn"](series[:30], 5)
        assert len(out) == 5, model["id"]
        assert all(abs(v) < 1e6 for v in out), model["id"]


def test_damped_trend_forecasts_flatten():
    rising = [float(i) for i in range(30)]
    out = damped_holt(rising, 5)
    steps = [b - a for a, b in zip(out, out[1:])]
    assert all(step < 1.0 for step in steps)             # a damped trend gains less than the raw slope each year
    assert steps[-1] < steps[0]                           # and the gain shrinks
    assert ridge_on_lags([1.0, 2.0, 3.0], 2) == [3.0, 3.0]  # too short to learn from: falls back to persistence


# ---- the lab ------------------------------------------------------------------------------------


def test_short_series_is_refused_politely():
    result = run_forecast_lab(YEARS[:20], _trend_series(n=20))
    assert result["ok"] is False and "at least 25" in result["message"]


def test_trending_series_gets_a_winner_that_beats_the_baseline():
    result = run_forecast_lab(YEARS, _trend_series(slope=0.08, noise=0.25))
    assert result["ok"]
    assert result["beats_baseline"] is True
    assert result["best"] not in ("persistence", "mean")
    best = next(m for m in result["models"] if m["is_best"])
    assert best["skill"] > 0.1
    assert [f["year"] for f in result["forecast"]] == [2026, 2027, 2028, 2029, 2030]
    assert result["forecast"][-1]["value"] > result["history"][0]["value"]  # the trend continues upward
    assert all(f["lo"] < f["value"] < f["hi"] for f in result["forecast"])


def test_pure_noise_is_not_credited_with_skill():
    rng = random.Random(21)
    result = run_forecast_lab(YEARS, [10 + rng.gauss(0, 1) for _ in range(45)])
    assert result["ok"]
    assert result["beats_baseline"] is False  # nothing can beat the long-run average on pure noise


def test_conformal_bands_cover_close_to_the_nominal_rate_out_of_sample():
    rng = random.Random(22)
    result = run_forecast_lab(YEARS, [10 + rng.gauss(0, 1) for _ in range(45)])
    cov = result["coverage"]
    assert cov["nominal"] == 0.8 and cov["n_test"] >= 20
    assert 0.6 <= cov["test"] <= 0.98


def test_scoreboard_is_complete_and_consistent():
    result = run_forecast_lab(YEARS, _trend_series())
    assert {m["id"] for m in result["models"]} == {m["id"] for m in MODELS}
    assert sum(m["is_best"] for m in result["models"]) == 1
    base = next(m for m in result["models"] if m["id"] == result["baseline"])
    assert base["skill"] == pytest.approx(0.0)  # the baseline has zero skill against itself
    assert all(len(m["mae_by_horizon"]) == 5 and len(m["skill_by_horizon"]) == 5 for m in result["models"])
    assert result["min_train"] < result["n_years"] and result["n_origins"] == result["n_years"] - result["min_train"]


def test_replays_show_past_forecasts_next_to_what_happened():
    result = run_forecast_lab(YEARS, _trend_series())
    replays = result["replays"]
    assert 1 <= len(replays) <= 6
    assert [r["origin_year"] for r in replays] == sorted(r["origin_year"] for r in replays)
    for replay in replays:
        assert [p["year"] for p in replay["points"]] == [replay["origin_year"] + h for h in range(1, 6)]
        assert all(p["actual"] is not None and p["lo"] < p["value"] < p["hi"] for p in replay["points"])
        actual = {a["year"]: a["value"] for a in result["history"]}
        assert all(p["actual"] == pytest.approx(actual[p["year"]]) for p in replay["points"])  # "actual" really is the later record


def test_a_gap_in_the_record_uses_only_the_unbroken_recent_run():
    years = list(range(1981, 1991)) + list(range(1995, 2026))  # 31 consecutive years at the end
    values = _trend_series(n=len(years))
    result = run_forecast_lab(years, values)
    assert result["ok"] and result["n_years"] == 31 and result["history"][0]["year"] == 1995


# ---- review item B3: the coverage check never uses data from its own test period ---------------------------------


def test_coverage_model_and_calibration_ignore_the_test_period():
    rng = random.Random(22)
    values = [10 + 0.03 * i + rng.gauss(0, 1) for i in range(45)]
    result = run_forecast_lab(YEARS, values)
    cov = result["coverage"]
    cut_year = cov["calibration_end_year"]
    assert YEARS[0] < cut_year < YEARS[-1] and cov["model"] in {m["id"] for m in MODELS}
    # Rewrite every value after the calibration year: the model chosen for the check must not change.
    k = YEARS.index(cut_year)
    for shift in (0.5, -0.5):
        changed = values[: k + 1] + [v + shift * (i + 1) for i, v in enumerate(values[k + 1 :])]
        assert run_forecast_lab(YEARS, changed)["coverage"]["model"] == cov["model"]


def test_coverage_model_is_the_lowest_error_model_on_rows_known_by_the_cut():
    from statistics import mean

    rng = random.Random(5)
    values = [10 + 0.05 * i + rng.gauss(0, 0.5) for i in range(45)]
    result = run_forecast_lab(YEARS, values)
    k = YEARS.index(result["coverage"]["calibration_end_year"])
    origins = range(result["min_train"], len(values))

    def mae_known(fn):
        errs = [abs(fn(values[:o], 5)[h - 1] - values[o + h - 1]) for o in origins for h in range(1, 6) if o + h - 1 <= k]
        return mean(errs)

    expected = min(MODELS, key=lambda m: mae_known(m["fn"]))["id"]
    assert result["coverage"]["model"] == expected


def test_replay_bands_are_labelled_in_sample():
    result = run_forecast_lab(YEARS, _trend_series())
    assert result["replays"] and all(r["band_basis"] == "in_sample" for r in result["replays"])
    assert "out-of-sample" in result["replay_note"]
