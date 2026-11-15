# Statistics audit

**Question:** is the significance logic correct? **Answer:** the core tests were already exact; the audit found and fixed three
real issues (one cosmetic, two that affected p-values). Everything below is reproducible with `tools/stats_audit/`.

## What was checked, and against what

Every statistic in `backend/app/stats.py` was compared with an independent reference implementation on hundreds of random
series (including heavy ties and short records). The reference libraries live only in a throwaway environment; the app itself
still has no SciPy.

| Statistic | Reference | Worst difference |
| --- | --- | --- |
| Student-t p-values and critical values | `scipy.stats.t` | 7e-14 (relative) |
| Normal p-values | `scipy.stats.norm` | 1e-14 |
| Mann-Kendall S, z, p (tie-corrected, continuity-corrected) | `pymannkendall` | identical |
| Sen's slope | `pymannkendall` | identical |
| Sen's 95% interval | rank rule of the R `trend` package (Gilbert 1987) | identical **after fix 1** |
| Regression slope, standard error, p, interval, R-squared | `scipy.stats.linregress` | 6e-15 |
| Benjamini-Hochberg decisions | `scipy.stats.false_discovery_control` | 0 mismatches in 300 runs |
| Correlation p-value | `scipy.stats.pearsonr` | 3e-14 |
| Pettitt change point and p-value | `pyhomogeneity` and the published formula | identical (we cap p at 1; the package does not) |

Fixed reference numbers from these libraries are now unit tests: `backend/tests/test_stats_reference.py`.

## The three corrections

1. **Sen's interval, lower limit (small).** The lower end used the wrong rank: one place too high. The standard rule takes the
   M1-th and (M2+1)-th smallest pairwise slopes. The old code matched the upper end and was off by one on the lower end in 233 of
   400 test series (the interval was slightly too narrow on that side). Now identical to the reference.
2. **Serial correlation adjustment (the important one).** Climate years resemble their neighbours, which makes chance trends
   look convincing. The old rule inflated the variance only when lag-1 autocorrelation was itself significant, and used the raw
   estimate, which is biased low in short records (about `(2 + 4*phi) / n`). Simulation showed it still rejected true
   no-trend series 9-12% of the time at a nominal 5%. The shipped method undoes the bias and applies the
   `(1 + phi) / (1 - phi)` inflation whenever phi is positive. It also uses the effective degrees of freedom in the regression
   t-test. The notice shown to the user ("p-value widened") now appears only when the inflation is material (factor 1.2 or more).
3. **Duel test (small).** Used a normal approximation. It is now Welch's t-test with each slope's own degrees of freedom
   (still treating the two places as independent, which the text says; nearby places share weather, so the test errs cautious).

### False-alarm and detection rates (n = 44 years, 1,500 simulated series per row, nominal 5%)

| Scenario | Unadjusted | **Old method** | **New method** |
| --- | --- | --- | --- |
| No trend, independent years | 4.7% | 5.2% | **3.8%** |
| No trend, persistence phi = 0.3 | 14.5% | 10.8% | **5.3%** |
| No trend, persistence phi = 0.5 | 22.3% | 9.4% | **4.7%** |
| No trend, persistence phi = 0.7 | 38.5% | 11.0% | **6.6%** |
| Real trend (0.03 sd/yr), independent | 66% | 66% | 61% |
| Real trend (0.03 sd/yr), phi = 0.5 | 61% | 43% (but with 9% false alarms) | 26% |

The honest trade-off: with strongly persistent years the corrected test is more cautious, so it detects fewer real but modest
trends. That is the correct behaviour when a few decades of data carry less independent information than their length suggests.
The unadjusted p-value is still shown beside it.

## Backend review fixes (2026-11-15)

A second review (`backend-review/BACKEND_REVIEW.md`) found six more defects. Each has a test that fails on the old code and
passes now. **No existing reference value changed:** `test_stats_reference.py` and every earlier test pass unchanged, and
p-values, slopes and intervals are untouched for every series that has a non-zero Sen slope and ordinary units.

