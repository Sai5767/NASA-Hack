const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

async function getJson(path, params = {}, signal) {
  const query = new URLSearchParams(params).toString();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Can't reach the analysis server. Is the backend running on port 8000?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : "The analysis failed.";
    throw new Error(detail);
  }
  return body;
}

export const fetchVariables = (signal) => getJson("/api/variables", {}, signal);
export const fetchTrend = (params, signal) => getJson("/api/trend", params, signal);
export const fetchSweep = (params, signal) => getJson("/api/sweep", params, signal);
export const fetchGrid = (params, signal) => getJson("/api/grid", params, signal);
export const fetchDuel = (params, signal) => getJson("/api/duel", params, signal);
