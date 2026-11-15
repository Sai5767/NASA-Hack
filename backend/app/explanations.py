"""Server-only AI-assisted "Why might this be happening?" explanations (V2).

Core guarantees:
  1. Never accepts client-supplied p-values, slopes, source facts, or hidden prompt text (`extra="forbid"`).
  2. Always recomputes/retrieves the trend analysis on the server from NASA POWER before generating an explanation.
  3. Uses OpenAI Responses API only on the backend (`OPENAI_API_KEY`, `OPENAI_EXPLANATION_MODEL`).
  4. Enforces an allow-list of reputable scientific/institutional domains for citations.
  5. Validates structured output on the server and removes any driver that lacks valid citations or valid evidence_type.
  6. Caches verified explanations for 24 hours by `(case_signature, normalized_question)` and rate-limits live requests.
  7. Works without `OPENAI_API_KEY` by falling back cleanly to curated published context from `reasons.py` or an honest
     `no_evidence` state.
"""

from __future__ import annotations

import json
import re
from typing import Callable
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import analysis
from .nasa_power import VARIABLES
from .reasons import DEFAULT as DEFAULT_REASON, reason_for
from .resilience import (
    BoundedTTLCache,
    HEALTH_REGISTRY,
    SlidingWindowRateLimiter,
    UpstreamServiceError,
    load_config,
    make_case_signature,
    parse_case_signature,
    redact_secrets,
    request_with_resilience,
    utc_now_iso,
)

FIXED_DISCLAIMER = "These are possible explanations, not proof that one cause created this local trend."
SUMMARY_PREFIX = "Possible explanations, not proof of cause."

VALID_EVIDENCE_TYPES = {
    "measured_local_trend",
    "physical_mechanism",
    "climate_rhythm_correlation",
    "published_literature",
}

VALID_CONFIDENCE_LEVELS = {"well established", "plausible", "uncertain"}

ALLOWED_SCIENCE_DOMAINS = (
    "nasa.gov",
    "earthdata.nasa.gov",
    "power.larc.nasa.gov",
    "data.giss.nasa.gov",
    "giovanni.gsfc.nasa.gov",
    "disc.gsfc.nasa.gov",
    "noaa.gov",
    "gml.noaa.gov",
    "cpc.ncep.noaa.gov",
    "ncei.noaa.gov",
    "nsidc.org",
    "ipcc.ch",
    "wmo.int",
    "amap.no",
    "globalcarbonproject.org",
    "asc-csa.gc.ca",
    "geo.ca",
    "knmi.nl",
    "nature.com",
    "science.org",
    "pnas.org",
    "ametsoc.org",
    "journals.ametsoc.org",
    "agu.org",
    "wiley.com",
    "onlinelibrary.wiley.com",
    "copernicus.org",
    "iop.org",
    "springer.com",
    "royalsocietypublishing.org",
)



def _collapse_subdomains(domains: tuple[str, ...]) -> list[str]:
    """The allow-list without entries already covered by a parent domain (the web_search filter includes subdomains)."""
    ordered = list(dict.fromkeys(d.strip().lower() for d in domains if d.strip()))
    return [d for d in ordered if not any(d != p and d.endswith("." + p) for p in ordered)]


# Sent to the Responses API web_search tool as filters.allowed_domains, so the search itself can only retrieve from these
# sites (first defence). Server-side citation validation (is_allowed_science_url + provenance) stays the second defence.
WEB_SEARCH_ALLOWED_DOMAINS: list[str] = _collapse_subdomains(ALLOWED_SCIENCE_DOMAINS)

