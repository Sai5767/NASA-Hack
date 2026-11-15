# Trend Detective V2 — API Contract

This document is the authoritative contract between the FastAPI backend (`backend/app/`) and the React/Vite frontend (`frontend/src/`) for Trend Detective V2.

All existing V1 endpoints (`/api/version`, `/api/variables`, `/api/trend`, `/api/sweep`, `/api/grid`, `/api/suspects`, `/api/vitals`, `/api/places`, `/api/world`, `/api/ledger`, `/api/forecast`, `/api/archetypes`, `/api/duel`) preserve 100% of their V1 fields and semantics.

Deterministic JSON fixtures for every V2 route are stored in `backend/tests/fixtures/v2_fixtures.json` and verified by `backend/tests/test_v2_contract_fixtures.py`.

---

## Core Contract Rules for Frontend Integration

1. **No Server Accounts or Profile Endpoints:** All profile choices, display names, earth-system interests, and saved locations stay in browser `localStorage` (`td-profile-v2`). Never send profile objects, passwords, or auth headers to the server.
2. **Server-Computed Statistics Only:** The frontend must never compute or alter trend slopes, confidence intervals, p-values, serial-correlation factors, or forecast eligibility. Render `evidence_trace` directly from `GET /api/trend`.
3. **Strict Request Validation on `POST /api/explanations`:** The endpoint uses `extra="forbid"`. Only submit `{case_signature, variable, lat, lon, start_year, end_year, question}`. Submitting client-side `p_value`, `slope`, `stats`, or `system_prompt` fields will return `HTTP 422`.
4. **Observed vs. Forecast Separation:** `GET /api/monthly-frames` returns `"kind": "observed"`. `GET /api/monthly-forecast` returns `"kind": "forecast"` with `"badge": "Forecast — not observed data"` **only** when `"eligible": true`. When `"eligible": false`, `"frames"` is `[]` and `"reason"` explains why forecasts are withheld.
5. **News is Context, Not Evidence:** Every item from `GET /api/news` includes `"label": "news context, not scientific evidence"`, a deterministic `"severity"` (`"green" | "amber" | "red"`) and `"publisher_verified": true | false`. Show `publisher_verified: false` items only as "Unverified news context", less prominent than verified ones, and never make their severity sound like official advice. When `"stale": true`, display `cache_age_seconds` / `fetched_at` visibly.
6. **Live Weather is a Separate Source:** `GET /api/live-weather` (Meteomatics) is hourly operational weather for the next 1 to 72 hours. It is never NASA POWER data, never part of a trend, and never the app's own monthly forecast. Show its `label` and `source_note` with it, and handle `available: false` as a normal state (no credentials, provider outage), not an error.

---

## 1. `GET /api/trend` *(Extended)*

Returns the complete point trend case file, now extended with `case_signature` and `evidence_trace`. All existing top-level keys (`variable`, `location`, `period`, `quality`, `stats`, `ols`, `annual`, `monthly`, `rolling`, `trend_line`, `fingerprint`, `month_agreement`, `emergence`, `robustness`, `shape`, `checks`, `grade`, `agreement`, `summary`, `caveats`) remain unchanged.

### Query Parameters

| Parameter | Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `variable` | `string` | Valid key in `/api/variables` | *(required)* | NASA POWER parameter ID (e.g. `T2M`, `PRECTOTCORR`, `CLOUD_AMT`) |
| `lat` | `float` | `-90.0 <= lat <= 90.0` | *(required)* | Latitude in decimal degrees |
| `lon` | `float` | `-180.0 <= lon <= 180.0` | *(required)* | Longitude in decimal degrees |
| `start_year` | `int` | `1981 <= start_year < end_year` | `1981` | First year of analysis window |
| `end_year` | `int` | `end_year - start_year + 1 >= 20` | `current_year - 1` | Last year of analysis window. The default is computed from today's date on every request (it used to be frozen when the server started), on every route that has one. |

**Significance rule (Phase 0, B1):** `stats.significant` is `false` whenever Sen's slope is exactly 0, even when the Mann-Kendall `p_value` is below 0.05 (heavy ties, e.g. zero-snowfall years). `p_value` itself is unchanged. The same rule flows into `/api/sweep`, `/api/grid`, `/api/world`, `/api/ledger`, Planet Vitals and `evidence_trace`; `significant_fdr` is only ever `true` for a row that is also `significant`. `emergence.series[*].z` / `p` are autocorrelation-adjusted, each entry has a `significant` boolean, and `emergence.year` (and `emergence_year` in sweep and Planet Vitals) is `null` whenever the headline trend is not significant. Details: `docs/STATS_AUDIT.md`, "Backend review fixes (2026-11-15)".

### New Top-Level Fields Added in V2

