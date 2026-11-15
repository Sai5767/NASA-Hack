/** Shareable links: the whole question lives in the URL hash, so a link reopens the same case. */

export const TAB_IDS = ["investigate", "sweep", "scan", "duel", "world", "vitals", "events", "ledger"];

export function encodeState({ tab, params, pinB }) {
  const q = new URLSearchParams();
  q.set("t", tab);
  if (params) {
    q.set("v", params.variable);
    q.set("lat", String(params.lat));
    q.set("lon", String(params.lon));
    q.set("from", String(params.start));
    q.set("to", String(params.end));
  }
  if (pinB) {
    q.set("blat", String(pinB.lat));
    q.set("blon", String(pinB.lon));
  }
  return q.toString();
}

const inRange = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;

/** Parse a URL hash. Returns null when it does not describe a valid state. */
export function decodeState(hash) {
  try {
    const q = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
    const tab = TAB_IDS.includes(q.get("t")) ? q.get("t") : "investigate";
    const state = { tab, params: null, pinB: null };

    const variable = q.get("v");
    const lat = Number(q.get("lat"));
    const lon = Number(q.get("lon"));
    if (variable && /^[A-Za-z0-9_]{2,32}$/.test(variable) && q.has("lat") && q.has("lon") && inRange(lat, -90, 90) && inRange(lon, -180, 180)) {
      const start = Number.parseInt(q.get("from"), 10);
      const end = Number.parseInt(q.get("to"), 10);
      state.params = {
        variable,
        lat,
        lon,
        start: inRange(start, 1981, 2100) ? start : 1981,
        end: inRange(end, 1981, 2100) ? end : new Date().getFullYear() - 1,
      };
    }

    const blat = Number(q.get("blat"));
    const blon = Number(q.get("blon"));
    if (q.has("blat") && q.has("blon") && inRange(blat, -90, 90) && inRange(blon, -180, 180)) {
      state.pinB = { lat: blat, lon: blon };
    }
    return state.params || state.pinB || tab !== "investigate" ? state : null;
  } catch {
    return null;
  }
}
