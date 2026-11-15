"""Optional local settings file: `backend/.env`.

Rule (V2): real environment variables come first; `backend/.env` is read second and only fills in what the environment leaves
unset. So on Azure (or any host that sets environment variables) the file is never needed and never wins, and on a laptop it
lets the owner keep keys in one untracked place instead of retyping them in every terminal.

  * The file is optional. Absent, unreadable or empty, nothing happens and the app starts normally.
  * Only known setting names are accepted (see ALLOWED_PREFIXES). A `.env` cannot set PATH, PYTHONPATH or anything else.
  * Blank values are skipped, so a copy of `.env.example` with nothing filled in turns every optional feature off.
  * Values are never printed, logged or returned: the result lists names only.
  * Loaded values go into the process environment, so every reader (including the secret redaction in resilience.py, which
    scrubs the values of known secret names from error text) treats them like any other environment variable.

`backend/.env` is ignored by Git and by Docker. `backend/.env.example` (names only, no values) is the committed template.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

# backend/.env, wherever the server is started from
ENV_FILE_PATH = Path(__file__).resolve().parents[1] / ".env"

# The settings this app reads (see resilience.load_config and deploy.allowed_origins). Anything else in the file is ignored.
ALLOWED_PREFIXES = ("OPENAI_", "EXPLANATION_", "NEWS_", "METEOMATICS_", "NASA_POWER_", "STREAMS_", "TD_")

# Tests (and anyone who wants the file ignored) set this to 0.
SWITCH = "TD_LOAD_ENV_FILE"


def load_local_env(path: Path | None = None) -> dict[str, list[str]]:
    """Fill unset settings from the local env file. Returns setting NAMES only: `loaded`, `kept_from_environment`, `ignored`."""
    result: dict[str, list[str]] = {"loaded": [], "kept_from_environment": [], "ignored": []}
    if os.environ.get(SWITCH, "1").strip().lower() in ("0", "false", "no", "off"):
        return result
    env_path = ENV_FILE_PATH if path is None else Path(path)
    if not env_path.is_file():
        return result
    try:
        values = dotenv_values(env_path, encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return result  # an unreadable file is the same as no file

    for name, raw in values.items():
        value = (raw or "").strip()
        if not value:
            continue  # blank: feature stays off
        if not name.startswith(ALLOWED_PREFIXES):
            result["ignored"].append(name)
            continue
        if os.environ.get(name, "").strip():
            result["kept_from_environment"].append(name)  # a real environment variable always wins
            continue
        os.environ[name] = value
        result["loaded"].append(name)
    return result