```json
{
  "case_signature": "v2|T2M|33.450|-112.070|1981|2024|a1b2c3d4e5f60123456789ab",
  "evidence_trace": {
    "verdict": {
      "code": "strong_evidence",
      "label": "Strong evidence of a trend",
      "tier": 3,
      "direction": "increasing",
      "sign": "up",
      "summary": "Air temperature at (33.45, -112.07) rose over 1981–2024: +0.602 °C per decade (95% range +0.541 to +0.662), about +2.59 °C in total. That change is roughly 15.6× the normal year-to-year swing. Strong evidence (5 of 5 checks passed).",
      "ladder": [
        { "code": "strong_evidence", "label": "Strong evidence of a trend", "tier": 3 },
        { "code": "some_evidence", "label": "Some evidence — investigate carefully", "tier": 2 },
        { "code": "no_clear_evidence", "label": "No clear evidence yet", "tier": 1 },
        { "code": "insufficient_data", "label": "Not enough data to tell", "tier": 0 }
      ]
    },
    "completeness": {
      "start_year": 1981,
      "end_year": 2024,
      "complete_years": [1981, 1982, "... 2024"],
      "years_used": 44,
      "years_requested": 44,
      "valid_months": 528,
      "expected_months": 528,
      "min_months_per_year": 12,
      "min_years_required": 20,
      "source": "NASA Langley Research Center (LaRC) POWER Project"
    },
    "slope_and_interval": {
      "method": "Theil–Sen median pairwise slope with Gilbert (1987) 95% confidence interval",
      "units": "°C",
      "slope_per_year": 0.0602,
      "slope_per_decade": 0.602,
      "ci_low_per_decade": 0.541,
      "ci_high_per_decade": 0.662,
      "confidence_level": 0.95,
      "total_change": 2.5886,
      "span_years": 43,
      "mean_value": 11.29,
      "percent_of_mean": null,
      "noise_sd": 0.165,
      "signal_to_noise": 15.64
    },
    "mann_kendall": {
      "method": "Two-sided Mann–Kendall non-parametric trend test (tie- and continuity-corrected)",
      "s": 850.0,
      "z": 8.59,
      "p_value": 8.6e-18,
      "raw_p_value": 8.6e-18,
      "alpha": 0.05,
      "significant": true,
      "direction": "increasing",
      "sign": "up"
    },
    "regression_and_serial_correlation": {
      "ols": {
        "slope_per_decade": 0.601,
        "se_per_decade": 0.019,
        "ci_low_per_decade": 0.562,
        "ci_high_per_decade": 0.640,
        "t": 31.1,
        "df": 42.0,
        "p_value": 0.0,
        "r2": 0.958,
        "significant": true
      },
      "tests_agree": true,
      "serial_correlation": {
        "method": "Marriott–Pope (1954) bias-corrected lag-1 autocorrelation variance inflation (1+phi)/(1-phi)",
        "lag1_r1": -0.08,
        "variance_factor": 1.0,
        "adjusted": false,
        "effective_df": 42.0,
        "raw_p_value": 8.6e-18,
        "adjusted_p_value": 8.6e-18
      }
    },
    "correction_status": {
      "method": "Benjamini–Hochberg false-discovery rate (FDR) control",
      "alpha": 0.05,
      "primary_test_scope": "single_series",
      "primary_p_fdr_adjusted": false,
      "calendar_months_fdr_applied": true,
      "calendar_months_tested": 12,
      "calendar_months_significant_fdr": 12,
      "explanation": "A single requested point trend is tested at alpha = 0.05 using the serial-correlation-adjusted p-value. Simultaneous families of tests (the 12 calendar months here, plus Sweep, Scan, World, and Ledger) apply Benjamini–Hochberg false-discovery control at q = 0.05."
    },
    "grade": { "code": "strong", "label": "Strong evidence", "passed": 5, "total": 5 },
    "checks": [ "... 5 check objects ..." ],
    "steps": [
      {
        "step": 1,
        "id": "completeness",
        "title": "Count complete 12-month years",
        "plain_explanation": "Used 44 complete 12-month years (1981–2024) from 528 valid monthly observations so no single season biases the annual average.",
        "method_label": "Complete-year annual aggregation (12 valid months required per year)",
        "values": { "years_used": 44, "years_requested": 44, "valid_months": 528, "expected_months": 528, "start_year": 1981, "end_year": 2024 }
      }
    ],
    "caveats": [ "... caveats list ..." ]
  }
}
```

---

## 2. `GET /api/monthly-frames`

Returns observed monthly values and anomalies on a tightly bounded local grid (`1x1` to `3x3`) around a selected location for the bottom timeline rail. Missing cells or missing months are explicitly flagged with `"missing": true`, `"value": null`, `"anomaly": null` and are never interpolated.

### Query Parameters

| Parameter | Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `variable` | `string` | Valid key in `/api/variables` | *(required)* | NASA POWER parameter ID |
| `lat` | `float` | `-90.0 <= lat <= 90.0` | *(required)* | Center latitude |
| `lon` | `float` | `-180.0 <= lon <= 180.0` | *(required)* | Center longitude |
| `start_year` | `int` | `1981 <= start_year <= end_year` | `current_year - 3` | First year of returned monthly frames |
| `end_year` | `int` | `end_year - start_year + 1 <= 10` | `current_year - 1` | Last year of returned monthly frames (max 10 years / 120 months) |
| `n` | `int` | `1 <= n <= 3` | `3` | Grid points per side (`1` = 1 cell, `2` = 4 cells, `3` = 9 cells) |
| `size` | `float` | `0 < size <= 12.0` | `2.0` | Width of local grid in degrees |

### Example Response (`HTTP 200`)

