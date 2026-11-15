# V3 "Quiet Earth" final handoff (branch v3-quiet-earth)

Nothing is committed beyond 57df145. Per the owner, test suites were NOT re-run in the final pass; `npm run build` (frontend) passes.

## What changed, per agent
- Backend: drift check only, no code change (342 tests passed at that time).
- Audit: docs/V3_AUDIT_REPORT.md.
- Design: tokens, Logo, docs/V3_QUIET_EARTH_VISUAL_SPEC.md.
- Shell: first-run welcome globe, rail, top bar, pin history/undo, saved pins, scan-active indicator, VISHWA credit.
- Charts: shared ChartViewer (expand, log/linear, units, range, export) and chart components.
- Globe: Earth rendering, rotation, coarse preview (public/coarse), timeline rail, news callouts, GlobeLegend, lib/globeDots.js, saved-pin rendering.
- Insight: Explore groups + ExploreTabs, split view (`also`), Ask tab, Ledger, Term/glossary, Explainer, Scan chips, World legend, Saved tab, verdict cards.
- Integration: App.jsx wiring (ExploreTabs, exploreAlso in route/history, open(id) for Duel+Scan together, ExplorePanel props setup/ask/saved, GlobeLegend/WorldLegend, archetype glyph legend, welcome globe controls off). SetupPanel is now an "Adjust" disclosure inside ExplorePanel.

## Owner PDF items 1-13
| # | Item | Status |
|---|------|--------|
| 1 | Plain-words World legend / baseline | Done (WorldLegend + Term) |
| 2 | Free-text question decides place/variable; Adjust disclosure | Done |
| 3 | Ask as its own tab | Done |
| 4 | Ledger units, "correction" defined, arrow meaning | Done |
| 5 | Ledger chips as filters | Done |
| 6 | Scan cell style matches chips; legend lists styles | Done (GlobeLegend scanStyles) |
| 7 | Expandable charts, log axis, units, export | Done (ChartViewer) |
| 8 | Terms explained on hover/click | Done |
| 9 | Pin undo | Done |
| 10 | Save pin with scan, colour, globe + Saved tab | Done |
| 11 | Explainer resizable, scrolls, chips less intrusive | Done |
| 12 | Scan-active indicator | Done |
| 13 | Duel + Scan combos, grouped tabs | Done |

## Credit
VISHWA = Validated Insights on Significant Hydro-climate and Weather Anomalies (vishwa.earth), credited in the shell footer.

## Not done / unverified
- No test suites re-run after the final wiring (owner request); only the production build was checked.
- Browser checks are partial: welcome Earth, coarse preview and drag-resume were verified; split view (Duel+Scan), Ask tab, Saved tab, local-cell and news callouts were not browser-verified. The running :8000 backend returned 404 for /api/monthly-frames and /api/news (old process).
- News detail opens in the shell drawer (MainStage default); not a separate focus panel.
- Bundle is ~698 kB (chunk-size warning only).

## Owner-only steps
1. Choose `OPENAI_EXPLANATION_MODEL`.
2. Run real OpenAI and Meteomatics smoke tests with live keys.
3. Set `TD_TRUSTED_PROXY_HOPS` on Azure.
4. Restart local servers with STOP.bat then START.bat so :8000 serves the new endpoints.