# Canonical URLs for the curated literature sources in `reasons.py`
CURATED_SOURCE_URLS: dict[str, tuple[str, str]] = {
    "IPCC AR6 WG1": ("https://www.ipcc.ch/report/ar6/wg1/", "IPCC Sixth Assessment Report (WG1)"),
    "NASA GISS GISTEMP": ("https://data.giss.nasa.gov/gistemp/", "NASA GISS Surface Temperature Analysis"),
    "NASA POWER": ("https://power.larc.nasa.gov/", "NASA LaRC POWER Project"),
    "NOAA Global Monitoring Laboratory": ("https://gml.noaa.gov/ccgg/trends/", "NOAA GML Carbon Cycle Greenhouse Gases"),
    "Global Carbon Project": ("https://www.globalcarbonproject.org/", "Global Carbon Project"),
    "NSIDC": ("https://nsidc.org/data/seaice_index", "NSIDC Sea Ice Index"),
    "AMAP 2021": ("https://www.amap.no/", "Arctic Monitoring and Assessment Programme (AMAP)"),
    "Rantanen et al. 2022, Communications Earth & Environment": (
        "https://www.nature.com/articles/s43247-022-00498-3",
        "Rantanen et al. (2022), Communications Earth & Environment",
    ),
    "Ramanathan et al. 2005, PNAS": (
        "https://www.pnas.org/doi/10.1073/pnas.0500656102",
        "Ramanathan et al. (2005), PNAS",
    ),
    "Wild 2009, Journal of Geophysical Research": (
        "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2008JD011470",
        "Wild (2009), Journal of Geophysical Research",
    ),
    "Wild et al. 2005, Science": (
        "https://www.science.org/doi/10.1126/science.1103215",
        "Wild et al. (2005), Science",
    ),
    "Fu et al. 2013, PNAS": (
        "https://www.pnas.org/doi/10.1073/pnas.1302584110",
        "Fu et al. (2013), PNAS",
    ),
    "Lovejoy and Nobre 2018, Science Advances": (
        "https://www.science.org/doi/10.1126/sciadv.aat2340",
        "Lovejoy & Nobre (2018), Science Advances",
    ),
    "Giannini et al. 2003, Science": (
        "https://www.science.org/doi/10.1126/science.1089357",
        "Giannini et al. (2003), Science",
    ),
    "Hoerling et al. 2012, Journal of Climate": (
        "https://journals.ametsoc.org/view/journals/clim/25/6/jcli-d-11-00296.1.xml",
        "Hoerling et al. (2012), Journal of Climate",
    ),
    "Vose et al. 2005, Geophysical Research Letters": (
        "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2005GL024379",
        "Vose et al. (2005), Geophysical Research Letters",
    ),
    "Trenberth et al. 2003, Bulletin of the AMS": (
        "https://journals.ametsoc.org/view/journals/bams/84/9/bams-84-9-1205.xml",
        "Trenberth et al. (2003), Bulletin of the AMS",
    ),
    "Simmons et al. 2010, Nature Geoscience": (
        "https://www.nature.com/articles/ngeo793",
        "Simmons et al. (2010), Nature Geoscience",
    ),
    "Byrne and O'Gorman 2018, PNAS": (
        "https://www.pnas.org/doi/10.1073/pnas.1722312115",
        "Byrne & O'Gorman (2018), PNAS",
    ),
    "Vautard et al. 2010, Nature Geoscience": (
        "https://www.nature.com/articles/ngeo979",
        "Vautard et al. (2010), Nature Geoscience",
    ),
    "Zeng et al. 2019, Nature Climate Change": (
        "https://www.nature.com/articles/s41558-019-0622-6",
        "Zeng et al. (2019), Nature Climate Change",
    ),
    "Berg and Sheffield 2018, Current Climate Change Reports": (
        "https://link.springer.com/article/10.1007/s40641-018-0095-0",
        "Berg & Sheffield (2018), Current Climate Change Reports",
    ),
}

_PROMPT_INJECTION_RE = re.compile(
    r"(?i)(ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|"
    r"system\s*prompt|you\s+are\s+now\s+|disregard\s+all|override\s+rules|"
    r"<\s*script|javascript:|data:text/html)"
)

_CAUSAL_OVERCLAIM_RE = re.compile(
    r"(?i)\b(proves?\s+that|definitive\s+proof|100%\s+caused\s+by|certainly\s+caused\s+by|"
    r"sole\s+cause\s+of|guaranteed\s+to\s+cause)\b"
)

_ADVICE_OVERCLAIM_RE = re.compile(
    r"(?i)\b(seek\s+immediate\s+medical|evacuate\s+immediately|medical\s+prescription|"
    r"legal\s+liability\s+advice)\b"
)

EXPLANATION_SYSTEM_PROMPT = """You are the scientific context assistant for Trend Detective (NASA Space Apps Challenge).
Follow these strict rules without exception:
1. POSSIBLE EXPLANATIONS ONLY, NOT CAUSATION: A statistical trend at one location never proves a single cause. Always frame explanations as plausible hypotheses, physical mechanisms, or published scientific context. Start the summary with: "Possible explanations, not proof of cause."
2. SUPPLIED FACTS ARE AUTHORITATIVE: Use only the server-computed statistical facts provided in the prompt (variable, location, period, Sen slope, 95% confidence interval, Mann-Kendall p-value, OLS p-value, evidence grade) plus retrieved cited scientific sources. Never recalculate, alter, or invent numbers.
3. NO INVENTED FACTS OR CITATIONS: Every driver MUST cite at least one valid citation ID from your `citations` list. Every citation URL must come from an official scientific/institutional source (nasa.gov, noaa.gov, ipcc.ch, nsidc.org, nature.com, science.org, pnas.org, ametsoc.org, agu.org, wiley.com, copernicus.org, wmo.int, amap.no). Never fabricate a URL or study.
4. SAY WHEN EVIDENCE CANNOT EXPLAIN THE LOCAL TREND: If published evidence cannot explain the local trend, say so plainly and return an empty `drivers` list.
5. AUDIENCE: Use short, clear, high-school-friendly English.
6. NO MEDICAL, EMERGENCY, OR LEGAL ADVICE: Never issue emergency warnings, evacuation instructions, medical guidance, or legal/financial advice.
7. OUTPUT FORMAT: Return strict JSON matching the schema:
{
  "summary": "Possible explanations, not proof of cause. ...",
  "drivers": [
    {
      "title": "Short driver title",
      "explanation": "1-2 sentence hedged explanation suitable for high-school students.",
      "evidence_type": "measured_local_trend | physical_mechanism | climate_rhythm_correlation | published_literature",
      "confidence": "well established | plausible | uncertain",
      "citation_ids": ["cit_1"]
    }
  ],
  "limitations": ["Limitation 1", "Limitation 2"],
  "citations": [
    {
      "id": "cit_1",
      "title": "Source title",
      "url": "https://...",
      "source_label": "Publisher or agency name"
    }
  ]
}"""

