# Statistics audit

Cross-checks the hand-written statistics in `backend/app/stats.py` against reference implementations and measures false-alarm
rates by simulation. Results and conclusions are in `docs/STATS_AUDIT.md`.

These scripts need libraries the app itself does not use, so install them in a throwaway environment, never in `backend/.venv`:

```bash
python -m venv audit-env
audit-env\Scripts\activate
pip install -r tools\stats_audit\requirements.txt   # numpy, scipy, pymannkendall, pyhomogeneity
python tools\stats_audit\audit_stats.py
python tools\stats_audit\calibration_variants.py
```

- `audit_stats.py`: distributions, Mann-Kendall, Sen slope and interval, regression, Benjamini-Hochberg, correlation, Pettitt,
  then false-alarm and power rates for the shipped method.
- `calibration_variants.py`: compares candidate serial-correlation adjustments (A = the old gated method, C = the shipped
  bias-corrected method). It was used to choose the method.
