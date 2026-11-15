import asyncio, gzip, json, sys, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
import httpx
from app import resilience

body = json.dumps({"ok": True}).encode()
def handler(request):
    return httpx.Response(200, content=gzip.compress(body), headers={"content-encoding": "gzip", "content-type": "application/json"})
real = httpx.AsyncClient
resilience.httpx.AsyncClient = lambda *a, **kw: real(*a, transport=httpx.MockTransport(handler), **kw)
try:
    r = asyncio.run(resilience.request_with_resilience("demo", "GET", "https://example.org/x", retry_delays=()))
    print("OK", r.status_code, r.json())
except Exception as e:
    print("FAILED:", type(e).__name__, getattr(e, "code", None), e)
resilience.httpx.AsyncClient = real

# TTL test
print("monotonic resolution", time.get_clock_info("monotonic"))
c = resilience.BoundedTTLCache("t", 2, 10)
c.put("a", 1)
print("get with ttl 0:", c.get("a", ttl_override=0.0))
# negative ttl / small values
c2 = resilience.BoundedTTLCache("t", 2, 0.0001)
print("ttl_seconds clamped to", c2.ttl_seconds)
