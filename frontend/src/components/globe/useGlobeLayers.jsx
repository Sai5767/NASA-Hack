/**
 * Shared state for the Main page's globe layers, timeline rail, live-weather card, forecast status and news.
 *
 * Request budget (plan 1, 7; spec 1.6):
 * - /api/monthly-frames: only the ACTIVE place and selected variable. Other saved places are never fetched.
 * - /api/monthly-forecast: only when the user presses "Check forecast"; never automatic, never for other places.
 * - /api/live-weather: only for the active place, only while the card is expanded or "Show on globe" is on.
 * - /api/news: automatically once `newsWanted` is true (default on Main), saved places only, never holding up render.
 * - Coarse whole-Earth preview: one static same-origin file per variable (public/coarse), cached for the session.
 * Every request has its own AbortController: a new selection cancels the stale request. Responses are cached in
 * memory only (public data, bounded, 15 minutes).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchLiveWeather, fetchMonthlyForecast, fetchMonthlyFrames, fetchNews } from "../../api.js";
import { motionReduced } from "../../lib/theme.js";
import {
  buildTimeline, defaultIndex, dwellFor, expectedCells, fieldCells, forecastQuery, forecastStatus, frameFadeMs, framesQuery,
  gridExtent, isForecastIndex, nextPlayIndex, REDUCED_SPEEDS, transitionPlan,
} from "../../lib/globeFrames.js";
import { FRAME_FADE_MS } from "../../lib/globeFrames.js";
import { frameMonthKey, monthLabel, pickCoarseMonth, useCoarsePreview } from "../../lib/coarsePreview.js";
import { classify, rampFor, tokenFor } from "../../lib/ramp.js";
import { createMemoCache } from "../../lib/memoCache.js";
import { filterByInterest, interestForVariable, locationsParam, markersFor, savedStories } from "../../lib/globeNews.js";
import { glyphModel, weatherState } from "../../lib/liveWeather.js";

const framesCache = createMemoCache({ max: 8 });
const forecastCache = createMemoCache({ max: 4 });
const weatherCache = createMemoCache({ max: 6, ttlMs: 10 * 60 * 1000 });
const newsCache = createMemoCache({ max: 3 });

const EMPTY = { key: null, data: null, error: null, loading: false, receivedAt: null };

/** One abortable request slot: run(key, fetcher) cancels whatever was in flight. */
function useRequest(cache) {
  const [state, setState] = useState(EMPTY);
  const ctrl = useRef(null);
  const keyRef = useRef(null);
  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
  }, []);
  const reset = useCallback(() => {
    cancel();
    keyRef.current = null;
    setState(EMPTY);
  }, [cancel]);
  const run = useCallback(
    (key, fetcher, { force = false } = {}) => {
      cancel();
      keyRef.current = key;
      const hit = force ? undefined : cache.get(key);
      if (hit) {
        setState({ key, data: hit.data, error: null, loading: false, receivedAt: hit.receivedAt });
        return;
      }
      const c = new AbortController();
      ctrl.current = c;
      setState((s) => ({ key, data: s.key === key ? s.data : null, error: null, loading: true, receivedAt: s.key === key ? s.receivedAt : null }));
      fetcher(c.signal).then(
        (data) => {
          if (c.signal.aborted || keyRef.current !== key) return;
          const receivedAt = Date.now();
          cache.set(key, { data, receivedAt });
          setState({ key, data, error: null, loading: false, receivedAt });
        },
        (err) => {
          if (c.signal.aborted || err?.name === "AbortError" || keyRef.current !== key) return;
          setState({ key, data: null, error: err?.message || "The request failed.", loading: false, receivedAt: null });
        },
      );
    },
    [cache, cancel],
  );
  useEffect(() => cancel, [cancel]);
  return { state, run, cancel, reset };
}

// ---------------------------------------------------------------- news store for the shell drawer
// The shell renders the right-hand drawer outside this provider, so the open news panel reads live news state here.
let newsSnapshot = { req: EMPTY, stories: [], retry: () => {} };
const newsListeners = new Set();
function publishNews(next) {
  newsSnapshot = next;
  for (const l of newsListeners) l();
}
export function useNewsSnapshot() {
  return useSyncExternalStore(
    (l) => {
      newsListeners.add(l);
      return () => newsListeners.delete(l);
    },
    () => newsSnapshot,
    () => newsSnapshot,
  );
}

const Ctx = createContext(null);
/** Exported for render tests and for any consumer that needs to provide a fixed layer state. */
export const GlobeLayersContext = Ctx;
export const useGlobeLayers = () => useContext(Ctx);

