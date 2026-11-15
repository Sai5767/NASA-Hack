/**
 * A small bounded in-memory cache for public, non-sensitive API responses (monthly frames, forecast, live weather,
 * news). Nothing is written to storage. Oldest entries are evicted first; entries expire after `ttlMs`.
 */
export function createMemoCache({ max = 8, ttlMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, hit); // most recently used last
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}