_explanation_cache: BoundedTTLCache[tuple[str, str], dict] = BoundedTTLCache(
    "ai_explanations", max_entries=500, ttl_seconds=24 * 3600
)
_rate_limiter = SlidingWindowRateLimiter(max_requests=15, window_seconds=300)


def clear_explanation_state() -> None:
    """Clear cache and rate-limit buckets (used by offline tests)."""
    _explanation_cache.clear()
    _rate_limiter.clear()


def explanation_health() -> dict:
    """Non-secret health and cache telemetry for the AI explanations feature."""
    cfg = load_config()
    cache_info = _explanation_cache.stats(ttl_override=cfg.explanation_cache_ttl_seconds)
    snap = HEALTH_REGISTRY.snapshot("openai_explanations")
    if not cfg.openai_configured:
        status = "fallback_only"
    elif snap["consecutive_failures"] > 0:
        status = "degraded"
    else:
        status = "available"
    return {
        "status": status,
        "configured": cfg.openai_configured,
        "key_present": cfg.openai_key_present,
        "model": cfg.openai_explanation_model,
        "model_configured": cfg.openai_model_present,
        "web_search_enabled": cfg.openai_web_search_enabled,
        "web_search_tool": "web_search",
        "search_context_size": cfg.openai_search_context_size,
        "max_tool_calls": cfg.openai_max_tool_calls or None,
        "max_output_tokens": cfg.openai_max_output_tokens,
        "allowed_domains_count": len(ALLOWED_SCIENCE_DOMAINS),
        "search_filter_domains_count": len(WEB_SEARCH_ALLOWED_DOMAINS),
        "fallback_available": True,
        "fallback_source": "curated_literature_rules (reasons.py)",
        "rate_limit_max_requests": cfg.explanation_rate_limit_max,
        "rate_limit_window_seconds": cfg.explanation_rate_limit_window_seconds,
        **cache_info,
        **snap,
    }


class ExplanationRequest(BaseModel):
    """Browser request payload for POST /api/explanations.

    Extra fields (such as client-supplied p_value, slope, stats, or system_prompt) are strictly forbidden.
    """

    model_config = ConfigDict(extra="forbid")

    case_signature: str | None = Field(default=None, max_length=200)
    variable: str | None = Field(default=None, max_length=40)
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lon: float | None = Field(default=None, ge=-180.0, le=180.0)
    start_year: int | None = Field(default=None)
    end_year: int | None = Field(default=None)
    question: str | None = Field(default=None, max_length=240)

    @field_validator("question")
    @classmethod
    def _validate_question(cls, val: str | None) -> str | None:
        if val is None:
            return None
        cleaned = " ".join(val.strip().split())
        if not cleaned:
            return None
        if any(ord(ch) < 32 for ch in cleaned):
            raise ValueError("Question contains invalid control characters.")
        if _PROMPT_INJECTION_RE.search(cleaned):
            raise ValueError("Question contains disallowed instruction-override text.")
        return cleaned


def resolve_case_parameters(req: ExplanationRequest) -> tuple[str, float, float, int, int, str]:
    """Verify and resolve (variable, lat, lon, start_year, end_year, case_signature) from the request."""
    if req.case_signature:
        unpacked = parse_case_signature(req.case_signature)
        sig_var = unpacked["variable"]
        sig_lat = unpacked["lat"]
        sig_lon = unpacked["lon"]
        sig_start = unpacked["start_year"]
        sig_end = unpacked["end_year"]
        if sig_lat is None or sig_lon is None:
            raise ValueError("Point explanations require numeric latitude and longitude.")

        if req.variable is not None and req.variable != sig_var:
            raise ValueError("Request variable does not match case_signature.")
        if req.lat is not None and abs(round(req.lat, 3) - round(sig_lat, 3)) > 1e-3:
            raise ValueError("Request latitude does not match case_signature.")
        if req.lon is not None and abs(round(req.lon, 3) - round(sig_lon, 3)) > 1e-3:
            raise ValueError("Request longitude does not match case_signature.")
        if req.start_year is not None and req.start_year != sig_start:
            raise ValueError("Request start_year does not match case_signature.")
        if req.end_year is not None and req.end_year != sig_end:
            raise ValueError("Request end_year does not match case_signature.")

        return sig_var, float(sig_lat), float(sig_lon), int(sig_start), int(sig_end), unpacked["case_signature"]

    if req.variable is None or req.lat is None or req.lon is None:
        raise ValueError("Provide either a valid case_signature or (variable, lat, lon).")

    start_yr = req.start_year if req.start_year is not None else analysis.FIRST_YEAR
    from datetime import date

    end_yr = req.end_year if req.end_year is not None else (date.today().year - 1)
    sig = make_case_signature(req.variable, req.lat, req.lon, start_yr, end_yr)
    return req.variable, float(req.lat), float(req.lon), int(start_yr), int(end_yr), sig


