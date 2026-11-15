import sys, threading, os
os.environ["TD_LOAD_ENV_FILE"] = "0"
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "backend"))
from app import nasa_power
from app.analysis import grid_points
for i in range(3000):
    nasa_power._cache_put(("T2M", i, 0, 1981, 2024), {})
stop = False
def writer():
    i = 10_000
    while not stop:
        nasa_power._cache_put(("T2M", i, 0, 1981, 2024), {}); i += 1
t = threading.Thread(target=writer); t.start()
errors = 0
for _ in range(300):
    try:
        nasa_power.cache_health()
    except RuntimeError as e:
        errors += 1; msg = str(e)
stop = True; t.join()
print("cache_health RuntimeErrors:", errors, msg if errors else "")
print("grid near pole:", sorted(set(la for la, _ in grid_points(85, 0, 40, 5))), len(grid_points(85, 0, 40, 5)), len(set(grid_points(85, 0, 40, 5))))
print("grid near dateline lons:", sorted(set(lo for _, lo in grid_points(0, 175, 20, 5))))
