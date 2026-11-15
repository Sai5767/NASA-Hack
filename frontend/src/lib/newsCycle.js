/**
 * Automatic popup cycle for the globe (Main page): capital cities and saved-place news.
 *
 * Several popups can be open at once, but never a crowd: at most `maxActive` (four on a desktop, two on a phone), and a
 * new one opens only one at a time, `spawnGapMs` apart, so they come out one after another instead of all together.
 * A popup is only chosen when it is eligible (on the visible hemisphere, away from the limb, with room for its box that
 * does not overlap another popup), by priority (saved places first, then capitals with verified news, then capitals with
 * unverified news, then the rest), the one shown longest ago first, with a long rest for a capital that was just shown.
 * Each popup dwells for `dwellMs` and then closes. Hovering or focusing a popup freezes the set (nothing expires, nothing
 * new opens) so the user can reach and click it. Anything else the user does (drag, scrub, an open drawer, reduced
 * motion) closes them all at once, and the cycle only resumes after the interaction has ended and a short idle delay.
 *
 * Pure and deterministic: no timers, no DOM, no fetches. The globe calls `stepCycle` from its ~250 ms layout pass.
 */

export const CYCLE = {
  dwellMs: 7000, // how long one popup stays
  spawnGapMs: 1300, // a new popup opens at most this often, so they come out one by one
  resumeMs: 1100, // idle time after an interaction before the cycle starts again
  cooldownMs: 45000, // a popup that was just shown rests this long while others are available
  minFade: 0.9, // a marker must be at least this far from the limb to open a popup (1 = facing us)
  maxActive: 4, // popups open at once on a desktop
  maxActivePhone: 2, // ... and on a phone
};

export function createCycle() {
  return { active: new Map(), nextSpawnAt: 0, resumeAt: 0, lastShown: new Map(), wasEnabled: false, frozenAt: null };
}

/** The ids of the popups that are open right now. */
export const activeIds = (state) => [...state.active.keys()];

const shownAt = (state, id) => state.lastShown.get(id) ?? Number.NEGATIVE_INFINITY;
const rankOf = (c) => c.rank ?? (c.kind === "capital" ? 3 : 0);

/**
 * Which candidate opens next, or null. `candidates` are `{ id, kind, rank, order, eligible }`; ones already open are skipped.
 * Lower rank first (0 saved place news, 1 capital with verified news, 2 capital with unverified news, 3 capital without
 * news); within a rank the least recently shown; ties follow `order` (stable, deterministic).
 */
export function pickNext(candidates, state, now, cfg = CYCLE) {
  const ok = candidates.filter((c) => c.eligible && !state.active.has(c.id));
  if (!ok.length) return null;
  const rested = ok.filter((c) => now - shownAt(state, c.id) >= cfg.cooldownMs);
  const pool = rested.length ? rested : ok; // everything is cooling down: repeat the least recent rather than go dark
  return [...pool].sort((a, b) => rankOf(a) - rankOf(b) || shownAt(state, a.id) - shownAt(state, b.id) || a.order - b.order)[0].id;
}

/** True when a marker may open an automatic popup right now. */
export function isEligible({ fade, clustered, hasStory, placeable }, cfg = CYCLE) {
  return !!hasStory && !clustered && !!placeable && fade >= cfg.minFade;
}

/**
 * Advance the cycle. `enabled` is false whenever the user (or reduced motion) holds the globe; `frozen` is true while a
 * popup is hovered or focused; `max` is how many may be open (defaults to the desktop limit). Mutates and returns `state`.
 */
export function stepCycle(state, { enabled, frozen = false, candidates, max = CYCLE.maxActive }, now, cfg = CYCLE) {
  if (!enabled) {
    // Takeover: close everything at once, and restart the idle delay when the interaction ends.
    state.active.clear();
    state.wasEnabled = false;
    state.frozenAt = null;
    state.resumeAt = now + cfg.resumeMs;
    return state;
  }
  state.wasEnabled = true;
  if (now < state.resumeAt) {
    state.active.clear();
    return state;
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  // A popup that moved toward the limb, was hidden or lost its room is tucked away at once, even while frozen.
  for (const id of [...state.active.keys()]) {
    if (!byId.get(id)?.eligible) {
      state.active.delete(id);
      state.lastShown.set(id, now);
    }
  }
  if (frozen) {
    if (state.frozenAt == null) state.frozenAt = now;
    return state; // nothing expires and nothing new opens while the user is reading
  }
  if (state.frozenAt != null) {
    // Reading ended: give every open popup (and the next spawn) back the time that was spent frozen.
    const shift = now - state.frozenAt;
    for (const v of state.active.values()) v.since += shift;
    state.nextSpawnAt += shift;
    state.frozenAt = null;
  }
  const closedNow = new Set();
  for (const [id, v] of [...state.active]) {
    if (now - v.since >= cfg.dwellMs) {
      state.active.delete(id);
      state.lastShown.set(id, now);
      closedNow.add(id);
    }
  }
  if (state.active.size < max && now >= state.nextSpawnAt) {
    // A popup that closed in this very step is never reopened in it (it would never visibly close).
    const id = pickNext(closedNow.size ? candidates.filter((c) => !closedNow.has(c.id)) : candidates, state, now, cfg);
    if (id != null) {
      state.active.set(id, { since: now });
      state.lastShown.set(id, now);
      state.nextSpawnAt = now + cfg.spawnGapMs;
    }
  }
  return state;
}
