# Trend Detective V2 — data and resource registry

This registry records all sources already used by the app and the additional resources supplied by the team. Listing a source is not a claim that it is integrated. Any future integration needs: an approved access method, automated tests with saved fixture data, licence/terms review, source attribution in the UI, variable/time/space provenance, and a failure fallback.

## Shipped analysis sources

| Source | Current role | V2 decision |
| --- | --- | --- |
| [NASA POWER](https://power.larc.nasa.gov/) | Primary keyless monthly point series for 19 variables, including MERRA-2 reanalysis and satellite-based radiation inputs | Keep as the V2 trend and monthly-forecast source. Cite variable provenance and model-derived limits. |
| [NASA GISS GISTEMP](https://data.giss.nasa.gov/gistemp/) | Global and zonal temperature cross-check | Keep for planet vitals and independent temperature context. |
| [NOAA Global Monitoring Laboratory](https://gml.noaa.gov/ccgg/trends/) | Atmospheric CO₂ | Keep for planet vital. |
| [NSIDC Sea Ice Index](https://nsidc.org/data/seaice_index) | Arctic and Antarctic sea ice extent | Keep for planet vitals. |
| [NOAA CPC / NCEI](https://www.cpc.ncep.noaa.gov/), [NCEI](https://www.ncei.noaa.gov/) | ENSO, PDO, NAO status and climate-rhythm analysis | Keep. These explain co-movement, not causal certainty. |
| [Meteomatics Weather API](https://www.meteomatics.com/en/api/getting-started/) | Global historic, current and forecast weather service; the supplied `t_2m:C` Berlin URL is a 2-metre temperature example | Integrate only through a server-side adapter using account credentials. Use for live weather/current and short-range temperature, precipitation and cloud-cover layers; keep distinct from NASA climate trends and internal monthly forecasts. |

## NASA data resources supplied by the team

| Resource | What it is | V2 status / constraints |
| --- | --- | --- |
| [Giovanni](https://giovanni.gsfc.nasa.gov/) | NASA GES DISC visual analysis/download portal for many variables and time series | Link from data-source/help UI and use to validate exploration. Do not describe it as an independent V2 data API unless a supported, tested programmatic access path is selected. |
| [Hydrology Time Series](https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series) | GES DISC hydrology time-series tool | Reference/resource link. Investigate only if a stable supported export/API is confirmed; current product must not depend on browser-automation of the tool. |
| [AppEEARS](https://appeears.earthdatacloud.nasa.gov/) | NASA LP DAAC service for area/point geospatial data transformation and time series | Candidate for a later, asynchronous adapter. It requires Earthdata authentication and job polling, so it is not a V2 critical path. Use only server-side credentials and never expose an Earthdata token to the browser. |
| [Climate Data Online](https://www.ncei.noaa.gov/cdo-web/) | NOAA/NCEI historical weather and climate archive and station metadata | Optional independent station comparison, not an average with gridded NASA POWER. Compare like-for-like scale, units and coverage first. |
| [SeaWiFS coastal chlorophyll time-series paper](https://ntrs.nasa.gov/api/citations/20090042747/downloads/20090042747.pdf) | Research example of remotely sensed time series and significance testing | Methodology/reference reading; it is not a live data API. |

## Partner resources supplied by the team

| Resource | What it is | V2 status / constraints |
| --- | --- | --- |
| [KNMI Climate Explorer](https://climexp.knmi.nl/) | Climate-data analysis and visualisation service | Reference/comparison link. Do not scrape it or use it as an undisclosed duplicate source. |
| [Trend-test methods article](https://medium.com/@snp.kriss/statistical-test-methods-to-detect-trends-in-time-series-data-b361a0ec530b) | General educational overview | Optional further-reading link only; current implementation is validated against scientific reference libraries, not a blog post. |
| [Statistical significance guide](https://www.statsig.com/perspectives/a-comprehensive-guide-to-statistical-significance) | General educational overview | Optional plain-language reading only. It must not replace the project’s statistics audit or source-specific caveats. |
| [Canadian Space Agency RCM data](https://donnees-data.asc-csa.gc.ca/en/dataset/rcm) | RADARSAT Constellation Mission SAR data catalogue | Candidate for a future specialised raster/SAR workflow. Not appropriate for a quick monthly-point V2 addition without a data-processing design. |
| [Geo.ca](https://geo.ca/) | Canadian open geospatial data catalogue | Optional Canada-focused context/reference source; requires per-dataset licence/access review. |
| [CSA SWOT information](https://www.asc-csa.gc.ca/eng/satellites/swot/) | Mission information about surface-water elevation | Education/reference link. A data implementation would need the NASA/CNES/partner product route, chosen variable, spatial method and authentication plan. |
| [CSA ecosystem monitoring overview](https://www.asc-csa.gc.ca/eng/satellites/everyday-lives/monitoring-and-protecting-our-ecosystems-from-space.asp) | Educational overview | Inspiration/reference only, not a data endpoint. |
| [CSA SAR Python tutorial](https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial) | Example SAR learning material | Developer reference only. Do not add its packages or copy imagery without a deliberately scoped SAR feature. |

## Source-combination policy

The V2 baseline does not average overlapping products. A numerical average is valid only when the products measure the same quantity on compatible temporal/spatial scales, units and datum; their uncertainty/bias treatment is documented; and the combined result is clearly labelled. Otherwise, show the primary series with an independent comparison or validation panel.

This rule is especially important for Meteomatics and NASA POWER: Meteomatics’s current/short-range operational weather values and NASA POWER’s monthly climate/reanalysis series answer different questions. Show both only in their respective source-labelled panels; do not calculate an average or imply that they are the same observation.

## Provenance requirements in the interface

Every chart, timeline and map layer must be able to show:

- source/product name and a source link;
- variable definition and units;
- observation versus model/reanalysis versus forecast state;
- spatial and temporal resolution;
- requested/available date range;
- latest successful fetch time and whether the display is stale; and
- a caveat appropriate to the product.
