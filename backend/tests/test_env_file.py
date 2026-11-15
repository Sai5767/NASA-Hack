"""Tests for the optional local settings file (app/env_file.py) and the committed template backend/.env.example."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient

from app.env_file import ALLOWED_PREFIXES, SWITCH, load_local_env
from app.main import app
from app.resilience import redact_secrets

BACKEND = Path(__file__).resolve().parents[1]
client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_environment(monkeypatch):
    """Work on a private copy of the environment, so nothing the loader sets can leak into other tests."""
    monkeypatch.setattr(os, "environ", dict(os.environ))
    os.environ[SWITCH] = "1"  # tests/conftest.py turns the file off for the rest of the suite
    for name in ("OPENAI_API_KEY", "OPENAI_EXPLANATION_MODEL", "METEOMATICS_USERNAME", "METEOMATICS_PASSWORD", "NEWS_PROVIDER", "NEWS_API_KEY", "TD_CASE_SECRET"):
        os.environ.pop(name, None)


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / ".env"
    path.write_text(text, encoding="utf-8")
    return path


def test_a_missing_or_unreadable_file_is_a_quiet_no_op(tmp_path):
    empty = {"loaded": [], "kept_from_environment": [], "ignored": []}
    assert load_local_env(tmp_path / "does-not-exist.env") == empty
    assert load_local_env(tmp_path) == empty  # a folder, not a file
    garbage = tmp_path / "garbage.env"
    garbage.write_bytes(b"\xff\xfe\x00 not text \x80\x81")
    assert load_local_env(garbage) == empty  # not valid UTF-8: same as no file


def test_the_file_only_fills_in_what_is_unset_and_the_real_environment_wins(tmp_path):
    path = _write(
        tmp_path,
        "# a comment\n"
        "OPENAI_API_KEY=sk-from-the-file-0000\n"
        'METEOMATICS_PASSWORD="file password with spaces"\n'
        "METEOMATICS_USERNAME=user_from_file\n"
        "NEWS_PROVIDER=\n"            # blank: that feature stays off
        "TD_CASE_SECRET=signing_from_file\n"
        "PATH=/somewhere/evil\n"      # not a setting this app reads
        "PYTHONPATH=/somewhere/evil\n",
    )
    os.environ["METEOMATICS_USERNAME"] = "user_from_the_real_environment"
    path_before = os.environ.get("PATH")

    result = load_local_env(path)

    assert os.environ["OPENAI_API_KEY"] == "sk-from-the-file-0000"
    assert os.environ["METEOMATICS_PASSWORD"] == "file password with spaces"
    assert os.environ["TD_CASE_SECRET"] == "signing_from_file"
    assert os.environ["METEOMATICS_USERNAME"] == "user_from_the_real_environment"  # environment first
    assert "NEWS_PROVIDER" not in os.environ
    assert os.environ.get("PATH") == path_before
    assert os.environ.get("PYTHONPATH") != "/somewhere/evil"

    assert sorted(result["loaded"]) == ["METEOMATICS_PASSWORD", "OPENAI_API_KEY", "TD_CASE_SECRET"]
    assert result["kept_from_environment"] == ["METEOMATICS_USERNAME"]
    assert sorted(result["ignored"]) == ["PATH", "PYTHONPATH"]
    # names only: no value ever appears in what is returned
    assert "sk-from-the-file" not in repr(result) and "file password" not in repr(result)


def test_an_empty_environment_variable_counts_as_unset(tmp_path):
    os.environ["OPENAI_API_KEY"] = "   "
    load_local_env(_write(tmp_path, "OPENAI_API_KEY=sk-filled-from-file\n"))
    assert os.environ["OPENAI_API_KEY"] == "sk-filled-from-file"


def test_the_switch_turns_the_file_off(tmp_path):
    os.environ[SWITCH] = "0"
    assert load_local_env(_write(tmp_path, "OPENAI_API_KEY=sk-should-not-load\n"))["loaded"] == []
    assert "OPENAI_API_KEY" not in os.environ


def test_values_that_came_from_the_file_are_scrubbed_from_error_text_like_any_other_secret(tmp_path):
    load_local_env(_write(tmp_path, "METEOMATICS_PASSWORD=pw_from_file_8841\n"))
    assert "pw_from_file_8841" not in redact_secrets("upstream said: bad login pw_from_file_8841")


def test_the_committed_template_lists_names_only_and_loads_nothing():
    template = BACKEND / ".env.example"
    assert template.is_file(), "backend/.env.example (placeholder names only) must be committed"
    values = dotenv_values(template)
    assert {"OPENAI_API_KEY", "OPENAI_EXPLANATION_MODEL", "METEOMATICS_USERNAME", "METEOMATICS_PASSWORD"} <= set(values)
    assert all(not (v or "").strip() for v in values.values()), "the template must contain no values at all"
    assert all(name.startswith(ALLOWED_PREFIXES) for name in values), "the template must only name settings the app reads"
    assert load_local_env(template)["loaded"] == []


def test_the_app_starts_and_every_optional_feature_degrades_when_no_key_is_set(fake_power):
    # No keys, no .env: nothing may crash, and each feature must say plainly that it is off.
    health = client.get("/api/health/details")
    assert health.status_code == 200
    features = health.json()["features"]
    assert features["ai_explanations"]["configured"] is False and features["ai_explanations"]["status"] == "fallback_only"
    assert features["meteomatics"]["configured"] is False and features["meteomatics"]["status"] == "unconfigured"

    live = client.get("/api/live-weather", params={"lat": 52.52, "lon": 13.46})
    assert live.status_code == 200 and live.json()["status"] == "unconfigured"

    trend = client.get("/api/trend", params={"variable": "T2M", "lat": 70, "lon": -150, "start_year": 1981, "end_year": 2024}).json()
    why = client.post("/api/explanations", json={"case_signature": trend["case_signature"]})
    assert why.status_code == 200 and why.json()["status"] in ("no_key", "no_evidence")



def test_backend_env_is_loaded_before_any_module_that_reads_settings_at_import():
    # A13: main.py used to import version.py (which reads TD_VERSION at import) before calling load_local_env().
    import ast

    tree = ast.parse((BACKEND / "app" / "main.py").read_text(encoding="utf-8"))
    body = [n for n in tree.body if not (isinstance(n, ast.Expr) and isinstance(getattr(n, "value", None), ast.Constant))]
    body = [n for n in body if not (isinstance(n, ast.ImportFrom) and n.module == "__future__")]
    first_import, first_call = body[0], body[1]
    assert isinstance(first_import, ast.ImportFrom) and first_import.module == "env_file"
    assert isinstance(first_call, ast.Expr) and getattr(first_call.value.func, "id", None) == "load_local_env"
    later_app_imports = [n for n in body[2:] if isinstance(n, ast.ImportFrom) and n.level == 1]
    assert any(n.module == "version" for n in later_app_imports)


def test_td_version_from_the_env_file_reaches_the_version_report(tmp_path, monkeypatch):
    # A13 end to end in a fresh interpreter: TD_VERSION only in a .env file, no git -> /api/version shows it.
    import subprocess
    import sys

    env_file = _write(tmp_path, "TD_VERSION=from-dot-env-77\n")
    code = (
        "import sys, pathlib; sys.path.insert(0, %r)\n"
        "import app.env_file as ef; ef.ENV_FILE_PATH = pathlib.Path(%r)\n"
        "import app.main as m\n"
        "print(m.VERSION['version'])\n"
    ) % (str(BACKEND), str(env_file))
    env = {k: v for k, v in os.environ.items() if k not in ("TD_VERSION", "PATH")}
    env["PATH"] = ""  # no git on PATH (like the Docker image), so the version must come from TD_VERSION
    env["TD_LOAD_ENV_FILE"] = "1"
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60, cwd=str(BACKEND))
    assert done.returncode == 0, done.stderr[-2000:]
    assert done.stdout.strip().splitlines()[-1] == "from-dot-env-77"


def test_the_test_suite_cannot_reach_the_network():
    # Phase 0 item D: tests/conftest.py refuses every non-loopback connection, so a test that forgets to mock NASA POWER,
    # OpenAI, Meteomatics or GDELT fails immediately instead of silently waiting on the network.
    import socket

    with pytest.raises(OSError, match="offline"):
        socket.getaddrinfo("power.larc.nasa.gov", 443)
    with pytest.raises(OSError, match="offline"):
        socket.create_connection(("93.184.216.34", 443), timeout=1)
