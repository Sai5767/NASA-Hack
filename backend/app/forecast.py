"""Forecast lab: honest short-range forecasting of a yearly series.

Several simple models compete in a rolling-origin backtest: each is trained only on data up to a past year,
asked for the next 1-5 years, and scored against what really happened. The winner forecasts the future, and its
error band comes from its own backtest track record (split-conformal prediction), whose coverage is then checked
on origins it was not calibrated on.

This is statistical extrapolation of one series, not a climate projection. If no model beats "just repeat last
year", the result says so.
"""

from __future__ import annotations

import math
from statistics import mean, median

from .ml import fit_ridge
from .stats import lag1_autocorrelation

HORIZON = 5
COVERAGE = 0.8
MIN_SERIES_YEARS = 25
SKILL_MARGIN = 0.03  # a model must beat the best baseline by at least 3% to count as having skill
CALIBRATION_SHARE = 0.6


# --------------------------------------------------------------------------- models: f(train, horizon) -> forecasts


def _line(values: list[float]) -> tuple[float, float]:
    """Least-squares line y = a + b*x over x = 0..n-1."""
    n = len(values)
    xm, ym = (n - 1) / 2, mean(values)
    sxx = sum((i - xm) ** 2 for i in range(n))
    b = sum((i - xm) * (v - ym) for i, v in enumerate(values)) / sxx
    return ym - b * xm, b


def persistence(train: list[float], h: int) -> list[float]:
    return [train[-1]] * h


def long_run_mean(train: list[float], h: int) -> list[float]:
    return [mean(train)] * h


def linear_trend(train: list[float], h: int) -> list[float]:
    a, b = _line(train)
    n = len(train)
    return [a + b * (n - 1 + k) for k in range(1, h + 1)]


def theil_sen(train: list[float], h: int) -> list[float]:
    n = len(train)
    b = median((train[j] - train[i]) / (j - i) for i in range(n - 1) for j in range(i + 1, n))
    a = median(v - b * i for i, v in enumerate(train))
    return [a + b * (n - 1 + k) for k in range(1, h + 1)]


def damped_holt(train: list[float], h: int) -> list[float]:
    """Exponential smoothing with a damped trend; smoothing constants chosen by one-step-ahead error."""
    best = None
    for alpha in (0.2, 0.4, 0.6, 0.8):
        for beta in (0.05, 0.15, 0.3):
            for phi in (0.8, 0.9, 0.98):
                level, trend = train[0], mean(train[i + 1] - train[i] for i in range(min(3, len(train) - 1)))
                sse = 0.0
                for y in train[1:]:
                    expected = level + phi * trend
                    sse += (y - expected) ** 2
                    new_level = alpha * y + (1 - alpha) * expected
                    trend = beta * (new_level - level) + (1 - beta) * phi * trend
                    level = new_level
                if best is None or sse < best[0]:
                    best = (sse, level, trend, phi)
    _, level, trend, phi = best
    out, damp = [], 0.0
    for k in range(1, h + 1):
        damp += phi**k
        out.append(level + damp * trend)
    return out


def trend_plus_ar1(train: list[float], h: int) -> list[float]:
    """A straight line, plus the part of the last year's departure that persists (AR(1) on the residuals)."""
    a, b = _line(train)
    n = len(train)
    residuals = [v - (a + b * i) for i, v in enumerate(train)]
    phi = max(-0.5, min(0.95, lag1_autocorrelation(residuals)))
    return [a + b * (n - 1 + k) + phi**k * residuals[-1] for k in range(1, h + 1)]


def ridge_on_lags(train: list[float], h: int, lags: int = 3, lam: float = 1.0) -> list[float]:
    """The learned model: ridge regression of each year on the previous three years and the time index, rolled forward."""
    n = len(train)
    if n - lags < 8:
        return persistence(train, h)
    rows = [[float(t)] + [train[t - j] for j in range(1, lags + 1)] for t in range(lags, n)]
    model = fit_ridge(rows, train[lags:], lam)
    history, out = list(train), []
    for step in range(h):
        t = n + step
        row = [float(t)] + [history[t - j] for j in range(1, lags + 1)]
        nxt = model.predict(row)
        history.append(nxt)
        out.append(nxt)
    return out