```json
{
  "variable": {
    "id": "T2M",
    "label": "Air temperature",
    "units": "°C",
    "group": "Heat",
    "ratio": false,
    "land_only": false,
    "description": "Average temperature of the air about 2 m above the ground. Rising values mean warming.",
    "tracks_global_temp": true
  },
  "location": { "lat": 33.45, "lon": -112.07 },
  "grid": {
    "n": 2,
    "size_degrees": 2.0,
    "total_cells": 4,
    "resolution_note": "Coarse local analysis grid around the selected location (~0.5° NASA POWER reanalysis), not a global satellite raster. Missing cells are shown as missing and never interpolated."
  },
  "period": {
    "start_year": 2024,
    "end_year": 2024,
    "climatology_start_year": 2005,
    "climatology_end_year": 2024,
    "start_month": "2024-01",
    "end_month": "2024-12",
    "total_months": 12
  },
  "provenance": {
    "source_id": "nasa_power",
    "source_name": "NASA Langley Research Center (LaRC) POWER Project",
    "source_url": "https://power.larc.nasa.gov/",
    "variable_id": "T2M",
    "variable_label": "Air temperature",
    "units": "°C",
    "observation_state": "observed_reanalysis",
    "spatial_resolution": "0.5° x 0.625° MERRA-2 / 1.0° radiation grid (coarse local analysis grid, not a satellite image)",
    "temporal_resolution": "monthly",
    "requested_period": { "start_year": 2024, "end_year": 2024 },
    "fetched_at": "2026-11-15T00:00:00Z",
    "stale": false,
    "caveat": "NASA POWER blends satellite observations with MERRA-2 reanalysis on a ~0.5° grid; nearby points can share grid cells."
  },
  "coverage": {
    "cells_requested": 4,
    "cells_succeeded": 4,
    "cells_failed": 0,
    "cells_with_missing_months": 0,
    "total_cell_months_expected": 48,
    "total_cell_months_valid": 48,
    "total_cell_months_missing": 0,
    "coverage_fraction": 1.0,
    "partial_failure": false
  },
  "cells": [
    {
      "cell_id": "r0_c0",
      "row": 0,
      "col": 0,
      "lat": 32.45,
      "lon": -113.07,
      "ok": true,
      "valid_months": 12,
      "missing_months": 0,
      "expected_months": 12,
      "missing_fraction": 0.0,
      "climatology": { "1": 10.61, "2": 14.52, "...": "..." },
      "error": null
    }
  ],
  "frames": [
    {
      "month": "2024-01",
      "stamp": "202401",
      "year": 2024,
      "month_num": 1,
      "label": "Jan 2024",
      "kind": "observed",
      "badge": "Observed (NASA POWER)",
      "valid_cells": 4,
      "missing_cells": 0,
      "mean_value": 11.42,
      "mean_anomaly": 0.61,
      "cells": [
        {
          "cell_id": "r0_c0",
          "row": 0,
          "col": 0,
          "lat": 32.45,
          "lon": -113.07,
          "value": 11.38,
          "anomaly": 0.77,
          "missing": false
        }
      ]
    }
  ]
}
```

---

## 3. `GET /api/monthly-forecast`

Evaluates rolling-origin monthly backtests (horizons 1 to 3 months) against a `seasonal_naive` baseline for `T2M`, `PRECTOTCORR`, and `CLOUD_AMT` only.

- When `eligible: true`, `frames` contains 1 to 3 forecast frames with `"kind": "forecast"` and `"badge": "Forecast — not observed data"`.
- When `eligible: false`, `frames` is `[]` and `reason` / `reason_code` explain why forecast frames are withheld (`"unsupported_variable"`, `"no_skill_over_seasonal_naive"`, `"poor_calibration_coverage"`, `"sparse_monthly_data"`, `"grid_cell_failure"`, `"insufficient_history"`, `"insufficient_backtest_origins"`, `"constant_series"`, or `"misaligned_cells"`). `"insufficient_backtest_origins"` is a defensive code that cannot occur with the current thresholds (120-month minimum, horizon at most 3). `"misaligned_cells"` is also defensive: it means the cells would forecast different calendar months, which the alignment step below prevents.
- **Alignment (Phase 0, A2):** every cell's training series is trimmed to the earliest last valid month across the grid before any backtest, so every cell forecasts the same calendar months and each frame's `month` label is true for every cell in it. `alignment` reports `{ "common_end_month": "YYYY-MM", "cells_trimmed_to_common_end": int }` (or `null` when no series was built: unsupported variable, grid-cell failure). The first forecast month is the month after `common_end_month`, which can be earlier than `end_year + 1`-January when a cell's latest month is missing.
- **`calibration` has one shape** whenever it is an object: `nominal_coverage`, `empirical_coverage` (`null` if not measured), `min_required_coverage`, `n_test_origins` (distinct held-out origin months), `n_test_pairs` (scored origin-horizon pairs; the old `n_test_origins` value counted these), `interval_half_width_by_horizon` (`null` entries if not measured), `passed`. It is `null` when no backtest ran for the whole grid (unsupported variable, grid-cell failure, sparse data, misaligned cells). When the response is withheld because one cell failed, `models`, `calibration` and `training_range` describe that failing cell (`failed_cell_id`), not the centre cell.
- The quality gate applies to **every** cell of the local grid. If any one cell is withheld the whole response is `eligible: false`, and the response names the first failing cell in `failed_cell_id` (present only in that case) with a per-cell `eligible` / `reason` list in `cells`.
- **Gate thresholds** (`backend/app/monthly.py`): at least 120 contiguous valid months (10 years); at most 5% missing months *inside* the variable's own record (months before a variable's record begins, such as cloud cover before 1984, are not counted as missing); at least 12 rolling backtest origins (24 used when available); the selected model must beat `seasonal_naive` overall by at least 1.5% mean absolute error **and** at every requested horizon; held-out interval coverage must reach at least 60% (nominal 80%).

### Query Parameters

| Parameter | Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `variable` | `string` | Valid key in `/api/variables` | *(required)* | Only `T2M`, `PRECTOTCORR`, `CLOUD_AMT` can be `eligible: true` |
| `lat` | `float` | `-90.0 <= lat <= 90.0` | *(required)* | Center latitude |
| `lon` | `float` | `-180.0 <= lon <= 180.0` | *(required)* | Center longitude |
| `start_year` | `int` | `1981 <= start_year < end_year` | `1981` | Start of training record |
| `end_year` | `int` | `end_year <= current_year` | `current_year - 1` | End of training record |
| `horizons` | `int` | `1 <= horizons <= 3` | `3` | Number of future months to forecast |
| `n` | `int` | `1 <= n <= 3` | `3` | Local grid points per side |
| `size` | `float` | `0 < size <= 12.0` | `2.0` | Width of local grid in degrees |

