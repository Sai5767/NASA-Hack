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
