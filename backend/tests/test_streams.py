"""Parsers use samples copied from the real files (formats verified against the live services)."""

import asyncio

import pytest

from app import streams

GISTEMP_GLOBAL = """Land-Ocean: Global Means
Year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D,D-N,DJF,MAM,JJA,SON
1880,-.19,-.25,-.10,-.17,-.10,-.21,-.19,-.11,-.15,-.23,-.22,-.18,-.18,***,***,-.12,-.17,-.20
2026,1.08,1.23,1.30,1.16,1.13,1.18,1.24,1.42,1.39,1.55,***,***,***,***,1.12,1.20,1.28,***
"""

GISTEMP_ZONAL = """Year,Glob,NHem,SHem,24N-90N,24S-24N,90S-24S,64N-90N,44N-64N,24N-44N,EQU-24N,24S-EQU,44S-24S,64S-44S,90S-64S
2024,1.28,1.65,.92,1.95,1.19,.74,2.88,1.95,1.65,1.21,1.17,.88,.54,.71
2025,1.19,1.47,.90,1.89,.86,.92,2.93,1.94,1.53,.85,.86,.96,.55,***
"""

CO2 = """# --------------------------------------------------------------------
# USE OF NOAA GML DATA
#
year,month,decimal date,average,deseasonalized,ndays,sdev,unc
1958,3,1958.2027,315.71,314.44,-1,-9.99,-0.99
1958,5,1958.3699,-99.99,317.69,-1,-9.99,-0.99
2026,9,2026.7083,426.07,429.55,18,0.51,0.23
"""

ONI = """ SEAS  YR   TOTAL   ANOM
  DJF 1950  25.01  -1.32
  NDJ 1950  25.40  -0.50
  ASO 2026  29.23   2.46
"""

PDO = """ ERSST PDO Index:
Year  Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
1854  0.11 -0.24 -0.40 -0.44 -0.54 -0.30 -0.10 -1.24 -1.00 -2.23 -1.68 -1.76
2026 -1.24 -1.00 -1.42 -1.62 -1.68 -1.72 -2.16 -1.88 -1.52 -2.26 99.99 99.99
"""

NAO = """      Jan    Feb    Mar    Apr    May    Jun    Jul    Aug    Sep    Oct    Nov    Dec
1950   0.92   0.40  -0.36   0.73  -0.59  -0.06  -1.26  -0.05   0.25   0.85  -1.26  -1.02
2026  -0.36   0.68   2.69   1.39  -0.74   0.10  -0.31  -1.92   0.53   1.19
"""

NSIDC = """year, mo,source_dataset, region, extent,   area
1979,  9,    NSIDC-0051,      N,   7.05,   4.58
1987, 12,    NSIDC-0051,      N, -9999, -9999
"""


def test_gistemp_global_handles_missing_markers():
    series = streams.parse_gistemp_global(GISTEMP_GLOBAL)
    assert series["188001"] == -0.19
    assert series["202610"] == 1.55
    assert series["202611"] is None  # "***" is a missing value, not zero
    assert len(series) == 24  # only the 12 monthly columns, not the annual or seasonal means


def test_gistemp_zonal_returns_bands():
    bands = streams.parse_gistemp_zonal(GISTEMP_ZONAL)
    assert bands["44N-64N"] == {2024: 1.95, 2025: 1.94}
    assert 2025 not in bands["90S-64S"]  # "***" dropped
    assert set(streams.zonal_band_for(lat) for lat in (-80, -50, -30, -10, 10, 30, 50, 80)) == {name for _, _, name in streams.ZONAL_BANDS}


def test_zonal_band_edges():
    assert streams.zonal_band_for(42) == "24N-44N"
    assert streams.zonal_band_for(44) == "44N-64N"
    assert streams.zonal_band_for(0) == "EQU-24N"
    assert streams.zonal_band_for(-0.5) == "24S-EQU"
    assert streams.zonal_band_for(90) == "64N-90N"
    assert streams.zonal_band_for(-90) == "90S-64S"
    with pytest.raises(ValueError):
        streams.zonal_band_for(91)