### Example Response — Eligible (`HTTP 200`)

```json
{
  "variable": { "id": "T2M", "label": "Air temperature", "units": "°C", "group": "Heat", "ratio": false, "land_only": false },
  "location": { "lat": 33.45, "lon": -112.07 },
  "supported_variables": ["T2M", "PRECTOTCORR", "CLOUD_AMT"],
  "eligible": true,
  "reason_code": "eligible",
  "reason": null,
  "label": "Forecast — not observed data",
  "horizons_requested": 3,
  "selected_model": "seasonal_trend_ar1",
  "selected_model_label": "Seasonal trend + AR(1) persistence",
  "baseline_model": "seasonal_naive",
  "models": [
    {
      "id": "seasonal_naive",
      "label": "Seasonal naive (same month last year)",
      "kind": "baseline",
      "mae": 0.5621,
      "rmse": 0.7012,
      "mae_by_horizon": [0.551, 0.564, 0.571],
      "rmse_by_horizon": [0.691, 0.703, 0.710],
      "skill_vs_seasonal_naive": 0.0,
      "skill_by_horizon": [0.0, 0.0, 0.0],
      "beats_baseline_all_horizons": false,
      "is_selected": false
    },
    {
      "id": "seasonal_trend_ar1",
      "label": "Seasonal trend + AR(1) persistence",
      "kind": "statistical",
      "mae": 0.4112,
      "rmse": 0.5104,
      "mae_by_horizon": [0.405, 0.412, 0.417],
      "rmse_by_horizon": [0.502, 0.511, 0.518],
      "skill_vs_seasonal_naive": 0.2685,
      "skill_by_horizon": [0.265, 0.2695, 0.2697],
      "beats_baseline_all_horizons": true,
      "is_selected": true
    }
  ],
  "calibration": {
    "nominal_coverage": 0.8,
    "empirical_coverage": 0.8333,
    "min_required_coverage": 0.6,
    "n_test_origins": 10,
    "n_test_pairs": 30,
    "interval_half_width_by_horizon": [0.64, 0.66, 0.68],
    "passed": true
  },
  "training_range": {
    "start_month": "1981-01",
    "end_month": "2024-12",
    "n_months": 528,
    "n_backtest_origins": 24
  },
  "alignment": { "common_end_month": "2024-12", "cells_trimmed_to_common_end": 0 },
  "grid": { "n": 2, "size_degrees": 2.0, "total_cells": 4 },
  "provenance": { "... observation_state: statistical_forecast_from_reanalysis ..." },
  "cells": [ "... per-cell forecasts ..." ],
  "frames": [
    {
      "horizon": 1,
      "month": "2025-01",
      "stamp": "202501",
      "year": 2025,
      "month_num": 1,
      "label": "Jan 2025",
      "kind": "forecast",
      "badge": "Forecast — not observed data",
      "valid_cells": 4,
      "missing_cells": 0,
      "mean_value": 12.64,
      "mean_anomaly": 1.35,
      "cells": [
        {
          "cell_id": "r0_c0",
          "row": 0,
          "col": 0,
          "lat": 32.45,
          "lon": -113.07,
          "value": 12.61,
          "anomaly": 1.33,
          "lo": 11.97,
          "hi": 13.25,
          "model_id": "seasonal_trend_ar1",
          "missing": false
        }
      ]
    }
  ]
}
```

### Example Response — Withheld (`HTTP 200`)

```json
{
  "variable": { "id": "WS2M", "label": "Wind speed", "units": "m/s", "group": "Wind & pressure", "ratio": true, "land_only": false },
  "location": { "lat": 33.45, "lon": -112.07 },
  "supported_variables": ["T2M", "PRECTOTCORR", "CLOUD_AMT"],
  "eligible": false,
  "reason_code": "unsupported_variable",
  "reason": "Forecast withheld: monthly forecasting is only enabled for Air temperature (T2M), Rainfall and snowfall (PRECTOTCORR), and Cloud cover (CLOUD_AMT), not Wind speed (WS2M).",
  "horizons_requested": 3,
  "selected_model": null,
  "selected_model_label": null,
  "baseline_model": "seasonal_naive",
  "models": [],
  "calibration": null,
  "training_range": null,
  "alignment": null,
  "grid": { "n": 2, "size_degrees": 2.0, "total_cells": 4 },
  "provenance": { "... provenance ..." },
  "cells": [],
  "frames": []
}
```

---

## 4. `POST /api/explanations`

Produces a hedged, source-cited explanation ("Why might this be happening?") for a server-verified trend analysis.

### Request Body (`application/json`)

Extra properties are forbidden (`HTTP 422`). Submit `case_signature` from `/api/trend` (or `variable`, `lat`, `lon`, `start_year`, `end_year`) plus an optional short `question`:

```json
{
  "case_signature": "v2|T2M|70.000|-150.000|1981|2024|a1b2c3d4e5f60123456789ab",
  "question": "Why is the Arctic warming so fast?"
}
```

### Response Status Values

| `status` | `fallback` | Meaning for the UI |
| --- | --- | --- |
| `"ok"` | `false` | Live OpenAI Responses API explanation succeeded and passed citation/driver validation. |
| `"fallback"` | `true` | Live AI call failed or was rejected by citation validation; serving curated literature context from `reasons.py`. |
| `"no_key"` | `true` | Live AI is not configured: `OPENAI_API_KEY` is unset (`fallback_reason: "missing_api_key"`) or `OPENAI_EXPLANATION_MODEL` is unset (`fallback_reason: "missing_model"`; no model name is built into the server). Serving curated literature context from `reasons.py`. |
| `"rate_limited"` | `true` | Client exceeded the per-window explanation quota (`retry_after_seconds` provided); serving curated fallback. |
| `"no_evidence"` | `true` | Either the measured trend is not statistically significant (`fallback_reason: "no_significant_trend"`), or no substantiated explanation exists (`drivers: []`). |