def is_allowed_science_url(url: str | None) -> tuple[bool, str | None]:
    """Verify that a citation URL is https:// and belongs to an approved scientific/institutional domain."""
    if not url or not isinstance(url, str):
        return False, None
    cleaned = url.strip()
    # Anything Python and a browser could read differently is refused outright: a backslash ("https://evil.com\.nasa.gov"
    # is evil.com in a browser), whitespace and control characters.
    if any(ch.isspace() or ch == "\\" or ord(ch) < 32 for ch in cleaned):
        return False, None
    try:
        parsed = urlparse(cleaned)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return False, None
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False, None
    if not re.fullmatch(r"[a-z0-9.-]+", host):
        return False, None
    if host.startswith("www."):
        host = host[4:]
    for allowed in ALLOWED_SCIENCE_DOMAINS:
        if host == allowed or host.endswith("." + allowed):
            return True, host
    return False, host


def url_match_key(url: str | None) -> str | None:
    """A comparable form of a URL: lower-case host without "www.", no query string or fragment, no trailing slash.

    The web-search tool appends tracking parameters (for example `?utm_source=openai`) to the links it returns, so a link
    the model quotes from memory of its own search result must still match the one that was actually retrieved.
    """
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
    except ValueError:
        return None
    if parsed.scheme != "https" or not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    return f"{host}{parsed.path.rstrip('/')}"


def trusted_curated_urls(trend_res: dict) -> set[str]:
    """Match keys of the curated source links that are handed to the model in the prompt (see _call_openai_responses)."""
    facts = _build_measured_facts(trend_res)
    curated = reason_for(facts["variable_id"], facts["location"]["lat"], facts["location"]["lon"], facts["sign"])
    keys = {
        url_match_key(CURATED_SOURCE_URLS.get(name, ("https://www.ipcc.ch/report/ar6/wg1/", name))[0])
        for name in curated.get("sources", [])
    }
    return {k for k in keys if k}


def _sig(value: float | None, digits: int = 4) -> float | None:
    """Round to significant digits, not decimal places, so a tiny but real slope never prints as 0 (B11)."""
    if value is None:
        return None
    try:
        return float(f"{float(value):.{digits}g}")
    except (TypeError, ValueError):
        return None


def _build_measured_facts(trend_res: dict) -> dict:
    s = trend_res["stats"]
    v = trend_res["variable"]
    return {
        "variable_id": v["id"],
        "variable_label": v["label"],
        "units": v["units"],
        "location": trend_res["location"],
        "period": trend_res["period"],
        "years_used": trend_res["quality"]["years_used"],
        "direction": s["direction"],
        "sign": s["sign"],
        "significant": s["significant"],
        "slope_per_decade": _sig(s["slope_per_decade"]),
        "ci_low_per_decade": _sig(s["ci_low_per_decade"]),
        "ci_high_per_decade": _sig(s["ci_high_per_decade"]),
        "total_change": _sig(s["total_change"]),
        "p_value": _sig(s["p_value"]),
        "raw_p_value": _sig(s["p_naive"]),
        "grade": trend_res["grade"],
        "verdict": trend_res["evidence_trace"]["verdict"]["label"],
    }