def test_co2_skips_comments_and_missing_sentinel():
    series = streams.parse_co2(CO2)
    assert series == {"195803": 315.71, "195805": None, "202609": 426.07}


def test_oni_seasons_land_on_their_center_month():
    series = streams.parse_oni(ONI)
    assert series["195001"] == -1.32   # DJF 1950 is centered on January
    assert series["195012"] == -0.50   # NDJ 1950 is centered on December
    assert series["202609"] == 2.46    # ASO is centered on September


def test_pdo_and_nao_tables():
    pdo = streams.parse_pdo(PDO)
    assert pdo["185401"] == 0.11 and pdo["185412"] == -1.76
    assert pdo["202611"] is None and pdo["202612"] is None  # 99.99 is missing
    nao = streams.parse_nao(NAO)
    assert nao["195001"] == 0.92
    assert "202611" not in nao  # an incomplete current-year row only yields the months it has


def test_nsidc_month_file():
    series = streams.parse_nsidc_month(NSIDC)
    assert series == {"197909": 7.05, "198712": None}


def test_stream_metadata_is_complete_enough_for_the_analysis_engine():
    for stream_id, info in streams.STREAMS.items():
        assert {"label", "units", "group", "ratio", "land_only", "description", "source", "kind"} <= set(info), stream_id
    assert {i["kind"] for i in streams.STREAMS.values()} == {"trend", "rhythm"}


# ---- fetching and caching (network replaced) -------------------------------------------------


@pytest.fixture
def fresh_caches(monkeypatch):
    monkeypatch.setattr(streams, "_text_cache", {})
    monkeypatch.setattr(streams, "_series_cache", {})


def test_get_monthly_parses_and_caches(monkeypatch, fresh_caches):
    calls = []

    async def fake_fetch(url):
        calls.append(url)
        return CO2

    monkeypatch.setattr(streams, "fetch_text", fake_fetch)
    first = asyncio.run(streams.get_monthly("co2_mlo"))
    second = asyncio.run(streams.get_monthly("co2_mlo"))
    assert first == second and first["202609"] == 426.07
    assert len(calls) == 1  # second call came from the cache


def test_sea_ice_combines_twelve_monthly_files_and_falls_back_to_older_version(monkeypatch, fresh_caches):
    seen = []

    async def fake_fetch(url):
        seen.append(url)
        if "v4.0" in url:
            raise streams.StreamError("not found")
        month = int(url.split("_")[-3])
        return f"year, mo,source_dataset, region, extent, area\n1990, {month}, X, N, {month}.5, 3.0\n"

    monkeypatch.setattr(streams, "fetch_text", fake_fetch)
    series = asyncio.run(streams.get_monthly("arctic_ice"))
    assert len(series) == 12
    assert series["199009"] == 9.5
    assert any("v3.0" in u for u in seen)


def test_empty_file_is_an_error(monkeypatch, fresh_caches):
    async def fake_fetch(url):
        return "# nothing useful here\n"

    monkeypatch.setattr(streams, "fetch_text", fake_fetch)
    with pytest.raises(streams.StreamError):
        asyncio.run(streams.get_monthly("co2_mlo"))


def test_unknown_stream_raises_key_error():
    with pytest.raises(KeyError):
        asyncio.run(streams.get_monthly("nope"))


def test_clip_and_latest_helpers():
    series = {"199912": 1.0, "200001": 2.0, "200002": None, "200003": 4.0, "200101": 5.0}
    assert streams.clip_years(series, 2000, 2000) == {"200001": 2.0, "200002": None, "200003": 4.0}
    assert streams.latest_value(series) == ("200101", 5.0)
    assert streams.latest_value({"200001": None}) is None