**Citation rules enforced by the server** (a driver without a surviving citation is removed, never shown):

- A citation link must be `https`, on an allow-listed science or institutional domain (NASA, NOAA, NSIDC, IPCC, WMO and a fixed set of journal publishers), with no credentials, backslash or whitespace in it.
- It must also be a link that really exists in what the model was given or retrieved: a page returned by the web-search tool during that request, or one of the curated sources supplied in the prompt. A plausible-looking address on an official domain that the model made up is dropped.
- If no driver survives, the response falls back (`status: "fallback"`, `fallback_reason: "validation_failed"`) to the curated text in `reasons.py`.
- Rate limiting applies per visitor (default 15 live AI calls per 5 minutes) and returns HTTP 200 with `status: "rate_limited"`, not HTTP 429. The visitor is the socket peer address, or the `X-Forwarded-For` entry written by the trusted proxy when the owner sets `TD_TRUSTED_PROXY_HOPS` (Azure App Service: `1`); IPv6 visitors are grouped per /64. Cached answers (24 hours per `case_signature` + normalised question) are served without spending the allowance.
- **Retrieval is restricted too:** the server uses the Responses API `web_search` tool with `filters.allowed_domains` set to the same science allow-list (parent domains only; subdomains are included), so the search itself can only retrieve those sites. Citation validation above is the second defence.
- `retry_after_seconds` is present on every response: an integer when `status` is `"rate_limited"` (or when OpenAI itself rate-limited the call and sent `Retry-After`), otherwise `null`.
- `measured_facts` numbers are rounded to 4 significant digits (not 4 decimal places), so a tiny significant slope or a very small p-value is never shown or sent to the model as 0.
- `citations` is deduplicated by link (a `?utm_source=` copy and the plain link are one citation) and lists only citations used by the drivers actually returned (at most 4 drivers).

### Example Response (`HTTP 200`)

```json
{
  "status": "ok",
  "summary": "Possible explanations, not proof of cause. The Arctic is warming roughly two to four times faster than the planet. Melting sea ice and snow expose darker surfaces that soak up more sunlight, which amplifies the warming ('Arctic amplification').",
  "disclaimer": "These are possible explanations, not proof that one cause created this local trend.",
  "drivers": [
    {
      "title": "Measured local air temperature trend",
      "explanation": "Across 44 complete years (1981–2024), air temperature moved +0.602 °C per decade (Mann–Kendall p = 8.6e-18). This establishes what changed, not what caused it.",
      "evidence_type": "measured_local_trend",
      "confidence": "well established",
      "citation_ids": ["cit_nasa_power"],
      "citations": [
        {
          "id": "cit_nasa_power",
          "title": "NASA POWER Agroclimatology / MERRA-2 Reanalysis Archive",
          "url": "https://power.larc.nasa.gov/",
          "domain": "power.larc.nasa.gov",
          "source_label": "NASA Langley Research Center (LaRC)"
        }
      ]
    },
    {
      "title": "Published scientific context for this variable and region",
      "explanation": "The Arctic is warming roughly two to four times faster than the planet. Melting sea ice and snow expose darker surfaces that soak up more sunlight, which amplifies the warming ('Arctic amplification').",
      "evidence_type": "published_literature",
      "confidence": "well established",
      "citation_ids": ["cit_1", "cit_2"],
      "citations": [
        {
          "id": "cit_1",
          "title": "Rantanen et al. (2022), Communications Earth & Environment",
          "url": "https://www.nature.com/articles/s43247-022-00498-3",
          "domain": "nature.com",
          "source_label": "Rantanen et al. 2022, Communications Earth & Environment"
        },
        {
          "id": "cit_2",
          "title": "Arctic Monitoring and Assessment Programme (AMAP)",
          "url": "https://www.amap.no/",
          "domain": "amap.no",
          "source_label": "AMAP 2021"
        }
      ]
    }
  ],
  "limitations": [
    "Trends are straight-line summaries of annual averages. They cannot capture cycles, sudden jumps or curved change.",
    "NASA POWER blends satellite observations with computer models (reanalysis) on a grid about half a degree wide, so points that are close together can share the same values.",
    "A significant trend shows a consistent direction over this period, not its cause. A different start or end year can change the answer."
  ],
  "citations": [ "... deduplicated citations array ..." ],
  "generated_at": "2026-11-15T00:00:00Z",
  "fallback": false,
  "fallback_reason": null,
  "retry_after_seconds": null,
  "case_signature": "v2|T2M|70.000|-150.000|1981|2024|fixture000000000000000000",
  "measured_facts": {
    "variable_id": "T2M",
    "variable_label": "Air temperature",
    "units": "°C",
    "location": { "lat": 70.0, "lon": -150.0 },
    "period": { "start_year": 1981, "end_year": 2024 },
    "years_used": 44,
    "direction": "increasing",
    "sign": "up",
    "significant": true,
    "slope_per_decade": 0.602,
    "ci_low_per_decade": 0.541,
    "ci_high_per_decade": 0.662,
    "total_change": 2.589,
    "p_value": 6.273e-18,
    "raw_p_value": 6.273e-18,
    "grade": { "code": "strong", "label": "Strong evidence", "passed": 5, "total": 5 },
    "verdict": "Strong evidence of a trend"
  },
  "cached": false
}
```

---

## 5. `GET /api/news`

