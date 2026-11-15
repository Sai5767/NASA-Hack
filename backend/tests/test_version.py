"""/api/version: the launcher and the page use it to tell a stale server from a fresh one."""

import subprocess
import time

from fastapi.testclient import TestClient

from app import version as version_module
from app.main import app

client = TestClient(app)


def test_the_endpoint_reports_what_the_launcher_needs():
    body = client.get("/api/version").json()
    assert body["app"] == "trend-detective"
    assert body["root_id"] == version_module.folder_id(version_module.ROOT)
    assert "root" not in body  # the local folder path (it contains the user name) is never published
    assert all(str(version_module.ROOT) not in str(value) for value in body.values())
    assert isinstance(body["dirty"], bool)
    assert 0 < body["started_epoch"] <= time.time()
    assert body["version"]  # a short commit, or "unknown" outside a git checkout


def test_the_version_is_the_checked_out_commit_when_git_is_available():
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=version_module.ROOT, capture_output=True, text=True)
    if head.returncode != 0:
        return  # not a git checkout (for example a Docker image): nothing to compare with
    assert version_module.read_version()["version"] == head.stdout.strip()


def test_without_git_the_version_falls_back_to_the_environment_then_unknown(monkeypatch):
    monkeypatch.setattr(version_module, "_git", lambda *args: None)
    monkeypatch.delenv("TD_VERSION", raising=False)
    assert version_module.read_version()["version"] == "unknown"
    monkeypatch.setenv("TD_VERSION", "build-42")
    info = version_module.read_version()
    assert info["version"] == "build-42" and info["dirty"] is False and info["branch"] is None


def test_a_git_that_is_missing_or_slow_never_breaks_the_server(monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("git is not installed")

    monkeypatch.setattr(version_module.subprocess, "run", boom)
    assert version_module._git("rev-parse") is None


def test_the_folder_fingerprint_matches_the_launchers_normalisation():
    # app-common.ps1 hashes the folder lower-cased with any trailing slash removed; both sides must agree.
    assert version_module.folder_id("C:\\Some\\Folder\\") == version_module.folder_id("c:\\some\\folder")
    assert version_module.folder_id("/srv/app/") == version_module.folder_id("/srv/app")
    assert len(version_module.folder_id("x")) == 16
