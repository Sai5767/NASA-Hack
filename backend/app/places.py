"""A small gazetteer of well-known places and regions (approximate centers).

Used for place search and for the World view, which samples one variable across all of them.
These are sample sites, not a complete or evenly spaced picture of the planet.
"""

from __future__ import annotations

# (id, name, kind, lat, lon)
_RAW = [
    # --- Cities ---
    ("delhi", "Delhi", "city", 28.61, 77.21), ("beijing", "Beijing", "city", 39.90, 116.40),
    ("shanghai", "Shanghai", "city", 31.23, 121.47), ("tokyo", "Tokyo", "city", 35.68, 139.69),
    ("jakarta", "Jakarta", "city", -6.20, 106.85), ("mumbai", "Mumbai", "city", 19.08, 72.88),
    ("dhaka", "Dhaka", "city", 23.81, 90.41), ("bangkok", "Bangkok", "city", 13.76, 100.50),
    ("manila", "Manila", "city", 14.60, 120.98), ("singapore", "Singapore", "city", 1.35, 103.82),
    ("karachi", "Karachi", "city", 24.86, 67.01), ("tehran", "Tehran", "city", 35.69, 51.39),
    ("riyadh", "Riyadh", "city", 24.71, 46.68), ("dubai", "Dubai", "city", 25.20, 55.27),
    ("istanbul", "Istanbul", "city", 41.01, 28.98), ("moscow", "Moscow", "city", 55.76, 37.62),
    ("london", "London", "city", 51.51, -0.13), ("paris", "Paris", "city", 48.86, 2.35),
    ("madrid", "Madrid", "city", 40.42, -3.70), ("cairo", "Cairo", "city", 30.04, 31.24),
    ("lagos", "Lagos", "city", 6.52, 3.38), ("nairobi", "Nairobi", "city", -1.29, 36.82),
    ("johannesburg", "Johannesburg", "city", -26.20, 28.05), ("new-york", "New York", "city", 40.71, -74.01),
    ("chicago", "Chicago", "city", 41.88, -87.63), ("houston", "Houston", "city", 29.76, -95.37),
    ("denver", "Denver", "city", 39.74, -104.99), ("phoenix", "Phoenix", "city", 33.45, -112.07),
    ("los-angeles", "Los Angeles", "city", 34.05, -118.24), ("miami", "Miami", "city", 25.76, -80.19),
    ("toronto", "Toronto", "city", 43.65, -79.38), ("mexico-city", "Mexico City", "city", 19.43, -99.13),
    ("bogota", "Bogotá", "city", 4.71, -74.07), ("lima", "Lima", "city", -12.05, -77.04),
    ("sao-paulo", "São Paulo", "city", -23.55, -46.63), ("buenos-aires", "Buenos Aires", "city", -34.60, -58.38),
    ("sydney", "Sydney", "city", -33.87, 151.21), ("perth", "Perth", "city", -31.95, 115.86),
    ("anchorage", "Anchorage", "city", 61.22, -149.90), ("honolulu", "Honolulu", "city", 21.31, -157.86),
    ("reykjavik", "Reykjavik", "city", 64.15, -21.94),
    # --- Landscapes and regions ---
    ("amazon", "Amazon Basin", "rainforest", -3.1, -60.0), ("congo", "Congo Basin", "rainforest", -1.0, 22.0),
    ("borneo", "Borneo", "rainforest", 1.0, 114.0), ("sahara", "Central Sahara", "desert", 23.0, 12.0),
    ("sahel", "Sahel", "dryland", 14.0, 2.0), ("gobi", "Gobi Desert", "desert", 42.0, 105.0),
    ("outback", "Australian Outback", "desert", -25.0, 134.0), ("arabia", "Arabian Peninsula", "desert", 24.0, 45.0),
    ("tibet", "Tibetan Plateau", "mountain", 31.0, 88.0), ("andes", "Central Andes", "mountain", -15.0, -70.0),
    ("alps", "The Alps", "mountain", 46.5, 9.0), ("patagonia", "Patagonia", "mountain", -45.0, -70.0),
    ("corn-belt", "Iowa Corn Belt", "farmland", 42.0, -93.6), ("great-plains", "US Great Plains", "farmland", 40.0, -100.0),
    ("mekong", "Mekong Delta", "delta", 10.0, 105.5), ("ganges", "Ganges Delta", "delta", 22.5, 89.0),
    ("nile", "Nile Delta", "delta", 31.0, 31.0), ("siberia", "Siberia (Yakutsk)", "boreal", 62.0, 129.7),
    ("alaska-north", "Arctic Alaska", "polar", 70.0, -150.0), ("greenland", "Greenland Ice Sheet", "polar", 72.0, -40.0),
    ("barents", "Barents Sea", "polar", 75.0, 40.0), ("antarctic-peninsula", "Antarctic Peninsula", "polar", -66.0, -62.0),
    # --- Open ocean ---
    ("eq-pacific", "Equatorial Pacific", "ocean", 0.0, -160.0), ("n-atlantic", "North Atlantic", "ocean", 50.0, -30.0),
    ("indian-ocean", "Indian Ocean", "ocean", -15.0, 75.0), ("southern-ocean", "Southern Ocean", "ocean", -55.0, 0.0),
    ("great-barrier", "Great Barrier Reef", "ocean", -18.0, 147.0),
]

PLACES: list[dict] = [
    {"id": pid, "name": name, "kind": kind, "lat": lat, "lon": lon} for pid, name, kind, lat, lon in _RAW
]
