# Deploying Trend Detective

This project is split into a **Vercel backend** and a separately hosted **static frontend on Porkbun**. Vercel is the only place that receives backend secrets. The Porkbun build receives one public setting: the Vercel API origin.

## Before starting

- Push the repository to GitHub. `.env` files must remain uncommitted.
- Have the final public frontend domain ready, including whether both `example.com` and `www.example.com` will be served.
- Generate a long random `TD_CASE_SECRET` in a password manager. It must not be the same as any account password.

## Vercel: backend and environment variables

1. In Vercel, import the GitHub repository. The Vercel project root directory must be the repository root.
2. Deploy once. `vercel.json` builds the React frontend and routes `/api/*` to `api/index.py`, which exposes the FastAPI app.
3. Copy the Vercel deployment’s production origin, for example `https://trend-detective-api.vercel.app`.
4. Under **Project → Settings → Environment Variables**, add the following values for **Production**:

   | Name | Required | Value |
   | --- | --- | --- |
   | `METEOMATICS_USERNAME` | Yes for live-weather feature | Meteomatics account username |
   | `METEOMATICS_PASSWORD` | Yes for live-weather feature | Meteomatics account password |
   | `TD_CASE_SECRET` | Yes | New long random secret |
   | `TD_ALLOWED_ORIGINS` | Yes for separate frontend | Comma-separated final frontend origins, e.g. `https://example.com,https://www.example.com` |
   | `OPENAI_API_KEY` | Optional | Enables live “Why?” explanations |
   | `OPENAI_EXPLANATION_MODEL` | Required with OpenAI key | A model available to the account and compatible with the Responses API |

5. Redeploy. Environment-variable changes do not reliably affect an already-built deployment until a redeploy.
6. Confirm these endpoints from a browser:

   ```text
   https://your-vercel-origin/api/health/details
   https://your-vercel-origin/docs
   ```

`backend/.env` is intentionally ignored by Vercel. [`api/index.py`](../api/index.py) sets `TD_LOAD_ENV_FILE=0`, so deploying cannot accidentally use a local secret file.

## Porkbun: static frontend

1. Create `frontend/.env.production` from `frontend/.env.production.example`.
2. Set only the public API origin:

   ```dotenv
   VITE_API_BASE=https://your-vercel-origin
   ```

3. Build locally:

   ```powershell
   cd frontend
   npm ci
   npm run build
   ```

4. Upload the **contents** of `frontend/dist/` to the Porkbun hosting document root.
5. If the Porkbun product provides rewrite rules, configure a single-page-app fallback to `/index.html` for client-side navigation.
6. Enable HTTPS on the chosen frontend domain before adding it to `TD_ALLOWED_ORIGINS`.

`VITE_API_BASE` is public by design. Never use a `VITE_` variable for keys, passwords, `TD_CASE_SECRET`, or any private setting.

## Smoke-test checklist

- [ ] Page loads from the Porkbun HTTPS URL with no CORS errors in browser developer tools.
- [ ] A location/metric trend loads and produces a case signature.
- [ ] A two-location comparison uses both selected locations.
- [ ] Globe overlay/timeline interactions still work.
- [ ] News context handles an empty provider response cleanly.
- [ ] `/api/live-weather` reports `available` with Meteomatics credentials, or an honest `unconfigured`/`unavailable` state without them.
- [ ] The “Why?” button returns a labelled curated fallback unless both OpenAI settings are intentionally configured.
- [ ] `/api/health/details` contains no credential values.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser reports CORS or fetch failure | Rebuild the frontend with the exact `VITE_API_BASE`; set the exact `https://` Porkbun origin(s) in `TD_ALLOWED_ORIGINS`; redeploy Vercel. |
| API works locally but fails on Vercel | Check Vercel function logs and `pyproject.toml`; do not upload `backend/.venv` or `backend/.env`. |
| Live weather says unconfigured | Verify both Meteomatics variable names in Vercel, then redeploy. |
| Explanations always use the fallback | This is expected without both `OPENAI_API_KEY` and `OPENAI_EXPLANATION_MODEL`. |
| Explanations report invalid signature after a cold start | Set a stable `TD_CASE_SECRET` in Vercel and redeploy. |

The core NASA/NOAA/NSIDC trend features use public keyless sources. Vercel/serverless cold starts can still make a first live request slower because in-memory caches are per instance.
