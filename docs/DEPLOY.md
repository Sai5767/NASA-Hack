# Publishing Trend Detective on free hosting

**Status: deployed on Vercel (Option D), private by default.** The Docker routes (A to C) are prepared but not published, and
have not been built on the machine this was written on (no Docker there); the one-process mode they rely on *has* been run and
checked locally.

## How it works

The API can serve the built front-end itself, so **one process and one URL** is all a host needs:

1. `npm run build` in `frontend/` produces `frontend/dist`.
2. When `frontend/dist/index.html` exists, `backend/app/deploy.py` mounts it at `/`. Every `/api/...` route keeps precedence.
3. In a production build the front-end calls the API on the same origin (`frontend/src/api.js`), so no URLs need configuring.
4. `TD_ALLOWED_ORIGINS` (comma separated, or `*`) adds extra browser origins, only needed if the page is hosted somewhere
   other than the API.

Try it locally without Docker:

```bash
cd frontend
npm run build
cd ../backend
.venv\Scripts\activate
uvicorn app.main:app --port 8010
```

Then open http://127.0.0.1:8010. That is the whole app from one server.

## Option A: Render (free web service)

1. Push this repository to GitHub (it already is) and make sure Render can read it.
2. In Render choose **New, Blueprint**, pick the repository and branch. `render.yaml` describes the service: Docker, free plan,
   health check `/api/places`.
3. Wait for the build. The URL Render shows is the app.

## Option B: Hugging Face Spaces (Docker Space, free)

Create a Space of type **Docker**, push this repository to it, and set the Space's app port to `8000`. The `Dockerfile` is used as is.

## Option C: Fly.io

`fly launch` detects the `Dockerfile`; keep internal port `8000`.

## Option D: Vercel (what is deployed now)

Vercel serves the built front-end from its CDN and runs the API as one serverless Python function. Files involved:

- `vercel.json`: builds `frontend/` into `frontend/dist`, and rewrites every `/api/...` request to the function.
- `api/index.py`: the function's entry point; it loads `backend/app/main.py` (`TD_LOAD_ENV_FILE=0`, so no `.env` file is read).
- `pyproject.toml`: the libraries the function installs (keep the pins in step with `backend/requirements.txt`).
- `.vercelignore`: what the CLI must not upload. It replaces `.gitignore` for deploys, so the secret files are listed again there.

Deploy from the repository root (first run: `npx vercel login`, then `npx vercel link --project trend-detective`):

```bash
npx vercel deploy --prod --yes
```

Set `OPENAI_API_KEY`, `METEOMATICS_USERNAME` etc. as Vercel project environment variables if you want those optional features.

Things that differ from the one-process hosts above:

- **Each request can run in a fresh process.** The in-memory caches and rate limits are per instance, so they help less and a cold request fetches NASA POWER again.
- **A request is cut off after 60 seconds** (`maxDuration` in `vercel.json`). The first trend ledger or world survey can take close to that.
- **New projects are private by default** (Vercel Authentication). Turn that off under Project Settings, Deployment Protection, for the public to see the site.

## What to expect on a free tier

- **Cold starts.** Free services sleep when idle, so the first request after a pause is slow.
- **First load of each place is slow.** The app asks NASA POWER live. Results are cached in memory, but the cache is lost whenever
  the service restarts, so the first trend ledger or world survey after a wake-up can take about a minute.
- **No secrets are required.** The core app uses only keyless public data sources. If you turn on the optional OpenAI explanations or Meteomatics weather, set `OPENAI_API_KEY`, `OPENAI_EXPLANATION_MODEL`, `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` as the host's environment variables (Azure: App Service application settings). Never put values in the repository, and never upload `backend/.env` (it is excluded from Git and from the Docker image; the host's variables always win over it).
- **Public means public.** Anyone with the URL can use it, and every request calls NASA POWER from the host's IP address. Keep
  an eye on the rate limits if it gets heavy use.

## Checklist before announcing the link

- [ ] Open the URL on a phone and on a laptop; try the guided cases and the ledger.
- [ ] Confirm the footer credits (NASA POWER, GISTEMP, NOAA, NSIDC) are visible.
- [ ] Put the URL in the README and the competition submission.
