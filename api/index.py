"""Vercel entry point: serves the FastAPI app (backend/app) as one serverless function. See docs/DEPLOY.md.

The built front-end is served by Vercel's CDN, and vercel.json rewrites every /api/... request to this function, so the
page and the API share one origin and no URLs need configuring.
"""

import os
import sys
from pathlib import Path

# Hosted settings come from the project's environment variables, never from a file.
os.environ.setdefault("TD_LOAD_ENV_FILE", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401  (Vercel looks for a module-level ASGI object named `app`)
