import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrend, requestExplanation } from "../../api.js";
import { canExplain, explanationPayload, secondsLeft, shouldRetryStale, trendParamsOf } from "./logic.js";

const IDLE = { phase: "idle", res: null, error: null, receivedAt: 0, question: "" };

/**
 * The manual "Why might this be happening?" request (spec 5.7). Nothing is sent until `ask()` is called.
 *
 *   phase: "idle" | "loading" | "refreshing" (stale signature: refetching the trend once) | "done" | "error"
 *
 * - Sends only `{ case_signature, question? }` (lib: explanationPayload).
 * - HTTP 422 naming the case signature → refetch /api/trend for the same case, then retry exactly once with the fresh
 *   signature; `onTrendRefreshed(freshTrend)` lets the owner of the trend state adopt it.
 * - A newer ask, a different case or unmount aborts the request in flight (AbortController).
 */
export function useExplanation(trend, { onTrendRefreshed } = {}) {
  const [state, setState] = useState(IDLE);
  const ctrl = useRef(null);
  const trendRef = useRef(trend);
  const adopted = useRef(null);
  const refreshedCb = useRef(onTrendRefreshed);
  refreshedCb.current = onTrendRefreshed;

  const sig = trend?.case_signature ?? null;
  useEffect(() => {
    // A signature this hook just fetched itself (stale retry) is the same case: keep the answer.
    if (sig && sig === adopted.current) return;
    trendRef.current = trend;
    ctrl.current?.abort();
    setState(IDLE);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => ctrl.current?.abort(), []);

  const ask = useCallback(async (question = "") => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    let current = trendRef.current;
    if (!canExplain(current)) return;
    setState((s) => ({ ...s, phase: "loading", error: null, question }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await requestExplanation(explanationPayload(current, question), c.signal);
        if (c.signal.aborted) return;
        setState({ phase: "done", res, error: null, receivedAt: Date.now(), question });
        return;
      } catch (err) {
        if (err?.name === "AbortError" || c.signal.aborted) return;
        if (!shouldRetryStale(err, attempt)) {
          setState((s) => ({ ...s, phase: "error", error: err }));
          return;
        }
        setState((s) => ({ ...s, phase: "refreshing" }));
        try {
          const fresh = await fetchTrend(trendParamsOf(current), c.signal);
          if (c.signal.aborted) return;
          if (!canExplain(fresh)) {
            setState((s) => ({ ...s, phase: "error", error: { status: 422, detail: null, message: "stale" } }));
            return;
          }
          adopted.current = fresh.case_signature;
          trendRef.current = fresh;
          current = fresh;
          refreshedCb.current?.(fresh);
          setState((s) => ({ ...s, phase: "loading" }));
        } catch (err2) {
          if (err2?.name === "AbortError" || c.signal.aborted) return;
          setState((s) => ({ ...s, phase: "error", error: err2 }));
          return;
        }
      }
    }
  }, []);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setState((s) => (s.res ? { ...s, phase: "done" } : IDLE));
  }, []);

  return { ...state, ask, cancel };
}

/** Whole seconds until a rate-limited request may be retried, ticking once a second while above zero. */
export function useCountdown(retryAfterSeconds, receivedAt) {
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(retryAfterSeconds, receivedAt, now);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left > 0, receivedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}