def ensemble(train: list[float], h: int) -> list[float]:
    members = [linear_trend(train, h), theil_sen(train, h), damped_holt(train, h), trend_plus_ar1(train, h), ridge_on_lags(train, h)]
    return [mean(col) for col in zip(*members)]


MODELS = [
    {"id": "persistence", "label": "Repeat last year", "kind": "baseline", "fn": persistence},
    {"id": "mean", "label": "Long-run average", "kind": "baseline", "fn": long_run_mean},
    {"id": "linear", "label": "Straight-line trend", "kind": "statistical", "fn": linear_trend},
    {"id": "sen", "label": "Theil–Sen trend", "kind": "statistical", "fn": theil_sen},
    {"id": "holt", "label": "Damped trend smoothing", "kind": "statistical", "fn": damped_holt},
    {"id": "ar1", "label": "Trend plus persistence", "kind": "statistical", "fn": trend_plus_ar1},
    {"id": "ridge", "label": "Ridge regression on past years", "kind": "learned", "fn": ridge_on_lags},
    {"id": "ensemble", "label": "Average of the five trend models", "kind": "ensemble", "fn": ensemble},
]


# --------------------------------------------------------------------------- helpers


def trim_to_consecutive(years: list[int], values: list[float]) -> tuple[list[int], list[float]]:
    """The longest run of consecutive years that ends at the latest year (forecasting needs an unbroken record)."""
    start = len(years) - 1
    while start > 0 and years[start] - years[start - 1] == 1:
        start -= 1
    return years[start:], values[start:]


def conformal_quantile(abs_errors: list[float], coverage: float = COVERAGE) -> float | None:
    """Split-conformal quantile: the ceil((m+1)*coverage)-th smallest absolute error. None when there are too few."""
    m = len(abs_errors)
    if m < 4:
        return None
    k = min(m, math.ceil((m + 1) * coverage))
    return sorted(abs_errors)[k - 1]


# --------------------------------------------------------------------------- the lab


