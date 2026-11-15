"""Which version of the app is running, and from where.

The launcher and the page both ask /api/version, so a stale server (an older copy, or code that changed after the server
started) can be told apart from a fresh one instead of being silently reused. Computed once, when the server starts: that
is the code the server actually loaded.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "trend-detective"


def folder_id(path: Path | str = ROOT) -> str:
    """A short, one-way fingerprint of the folder the server runs from.

    The launcher compares it with its own folder to spot a server started from another copy. The folder path itself is
    never published: on a laptop it contains the owner's user name.
    """
    norm = str(path).rstrip("\\/").lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def _git(*args: str) -> str | None:
    try:
        done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def read_version() -> dict:
    """The commit this folder is at, whether tracked files have uncommitted changes, and a fingerprint of its folder."""
    commit = _git("rev-parse", "--short", "HEAD") or os.environ.get("TD_VERSION") or "unknown"
    return {
        "app": APP_ID,
        "version": commit,
        "branch": _git("branch", "--show-current") or None,
        "dirty": bool(_git("status", "--porcelain", "--untracked-files=no")),
        "root_id": folder_id(),
        "started_epoch": time.time(),
    }


VERSION = read_version()