Returns deduplicated, deterministically triaged environmental/weather news context near user-saved locations plus the fixed global rotation set (`delhi`, `phoenix`, `amazon`, `london`, `sydney`). Cached for at least 15 minutes (`900s`).

**Behaviour the UI must plan for**

- **Only environmental stories are returned.** An article is kept only if its title is about weather, climate or the environment (deterministic keyword rule); anything else the provider returns (a film list, a royal visit) is dropped. Severity is also a keyword rule: `red` = reported emergency or fatalities, `amber` = a weather phrase such as "flood warning", "heat advisory" or "storm watch", otherwise `green`. It is an editorial triage label, not an official rating.
- **The first request can take up to 20 seconds** (the provider is slow and rate-limits). The whole request has a 20-second budget: locations that have not answered by then are listed in `partial_failures` with `"code": "timeout"` and the rest are returned. Call it lazily and show a loading state. A second request within 15 minutes is served from cache instantly.
- `partial_failures[].code` is one of `"timeout"`, `"rate_limited"`, `"provider_error"` or another typed upstream code. `items` can be empty with `partial_failures` set: show `empty_reason`, never placeholder headlines.

### Query Parameters

| Parameter | Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `locations` | `string` | Optional, max 300 chars | `null` | Comma-separated place IDs (e.g. `delhi,phoenix`) or custom `Name:lat:lon` specs (up to 5 saved locations) |
| `limit` | `int` | `1 <= limit <= 50` | `18` | Maximum number of deduplicated news items to return |

### Example Response (`HTTP 200`)

```json
{
  "items": [
    {
      "id": "news_9f4b2c8e1a20",
      "title": "Severe heatwave advisory issued across northern India as temperatures surge",
      "publisher": "BBC News",
      "publisher_verified": true,
      "canonical_url": "https://www.bbc.com/news/science-environment-101",
      "url": "https://www.bbc.com/news/science-environment-101",
      "published_at": "2026-11-14T12:00:00Z",
      "category": "heat_wildfire",
      "severity": "amber",
      "severity_label": "Weather / environmental watch",
      "lat": 28.61,
      "lon": 77.21,
      "location_id": "delhi",
      "location_name": "Delhi",
      "location_source": "saved_location",
      "coordinate_precision": "city_centroid",
      "uncertainty_km": 50,
      "label": "news context, not scientific evidence"
    }
  ],
  "fetched_at": "2026-11-15T00:00:00Z",
  "stale": false,
  "cache_age_seconds": 0.0,
  "provider": "gdelt",
  "partial_failures": [],
  "locations_queried": [
    { "id": "delhi", "name": "Delhi", "lat": 28.61, "lon": 77.21, "source": "saved_location" }
  ],
  "empty_reason": null,
  "context_note": "News markers provide regional environmental context only; they are not scientific trend evidence."
}
```

---

## 6. `GET /api/health/details`

Returns non-secret availability and cache age for NASA POWER, planet streams, Meteomatics live weather, AI explanations, live news, and monthly forecasting without invoking upstream network calls.

### Example Response (`HTTP 200`)

```json
{
  "status": "ok",
  "checked_at": "2026-11-15T00:00:00Z",
  "version": "223a8c6",
  "features": {
    "nasa_power": {
      "status": "available",
      "configured": true,
      "keyless": true,
      "cache_entries": 12,
      "cache_limit": 4000,
      "ttl_seconds": 21600,
      "newest_cache_age_seconds": 4.2,
      "oldest_cache_age_seconds": 18.5,
      "timeout_seconds": 30.0,
      "max_concurrency": 3,
      "max_concurrency_scope": "process",
      "last_status": "healthy",
      "last_success_at": "2026-11-15T00:00:00Z",
      "last_error_at": null,
      "last_error_code": null,
      "consecutive_failures": 0
    },
    "planet_streams": {
      "status": "available",
      "configured": true,
      "keyless": true,
      "cached_streams": [],
      "cache_entries": 0,
      "ttl_seconds": 43200,
      "newest_cache_age_seconds": null,
      "oldest_cache_age_seconds": null,
      "last_status": "idle",
      "last_success_at": null,
      "last_error_at": null,
      "last_error_code": null,
      "consecutive_failures": 0
    },
    "meteomatics": {
      "status": "unconfigured",
      "available": false,
      "configured": false,
      "provider": "Meteomatics",
      "parameters": ["t_2m:C", "precip_1h:mm", "total_cloud_cover:p", "wind_speed_10m:ms"],
      "cache": {
        "entries": 0,
        "fresh_entries": 0,
        "stale_entries": 0,
        "max_entries": 128,
        "ttl_seconds": 900,
        "newest_age_seconds": null,
        "oldest_age_seconds": null,
        "hits": 0,
        "misses": 0,
        "stale_hits": 0
      },
      "rate_limit": {
        "per_visitor_max_requests": 30,
        "per_visitor_window_seconds": 300,
        "global_max_requests": 300,
        "global_window_seconds": 3600,
        "tracked_visitors": 0,
        "trusted_proxy_hops": 0
      },
      "telemetry": {
        "last_status": "idle",
        "last_success_at": null,
        "last_error_at": null,
        "last_error_code": null,
        "consecutive_failures": 0
      }
    },
    "ai_explanations": {
      "status": "fallback_only",
      "configured": false,
      "key_present": false,
      "model": null,
      "model_configured": false,
      "web_search_enabled": true,
      "web_search_tool": "web_search",
      "search_context_size": "low",
      "max_tool_calls": 3,
      "max_output_tokens": 1400,
      "allowed_domains_count": 30,
      "search_filter_domains_count": 20,
      "fallback_available": true,
      "fallback_source": "curated_literature_rules (reasons.py)",
      "rate_limit_max_requests": 15,
      "rate_limit_window_seconds": 300,
      "entries": 0,
      "fresh_entries": 0,
      "stale_entries": 0,
      "max_entries": 500,
      "ttl_seconds": 86400,
      "newest_age_seconds": null,
      "oldest_age_seconds": null,
      "hits": 0,
      "misses": 0,
      "stale_hits": 0,
      "last_status": "idle",
      "last_success_at": null,
      "last_error_at": null,
      "last_error_code": null,
      "consecutive_failures": 0
    },
    "news": {
      "status": "available",
      "configured": true,
      "provider": "gdelt",
      "stale_available": false,
      "timeout_seconds": 12.0,
      "entries": 0,
      "fresh_entries": 0,
      "stale_entries": 0,
      "max_entries": 120,
      "ttl_seconds": 900,
      "newest_age_seconds": null,
      "oldest_age_seconds": null,
      "hits": 0,
      "misses": 0,
      "stale_hits": 0,
      "last_status": "idle",
      "last_success_at": null,
      "last_error_at": null,
      "last_error_code": null,
      "consecutive_failures": 0
    },
    "monthly_forecast": {
      "status": "available",
      "configured": true,
      "supported_variables": ["T2M", "PRECTOTCORR", "CLOUD_AMT"],
      "max_horizon_months": 3,
      "max_grid_side": 3,
      "baseline_model": "seasonal_naive"
    }
  }
}
```


