import sys, os
os.environ["TD_LOAD_ENV_FILE"] = "0"
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from fastapi.testclient import TestClient
from app import analysis
from app.main import app
from tests.conftest import make_monthly
async def fake(parameters, lat, lon, start, end):
    return {p: make_monthly(start, end) for p in parameters}
analysis.fetch_monthly_multi = fake
c = TestClient(app, raise_server_exceptions=False)
for q in [("/api/live-weather", {"lat": "nan", "lon": 0}), ("/api/live-weather", {"lat": "inf", "lon": 0}),
          ("/api/grid", {"variable": "T2M", "lat": 0, "lon": 0, "size": "nan"}),
          ("/api/monthly-frames", {"variable": "T2M", "lat": 0, "lon": 0, "size": "nan"}),
          ("/api/monthly-frames", {"variable": "T2M", "lat": 0, "lon": 0, "start_year": 2026, "end_year": 2026, "n": 1})]:
    r = c.get(*[q[0]], params=q[1])
    body = r.json()
    print(q, r.status_code, str(body.get("detail", body.get("coverage")))[:160])
