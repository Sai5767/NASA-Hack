# Trend Detective

Trend Detective is a NASA Space Apps Challenge project for exploring long-term Earth-system change. A student can choose a place and a metric, see the pattern on an interactive globe, and get a plain-language answer to:

1. What is changing?
2. Where is it changing?
3. How large is the change?
4. Is the evidence strong enough to trust?

The app separates observations, short operational forecasts, news context, statistical evidence, and possible explanations. A news item or an AI explanation is never presented as proof of a measured trend.

## What is implemented

- A dark, interactive Earth view with timeline-controlled climate layers and local detail.
- Place-based monthly analysis for 19 NASA POWER variables, including temperature, rainfall, cloud cover, humidity, soil wetness, sunlight, wind, and pressure.
- Trend cards with Theil-Sen slope, confidence interval, Mann-Kendall test, regression test, serial-correlation adjustment, multiple-testing correction, and an evidence grade.
- Comparison, regional scan, world survey, global vital-sign, forecast, and “Why might this be happening?” views.
- Local browser-only profile preferences and saved locations; the project does not require a user database for the demonstration.
- Optional, clearly labelled live weather (Meteomatics), news context (GDELT), and OpenAI-backed explanation features.

See [DATA_SOURCES_APIS_AND_AI_MODELS.txt](DATA_SOURCES_APIS_AND_AI_MODELS.txt) for the submission-ready source and model inventory.

## Run locally

### Fastest option on Windows

Double-click `START.bat`, then open <http://127.0.0.1:5173>. It requires Python 3.10+ and Node.js 18+.

Double-click `STOP.bat` when finished.

### Manual option

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# In another terminal
cd frontend
npm install
npm run dev
```

The API is available at <http://127.0.0.1:8000/docs>.

## Configuration and secrets

The core NASA/NOAA/NSIDC analysis runs without credentials. `backend/.env` is a local-only file: it is deliberately ignored by Git, Docker, and Vercel uploads.

1. Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` if it does not already exist.
2. Put real values only in `backend/.env` locally, or in the **Vercel project’s Environment Variables** for production.
3. Never put any secret in `frontend/`, `VITE_*` variables, source code, screenshots, Git commits, or this README.

| Feature | Required environment variables | Notes |
| --- | --- | --- |
| Live weather | `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` | Server-side only. It enables `/api/live-weather`; it is not mixed into NASA trend calculations. |
| “Why?” AI explanations | `OPENAI_API_KEY`, `OPENAI_EXPLANATION_MODEL` | Both are required. Without them, the app deliberately uses the sourced curated fallback. |
| Case signatures in serverless hosting | `TD_CASE_SECRET` | Set a long, random, private value in Vercel. It must stay stable across serverless instances. |
| Browser access from the Porkbun site | `TD_ALLOWED_ORIGINS` | Comma-separated complete origins, for example `https://example.com,https://www.example.com`. |
| Vercel proxy-aware rate limiting | `TD_TRUSTED_PROXY_HOPS` | Leave at `0` unless deployment testing confirms the correct proxy-hop count. |

The exact accepted setting names, defaults, and non-secret health reporting are defined in [`backend/app/resilience.py`](backend/app/resilience.py). The application redacts recognised secrets from error messages, but that is not a substitute for keeping them private.

## Deploy: Vercel API + Porkbun frontend

This repository is prepared for Vercel, but this local checkout is **not linked to a Vercel project**. The following one-time setup must be completed in the relevant dashboards; no deployment URL is hard-coded in the repository.

### 1. Deploy the backend on Vercel

1. Import the GitHub repository into Vercel or link it from the repository root with the Vercel CLI.
2. Deploy from the repository root. [`vercel.json`](vercel.json) builds `frontend/` too, but Vercel’s Python function is exposed at `/api/*` through [`api/index.py`](api/index.py).
3. In **Vercel → Project → Settings → Environment Variables**, add these for **Production** (and Preview if you use previews):
   - `METEOMATICS_USERNAME`
   - `METEOMATICS_PASSWORD`
   - `TD_CASE_SECRET` — generate a new long random value in a password manager; do not use the local file as a public record.
   - `TD_ALLOWED_ORIGINS` — add the final Porkbun site origins after the site has a public URL.
   - Optional: `OPENAI_API_KEY` and `OPENAI_EXPLANATION_MODEL` for live AI explanations.
4. Redeploy after adding or changing any Vercel environment variable.
5. Record the public backend origin, such as `https://your-api-project.vercel.app`. Do not use a trailing slash.
6. Test `https://your-api-project.vercel.app/api/health/details`. It must return JSON and must never expose credentials.

Do **not** upload `backend/.env` to Vercel. `api/index.py` explicitly disables loading local `.env` files so only Vercel project settings are used in production.

### 2. Build the separate frontend for Porkbun

Create `frontend/.env.production` locally before building; it is ignored by Git. Start from [`frontend/.env.production.example`](frontend/.env.production.example):

```dotenv
VITE_API_BASE=https://your-api-project.vercel.app
```

Then build and upload the generated static files to the Porkbun web-hosting document root:

```powershell
cd frontend
npm ci
npm run build
```

Upload the **contents** of `frontend/dist/`, not the `dist` folder itself. Configure the host to send unknown application routes to `index.html` if the hosting product supports a single-page-app rewrite. The built site contains the public Vercel API URL, which is expected; it contains no secret.

### 3. Connect the domain safely

1. In Porkbun, point the chosen domain or subdomain to the static host using that host’s DNS instructions.
2. Wait for HTTPS to be active. Use the final `https://…` origin in `TD_ALLOWED_ORIGINS` on Vercel.
3. Redeploy the Vercel backend after updating CORS.
4. Open the Porkbun URL in a private browser window and test a normal trend request, a two-place comparison, a live-weather request, an explanation fallback, and a news popup.

If the site shows a network/CORS error, check that the `VITE_API_BASE` build value exactly matches the Vercel URL and that `TD_ALLOWED_ORIGINS` has the exact Porkbun origin(s), including `https://` and without path names.

Detailed Vercel notes are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```powershell
cd backend
.venv\Scripts\python -m pytest

cd ..\frontend
npm test
```

The backend suite uses fixtures for its automated tests; it does not need to spend external API quota.

## Data credits

The main climate-analysis data come from NASA POWER, NASA GISS GISTEMP, NOAA GML/CPC/NCEI, and the NOAA@NSIDC Sea Ice Index. The full data, news, optional weather, map, font, and AI inventory—with direct official URLs and clear “used vs not used” status—is in [DATA_SOURCES_APIS_AND_AI_MODELS.txt](DATA_SOURCES_APIS_AND_AI_MODELS.txt).

## Important limitations

- NASA POWER point data and the bundled coarse preview are not the same as global satellite imagery or a high-resolution global raster.
- Forecast visuals are short-horizon statistical estimates and are visibly labelled as forecasts, not observations or climate projections.
- News markers are automated contextual leads with deterministic severity labels, not verified emergency alerts or scientific evidence.
- AI “Why?” answers are possible explanations with validated sources; they cannot establish local causation.