---

## 7. `GET /api/live-weather`

Meteomatics operational weather for **one location**: current conditions and an hourly forecast for the next 1 to 72 hours. It complements NASA POWER and is **never** averaged with it, never part of a trend, and never labelled as NASA data or as the app's own monthly forecast. All network access is server-side; the credentials (`METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD`) are never sent to, or visible in, the browser.

### Query Parameters

| Parameter | Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `lat` | `float` | `-90.0 <= lat <= 90.0` | *(required)* | Latitude (rounded to 4 decimals) |
| `lon` | `float` | `-180.0 <= lon <= 180.0` | *(required)* | Longitude (rounded to 4 decimals) |
| `hours` | `int` | `1 <= hours <= 72` | `24` | Forecast horizon in hours. Out-of-range values return `HTTP 422`. |

The series starts at the current UTC hour and is hourly (`PT1H`). Results are cached for 15 minutes per place (coordinates rounded to 0.01°) and horizon, but a cached reply is only fresh within the UTC hour it started in: after the hour turns it is refreshed, and any stale copy served is trimmed so `series[0]`, `current` and `request.start` are the current hour. `location` is always the caller's own rounded coordinates.

**Quota protection (Phase 0, item B):** requests that would reach Meteomatics (cache misses) are limited per visitor (default 30 per 5 minutes, `METEOMATICS_RATE_LIMIT_MAX` / `METEOMATICS_RATE_LIMIT_WINDOW_SECONDS`) and for the whole server (default 300 per hour, `METEOMATICS_GLOBAL_RATE_LIMIT_MAX` / `METEOMATICS_GLOBAL_RATE_LIMIT_WINDOW_SECONDS`). Cache hits are never counted. The visitor is identified as for `/api/explanations` (socket peer, or the trusted `X-Forwarded-For` entry when `TD_TRUSTED_PROXY_HOPS` is set). Provider replies are streamed and refused as soon as they pass 512 KB.

`retry_after_seconds` is present on every response: an integer for `"rate_limited"` (and for a `"stale"` reply served because of a limit, or when Meteomatics sent `Retry-After`), otherwise `null`.

### `status` values (always `HTTP 200` when the query itself is valid)

| `status` | `available` | `stale` | Meaning for the UI |
| --- | --- | --- | --- |
| `"available"` | `true` | `false` | Fresh, validated data in `series` and `current`. |
| `"stale"` | `true` | `true` | The refresh failed; the last good result is shown. Display `fetched_at` and `reason`. |
| `"unconfigured"` | `false` | `false` | The server has no Meteomatics credentials. Hide or disable the live-weather panel and show `reason`. This is the normal state on a fresh local install. |
| `"unavailable"` | `false` | `false` | Provider failure (authentication, rate limit or quota, timeout, bad range, malformed reply, or a server misconfiguration such as an invalid `METEOMATICS_BASE_URL`) and no cached result. Show `reason`; it never contains a credential or an upstream error body. |
| `"rate_limited"` | `false` | `false` | This visitor (or the whole server) used its live-weather allowance and no cached reply exists for this place. Meteomatics was not called. Show `reason` and try again after `retry_after_seconds`. When a cached reply exists it is served instead, as `"stale"`. |

### Example Response — Unconfigured (`HTTP 200`)

```json
{
  "available": false,
  "status": "unconfigured",
  "provider": "Meteomatics",
  "label": "Meteomatics weather forecast — not NASA trend data",
  "location": { "lat": 52.52, "lon": 13.46 },
  "request": { "hours": 6, "interval": "PT1H", "start": "2026-11-15T14:00:00Z", "end": "2026-11-15T20:00:00Z" },
  "parameters": {
    "temperature_c": "t_2m:C",
    "precipitation_1h_mm": "precip_1h:mm",
    "cloud_cover_percent": "total_cloud_cover:p",
    "wind_speed_10m_ms": "wind_speed_10m:ms"
  },
  "parameter_details": {
    "temperature_c": { "parameter": "t_2m:C", "label": "Air temperature (2 m)", "unit": "°C" },
    "precipitation_1h_mm": { "parameter": "precip_1h:mm", "label": "Hourly precipitation", "unit": "mm" },
    "cloud_cover_percent": { "parameter": "total_cloud_cover:p", "label": "Total cloud cover", "unit": "%" },
    "wind_speed_10m_ms": { "parameter": "wind_speed_10m:ms", "label": "10 m wind speed", "unit": "m/s" }
  },
  "current": null,
  "series": [],
  "fetched_at": "2026-11-15T14:09:53Z",
  "stale": false,
  "reason": "Live weather is unavailable because METEOMATICS_USERNAME and METEOMATICS_PASSWORD are not configured on the server.",
  "retry_after_seconds": null,
  "source_note": "Meteomatics operational weather data. It is separate from NASA POWER climate-trend analysis.",
  "provider_metadata": {}
}
```

