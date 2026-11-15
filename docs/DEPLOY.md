# Publishing Trend Detective on free hosting

**Status: prepared, not published.** Putting the app online needs an account with a hosting service, which only the project
owner can create, so nothing has been deployed. Everything below is ready to use. The Docker route has not been built on
the machine this was written on (no Docker there); the one-process mode it relies on *has* been run and checked locally.

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

## What to expect on a free tier

- **Cold starts.** Free services sleep when idle, so the first request after a pause is slow.
- **First load of each place is slow.** The app asks NASA POWER live. Results are cached in memory, but the cache is lost whenever
  the service restarts, so the first trend ledger or world survey after a wake-up can take about a minute.
- **No secrets.** The app uses only keyless public data sources, so there is nothing to configure or protect.
- **Public means public.** Anyone with the URL can use it, and every request calls NASA POWER from the host's IP address. Keep
  an eye on the rate limits if it gets heavy use.

## Checklist before announcing the link

- [ ] Open the URL on a phone and on a laptop; try the guided cases and the ledger.
- [ ] Confirm the footer credits (NASA POWER, GISTEMP, NOAA, NSIDC) are visible.
- [ ] Put the URL in the README and the competition submission.
