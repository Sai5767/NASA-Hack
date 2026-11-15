"""Deployment helpers: extra CORS origins from the environment, and serving the built front-end from the same server.

One process and one URL is all a free hosting service needs: build the front-end (npm run build) and the API serves it.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def allowed_origins(extra: str | None = None) -> list[str]:
    """The local dev origins plus any in TD_ALLOWED_ORIGINS (comma separated). "*" allows every origin."""
    raw = os.environ.get("TD_ALLOWED_ORIGINS", "") if extra is None else extra
    origins = list(LOCAL_ORIGINS)
    for item in raw.split(","):
        item = item.strip().rstrip("/")
        if item and item not in origins:
            origins.append(item)
    return origins


def frontend_dist(root: Path | None = None) -> Path | None:
    """The built front-end folder, or None if it has not been built."""
    root = root or Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return root if (root / "index.html").is_file() else None


def mount_frontend(app: FastAPI, dist: Path | None) -> bool:
    """Serve the built front-end at "/". Mount last: routes declared before this keep precedence. Returns whether it mounted."""
    if dist is None:
        return False
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    return True