| ID | Defect (reproduced) | Rule now | Tests |
| --- | --- | --- | --- |
| B1 | With heavy ties (zero-snowfall or zero-rain years) Mann-Kendall gave p = 0.011 while Sen's slope and its interval were exactly 0. The result said `significant: true` but `direction: "no significant trend"`, `sign: "flat"`; the "mk" check passed, grade "weak", verdict "some evidence", summary "no significant trend". | **A trend is significant only if p < 0.05 *and* Sen's slope is not 0** (`stats.mann_kendall`). The p-value is reported unchanged; the summary and the "mk" check detail say why it did not count. Because the rule sits at the source, direction, sign, checks, grade, verdict, emergence, trimmed versions and every consumer of `stats.significant` agree. The 12 calendar months use the same rule after Benjamini-Hochberg, and the trend ledger counts a row as surviving correction only when its BH flag *and* `significant` are true. | `test_stats.py::test_heavy_ties_with_zero_sen_slope_are_not_significant`, `test_analysis.py::test_zero_sen_slope_with_low_p_gives_one_consistent_no_trend_answer`, `test_ledger.py::test_a_flat_row_never_survives_correction_even_with_a_tiny_p` |
| B2 | The emergence year used the naive Mann-Kendall p (no serial-correlation adjustment): for persistent series (phi = 0.7) the case file said "emerged in 2015" while the headline p was 0.10. | Each prefix is tested with the full `mann_kendall` (adjusted p, same zero-slope rule). The last point equals the headline test, so an emergence year exists only when the headline trend is significant. Each series entry now also carries `significant`. | `test_analysis.py::test_no_emergence_year_when_the_adjusted_headline_is_not_significant`, `::test_emergence_year_is_the_start_of_the_final_significant_run` |
| B3 | Forecast lab: the model was picked by error over all backtest origins, including the "held-out" ones its coverage was then scored on, and the calibration rows could have targets inside the test period. | The coverage check re-runs the whole procedure as of the calibration year `cut`: the model is chosen, and the band calibrated, only on backtest rows whose target year is at or before `cut`; coverage is scored on later origins. The model chosen this way is reported (`coverage.model`, `coverage.calibration_end_year`); the overall winner and its forecast are unchanged. Replay bands are today's band and are labelled `band_basis: "in_sample"` with a `replay_note`. | `test_forecast.py::test_coverage_model_and_calibration_ignore_the_test_period`, `::test_coverage_model_is_the_lowest_error_model_on_rows_known_by_the_cut`, `::test_replay_bands_are_labelled_in_sample` |
| B6 | The ENSO-adjusted trend regressed the trending local values on raw ONI, so drift that ONI shares with time was credited to ENSO (coefficient 0.046 instead of 0.027 in the repro). | Partial regression: the ENSO coefficient comes from the linearly detrended pair, which equals the ONI coefficient of `y ~ a + c*t + b*ONI` (Frisch-Waugh-Lovell). `enso_share` is the share of the detrended variance ONI explains. | `test_context.py::test_enso_adjustment_does_not_credit_shared_drift_to_enso`, `::test_enso_adjustment_matches_the_three_term_regression` |
| B10 | The OLS "perfect line" test had an absolute floor (`1e-24 * max(syy, 1)`), so noisy data around 1e-14 got se = 0 and p = 0; the same data times 1e14 gave p = 0.017. | Relative tests only: a perfect line is `sse <= 1e-24 * syy`, and a series whose spread is only rounding error (`syy <= 1e-28 * sum(y^2)`) is constant (slope 0, p = 1). | `test_stats.py::test_ols_p_value_does_not_depend_on_the_scale_of_the_data`, `::test_ols_on_a_constant_series_finds_no_trend_and_a_perfect_line_still_has_p_zero` |
| A6 | `grid_points` clamped: near a pole several rows collapsed onto 90° (25 points, 20 distinct), and longitudes past 180 stuck at 180. Duplicates were counted twice in BH, the composite, and Moran's I. | Longitude wraps to [-180, 180). Near a pole the latitude window is shifted (spacing and row count kept) to fit inside ±89.75°, half a POWER cell short of the pole, where every longitude is the same point. Every cell is distinct; the grid is then not centred on the requested latitude. | `test_grid.py::test_grid_near_a_pole_shifts_instead_of_duplicating_rows`, `::test_grid_wraps_across_the_antimeridian`, `::test_grid_row_major_order_is_south_to_north_west_to_east` |

## Conventions that look like differences but are not errors

- **Sen intercept.** `pymannkendall` uses `median(y) - slope * median(t)`; this project uses `median(y - slope * (t - t0))`, so
  half the residuals are above the line. Both are accepted conventions; it only moves the drawn line, not the slope or p-value.
- **Evidence grade.** Strong / moderate / weak / none is a documented rule of thumb over five visible checks, not a hypothesis test.

## Known limits (stated, not hidden)

- A single place is tested for one chosen variable and period; choosing the variable or the start year after looking at the
  data inflates false alarms. Sweep, Scan, World, months and the three climate rhythms are corrected with Benjamini-Hochberg,
  which stays valid when tests are positively dependent (nearby places are).
- The Duel and the regional composite treat places as independent; spatial correlation makes them cautious, not liberal.
- NASA POWER is reanalysis (a model constrained by observations), not raw measurement, and some inputs change over time.
- Moran's I (permutation test) is covered by synthetic-pattern tests, but was not cross-checked against an external library.
- Smooth, curving records are treated as persistent noise. Atmospheric CO2 has a signal 32 times its normal year-to-year swing
  yet gets p = 0.001, because the residuals about a straight line are strongly autocorrelated (the curve), so the variance is
  inflated to the cap. That is cautious, not wrong, but it makes p-value order a poor guide to strength of change. The trend
  ledger therefore also orders by signal vs noise and by percent change.
- Lag-1 persistence is a one-parameter summary; longer memory (for example decadal ocean cycles) is only partly captured.
