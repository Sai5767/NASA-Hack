/**
 * Shared state for the Main page's globe layers, timeline rail, live-weather card, forecast status and news.
 *
 * Request budget (plan 1, 7; spec 1.6):
 * - /api/monthly-frames: only the ACTIVE place and selected variable. Other saved places are never fetched.
 * - /api/monthly-forecast: only when the user presses "Check forecast"; never automatic, never for other places.
 * - /api/live-weather: only for the active place, only while the card is expanded or "Show on globe" is on.
 * - /api/news: only after the news section scrolls into view or the user asks, for saved places only.
 * Every request has its own AbortController: a new selection cancels the stale request. Responses are cached in
 * memory only (public data, bounded, 15 minutes).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchLiveWeather, fetchMonthlyForecast, fetchMonthlyFrames, fetchNews } from "../../api.js";
import { motionReduced } from "../../lib/theme.js";
import {
  buildTimeline, defaultIndex, dwellFor, expectedCells, fadeMsFor, fieldCells, forecastQuery, forecastStatus, framesQuery,
  gridExtent, isForecastIndex, nextPlayIndex, REDUCED_SPEEDS, transitionPlan,
} from "../../lib/globeFrames.js";
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

export function GlobeLayersProvider({ place, variable, places = [], reducedMotion = false, children }) {
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

  // Field for the globe: current frame, plus the transition from the frame shown before it (playback only).
  const prevShown = useRef(null);
  const frame = timeline?.frames[index] ?? null;
  const field = useMemo(() => {
    if (!place || !variable) return null;
    if (frames.state.loading && !frames.state.data) {
      const cells = expectedCells(place);
      return { key: `loading:${placeKey}`, flyKey: null, loading: true, cells, half: cells[0]?.half ?? 0.5, kind: "observed", extent: gridExtent(cells, cells[0]?.half ?? 0.5), tag: "LOCAL GRID · REQUESTING" };
    }
    if (!timeline || !frame) return null;
    const cells = fieldCells(timeline, frame);
    const before = prevShown.current;
    const sameSet = before && before.tlKey === tlKey;
    const plan = playing && sameSet ? transitionPlan(before.frame, frame) : new Map();
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
      tag: forecastFrame ? "FORECAST · NOT OBSERVED" : `LOCAL GRID · ${n}×${n} · NASA POWER`,
      swatchToken: frame.valid_cells > 0 ? tokenFor(cls, rampFor(timeline.variable)) : null,
      plan,
      prevCells,
      fadeMs: playing ? fadeMsFor(speed, reduced) : 0,
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

  // ---- news: lazily, saved places only, filtered to the selected interest
  const [newsWanted, setNewsWanted] = useState(false);
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
