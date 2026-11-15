# V2 Meteomatics live weather: handoff

`GET /api/live-weather` adds **current and short-range hourly weather** for one place from [Meteomatics](https://www.meteomatics.com/). It sits beside the NASA POWER climate analysis and never mixes with it: it is not averaged with NASA data, is not part of any trend, and is not the app's own monthly forecast. The schema is in [V2_API_CONTRACT.md](V2_API_CONTRACT.md) section 7.

## Files

| File | What it holds |
| --- | --- |
| `backend/app/meteomatics.py` | The provider: URL building, HTTPS Basic Auth, validation and normalisation of the JSON reply, a 15-minute cache with stale fallback, a 512 KB response cap, and the non-secret health summary. |
| `backend/app/main.py` | The route `GET /api/live-weather` (`lat` ±90, `lon` ±180, `hours` 1 to 72, default 24) and the `meteomatics` block in `GET /api/health/details`. |
| `backend/app/resilience.py` | Reads `METEOMATICS_*` settings; redacts the credentials from any text. |
| `backend/tests/test_v2_meteomatics.py` | Offline tests (below). |
| `backend/tests/test_v2_contract_fixtures.py`, `fixtures/v2_fixtures.json` | Fixtures `live_weather_unconfigured` and `live_weather_available`. |
| `frontend/src/api.js` | `fetchLiveWeather({ lat, lon, hours }, signal)`. |

## How it behaves

- **Credentials** come only from the server environment: `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`. They are passed through the HTTP client's authentication option (never in a URL), redirects are not followed, and they never appear in a response, a health report, an error or a test. The upstream `user` field is stripped from the reply.
- **Request**: `https://api.meteomatics.com/{start}--{end}:PT1H/{parameters}/{lat},{lon}/json`, starting at the current UTC hour. Parameters: `t_2m:C` (air temperature), `precip_1h:mm` (hourly precipitation), `total_cloud_cover:p` (cloud cover), `wind_speed_10m:ms` (10 m wind speed).
- **Values**: a value the provider did not supply (or a sentinel such as -999) stays `null`. Nothing is interpolated.
- **No credentials**: HTTP 200 with `available: false`, `status: "unconfigured"`. The rest of the app is unaffected.
- **Failures** (401/403, 429, 400/404/422, timeout, 5xx, malformed JSON, oversized reply): a typed, non-secret result. If a cached reply exists it is served with `status: "stale"` and `stale: true`; otherwise `status: "unavailable"` with a plain `reason`.
- **Health**: `/api/health/details` reports `features.meteomatics` (configured or not, cache age, last success and error code) without calling Meteomatics.

## Try it locally

Set the two values in the PowerShell window that starts the backend (they exist only for that window), then start it:

```powershell
$env:METEOMATICS_USERNAME = "<your username>"
$env:METEOMATICS_PASSWORD = "<your password>"
cd backend
.venv\Scripts\activate
uvicorn app.main:app --port 8000
```

Then open `http://127.0.0.1:8000/api/live-weather?lat=52.52&lon=13.46&hours=24`. A successful reply says `"provider": "Meteomatics"` and shows a fetch time; it must not show your username or password. Double-clicking `START.bat` does not see values set in a different window. On Azure, set both as application settings (never in the repository).

## Tests

```powershell
cd backend
.venv\Scripts\activate
pytest tests/test_v2_meteomatics.py     # entirely offline, with a fake HTTP transport
pytest                                   # the whole suite
```

The tests cover: URL construction without embedded credentials; the unconfigured state; Basic Auth passed only through the client's auth mechanism plus JSON normalisation; 401, 403, 429, 400 and 503 replies whose bodies echo the credentials, which must never reach the result; timeout, malformed JSON and an oversized reply; stale-cache fallback during an outage; coordinate and hour validation; and credential redaction.

## Known limits

- **Never run against the real Meteomatics service** (no credentials were available during development). Run one real request before relying on it, and check the reply against the example in the contract.
- **Subscription limits are unknown.** A free or trial account may reject some parameters, horizons or places; that surfaces as `status: "unavailable"` with the reason "Meteomatics rejected the requested parameter or forecast range for this subscription".
- The cache key rounds the place to 0.01°, so two places within about a kilometre share a cached reply.
- One place per request. There is no bulk or saved-places endpoint.