### Example Response — Available (shape; values are placeholders)

When data are available `available` is `true`, `status` is `"available"`, `reason` is `null`, `current` is the first element of `series`, and `series` holds one object per hour. A value Meteomatics did not supply is `null`: it is never invented or interpolated.

```json
{
  "available": true,
  "status": "available",
  "series": [
    {
      "time": "2026-11-15T14:00:00Z",
      "temperature_c": 0.0,
      "precipitation_1h_mm": 0.0,
      "cloud_cover_percent": 0.0,
      "wind_speed_10m_ms": null
    }
  ],
  "current": { "time": "2026-11-15T14:00:00Z", "temperature_c": 0.0, "precipitation_1h_mm": 0.0, "cloud_cover_percent": 0.0, "wind_speed_10m_ms": null },
  "stale": false,
  "reason": null,
  "retry_after_seconds": null
}
```

(The remaining fields — `provider`, `label`, `location`, `request`, `parameters`, `parameter_details`, `fetched_at`, `source_note`, `provider_metadata` — are the same as in the unconfigured example.)

---

## 8. Phase 0 repair changes (2026-11-15)

Summary of every API-visible change from the Phase 0 backend repair (full list with tests: `docs/V2_BACKEND_REPAIR_HANDOFF.md`). All are additive or tighten an existing promise; the only removed field is `/api/version` `root` (see its row).

| Route | Change |
| --- | --- |
| all GET routes with year defaults | `end_year` (and `/api/monthly-frames` `start_year`) defaults are computed from today's date per request. |
| `/api/trend`, `/api/sweep`, `/api/grid`, `/api/world`, `/api/ledger`, `/api/vitals` | `significant` is `false` when Sen's slope is 0; `significant_fdr` requires `significant`; emergence p-values are autocorrelation-adjusted and `emergence.year` / `emergence_year` is `null` unless the headline is significant (Agent 0B; see `docs/STATS_AUDIT.md`). |
| `/api/grid`, `/api/monthly-frames`, `/api/monthly-forecast` | Grid longitudes wrap into [-180, 180) (180 is returned as -180); near a pole the grid window shifts inside ±89.75 instead of repeating rows, so it is not centred on the requested latitude there (Agent 0B). |
| `/api/forecast` | `coverage` gains `model` and `calibration_end_year`; `coverage.test` is truly out of sample; each replay gains `band_basis: "in_sample"`; new top-level `replay_note` (Agent 0B). |
| `/api/suspects` | `enso_adjusted.enso_share` is a partial R²; the adjusted slope and its interval shift slightly (Agent 0B). |
| `/api/archetypes` | `k` is the number of clusters actually returned; new `requested_k` (the requested `k`, or `null`) (Agent 0C). |
| `/api/monthly-forecast` | New `alignment` object; calibration has one schema with new `n_test_pairs` (`n_test_origins` now counts origins); new defensive `reason_code` `"misaligned_cells"`; a withheld response's `models` / `calibration` / `training_range` describe the failing cell. |
| `/api/explanations` | New `retry_after_seconds` on every response; `status: "no_key"` also covers a missing model (`fallback_reason: "missing_model"`); `measured_facts` uses significant digits; citations deduplicated and limited to returned drivers; live calls use the `web_search` tool with `filters.allowed_domains`. |
| `/api/news` | Every item has `publisher_verified` (boolean, next to `publisher`): `true` only when the canonical URL's host is, or is a subdomain of, a domain in `news.VERIFIED_PUBLISHER_DOMAINS` (wire services, public broadcasters, major newsrooms, science journals, science agencies); the provider's publisher name is never trusted. Show `false` items as "Unverified news context". URLs keep a non-default port and bracketed IPv6 host; default ports are dropped; non-global IP hosts are rejected; `_hsenc` is stripped. Relevance accepts inflections ("flooding", "flooded", "evacuated") and bare "storm(s)"; "evacuating" / "evacuee" are red keywords (Agent 0C). |
| `/api/version` | (Integration, after Phase 0; the one removal.) `root`, the server's absolute folder path, is no longer returned because on a laptop it contains the user name. It is replaced by `root_id`, a 16-hex-character one-way fingerprint of the folder (SHA-256 of the lower-cased path without a trailing slash) that the launcher (`app-common.ps1` `Get-FolderId`) compares with its own folder. The page never read `root`. Fields now: `app`, `version`, `branch`, `dirty`, `root_id`, `started_epoch`. |
| `/api/live-weather` | New `status: "rate_limited"`; new `retry_after_seconds`; hour-aligned cache; caller's own `location`; invalid base URL is `"unavailable"`, not HTTP 500. |
| `/api/health/details` | `ai_explanations` gains `key_present`, `model_configured`, `web_search_tool`, `search_context_size`, `max_tool_calls`, `max_output_tokens`, `search_filter_domains_count`, and `model` is `null` until the owner sets one; `meteomatics` gains `rate_limit`; `nasa_power` gains `max_concurrency_scope: "process"`; `planet_streams` now records real success/failure (`http_error`, `network_error`, `empty_data`), honours `STREAMS_CACHE_TTL_SECONDS` and serves stale series when a refresh fails (Agent 0C). |
