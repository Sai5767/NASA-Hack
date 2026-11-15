import { useCallback, useEffect, useState } from "react";
import { emptyProfile, loadProfile, resetProfile, sanitizeProfile, saveProfile } from "../../lib/profile.js";
import { applyMotionPref } from "../../lib/theme.js";

/**
 * The profile, loaded once from td-profile-v2 (migrating V1 if needed) and saved after every change.
 * status: "ok" | "corrupt" (a fresh profile replaced an unreadable one) | "blocked" (nothing persists past this tab).
 * Nothing is written before sign-in, so a reset leaves no profile key behind.
 */
export function useProfileStore() {
  const [state, setState] = useState(() => loadProfile());
  const { profile } = state;

  useEffect(() => {
    if (!profile.account) return;
    const ok = saveProfile(profile);
    setState((s) => {
      const status = ok ? (s.status === "corrupt" ? "corrupt" : "ok") : "blocked";
      return s.status === status ? s : { ...s, status };
    });
  }, [profile]);

  useEffect(() => applyMotionPref(profile.prefs.reduceMotion), [profile.prefs.reduceMotion]);

  const update = useCallback((next) => {
    setState((s) => ({ ...s, profile: sanitizeProfile(typeof next === "function" ? next(s.profile) : next) }));
  }, []);

  const reset = useCallback(() => {
    const ok = resetProfile();
    setState({ profile: emptyProfile(), status: ok ? "ok" : "blocked", migrated: false });
  }, []);

  const dismissNotice = useCallback(() => setState((s) => (s.status === "corrupt" || s.migrated ? { ...s, status: s.status === "corrupt" ? "ok" : s.status, migrated: false } : s)), []);

  return { profile, status: state.status, migrated: state.migrated, update, reset, dismissNotice };
}

/** A media query as state. */
export function useMedia(query) {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  return match;
}

export const TABLET_QUERY = "(min-width: 768px) and (max-width: 1199.98px)";
export const MOBILE_QUERY = "(max-width: 767.98px)";
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