def _build_curated_fallback(
    trend_res: dict,
    case_signature: str,
    *,
    status: str,
    fallback_reason: str,
    retry_after_seconds: int | None = None,
) -> dict:
    """Build a structured explanation response from the audited `reasons.py` literature rules."""
    facts = _build_measured_facts(trend_res)
    s = trend_res["stats"]
    var_id = trend_res["variable"]["id"]
    lat = trend_res["location"]["lat"]
    lon = trend_res["location"]["lon"]
    Caveats = list(trend_res.get("caveats", analysis.BASE_CAVEATS))

    if not s["significant"] or s["sign"] not in ("up", "down"):
        return {
            "status": "no_evidence",
            "summary": (
                f"{SUMMARY_PREFIX} The NASA POWER record for {facts['variable_label']} here "
                f"({facts['period']['start_year']}–{facts['period']['end_year']}) does not show a statistically "
                "significant trend, so there is no confirmed local trend to explain."
            ),
            "disclaimer": FIXED_DISCLAIMER,
            "drivers": [],
            "limitations": Caveats,
            "citations": [],
            "generated_at": utc_now_iso(),
            "fallback": True,
            "fallback_reason": "no_significant_trend",
            "retry_after_seconds": None,
            "case_signature": case_signature,
            "measured_facts": facts,
            "cached": False,
        }

    curated = reason_for(var_id, lat, lon, s["sign"])
    is_default_unknown = curated["text"] == DEFAULT_REASON[0] or not curated.get("sources")

    if is_default_unknown:
        # No curated literature for this case: keep the caller's status (no_key, rate_limited, fallback) so the UI can say
        # why the AI was not used, with no drivers.
        return {
            "status": status,
            "summary": (
                f"{SUMMARY_PREFIX} The data establish a {s['direction']} trend in {facts['variable_label']} "
                f"({facts['slope_per_decade']:+.3g} {facts['units']}/decade, p = {s['p_value']:.3g}), "
                "but available curated evidence cannot establish why this specific local trend occurred."
            ),
            "disclaimer": FIXED_DISCLAIMER,
            "drivers": [],
            "limitations": Caveats,
            "citations": [],
            "generated_at": utc_now_iso(),
            "fallback": True,
            "fallback_reason": fallback_reason,
            "retry_after_seconds": retry_after_seconds,
            "case_signature": case_signature,
            "measured_facts": facts,
            "cached": False,
        }

    citations: list[dict] = [
        {
            "id": "cit_nasa_power",
            "title": "NASA POWER Agroclimatology / MERRA-2 Reanalysis Archive",
            "url": "https://power.larc.nasa.gov/",
            "domain": "power.larc.nasa.gov",
            "source_label": "NASA Langley Research Center (LaRC)",
        }
    ]
    lit_cit_ids: list[str] = []
    for idx, src_name in enumerate(curated["sources"], start=1):
        cid = f"cit_{idx}"
        url, label = CURATED_SOURCE_URLS.get(src_name, ("https://www.ipcc.ch/report/ar6/wg1/", src_name))
        _, domain = is_allowed_science_url(url)
        citations.append(
            {
                "id": cid,
                "title": label,
                "url": url,
                "domain": domain or "ipcc.ch",
                "source_label": src_name,
            }
        )
        lit_cit_ids.append(cid)

    drivers = [
        {
            "title": f"Measured local {facts['variable_label'].lower()} trend",
            "explanation": (
                f"Across {facts['years_used']} complete years ({facts['period']['start_year']}–{facts['period']['end_year']}), "
                f"{facts['variable_label'].lower()} moved {facts['slope_per_decade']:+.3g} {facts['units']} per decade "
                f"(Mann–Kendall p = {s['p_value']:.3g}). This establishes what changed, not what caused it."
            ),
            "evidence_type": "measured_local_trend",
            "confidence": "well established" if trend_res["grade"]["code"] == "strong" else "plausible",
            "citation_ids": ["cit_nasa_power"],
            "citations": [citations[0]],
        },
        {
            "title": "Published scientific context for this variable and region",
            "explanation": curated["text"],
            "evidence_type": "published_literature",
            "confidence": curated["confidence"],
            "citation_ids": lit_cit_ids,
            "citations": [c for c in citations if c["id"] in lit_cit_ids],
        },
    ]

    out = {
        "status": status,
        "summary": f"{SUMMARY_PREFIX} {curated['text']}",
        "disclaimer": FIXED_DISCLAIMER,
        "drivers": drivers,
        "limitations": Caveats,
        "citations": citations,
        "generated_at": utc_now_iso(),
        "fallback": True,
        "fallback_reason": fallback_reason,
        "retry_after_seconds": retry_after_seconds,
        "case_signature": case_signature,
        "measured_facts": facts,
        "cached": False,
    }
    return out


def _load_json_object_text(text: str) -> object:
    """Parse the model's JSON, tolerating a markdown code fence or a sentence around it (a common deviation).

    Anything that is still not valid JSON raises ValueError, and the caller falls back to the curated text.
    """
    cleaned = text.strip()
    try:
        return json.loads(cleaned)
    except ValueError:
        pass
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.S | re.I)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except ValueError:
            pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if 0 <= start < end:
        return json.loads(cleaned[start : end + 1])
    raise ValueError("no JSON object found")


