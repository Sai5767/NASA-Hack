import { useEffect, useLayoutEffect, useState } from "react";
import { clamp, easeOutCubic } from "./lib/format.js";
import { motionReduced } from "./lib/theme.js";

const QUERY = "(prefers-reduced-motion: reduce)";

/** OS "reduce motion" OR the in-app Account preference (`<html data-motion="reduced">`, set by lib/theme.js). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && motionReduced());
  useEffect(() => {
    const onChange = () => setReduced(motionReduced());
    onChange();
    const mq = window.matchMedia?.(QUERY);
    mq?.addEventListener("change", onChange);
    // The in-app preference is an attribute on <html>: watch it so a change in Account applies at once.
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(onChange);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      mq?.removeEventListener("change", onChange);
      observer?.disconnect();
    };
  }, []);
  return reduced;
}

/** State that survives reloads (localStorage). Falls back to plain state when storage is unavailable. */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage is a convenience only */
    }
  }, [key, value]);
  return [value, setValue];
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useWidth(ref, fallback = 600) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (w) => setWidth(Math.max(240, Math.round(w || fallback)));
    measure(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

/** Eased 0 -> 1 progress after an optional delay. Jumps straight to 1 for reduced motion. */
export function useProgress({ duration = 900, delay = 0, resetKey } = {}) {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return undefined;
    }
    setProgress(0);
    const start = performance.now() + delay;
    let raf;
    const tick = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      setProgress(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, delay, reduced, resetKey]);
  return progress;
}

/** A number that counts up from 0 to `target`. */
export function useCountUp(target, options) {
  const progress = useProgress(options);
  return (Number.isFinite(target) ? target : 0) * progress;
}

/** Reveals `text` one character at a time. Returns [visibleText, done, skip]. */
export function useTypewriter(text, { speed = 14, delay = 0 } = {}) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setCount(text.length);
      return undefined;
    }
    setCount(0);
    let timer;
    let i = 0;
    const starter = setTimeout(() => {
      timer = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length) clearInterval(timer);
      }, speed);
    }, delay);
    return () => {
      clearTimeout(starter);
      clearInterval(timer);
    };
  }, [text, speed, delay, reduced]);
  return [text.slice(0, count), count >= text.length, () => setCount(text.length)];
}
