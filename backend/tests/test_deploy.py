"""Deployment helpers: configurable CORS origins and serving the built front-end beside the API."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.deploy import LOCAL_ORIGINS, allowed_origins, frontend_dist, mount_frontend


def test_local_origins_are_always_allowed():
    assert allowed_origins("") == LOCAL_ORIGINS


def test_extra_origins_come_from_a_comma_separated_list_cleaned_and_deduplicated():
    out = allowed_origins(" https://demo.example.com/ ,https://demo.example.com, http://localhost:5173 ,, ")
    assert out == [*LOCAL_ORIGINS, "https://demo.example.com"]


def test_the_environment_variable_is_used_when_no_value_is_passed(monkeypatch):
    monkeypatch.setenv("TD_ALLOWED_ORIGINS", "https://a.example,https://b.example")
    assert allowed_origins()[-2:] == ["https://a.example", "https://b.example"]
    monkeypatch.delenv("TD_ALLOWED_ORIGINS")
    assert allowed_origins() == LOCAL_ORIGINS


def test_frontend_dist_needs_an_index_file(tmp_path):
    assert frontend_dist(tmp_path) is None
    (tmp_path / "index.html").write_text("<html></html>")
    assert frontend_dist(tmp_path) == tmp_path


def _site(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>Trend Detective</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log('hi')")
    app = FastAPI()

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    return app


def test_the_built_front_end_is_served_and_api_routes_keep_precedence(tmp_path):
    app = _site(tmp_path)
    assert mount_frontend(app, frontend_dist(tmp_path)) is True
    client = TestClient(app)
    assert client.get("/api/ping").json() == {"ok": True}
    home = client.get("/")
    assert home.status_code == 200 and "Trend Detective" in home.text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/nope.txt").status_code == 404


def test_without_a_build_nothing_is_mounted_and_the_api_still_works(tmp_path):
    app = _site(tmp_path)
    assert mount_frontend(app, frontend_dist(tmp_path / "missing")) is False
    client = TestClient(app)
    assert client.get("/api/ping").json() == {"ok": True}
    assert client.get("/").status_code == 404