def validate_and_normalize_ai_output(
    raw_payload: dict | str,
    url_annotations: list[dict] | None = None,
    *,
    default_limitations: list[str] | None = None,
    trusted_urls: set[str] | None = None,
) -> dict:
    """Validate structured OpenAI output, filter citations by domain allow-list, and strip unsubstantiated drivers.

    When `trusted_urls` is given (the live path always gives it), a citation must also be a link that really exists in what
    the model was given or retrieved: a web-search result (`url_annotations`) or one of the curated sources in the prompt.
    A plausible-looking address on an allowed domain that is in neither is an invented citation and is dropped.

    Raises ValueError if the payload is malformed, makes prohibited causal/advice claims, or has zero substantiated drivers.
    """
    if isinstance(raw_payload, str):
        try:
            data = _load_json_object_text(raw_payload)
        except ValueError as exc:
            raise ValueError("AI output was not valid JSON.") from exc
    elif isinstance(raw_payload, dict):
        data = raw_payload
    else:
        raise ValueError("AI output must be a JSON object.")

    summary = str(data.get("summary") or "").strip()
    if not summary:
        raise ValueError("AI output missing summary.")
    if _CAUSAL_OVERCLAIM_RE.search(summary) or _ADVICE_OVERCLAIM_RE.search(summary):
        raise ValueError("AI summary violated non-causal or safety constraints.")
    if not summary.startswith(SUMMARY_PREFIX):
        summary = f"{SUMMARY_PREFIX} {summary}"

    # Normalize and validate citations
    raw_citations = data.get("citations")
    if not isinstance(raw_citations, list):
        raw_citations = []

    # Merge any hosted web_search URL annotations returned by the OpenAI Responses API
    # (Only url_citation annotations become citations; "source" entries, the pages the search consulted, are provenance only.)
    if url_annotations:
        for idx, ann in enumerate(url_annotations, start=1):
            if ann.get("kind") == "source":
                continue
            ann_url = ann.get("url")
            ann_title = ann.get("title") or ann_url or f"Source {idx}"
            ann_key = url_match_key(ann_url)
            if ann_url and not any(
                url_match_key(c.get("url")) == ann_key for c in raw_citations if isinstance(c, dict)
            ):
                raw_citations.append(
                    {
                        "id": f"web_{idx}",
                        "title": ann_title,
                        "url": ann_url,
                        "source_label": ann.get("source_label") or ann_title,
                    }
                )

    provenance: set[str] | None = None
    if trusted_urls is not None:
        provenance = set(trusted_urls) | {k for k in (url_match_key(a.get("url")) for a in (url_annotations or [])) if k}

    valid_citations: dict[str, dict] = {}
    # Deduplicated on the comparable URL (B11): "...?utm_source=openai" and the plain link are one citation. A later
    # duplicate's id is mapped onto the first one so drivers that cite either id still resolve.
    id_for_key: dict[str, str] = {}
    alias: dict[str, str] = {}
    for idx, item in enumerate(raw_citations, start=1):
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or f"cit_{idx}").strip()
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "").strip()
        source_label = str(item.get("source_label") or title).strip()
        if not cid or not title or not url:
            continue
        allowed, domain = is_allowed_science_url(url)
        if not allowed or not domain:
            continue
        if provenance is not None and url_match_key(url) not in provenance:
            continue  # not retrieved and not supplied: an invented citation, however official the domain looks
        key = url_match_key(url) or url
        if key in id_for_key:
            if cid not in valid_citations:
                alias[cid] = id_for_key[key]
            continue
        if cid in valid_citations:
            continue  # a second citation reusing an id: keep the first
        id_for_key[key] = cid
        valid_citations[cid] = {
            "id": cid,
            "title": title[:200],
            "url": url,
            "domain": domain,
            "source_label": source_label[:120],
        }

    # Validate drivers; remove any unsubstantiated driver or driver with invalid evidence_type/causal overclaim
    raw_drivers = data.get("drivers")
    if not isinstance(raw_drivers, list):
        raise ValueError("AI output missing drivers list.")

    substantiated_drivers: list[dict] = []
    for drv in raw_drivers:
        if not isinstance(drv, dict):
            continue
        title = str(drv.get("title") or "").strip()
        explanation = str(drv.get("explanation") or "").strip()
        ev_type = str(drv.get("evidence_type") or "").strip()
        confidence = str(drv.get("confidence") or "plausible").strip().lower()
        cit_ids = drv.get("citation_ids")

        if not title or not explanation:
            continue
        if ev_type not in VALID_EVIDENCE_TYPES:
            continue
        if confidence not in VALID_CONFIDENCE_LEVELS:
            confidence = "plausible"
        if _CAUSAL_OVERCLAIM_RE.search(explanation) or _ADVICE_OVERCLAIM_RE.search(explanation):
            continue
        if not isinstance(cit_ids, list):
            continue

        resolved_ids: list[str] = []
        for raw_id in cit_ids:
            rid = str(raw_id).strip()
            rid = alias.get(rid, rid)
            if rid in valid_citations and rid not in resolved_ids:
                resolved_ids.append(rid)
        if not resolved_ids:
            # Unsubstantiated driver: remove rather than display!
            continue

        substantiated_drivers.append(
            {
                "title": title[:140],
                "explanation": explanation[:600],
                "evidence_type": ev_type,
                "confidence": confidence,
                "citation_ids": resolved_ids,
                "citations": [valid_citations[cid] for cid in resolved_ids],
            }
        )

    if not substantiated_drivers:
        raise ValueError("No substantiated drivers with valid scientific citations remained after validation.")

    raw_limitations = data.get("limitations")
    limitations: list[str] = []
    if isinstance(raw_limitations, list):
        for lim in raw_limitations:
            if isinstance(lim, str) and lim.strip():
                limitations.append(lim.strip()[:300])
    if not limitations:
        limitations = list(default_limitations or analysis.BASE_CAVEATS)

    kept_drivers = substantiated_drivers[:4]
    # Citations are computed from the drivers actually returned, so none outlives a dropped driver (B11).
    used_citation_ids = {cid for d in kept_drivers for cid in d["citation_ids"]}
    ordered_citations = [c for cid, c in valid_citations.items() if cid in used_citation_ids]
    return {
        "summary": summary,
        "drivers": kept_drivers,
        "limitations": limitations[:6],
        "citations": ordered_citations,
    }


