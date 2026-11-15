/**
 * News for the capital popups: gradual, polite and bounded.
 *
 * The capitals (lib/capitals.js, main countries first) are looked up through the same cached, rate-limited /api/news flow
 * as saved places, in batches of at most five, one batch at a time, `pauseMs` apart. It never asks about arbitrary
 * coordinates, never runs before onboarding is finished (the Main page starts it), never blocks rendering, and keeps
 * going across Main/Explore switches because the progress lives in this module, not in a component. It stops by itself
 * x; a rate-limited batch waits `backoffMs` first. Whatever has arrived is shown;
 * a capital with no news simply shows its geography card.
 */
import { locationsParam, savedStories } from "./globeNews.js";
import { capitalPlaces } from "./capitals.js";

export const CAPITAL_NEWS = {
  batchSize: 5,
  maxBatches: 24, // 120 capitals per visit at most, the main countries first
  pauseMs: 8000, // provider allows roughly one request per five seconds
  backoffMs: 60000,
  maxFails: 3,
  coolOffMs: 300000, // after that many failures in a row, rest five minutes ...
  maxCoolOffs: 1, // ... and try again once more before giving up for the visit
  tolerance: 0.6, // degrees: the server may snap a city to its own centroid
};

const store = { stories: [], batch: 0, fails: 0, coolOffs: 0, running: false, stopped: false, listeners: new Set(), version: 0 };

const emit = () => {
  store.version += 1;
  for (const l of store.listeners) l();
};
export const subscribeCapitalNews = (l) => {
  store.listeners.add(l);
  return () => store.listeners.delete(l);
};
export const capitalStoriesSnapshot = () => store;
/** Test hook: forget everything (a new session). */
export function resetCapitalNews() {
  Object.assign(store, { stories: [], batch: 0, fails: 0, coolOffs: 0, running: false, stopped: false, version: store.version + 1 });
}

/** How one answered batch counts: a batch where every capital failed and nothing came back is a failure. */
export function batchOutcome(data, count) {
  const items = data?.items ?? [];
  const failed = data?.partial_failures ?? [];
  const rateLimited = failed.some((f) => f?.code === "rate_limited");
  return { failed: items.length === 0 && failed.length >= count, rateLimited };
}

/**
 * Run the lookups. `fetchBatch(param, signal)` returns the /api/news response; `sleep(ms)` waits. Resolves when it has
 * finished, stopped or been aborted. Safe to call twice: only one run is ever active.
 */
export async function runCapitalNews({ fetchBatch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), signal, cfg = CAPITAL_NEWS }) {
  if (store.running || store.stopped) return;
  store.running = true;
  const places = capitalPlaces();
  try {
    while (store.batch < cfg.maxBatches && !signal?.aborted) {
      const batch = places.slice(store.batch * cfg.batchSize, (store.batch + 1) * cfg.batchSize);
      if (!batch.length) break;
      let data = null;
      try {
        data = await fetchBatch(locationsParam(batch), signal);
      } catch (err) {
        if (signal?.aborted || err?.name === "AbortError") return;
      }
      store.batch += 1;
      if (data) {
        const found = savedStories(data, batch, cfg.tolerance);
        if (found.length) store.stories = [...store.stories, ...found];
      }
      const out = data ? batchOutcome(data, batch.length) : { failed: true, rateLimited: false };
      store.fails = out.failed ? store.fails + 1 : 0;
      emit();
      if (store.fails >= cfg.maxFails) {
        // The provider keeps failing (rate-limited or down). Leave it alone for a long cool-off, then try again once more;
        // if it still fails, stop for the rest of this visit.
        if (store.coolOffs >= cfg.maxCoolOffs) {
          store.stopped = true;
          break;
        }
        store.coolOffs += 1;
        store.fails = 0;
        await sleep(cfg.coolOffMs);
        continue;
      }
      await sleep(out.rateLimited ? cfg.backoffMs : cfg.pauseMs);
    }
  } finally {
    store.running = false;
  }
}
