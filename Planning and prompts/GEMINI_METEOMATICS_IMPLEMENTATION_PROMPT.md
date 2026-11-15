# Gemini prompt — implement Meteomatics safely

```text
Implement the Meteomatics live-weather backend integration in the existing Trend Detective repository. This is a focused backend task; do not redesign the frontend or replace existing NASA trend analysis.

Read these files first:
- README.md
- HANDOFF.md
- Planning and prompts/V2_EXECUTION_PLAN.md
- Planning and prompts/V2_DATA_SOURCE_REGISTRY.md
- Planning and prompts/V2_AGENT_HANDOFF_PROMPTS.md

Goal
Add Meteomatics as a server-proxied live/current and short-range weather source for selected/saved locations. It complements NASA POWER; it must never be averaged with, substituted for, or labelled as NASA long-term climate-trend data.

Important credential rule
The owner will configure these in the local backend environment and in Azure App Service application settings:

  METEOMATICS_USERNAME
  METEOMATICS_PASSWORD

Do not ask for their values, print them, log them, commit them, put them in a URL, return them from an endpoint, or reference them in frontend code. Use HTTPS Basic Authentication through the HTTP client’s authentication option, never a `username:password@host` URL. The app must still run normally when either variable is absent.

Meteomatics reference query pattern

  https://api.meteomatics.com/{validdatetime}/{parameters}/{locations}/json

For a point time range at hourly resolution:

  https://api.meteomatics.com/{start}--{end}:PT1H/{parameters}/{lat},{lon}/json

Initial provider parameter mapping:

  air temperature:      t_2m:C
  hourly precipitation: precip_1h:mm
  total cloud cover:    total_cloud_cover:p
  10 m wind speed:      wind_speed_10m:ms

Implement these deliverables in order.

1. Baseline and source client
- Start from a new `codex/meteomatics-live-weather` branch. Run the existing backend tests before changes.
- Add a small `MeteomaticsProvider`/client module under `backend/app/` with strict input validation, a short connection/read timeout, bounded retry only for safe transient errors, response-size protection, and a bounded TTL cache.
- Use JSON responses, not the HTML example output. Never forward the raw upstream response without validation/normalisation.
- Keep all network access server-side. Do not alter NASA POWER requests or existing statistics.

2. API route
- Implement `GET /api/live-weather` in FastAPI.
- Inputs: `lat` (-90 to 90), `lon` (-180 to 180), `hours` (1 to 72, default 24). Round/cache coordinates sensibly and cap queries to prevent abusive fan-out.
- Start time should be UTC at a stable hourly boundary. Build an hourly Meteomatics range request from start through the requested horizon using the four initial parameters above.
- Return a stable, frontend-friendly schema similar to:

  {
    "available": true,
    "provider": "Meteomatics",
    "location": {"lat": 52.5206, "lon": 13.4618},
    "request": {"hours": 24, "interval": "PT1H"},
    "parameters": {
      "temperature_c": "t_2m:C",
      "precipitation_1h_mm": "precip_1h:mm",
      "cloud_cover_percent": "total_cloud_cover:p",
      "wind_speed_10m_ms": "wind_speed_10m:ms"
    },
    "series": [
      {
        "time": "ISO-8601 UTC",
        "temperature_c": 0.0,
        "precipitation_1h_mm": 0.0,
        "cloud_cover_percent": 0.0,
        "wind_speed_10m_ms": 0.0
      }
    ],
    "fetched_at": "ISO-8601 UTC",
    "stale": false,
    "source_note": "Meteomatics operational weather data. It is separate from NASA POWER climate-trend analysis.",
    "provider_metadata": {}
  }

- Preserve nulls for unavailable parameter/time values; never invent or interpolate observed weather.
- For missing credentials, unsupported provider response, 401, 429, timeout, malformed JSON, or upstream 5xx, return a typed, non-secret unavailable result. If a recent successful cached result exists, return it with `stale: true` and a timestamp. Do not leak upstream error bodies or credentials.
- Extend `/api/health/details` with a non-secret Meteomatics status and cache age. It must not call the provider just to answer a health check.

3. Tests
- Keep tests entirely offline with a fake/injected HTTP provider. Do not call Meteomatics in the test suite.
- Cover: URL/request construction, Basic Auth is passed only through the client auth mechanism, missing credentials, normal JSON parsing, all four parameter mappings, partial/missing values, 401, 429, timeout, malformed payload, stale-cache fallback, parameter/time/coordinate validation, and proof that responses/log fixtures never contain either credential.
- Do not alter existing statistical reference values.

4. Documentation and handoff
- Update `docs/V2_API_CONTRACT.md` (create it if absent) with the exact route schema, query limits, cache semantics, and unavailable/stale behaviour.
- Update README and HANDOFF.md with the two environment-variable names only, source credit, and the clear distinction between Meteomatics live weather and NASA climate analysis.
- Add `docs/V2_METEOMATICS_HANDOFF.md` with changed files, fixtures, API examples using placeholders only, test commands/results, and known subscription/horizon limitations.
- Run the backend test suite and report results. Do not deploy or configure Azure yourself.

Definition of done
- The existing application works unchanged without Meteomatics credentials.
- With credentials configured, `/api/live-weather` returns validated hourly temperature, precipitation, cloud-cover and wind data for one location.
- No secret reaches the browser, repository, logs, error text, tests or documentation.
- The response and docs make it impossible to confuse Meteomatics weather guidance with NASA historical trend data or the app’s internal monthly forecast.
```