def _extract_responses_api_content(api_json: dict) -> tuple[str | dict, list[dict]]:
    """Extract output text/JSON and URL citation annotations from an OpenAI Responses API payload."""
    if "output_parsed" in api_json and isinstance(api_json["output_parsed"], dict):
        return api_json["output_parsed"], api_json.get("citations", [])

    annotations: list[dict] = []
    text_chunks: list[str] = []

    if isinstance(api_json.get("output_text"), str) and api_json["output_text"].strip():
        text_chunks.append(api_json["output_text"].strip())

    if api_json.get("status") == "incomplete":
        # Cut off (for example by max_output_tokens): the JSON is unlikely to be whole, so do not try to use it.
        raise ValueError("OpenAI Responses API returned an incomplete response.")

    output_items = api_json.get("output", [])
    if not isinstance(output_items, list):
        output_items = []
    for item in output_items:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "web_search_call":
            action = item.get("action") if isinstance(item.get("action"), dict) else {}
            for src in action.get("sources") or []:
                if isinstance(src, dict) and isinstance(src.get("url"), str) and src["url"].strip():
                    annotations.append({"url": src["url"].strip(), "title": src.get("title") or src["url"], "kind": "source"})
            continue
        contents = item.get("content", [])
        if not isinstance(contents, list):
            continue
        for content in contents:
            if not isinstance(content, dict):
                continue
            if isinstance(content.get("text"), str) and content["text"].strip():
                text_chunks.append(content["text"].strip())
            for ann in content.get("annotations", []):
                if isinstance(ann, dict) and ann.get("type") in ("url_citation", "citation") and ann.get("url"):
                    annotations.append(
                        {
                            "url": ann["url"],
                            "title": ann.get("title") or ann["url"],
                            "source_label": ann.get("title") or ann["url"],
                        }
                    )

    if not text_chunks:
        raise ValueError("OpenAI Responses API payload contained no text output.")
    return text_chunks[0], annotations


def build_openai_request_body(cfg, user_payload: dict) -> dict:
    """The Responses API request. The model is whatever the owner configured; nothing here names one.

    Web search uses the current `web_search` tool (not the deprecated `web_search_preview`) with
    `filters.allowed_domains`, so retrieval itself is restricted to the science allow-list. `search_context_size` and
    `max_tool_calls` bound how much retrieved text and how many searches one explanation can spend, and
    `include: web_search_call.action.sources` returns every page the search consulted, which the validator accepts as
    provenance for a citation (it is still checked against the domain allow-list).
    """
    body: dict = {
        "model": cfg.openai_explanation_model,
        "instructions": EXPLANATION_SYSTEM_PROMPT,
        "input": json.dumps(user_payload),
        "text": {"format": {"type": "json_object"}},
        "max_output_tokens": cfg.openai_max_output_tokens,
        "store": False,
    }
    if cfg.openai_web_search_enabled:
        body["tools"] = [
            {
                "type": "web_search",
                "filters": {"allowed_domains": list(WEB_SEARCH_ALLOWED_DOMAINS)},
                "search_context_size": cfg.openai_search_context_size,
            }
        ]
        body["tool_choice"] = "auto"
        body["include"] = ["web_search_call.action.sources"]
        if cfg.openai_max_tool_calls:
            body["max_tool_calls"] = cfg.openai_max_tool_calls
    return body


async def _call_openai_responses(
    trend_res: dict,
    question: str | None,
    *,
    openai_caller: Callable | None = None,
) -> tuple[str | dict, list[dict]]:
    """Invoke the OpenAI Responses API on the server with authoritative trend facts."""
    cfg = load_config()
    if not cfg.openai_key_present or not cfg.openai_api_key:
        raise UpstreamServiceError("openai_explanations", "missing_api_key", "OPENAI_API_KEY is not configured.")
    if not cfg.openai_model_present:
        raise UpstreamServiceError("openai_explanations", "missing_model", "OPENAI_EXPLANATION_MODEL is not configured.")

    facts = _build_measured_facts(trend_res)
    curated = reason_for(
        facts["variable_id"],
        facts["location"]["lat"],
        facts["location"]["lon"],
        facts["sign"],
    )
    user_payload = {
        "task": "Explain plausible scientific drivers for this server-verified Earth-system trend with citations.",
        "user_question": question or "Why might this trend be happening at this location?",
        "authoritative_measured_facts": facts,
        "caveats": trend_res.get("caveats", []),
        "curated_reference_context": {
            "text": curated["text"],
            "confidence": curated["confidence"],
            "sources": [
                {
                    "name": s,
                    "url": CURATED_SOURCE_URLS.get(s, ("https://www.ipcc.ch/report/ar6/wg1/", s))[0],
                }
                for s in curated.get("sources", [])
            ],
        },
        "allowed_citation_domains": list(ALLOWED_SCIENCE_DOMAINS),
    }

    request_body = build_openai_request_body(cfg, user_payload)

    if openai_caller is not None:
        raw_resp = await openai_caller(request_body, cfg)
        HEALTH_REGISTRY.record_success("openai_explanations")
        return _extract_responses_api_content(raw_resp)

    headers = {
        "Authorization": f"Bearer {cfg.openai_api_key}",
        "Content-Type": "application/json",
    }
    resp = await request_with_resilience(
        "openai_explanations",
        "POST",
        cfg.openai_base_url,
        json_body=request_body,
        headers=headers,
        timeout_seconds=cfg.openai_timeout_seconds,
        retry_delays=(0.5,),
    )
    try:
        api_json = resp.json()
    except ValueError as exc:
        HEALTH_REGISTRY.record_failure("openai_explanations", "invalid_json")
        raise UpstreamServiceError("openai_explanations", "invalid_json", "OpenAI returned non-JSON body.") from exc
    return _extract_responses_api_content(api_json)


