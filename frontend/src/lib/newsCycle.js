/**
 * Automatic news-callout cycle for the globe (final visual fix, section 3).
 *
 * Exactly one automatic callout is active at a time. It is chosen from the markers that are currently eligible (on the
 * visible hemisphere, away from the limb, with room for the box), saved places first and then the fixed showcase cities,
 * the one shown longest ago first, and a story that was just shown rests for a cooldown while others are available.
 * The active callout dwells, closes, a short gap passes, then the next one opens. Anything the user does (hover, focus,
 * click, drag, scrub, an open drawer, reduced motion) takes over: the automatic callout closes at once and the cycle
 * only resumes after the interaction has ended and a short idle delay has passed.
 *
 * Pure and deterministic: no timers, no DOM, no fetches. The globe calls `stepCycle` from its ~250 ms layout pass.
 */

export const CYCLE = {
  dwellMs: 5200, // how long one callout stays
  gapMs: 900, // calm pause between two callouts
  resumeMs: 1100, // idle time after an interaction before the cycle starts again
  cooldownMs: 24000, // a story that was just shown rests this long while another one is available
  minFade: 0.9, // a marker must be at least this far from the limb to open a callout (1 = facing us)
};

export function createCycle() {
  return { activeId: null, since: 0, nextAt: 0, resumeAt: 0, lastShown: new Map(), wasEnabled: false, lastKind: null };
}

const shownAt = (state, id) => state.lastShown.get(id) ?? Number.NEGATIVE_INFINITY;
const rank = (c) => (c.showcase ? 1 : 0); // saved places before showcase cities
const kindOf = (c) => (c.kind === "capital" ? "capital" : "news");

/**
 * Which candidate opens next, or null. `candidates` are `{ id, showcase, order, eligible }`.
 * Saved places win; within a group the least recently shown wins; ties follow `order` (stable, deterministic).
 */
export function pickNext(candidates, state, now, cfg = CYCLE) {
  const ok = candidates.filter((c) => c.eligible);
  if (!ok.length) return null;
  const rested = ok.filter((c) => now - shownAt(state, c.id) >= cfg.cooldownMs);
  const cooled = rested.length ? rested : ok; // everything is cooling down: repeat the least recent rather than go dark
  // News and capital popups take turns, so neither can crowd the other out; if only one kind is available it runs alone.
  const wanted = state.lastKind === "news" ? "capital" : "news";
  const turn = cooled.filter((c) => kindOf(c) === wanted);
  const pool = turn.length ? turn : cooled;
  return [...pool].sort((a, b) => rank(a) - rank(b) || shownAt(state, a.id) - shownAt(state, b.id) || a.order - b.order)[0].id;
}

/** True when a marker may open an automatic callout right now. */
export function isEligible({ fade, clustered, hasStory, placeable }, cfg = CYCLE) {
  return !!hasStory && !clustered && !!placeable && fade >= cfg.minFade;
}

/**
 * Advance the cycle. `enabled` is false whenever the user (or reduced motion) holds the globe; `candidates` as above.
 * Mutates and returns `state`; `state.activeId` is the single automatic callout (or null).
 */
export function stepCycle(state, { enabled, candidates }, now, cfg = CYCLE) {
  if (!enabled) {
    // Takeover: close at once, and restart the idle delay when the interaction ends.
    state.activeId = null;
    state.wasEnabled = false;
    state.resumeAt = now + cfg.resumeMs;
    return state;
  }
  state.wasEnabled = true;
  if (now < state.resumeAt) {
    state.activeId = null;
    return state;
  }
  if (state.activeId != null) {
    const cur = candidates.find((c) => c.id === state.activeId);
    if (!cur || !cur.eligible) {
      // Moved toward the limb, was clustered away or lost its room: tuck it away and rest briefly.
      state.activeId = null;
      state.nextAt = now + cfg.gapMs;
    } else if (now - state.since >= cfg.dwellMs) {
      state.lastShown.set(state.activeId, now);
      state.activeId = null;
      state.nextAt = now + cfg.gapMs;
    }
  }
  if (state.activeId == null && now >= state.nextAt) {
    const id = pickNext(candidates, state, now, cfg);
    if (id != null) {
      state.activeId = id;
      state.since = now;
      state.lastShown.set(id, now);
      state.lastKind = kindOf(candidates.find((c) => c.id === id) ?? {});
    }
  }
  return state;
}