def run_forecast_lab(years: list[int], values: list[float], horizon: int = HORIZON) -> dict:
    years, values = trim_to_consecutive(years, values)
    n = len(values)
    if n < MIN_SERIES_YEARS:
        return {"ok": False, "message": f"Only {n} consecutive years: at least {MIN_SERIES_YEARS} are needed to backtest a forecast."}

    min_train = max(15, round(n * 0.45))
    origins = list(range(min_train, n))  # number of training years at each origin

    # preds[model][origin] -> forecasts for h = 1..horizon
    preds = {m["id"]: {o: m["fn"](values[:o], horizon) for o in origins} for m in MODELS}

    def errors_for(model_id: str) -> list[tuple[int, int, float]]:
        out = []
        for o in origins:
            for h in range(1, horizon + 1):
                if o + h - 1 < n:
                    out.append((o, h, preds[model_id][o][h - 1] - values[o + h - 1]))
        return out

    errs = {m["id"]: errors_for(m["id"]) for m in MODELS}

    def mae(model_id: str, h: int | None = None) -> float:
        rows = [abs(e) for (_, hh, e) in errs[model_id] if h is None or hh == h]
        return mean(rows)

    baselines = [m["id"] for m in MODELS if m["kind"] == "baseline"]
    base_id = min(baselines, key=mae)
    base_mae = mae(base_id)

    summary = []
    for m in MODELS:
        overall = mae(m["id"])
        by_h = [mae(m["id"], h) for h in range(1, horizon + 1)]
        base_by_h = [mae(base_id, h) for h in range(1, horizon + 1)]
        summary.append(
            {
                "id": m["id"],
                "label": m["label"],
                "kind": m["kind"],
                "mae": overall,
                "mae_by_horizon": by_h,
                "skill": 1.0 - overall / base_mae if base_mae > 0 else 0.0,
                "skill_by_horizon": [1.0 - a / b if b > 0 else 0.0 for a, b in zip(by_h, base_by_h)],
            }
        )
    best = min(summary, key=lambda s: s["mae"])
    best_id = best["id"]
    beats_baseline = best["kind"] != "baseline" and best["skill"] >= SKILL_MARGIN
    for s in summary:
        s["is_best"] = s["id"] == best_id

    # Conformal bands from the winner's own track record.
    abs_by_h = {h: [(o, abs(e)) for (o, hh, e) in errs[best_id] if hh == h] for h in range(1, horizon + 1)}
    q_all = {h: conformal_quantile([e for _, e in rows]) for h, rows in abs_by_h.items()}

    # Honest coverage check of the whole procedure (review item B3). Pretend it is the year after origin `cut`: only
    # values with index <= cut are known. The model and the baseline are chosen, and the band calibrated, on backtest
    # rows whose TARGET is known by then (o + h - 1 <= cut), and the band is then scored on later origins (o > cut),
    # which those choices never saw. The model chosen this way can differ from the overall winner; it is reported.
    cut = origins[max(1, math.floor(len(origins) * CALIBRATION_SHARE)) - 1]

    def known_by_cut(model_id: str) -> list[tuple[int, int, float]]:
        return [(o, hh, e) for (o, hh, e) in errs[model_id] if o + hh - 1 <= cut]

    def mae_cal(model_id: str) -> float:
        return mean(abs(e) for (_, _, e) in known_by_cut(model_id))

    cal_id = min((m["id"] for m in MODELS), key=mae_cal)
    hits = total = 0
    for h in range(1, horizon + 1):
        q_cal = conformal_quantile([abs(e) for (_, hh, e) in known_by_cut(cal_id) if hh == h])
        if q_cal is None:
            continue
        for o, hh, e in errs[cal_id]:
            if hh == h and o > cut:
                total += 1
                hits += abs(e) <= q_cal
    coverage = {
        "nominal": COVERAGE,
        "test": hits / total if total else None,
        "n_test": total,
        "model": cal_id,
        "calibration_end_year": years[cut],
    }

    # The forecast itself.
    final = next(m["fn"] for m in MODELS if m["id"] == best_id)(values, horizon)
    forecast = []
    for h, v in enumerate(final, start=1):
        q = q_all[h]
        forecast.append({"year": years[-1] + h, "value": v, "lo": v - q if q is not None else None, "hi": v + q if q is not None else None})

    # Replays: what this model would have said at earlier points in time, next to what really happened.
    full_future = [o for o in origins if o + horizon <= n]
    picks = full_future[:: max(1, len(full_future) // 5)][:6] if full_future else []
    replays = []
    for o in picks:
        points = []
        for h in range(1, horizon + 1):
            v, q = preds[best_id][o][h - 1], q_all[h]
            points.append(
                {"year": years[o - 1] + h, "value": v, "lo": v - q if q is not None else None, "hi": v + q if q is not None else None, "actual": values[o + h - 1]}
            )
        # The band is today's band (q_all), calibrated on every backtest error including these years', and the model
        # was chosen with hindsight: a replay illustrates the model's track record, it is not an out-of-sample test.
        replays.append({"origin_year": years[o - 1], "points": points, "band_basis": "in_sample"})

    return {
        "ok": True,
        "horizon": horizon,
        "n_years": n,
        "n_origins": len(origins),
        "min_train": min_train,
        "baseline": base_id,
        "best": best_id,
        "best_label": best["label"],
        "beats_baseline": beats_baseline,
        "models": summary,
        "forecast": forecast,
        "coverage": coverage,
        "replays": replays,
        "replay_note": (
            "Replays use the winning model and today's error band, both chosen with knowledge of the whole record, so "
            "they illustrate the track record rather than test it. The out-of-sample check is the coverage figure."
        ),
        "history": [{"year": y, "value": v} for y, v in zip(years, values)],
        "caveat": "A statistical extrapolation of this one series, not a climate projection. It assumes the pattern of recent decades continues.",
    }