async def generate_explanation(
    req: ExplanationRequest,
    *,
    client_ip: str = "anonymous",
    openai_caller: Callable | None = None,
) -> dict:
    """Verify trend server-side and return a validated source-cited explanation or safe curated fallback."""
    cfg = load_config()
    variable, lat, lon, start_year, end_year, case_sig = resolve_case_parameters(req)
    norm_question = (req.question or "").strip().lower()
    cache_key = (case_sig, norm_question)

    # 1. Check 24-hour signature cache first
    cached_entry = _explanation_cache.get_entry(cache_key, ttl_override=cfg.explanation_cache_ttl_seconds)
    if cached_entry is not None:
        return {**cached_entry.value, "cached": True}

    # 2. Recompute/retrieve the trend analysis server-side
    trend_res = await analysis.analyze_point(variable, lat, lon, start_year, end_year, detail=True)
    canonical_sig = trend_res.get("case_signature") or case_sig

    # 3. If the trend is not statistically significant (or has no direction), never ask the LLM to invent reasons.
    #    Same rule as _build_curated_fallback, so the two can never disagree (B1).
    if not trend_res["stats"]["significant"] or trend_res["stats"]["sign"] not in ("up", "down"):
        no_ev = _build_curated_fallback(
            trend_res,
            canonical_sig,
            status="no_evidence",
            fallback_reason="no_significant_trend",
        )
        _explanation_cache.put(cache_key, no_ev)
        return no_ev

    # 4. If OPENAI_API_KEY or OPENAI_EXPLANATION_MODEL is not configured, return curated fallback immediately.
    #    (No model name is built in: live AI is off until the owner picks one.)
    if not cfg.openai_configured and openai_caller is None:
        return _build_curated_fallback(
            trend_res,
            canonical_sig,
            status="no_key",
            fallback_reason="missing_api_key" if not cfg.openai_key_present else "missing_model",
        )

    # 5. Check per-client rate limiter before making a live AI request
    allowed, retry_after, _ = _rate_limiter.check(
        client_ip,
        max_requests=cfg.explanation_rate_limit_max,
        window_seconds=cfg.explanation_rate_limit_window_seconds,
    )
    if not allowed:
        return _build_curated_fallback(
            trend_res,
            canonical_sig,
            status="rate_limited",
            fallback_reason="rate_limited",
            retry_after_seconds=retry_after,
        )

    # 6. Call OpenAI Responses API and validate structured output & citations
    try:
        raw_content, url_annotations = await _call_openai_responses(
            trend_res, req.question, openai_caller=openai_caller
        )
        validated = validate_and_normalize_ai_output(
            raw_content,
            url_annotations,
            default_limitations=trend_res.get("caveats"),
            trusted_urls=trusted_curated_urls(trend_res),
        )
    except (UpstreamServiceError, ValueError, KeyError, TypeError) as exc:
        reason_code = exc.code if isinstance(exc, UpstreamServiceError) else "validation_failed"
        HEALTH_REGISTRY.record_failure("openai_explanations", redact_secrets(reason_code))
        return _build_curated_fallback(
            trend_res,
            canonical_sig,
            status="fallback",
            fallback_reason=reason_code,
            retry_after_seconds=getattr(exc, "retry_after_seconds", None),
        )

    response = {
        "status": "ok",
        "summary": validated["summary"],
        "disclaimer": FIXED_DISCLAIMER,
        "drivers": validated["drivers"],
        "limitations": validated["limitations"],
        "citations": validated["citations"],
        "generated_at": utc_now_iso(),
        "fallback": False,
        "fallback_reason": None,
        "retry_after_seconds": None,
        "case_signature": canonical_sig,
        "measured_facts": _build_measured_facts(trend_res),
        "cached": False,
    }
    _explanation_cache.put(cache_key, response)
    return response