// ---------------------------------------------------------------- live layer state for the shell drawer
// Same reason as the news store: rail rows open their full detail (live weather, forecast) in the shell drawer,
// which renders outside the provider. LayersBridge re-provides the live value there.
let layersSnapshot = null;
const layersListeners = new Set();
function publishLayers(next) {
  layersSnapshot = next;
  for (const l of layersListeners) l();
}
function useLayersSnapshot() {
  return useSyncExternalStore(
    (l) => {
      layersListeners.add(l);
      return () => layersListeners.delete(l);
    },
    () => layersSnapshot,
    () => layersSnapshot,
  );
}
/** Wrap drawer content that needs the globe layers (the drawer renders outside GlobeLayersProvider). */
export function LayersBridge({ children }) {
  const inside = useContext(Ctx);
  const live = useLayersSnapshot();
  if (inside) return children;
  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

export function GlobeLayersProvider({ place, variable, places = [], reducedMotion = false, newsWanted: newsWantedProp = true, children }) {
  const reduced = !!reducedMotion || motionReduced();
  const frames = useRequest(framesCache);
  const forecast = useRequest(forecastCache);
  const weather = useRequest(weatherCache);
  const news = useRequest(newsCache);

  const [range, setRange] = useState(3);
  const placeKey = place && Number.isFinite(place.lat) ? `${place.lat.toFixed(4)},${place.lon.toFixed(4)}` : null;
  const variableId = variable?.id ?? null;

  // ---- observed monthly frames: active place + variable only
  const loadFrames = useCallback(
    (force = false) => {
      if (!place || !variable) return;
      const q = framesQuery(place, variable, range);
      frames.run(JSON.stringify(q), (s) => fetchMonthlyFrames(q, s), { force });
    },
    [placeKey, variableId, range], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!placeKey || !variableId) {
      frames.reset();
      return;
    }
    loadFrames();
  }, [placeKey, variableId, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- forecast: only on request; forgotten when the place or variable changes
  useEffect(() => {
    forecast.reset();
  }, [placeKey, variableId]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestForecast = useCallback(
    (force = false) => {
      if (!place || !variable) return;
      const q = forecastQuery(place, variable);
      forecast.run(JSON.stringify(q), (s) => fetchMonthlyForecast(q, s), { force });
    },
    [placeKey, variableId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const forecastCurrent = placeKey && variableId ? forecast.state : EMPTY;
  const fStatus = forecastStatus(forecastCurrent);

  // ---- timeline
  const timeline = useMemo(
    () => buildTimeline(frames.state.data, fStatus.kind === "eligible" ? forecastCurrent.data : null),
    [frames.state.data, fStatus.kind, forecastCurrent.data],
  );
  const [index, setIndexRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedRaw] = useState(1);
  const tlKey = frames.state.data ? frames.state.key : null;
  useEffect(() => {
    setPlaying(false);
    setIndexRaw(defaultIndex(timeline));
  }, [tlKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!timeline) return;
    setIndexRaw((i) => Math.min(i, timeline.frames.length - 1));
  }, [timeline]);
  useEffect(() => {
    if (reduced && !REDUCED_SPEEDS.some((s) => s.id === speed)) setSpeedRaw(1);
  }, [reduced, speed]);
  const setIndex = useCallback((i) => {
    setPlaying(false);
    setIndexRaw(i);
  }, []);
  const setSpeed = useCallback((s) => setSpeedRaw(s), []);

  // Play: one month per dwell; stops at the last observed month (never runs into the forecast).
  useEffect(() => {
    if (!playing || !timeline) return undefined;
    const t = setTimeout(() => {
      const next = nextPlayIndex(timeline, index);
      if (next == null) setPlaying(false);
      else setIndexRaw(next);
    }, dwellFor(speed));
    return () => clearTimeout(t);
  }, [playing, index, speed, timeline]);
  const togglePlay = useCallback(() => {
    if (!timeline) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (nextPlayIndex(timeline, index) == null) {
      // Replay: back to the start of the zone the thumb is in (a hard cut).
      setIndexRaw(isForecastIndex(timeline, index) ? timeline.observedCount : 0);
    }
    setPlaying(true);
  }, [timeline, index, playing]);
  // Pause playback when the page is hidden.
  useEffect(() => {
    const onVis = () => document.visibilityState === "hidden" && setPlaying(false);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Field for the globe: current frame, plus the transition from the frame shown before it (step, drag or playback).
  const prevShown = useRef(null);
  const frame = timeline?.frames[index] ?? null;
  const field = useMemo(() => {
    if (!place || !variable) return null;
    if (frames.state.loading && !frames.state.data) {
      const cells = expectedCells(place);
      return { key: `loading:${placeKey}`, flyKey: null, loading: true, cells, half: cells[0]?.half ?? 0.5, kind: "observed", extent: gridExtent(cells, cells[0]?.half ?? 0.5), tag: "Loading detailed local data" };
    }
    if (!timeline || !frame) return null;
    const cells = fieldCells(timeline, frame);
    const before = prevShown.current;
    const sameSet = before && before.tlKey === tlKey;
    // Cross-fade only actual adjacent returned frames (either direction: step, drag or playback); anything else cuts.
    const plan = sameSet ? transitionPlan(before.frame, frame, { eitherWay: true }) : new Map();
    const prevCells = sameSet ? new Map(fieldCells(timeline, before.frame).map((c) => [c.id, c])) : new Map();
    const n = timeline.grid?.n ?? 1;
    const forecastFrame = frame.kind === "forecast";
    const cls = classify(frame.mean_anomaly, timeline.scale);
    return {
      key: `${tlKey}:${frame.kind}:${frame.month}`,
      flyKey: tlKey,
      loading: false,
      cells,
      half: timeline.half,
      kind: frame.kind,
      extent: gridExtent(cells, timeline.half),
      tag: forecastFrame ? "Forecast · not observed" : `Detailed local data · ${n}×${n}`,
      swatchToken: frame.valid_cells > 0 ? tokenFor(cls, rampFor(timeline.variable)) : null,
      plan,
      prevCells,
      fadeMs: frameFadeMs({ playing, speed, reduced }),
    };
  }, [place, variable, frames.state.loading, frames.state.data, timeline, frame, tlKey, playing, speed, reduced, placeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (frame && tlKey) prevShown.current = { tlKey, frame };
  }, [frame, tlKey]);

  // ---- live weather (Meteomatics): active place only, only while wanted
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [hours, setHours] = useState(24);
  const loadWeather = useCallback(
    (force = false) => {
      if (!place) return;
      const q = { lat: Number(place.lat).toFixed(4), lon: Number(place.lon).toFixed(4), hours };
      weather.run(JSON.stringify(q), (s) => fetchLiveWeather(q, s), { force });
    },
    [placeKey, hours], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!placeKey || !(weatherOpen || showLive)) {
      weather.cancel();
      return;
    }
    loadWeather();
  }, [placeKey, weatherOpen, showLive, hours]); // eslint-disable-line react-hooks/exhaustive-deps
  const weatherReq = placeKey ? weather.state : EMPTY;
  const wState = weatherState(weatherReq);
  useEffect(() => {
    if (showLive && ["unconfigured", "unavailable", "rate_limited", "error"].includes(wState.kind)) setShowLive(false);
  }, [wState.kind, showLive]);
  const liveGlyph = showLive && wState.canShowOnGlobe && place
    ? { lat: place.lat, lon: place.lon, model: glyphModel(weatherReq.data), label: wState.label }
    : null;

  // ---- coarse whole-Earth preview (plan 6B): appears as soon as a primary variable is chosen, no place needed
  const coarseReq = useCoarsePreview(variableId);
  const coarseDoc = coarseReq.doc;
  const [coarseOwn, setCoarseOwnRaw] = useState(null); // preview month when there is no local timeline
  const [coarsePlaying, setCoarsePlaying] = useState(false);
  useEffect(() => {
    setCoarsePlaying(false);
    setCoarseOwnRaw(coarseDoc ? coarseDoc.months.length - 1 : null);
  }, [coarseDoc]);
  const lastCoarse = useRef(null);
  const coarsePick = useMemo(() => {
    if (!coarseDoc) return null;
    if (frame) return pickCoarseMonth(coarseDoc, frameMonthKey(frame), lastCoarse.current);
    return pickCoarseMonth(coarseDoc, null, coarseOwn);
  }, [coarseDoc, frame, coarseOwn]);
  useEffect(() => {
    if (coarsePick) lastCoarse.current = coarsePick.index;
  }, [coarsePick]);
  useEffect(() => {
    if (!coarsePlaying || !coarseDoc || timeline) return undefined;
    const t = setTimeout(() => {
      if (coarseOwn == null || coarseOwn >= coarseDoc.months.length - 1) setCoarsePlaying(false);
      else setCoarseOwnRaw(coarseOwn + 1);
    }, dwellFor(speed));
    return () => clearTimeout(t);
  }, [coarsePlaying, coarseOwn, coarseDoc, timeline, speed]);
  useEffect(() => {
    if (timeline) setCoarsePlaying(false);
  }, [timeline]);
  const coarse = coarseDoc && coarsePick
    ? {
      status: "ready",
      doc: coarseDoc,
      index: coarsePick.index,
      exact: coarsePick.exact,
      label: coarsePick.label,
      note: coarsePick.note,
      fadeMs: reduced ? 0 : coarsePlaying ? Math.min(300, dwellFor(speed) * 0.6) : FRAME_FADE_MS,
      dim: !!field && !field.loading,
    }
    : { status: coarseReq.status, doc: null };

  /**
   * One scrubber model for the floating timeline: the local monthly frames when a place is active, otherwise the
   * coarse preview months (so the same slider moves the whole-Earth preview before any place is chosen).
   */
  const scrub = timeline
    ? { mode: "local" }
    : coarseDoc && coarseOwn != null
      ? {
        mode: "coarse",
        count: coarseDoc.months.length,
        index: coarseOwn,
        setIndex: (i) => {
          setCoarsePlaying(false);
          setCoarseOwnRaw(Math.max(0, Math.min(coarseDoc.months.length - 1, i)));
        },
        playing: coarsePlaying,
        togglePlay: () => {
          if (coarsePlaying) return setCoarsePlaying(false);
          if (coarseOwn >= coarseDoc.months.length - 1) setCoarseOwnRaw(0);
          return setCoarsePlaying(true);
        },
        atEnd: coarseOwn >= coarseDoc.months.length - 1,
        label: (i) => monthLabel(coarseDoc.months[i]),
      }
      : null;

  // ---- news: automatic once wanted (default on Main), saved places only, filtered to the selected interest
  const [newsWanted, setNewsWanted] = useState(false);
  useEffect(() => {
    if (!newsWantedProp) {
      setNewsWanted(false);
      return undefined;
    }
    // Never hold up the first render: start after the page has painted.
    const t = setTimeout(() => setNewsWanted(true), 400);
    return () => clearTimeout(t);
  }, [newsWantedProp]);
  const [showAllNews, setShowAllNews] = useState(false);
  const [openNewsPlace, setOpenNewsPlace] = useState(null);
  const locParam = locationsParam(places);
  const loadNews = useCallback(
    (force = false) => {
      if (!locParam) return;
      news.run(locParam, (s) => fetchNews({ locations: locParam, limit: 30 }, s), { force });
    },
    [locParam], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (newsWanted && locParam) loadNews();
    if (!locParam) news.reset();
  }, [newsWanted, locParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const interest = interestForVariable(variable);
  const allStories = useMemo(() => savedStories(news.state.data, places), [news.state.data, places]);
  const stories = useMemo(() => (showAllNews ? allStories : filterByInterest(allStories, interest)), [allStories, showAllNews, interest]);
  const newsReq = locParam ? news.state : EMPTY;

  const value = {
    place, variable, places, reduced,
    // timeline + field
    framesReq: frames.state, loadFrames, range, setRange, timeline, index, setIndex, frame, playing, togglePlay, speed, setSpeed, field,
    // coarse whole-Earth preview + the scrubber model
    coarse, scrub,
    // forecast
    forecastReq: forecastCurrent, forecastStatus: fStatus, requestForecast,
    showForecast: () => timeline?.forecastCount && setIndex(timeline.observedCount),
    // weather
    weatherReq, weatherState: wState, weatherOpen, setWeatherOpen, showLive, setShowLive, hours, setHours, loadWeather, liveGlyph,
    // news
    newsReq, newsWanted, setNewsWanted, loadNews, stories, allStories, showAllNews, setShowAllNews, interest, openNewsPlace, setOpenNewsPlace,
  };

  useEffect(() => {
    publishNews({ req: newsReq, stories: allStories, retry: () => loadNews(true) });
  }, [newsReq, allStories, loadNews]);
  useEffect(() => {
    publishLayers(value);
  });
  useEffect(() => () => publishLayers(null), []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** News markers for the globe (built from the interest-filtered list; colour from verified stories only). */
export function useNewsMarkers(openPlaceId) {
  const L = useGlobeLayers();
  return useMemo(
    () => (L ? markersFor(L.stories, { stale: L.newsReq.data?.stale === true, openPlaceId }) : []),
    [L?.stories, L?.newsReq.data, openPlaceId], // eslint-disable-line react-hooks/exhaustive-deps
  );
}
