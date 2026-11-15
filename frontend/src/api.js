// In development the API is on port 8000. In a production build it is the same server that serves the page, so the
// base is empty (same origin). VITE_API_BASE overrides both, for example to point a hosted page at a separate API.
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

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

async function postJson(path, payload = {}, signal) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Can't reach the analysis server. Is the backend running on port 8000?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : "The request failed.";
    throw new Error(detail);
  }
  return body;
}

export const fetchVariables = (signal) => getJson("/api/variables", {}, signal);
export const fetchTrend = (params, signal) => getJson("/api/trend", params, signal);
export const fetchSweep = (params, signal) => getJson("/api/sweep", params, signal);
export const fetchGrid = (params, signal) => getJson("/api/grid", params, signal);
export const fetchDuel = (params, signal) => getJson("/api/duel", params, signal);
export const fetchSuspects = (params, signal) => getJson("/api/suspects", params, signal);
export const fetchVitals = (params, signal) => getJson("/api/vitals", params, signal);
export const fetchWorld = (params, signal) => getJson("/api/world", params, signal);
export const fetchPlaces = (signal) => getJson("/api/places", {}, signal);
export const fetchForecast = (params, signal) => getJson("/api/forecast", params, signal);
export const fetchArchetypes = (params, signal) => getJson("/api/archetypes", params, signal);
export const fetchLedger = (params, signal) => getJson("/api/ledger", params, signal);
export const fetchVersion = (signal) => getJson("/api/version", {}, signal);

// V2 backend integration helpers (see docs/V2_API_CONTRACT.md and docs/V2_BACKEND_HANDOFF.md)
export const fetchHealthDetails = (signal) => getJson("/api/health/details", {}, signal);
export const fetchMonthlyFrames = (params, signal) => getJson("/api/monthly-frames", params, signal);
export const fetchMonthlyForecast = (params, signal) => getJson("/api/monthly-forecast", params, signal);
export const fetchExplanation = (payload, signal) => postJson("/api/explanations", payload, signal);
export const fetchNews = (params = {}, signal) => getJson("/api/news", params, signal);
export const fetchLiveWeather = (params, signal) => getJson("/api/live-weather", params, signal);


// ---- Insight additions (Agent 4: evidence verdict, manual Why). Append-only; existing exports above are unchanged. ----
/**
 * POST /api/explanations that keeps the HTTP status, so the caller can tell a stale case signature (HTTP 422 naming
 * the signature: refetch the trend, retry once) from any other failure. Throws an Error with `.status` and `.detail`
 * (`.status` is 0 when the server could not be reached). Send only `{ case_signature, question? }`.
 */
export async function requestExplanation(payload, signal) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/explanations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    const e = new Error("Can't reach the analysis server.");
    e.status = 0;
    e.detail = null;
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(typeof body.detail === "string" ? body.detail : "The request failed.");
    e.status = res.status;
    e.detail = body.detail ?? null;
    throw e;
  }
  return body;
}
