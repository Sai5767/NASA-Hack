import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCircle, geoDistance, geoEqualEarth, geoOrthographic, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { cellContains, cellRing } from "../lib/geo.js";
import { clamp, easeInOutCubic, easeOutCubic, lerp, mean, wrapLon } from "../lib/format.js";
import { motionReduced, PIN_COLORS } from "../lib/theme.js";
import { FALLBACK, readTokens, rgba } from "../lib/tokens.js";
import { useReducedMotion } from "../hooks.js";
import { drawCoarse, drawField, makePatterns } from "./globe/fieldLayer.js";
import LiveGlyph from "./globe/LiveGlyph.jsx";
import "../styles/globe.css";

// Natural Earth land and borders (public domain) via the world-atlas package. The Earth is procedural: no imagery.
const LAND = feature(world, world.objects.land);
const BORDERS = mesh(world, world.objects.countries, (a, b) => a !== b);
const SPHERE = { type: "Sphere" };

/**
 * Base-globe palette. The CSS tokens (--earth-*, docs/V3_QUIET_EARTH_VISUAL_SPEC.md 2.2) win; this object is only the
 * no-DOM fallback, built from the token mirror in lib/tokens.js. App may still call applyGlobePalette (V2 API).
 */
const PAL = {
  atmosphere: "120,170,230",
  oceanA: FALLBACK["--earth-ocean-lit"],
  oceanB: FALLBACK["--earth-ocean-dark"],
  flatOcean: FALLBACK["--earth-flat-ocean"],
  land: FALLBACK["--earth-land"],
  landDry: FALLBACK["--earth-land-dry"],
  ice: FALLBACK["--earth-ice"],
  coast: rgba(FALLBACK["--earth-ice"], 0.26),
  border: rgba(FALLBACK["--white"], 0.07),
  limb: null,
};

/** Switch the globe's land, sea and rim colours (kept for the V2 API; CSS --earth-* tokens take precedence). */
export function applyGlobePalette(palette) {
  Object.assign(PAL, palette);
}

const cssVar = (name) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return "";
  }
};
const cssMs = (name, fallback) => {
  const v = cssVar(name);
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("ms") || !v.endsWith("s") ? n : n * 1000;
};

/** Resolved Earth palette: CSS tokens first, then PAL. */
function earthPalette() {
  const pick = (name, fb) => cssVar(name) || fb;
  const atm = (cssVar("--earth-atmosphere-rgb") || cssVar("--globe-halo-rgb") || PAL.atmosphere).replace(/\s+/g, "");
  return {
    atmosphere: atm,
    oceanA: pick("--earth-ocean-lit", PAL.oceanA),
    oceanB: pick("--earth-ocean-dark", PAL.oceanB),
    flatOcean: pick("--earth-flat-ocean", PAL.flatOcean),
    land: pick("--earth-land", PAL.land),
    landDry: pick("--earth-land-dry", PAL.landDry),
    ice: pick("--earth-ice", PAL.ice),
    coast: pick("--earth-coast", PAL.coast),
    border: pick("--earth-border", PAL.border),
    limb: pick("--earth-limb", PAL.limb ?? `rgba(${atm},0.3)`),
    pinOutline: pick("--pin-outline", FALLBACK["--bg"]),
  };
}

// Soft climate tints on the land only (drawn clipped to land): dry subtropical belts and polar ice, each as three
// nested low-alpha bands so the edges feather. Approximate look only, never data.
const capCircle = (lat, radius) => geoCircle().center([0, lat]).radius(radius)();
const DRY_BANDS = [
  [13, 37], [17, 33], [21, 29],
].flatMap(([a, b]) => [
  { outer: capCircle(90, 90 - a), inner: capCircle(90, 90 - b) },
  { outer: capCircle(-90, 90 - a), inner: capCircle(-90, 90 - b) },
]);
const ICE_CAPS = [capCircle(90, 18), capCircle(90, 22), capCircle(90, 26), capCircle(-90, 24), capCircle(-90, 28), capCircle(-90, 32)];

const VIEW_DEFAULTS = {
  globe: { lon: -40, lat: 24, k: 1 },
  flat: { lon: 0, lat: 12, k: 1.7 },
};
const K_LIMITS = { globe: [0.8, 14], flat: [1, 24] };

// Idle rotation (plan 5.4): ~2 degrees per second, resuming ~1 s after the last interaction with a gentle ramp.
const IDLE_DEFAULTS = { degPerS: 2, resumeMs: 1000, rampMs: 900 };
const CALLOUT_W = 232;
const CALLOUT_H = 66;
const CLUSTER_PX = 22;
const UI_FONT = '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif';

function buildProjection(mode, v, w, h, s = 1) {
  if (mode === "globe") {
    const radius = (Math.min(w, h) / 2) * 0.88;
    return geoOrthographic()
      .rotate([-v.lon, -v.lat, 0])
      .scale(radius * v.k * s)
      .translate([(w / 2) * s, (h / 2) * s])
      .clipAngle(90);
  }
  const base = (w * 0.94) / 5.41;
  return geoEqualEarth()
    .rotate([-v.lon, 0, 0])
    .center([0, v.lat])
    .scale(base * v.k * s)
    .translate([(w / 2) * s, (h / 2) * s]);
}

function withAlpha(hex, alpha) {
  if (!hex || hex[0] !== "#") return hex;
  return rgba(hex, alpha);
}

/** Pin A / B: a quiet static marker (no pulse, no glow). B is told apart by its dashed ring and label. */
function drawPin(ctx, x, y, pin, tk) {
  const color = pin.color;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.strokeStyle = withAlpha(color, 0.7);
  ctx.lineWidth = 1;
  ctx.setLineDash(pin.label === "B" ? [3, 2] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(tk["--bg"], 0.9);
  ctx.stroke();
  if (pin.label) {
    ctx.font = `500 13px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(tk["--bg"], 0.85);
    ctx.strokeText(pin.label, x + 13, y);
    ctx.fillStyle = tk["--text"];
    ctx.fillText(pin.label, x + 13, y);
  }
}

/** Resolve a saved-pin colour: a PIN_COLORS id, a hex, or a CSS var name. */
function pinColor(color) {
  const byId = PIN_COLORS.find((p) => p.id === color || p.hex === color);
  if (byId) return { fill: byId.hex, outline: byId.outline };
  if (typeof color === "string" && color.startsWith("--")) return { fill: `var(${color})`, outline: null };
  return { fill: color || PIN_COLORS[0].hex, outline: null };
}

const narrow = (w) => w < 560;

/**
 * Interactive globe / flat map drawn on a canvas.
 *
 * Existing props (unchanged; Explore and onboarding use them):
 * pins:   [{ lat, lon, color, label }]
 * cells:  [{ lat, lon, fill, alpha, stroke, strokeWidth, dash, tip, style? }] drawn as `cellHalf`-degree squares
 * dots:   [{ lat, lon, color, r, ring, tip, sign?: "up"|"down", failed?: boolean }] markers; clicking one calls onDotPick(dot)
 * focus:  { lat, lon, k?, nonce } -> flies the camera there whenever `nonce` changes
 * modeRequest: { mode: "globe" | "flat", nonce } -> switches the map style
 *
 * Layer props (all optional; see docs/V2_GLOBE_HANDOFF.md and plan 6):
 * coarse:     coarse whole-Earth preview { doc, index, fadeMs, dim } (built in components/globe/useGlobeLayers.jsx)
 * field:      detailed local grid { key, flyKey, cells, half, kind, loading, extent, tag, swatchToken, plan, prevCells, fadeMs }
 * markers:    news markers [{ id, lat, lon, tone, glyph, count, stale, open, verified, uncertaintyKm, name, lead }]
 * renderMarkerCard(marker): compact callout body shown at the end of the marker's leader line
 * onMarkerPick(marker) / onOpenNews(marker): click / Enter / Space on a marker or its callout
 * savedPins:  [{ id, lat, lon, label, color, outline? }] small labelled markers (colour on the marker only);
 *             click calls onOpenSavedPin(id) and/or onSavedPinPick(pin)
 * liveGlyph:  { lat, lon, model, label } Meteomatics point glyph (never an area)
 * rotationPaused: explicit external pause (data layers, markers and zoom never pause rotation by themselves)
 * idleSpin:   rotate when nobody is interacting (stopped with reduced motion)
 * controls:   show the small zoom / pause / info control (default true; the welcome scene passes false)
 * onCellFocus(cell | null): hover on a field cell
 * layerLabel: plain-text description of the active layer, appended to the globe's aria-label
 * reducedMotion: the app's reduce-motion preference (OS setting and <html data-motion="reduced"> are also honoured)
 */
export default function Globe({
  pins = [],
  cells = [],
  cellHalf = 0,
  selectedCell = null,
  dots = [],
  onDotPick,
  focus = null,
  modeRequest = null,
  busy = false,
  idleSpin = false,
  onPick,
  coarse = null,
  field = null,
  markers = [],
  renderMarkerCard,
  onMarkerPick,
  onOpenNews,
  savedPins = [],
  onOpenSavedPin,
  onSavedPinPick,
  liveGlyph = null,
  rotationPaused = false,
  controls = true,
  onCellFocus,
  layerLabel = "",
  reducedMotion = false,
  children,
}) {
  const osReduced = useReducedMotion();
  const reduced = osReduced || reducedMotion || motionReduced();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [mode, setMode] = useState("globe");
  const [hover, setHover] = useState(null);
  const [userPaused, setUserPaused] = useState(false);
  const [reading, setReading] = useState(null); // id of a news marker / saved pin being hovered or focused
  const [infoOpen, setInfoOpen] = useState(false);
  const sizeRef = useRef({ w: 600, h: 600 });
  const [sizeTick, setSizeTick] = useState(0);
  const view = useRef({ ...VIEW_DEFAULTS.globe });
  const fly = useRef(null);
  const drag = useRef(null);
  const idleAt = useRef(0);
  const spinSince = useRef(null);
  const dirty = useRef(true);
  const hoverKey = useRef("");
  const dotPositions = useRef([]);
  const newsEls = useRef(new Map());
  const pinEls = useRef(new Map());
  const liveEl = useRef(null);
  const tokens = useRef(null);
  const earth = useRef(null);
  const idle = useRef(IDLE_DEFAULTS);
  const patterns = useRef(null);
  const live = useRef({});
  const layout = useRef({ at: 0, callouts: new Set(), clusters: new Map(), hidden: new Set() });

  const polys = useMemo(
    () => cells.map((c) => ({ type: "Polygon", coordinates: [cellRing(c.lat, c.lon, cellHalf)] })),
    [cells, cellHalf],
  );
  const reveal = useMemo(() => {
    if (!cells.length) return { delays: [], total: 0, at: 0 };
    const center = [mean(cells.map((c) => c.lon)), mean(cells.map((c) => c.lat))];
    const dists = cells.map((c) => geoDistance([c.lon, c.lat], center));
    const maxDist = Math.max(...dists) || 1;
    return { delays: dists.map((d) => (d / maxDist) * 300), total: 700, at: performance.now() };
  }, [cells]);

  // The field's arrival fade (once per new grid) and the start of each frame's cross-fade.
  const fieldAnim = useRef({ flyKey: null, revealAt: 0, delays: [], changedAt: 0, key: null });
  if (field && !field.loading) {
    const fa = fieldAnim.current;
    if (field.flyKey !== fa.flyKey) {
      const center = field.extent ? [field.extent.lon, field.extent.lat] : [0, 0];
      const dists = field.cells.map((c) => geoDistance([c.lon, c.lat], center));
      const maxDist = Math.max(...dists) || 1;
      fa.flyKey = field.flyKey;
      fa.revealAt = performance.now();
      fa.delays = dists.map((d) => (d / maxDist) * 650);
    }
    if (field.key !== fa.key) {
      fa.key = field.key;
      fa.changedAt = performance.now();
    }
  }
  // The coarse preview's month cross-fade.
  const coarseAnim = useRef({ doc: null, index: null, prevIndex: null, changedAt: 0 });
  if (coarse?.doc) {
    const ca = coarseAnim.current;
    if (ca.doc !== coarse.doc) {
      Object.assign(ca, { doc: coarse.doc, index: coarse.index, prevIndex: null, changedAt: performance.now() });
    } else if (ca.index !== coarse.index) {
      Object.assign(ca, { prevIndex: ca.index, index: coarse.index, changedAt: performance.now() });
    }
  }

  live.current = {
    pins, cells, polys, cellHalf, selectedCell, dots, busy, idleSpin, reduced, mode, reveal,
    hoverCell: hover?.cell ?? -1, hoverDot: hover?.dot ?? -1, hoverField: hover?.fieldCell ?? null,
    coarse, field, markers, savedPins, liveGlyph, rotationPaused, userPaused, reading,
  };

  useEffect(() => {
    dirty.current = true;
    layout.current.at = 0; // re-run callout selection / clustering
  }, [pins, cells, selectedCell, dots, busy, mode, hover, sizeTick, reduced, coarse, field, markers, savedPins, liveGlyph, reading]);

  // Canvas colours come from the CSS tokens, read once per mount.
  useEffect(() => {
    tokens.current = readTokens();
    earth.current = earthPalette();
    idle.current = {
      degPerS: Number.parseFloat(cssVar("--globe-idle-deg-per-s")) || IDLE_DEFAULTS.degPerS,
      resumeMs: cssMs("--globe-idle-resume-delay", IDLE_DEFAULTS.resumeMs),
      rampMs: cssMs("--globe-idle-ramp", IDLE_DEFAULTS.rampMs),
    };
    patterns.current = null;
  }, []);

  // Keep canvas size in sync with its container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: Math.max(200, r.width), h: Math.max(200, r.height) };
      setSizeTick((n) => n + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Any drag, wheel, key or zoom: rotation stops now and resumes ~1 s later with a gentle ramp. */
  const interacted = (extraMs = 0) => {
    idleAt.current = performance.now() + idle.current.resumeMs + extraMs;
    spinSince.current = null;
  };

  const startFly = useCallback((to, duration = 1400, arc = true) => {
    const v = view.current;
    const dur = live.current.reduced ? 1 : duration;
    fly.current = { from: { ...v }, to: { ...v, ...to }, t0: performance.now(), dur, arc };
    idleAt.current = performance.now() + dur + idle.current.resumeMs;
    spinSince.current = null;
  }, []);

  // The app can ask for a different map style (for example the flat map for a world overview).
  useEffect(() => {
    if (modeRequest) switchMode(modeRequest.mode);
  }, [modeRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Camera flies to a new focus.
  useEffect(() => {
    if (!focus) return;
    const m = live.current.mode;
    const k = focus.k ?? Math.max(view.current.k, m === "globe" ? 1.9 : 2.6);
    startFly({ lon: focus.lon, lat: clamp(focus.lat, -80, 80), k: clamp(k, ...K_LIMITS[m]) });
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new local grid arrives, fly so it spans a readable part of the stage (capped at the zoom limit).
  useEffect(() => {
    if (!field?.flyKey || field.loading || !field.extent) return;
    const m = live.current.mode;
    const { w, h } = sizeRef.current;
    const spanDeg = Math.max(field.extent.north - field.extent.south, field.extent.east - field.extent.west, 0.5);
    const base = m === "globe" ? (Math.min(w, h) / 2) * 0.88 : (w * 0.94) / 5.41;
    const want = (0.35 * Math.min(w, h)) / ((spanDeg * Math.PI) / 180) / base;
    startFly({ lon: field.extent.lon, lat: clamp(field.extent.lat, -80, 80), k: clamp(want, ...K_LIMITS[m]) });
  }, [field?.flyKey, field?.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (next) => {
    setMode(next);
    const first = live.current.pins[0];
    view.current = { ...VIEW_DEFAULTS[next], ...(first ? { lon: first.lon, lat: clamp(first.lat, -80, 80), k: next === "globe" ? 1.9 : 3 } : {}) };
    fly.current = null;
    dirty.current = true;
  };

  const degreesPerPixel = () => {
    const { w, h } = sizeRef.current;
    const scale = live.current.mode === "globe" ? (Math.min(w, h) / 2) * 0.88 * view.current.k : ((w * 0.94) / 5.41) * view.current.k;
    return 180 / Math.PI / scale;
  };

  const zoomBy = (factor) => {
    const m = live.current.mode;
    startFly({ k: clamp(view.current.k * factor, ...K_LIMITS[m]) }, 380, false);
  };

  /**
   * Whether idle rotation may run (plan 5.4). Only these pause it: a drag / fly in progress, the ~1 s after an
   * interaction, hovering or focusing a marker, an open callout, the explicit pause prop or button, reduced motion and a
   * hidden page. Data layers, live glyphs, markers being present and zoom never stop it.
   */
  const spinAllowed = (L, now) =>
    L.idleSpin &&
    !L.reduced &&
    !L.userPaused &&
    !L.rotationPaused &&
    !drag.current &&
    !fly.current &&
    L.reading == null &&
    L.hoverDot < 0 &&
    !L.markers.some((m) => m.open) &&
    L.mode === "globe" &&
    now > idleAt.current &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");

  // Animation loop.
  useEffect(() => {
    let raf;
    let last = performance.now();

    const step = (dt, now) => {
      const L = live.current;
      const v = view.current;
      if (fly.current) {
        const f = fly.current;
        const t = clamp((now - f.t0) / f.dur, 0, 1);
        const e = easeInOutCubic(t);
        v.lon = wrapLon(f.from.lon + wrapLon(f.to.lon - f.from.lon) * e);
        v.lat = lerp(f.from.lat, f.to.lat, e);
        v.k = lerp(f.from.k, f.to.k, e) * (f.arc ? 1 - 0.26 * Math.sin(Math.PI * t) : 1);
        if (t >= 1) {
          v.k = f.to.k;
          fly.current = null;
        }
        return true;
      }
      if (spinAllowed(L, now)) {
        if (spinSince.current == null) spinSince.current = now;
        const r = clamp((now - spinSince.current) / idle.current.rampMs, 0, 1);
        const ramp = r * r * (3 - 2 * r); // smoothstep: no jolt when rotation resumes
        // Same apparent screen speed at every zoom level.
        v.lon = wrapLon(v.lon + ((dt * idle.current.degPerS) / 1000) * ramp / Math.max(1, v.k));
        return true;
      }
      spinSince.current = null;
      return false;
    };

    /** News markers, leader lines, callouts and saved pins: re-projected every frame so they stay anchored. */
    const placeOverlays = (proj, isGlobe, v, R, now) => {
      const L = live.current;
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const facing = (lon, lat) => (isGlobe ? Math.cos(geoDistance([lon, lat], [v.lon, v.lat])) : 1);
      const fadeOf = (f) => clamp((f - 0.06) / 0.22, 0, 1); // tuck away gracefully before the limb

      // 1. Project every news marker.
      const pts = [];
      for (const m of L.markers) {
        const f = facing(m.lon, m.lat);
        const pt = f > 0 ? proj([m.lon, m.lat]) : null;
        pts.push({ m, f, pt, fade: pt ? fadeOf(f) : 0 });
      }

      // 2. Every ~250 ms (or after a change), re-pick which markers cluster and which show a callout.
      const lay = layout.current;
      if (now - lay.at > 250) {
        lay.at = now;
        const order = [...pts]
          .filter((p) => p.pt && p.fade > 0)
          .sort((a, b) => (b.m.id === L.reading) - (a.m.id === L.reading) || (b.m.open - a.m.open) || b.f - a.f);
        const kept = [];
        const clusters = new Map();
        const hidden = new Set();
        for (const p of order) {
          const near = kept.find((k) => Math.hypot(k.pt[0] - p.pt[0], k.pt[1] - p.pt[1]) < CLUSTER_PX);
          if (near) {
            clusters.set(near.m.id, (clusters.get(near.m.id) ?? 1) + 1);
            hidden.add(p.m.id);
          } else kept.push(p);
        }
        const limit = narrow(w) ? 1 : 3;
        const callouts = new Set();
        const rects = [];
        for (const p of kept) {
          if (callouts.size >= limit) break;
          const forced = p.m.id === L.reading || p.m.open;
          if (!forced && p.fade < 0.9) continue;
          const e = calloutEnd(p.pt, isGlobe, cx, cy, R, w, h);
          const r = { x0: e.bx, y0: e.by, x1: e.bx + CALLOUT_W, y1: e.by + CALLOUT_H };
          if (!forced && rects.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
          rects.push(r);
          callouts.add(p.m.id);
        }
        Object.assign(lay, { callouts, clusters, hidden });
      }

      // 3. Write positions straight to the DOM (no React render per frame).
      for (const p of pts) {
        const el = newsEls.current.get(p.m.id);
        if (!el) continue;
        if (!p.pt || p.fade <= 0) {
          el.dataset.state = "hidden";
          continue;
        }
        const clustered = lay.hidden.has(p.m.id);
        const callout = !clustered && lay.callouts.has(p.m.id);
        el.dataset.state = clustered ? "hidden" : callout ? "callout" : "marker";
        el.style.transform = `translate(${p.pt[0]}px, ${p.pt[1]}px)`;
        el.style.setProperty("--fade", p.fade.toFixed(3));
        const n = lay.clusters.get(p.m.id) ?? 0;
        if (el.dataset.cluster !== String(n)) {
          el.dataset.cluster = String(n);
          const c = el.querySelector(".gl-news-cluster");
          if (c) c.textContent = n > 1 ? `+${n - 1}` : "";
        }
        if (callout) {
          const e = calloutEnd(p.pt, isGlobe, cx, cy, R, w, h);
          const dx = e.ax - p.pt[0];
          const dy = e.ay - p.pt[1];
          el.style.setProperty("--len", `${Math.hypot(dx, dy).toFixed(1)}px`);
          el.style.setProperty("--ang", `${Math.atan2(dy, dx).toFixed(4)}rad`);
          el.style.setProperty("--bx", `${(e.bx - p.pt[0]).toFixed(1)}px`);
          el.style.setProperty("--by", `${(e.by - p.pt[1]).toFixed(1)}px`);
          el.style.setProperty("--ux", (dx / (Math.hypot(dx, dy) || 1)).toFixed(3));
          el.style.setProperty("--uy", (dy / (Math.hypot(dx, dy) || 1)).toFixed(3));
        }
      }

      // Saved pins: always labelled, tucked away behind the limb.
      for (const sp of L.savedPins) {
        const el = pinEls.current.get(sp.id);
        if (!el) continue;
        const f = facing(sp.lon, sp.lat);
        const pt = f > 0 ? proj([sp.lon, sp.lat]) : null;
        const fade = pt ? fadeOf(f) : 0;
        if (!pt || fade <= 0) {
          el.dataset.hidden = "true";
          continue;
        }
        el.dataset.hidden = "false";
        el.style.transform = `translate(${pt[0]}px, ${pt[1]}px)`;
        el.style.setProperty("--fade", fade.toFixed(3));
      }

      const g = L.liveGlyph;
      if (liveEl.current) {
        const pt = g && facing(g.lon, g.lat) > 0.05 ? proj([g.lon, g.lat]) : null;
        if (pt) {
          liveEl.current.style.transform = `translate(${pt[0]}px, ${pt[1]}px)`;
          liveEl.current.dataset.hidden = "false";
        } else liveEl.current.dataset.hidden = "true";
      }
    };

    const draw = (now) => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const { w, h } = sizeRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!tokens.current) tokens.current = readTokens();
      if (!earth.current) earth.current = earthPalette();
      if (!patterns.current) patterns.current = makePatterns(ctx, tokens.current);
      const tk = tokens.current;
      const E = earth.current;

      const L = live.current;
      const v = view.current;
      const isGlobe = L.mode === "globe";
      const proj = buildProjection(L.mode, v, w, h);
      const path = geoPath(proj, ctx);
      const R = isGlobe ? proj.scale() : 0;
      const cx = w / 2;
      const cy = h / 2;
      // Sunlight from the upper left: soft terminator-style shading, never a hard day/night line.
      const lx = cx - R * 0.42;
      const ly = cy - R * 0.38;

      if (isGlobe) {
        // Thin atmosphere rim just outside the disc (within ~4% of the radius, max alpha 0.22).
        const rim = ctx.createRadialGradient(cx, cy, R * 0.995, cx, cy, R * 1.04);
        rim.addColorStop(0, `rgba(${E.atmosphere},0.22)`);
        rim.addColorStop(1, `rgba(${E.atmosphere},0)`);
        ctx.fillStyle = rim;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ocean.
      ctx.beginPath();
      path(SPHERE);
      if (isGlobe) {
        const ocean = ctx.createRadialGradient(lx, ly, R * 0.05, cx, cy, R * 1.08);
        ocean.addColorStop(0, E.oceanA);
        ocean.addColorStop(1, E.oceanB);
        ctx.fillStyle = ocean;
      } else {
        ctx.fillStyle = E.flatOcean;
      }
      ctx.fill();

      // Land, with soft dry-belt and ice tints clipped to the land.
      ctx.beginPath();
      path(LAND);
      ctx.fillStyle = E.land;
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      path(LAND);
      ctx.clip();
      ctx.fillStyle = E.landDry;
      ctx.globalAlpha = 0.17;
      for (const band of DRY_BANDS) {
        ctx.beginPath();
        path(band.outer);
        path(band.inner);
        ctx.fill("evenodd");
      }
      ctx.fillStyle = E.ice;
      ctx.globalAlpha = 0.28;
      for (const cap of ICE_CAPS) {
        ctx.beginPath();
        path(cap);
        ctx.fill();
      }
      ctx.restore();

      ctx.beginPath();
      path(LAND);
      ctx.strokeStyle = E.coast;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.beginPath();
      path(BORDERS);
      ctx.strokeStyle = E.border;
      ctx.lineWidth = 0.4;
      ctx.stroke();

      // Coarse whole-Earth preview: under the lighting, so it reads as part of the sphere.
      let coarseAnimating = false;
      if (L.coarse?.doc) {
        const ca = coarseAnim.current;
        const res = drawCoarse(
          ctx,
          { path, w, h, isGlobe, makeProjection: (s) => buildProjection(L.mode, v, w, h, s), geoPathFor: (p, g) => geoPath(p, g) },
          { doc: L.coarse.doc, index: ca.index, prevIndex: ca.prevIndex, changedAt: ca.changedAt, fadeMs: L.coarse.fadeMs, dim: L.coarse.dim },
          tk,
          now,
          { reduced: L.reduced },
        );
        coarseAnimating = res.animating;
      }

      if (isGlobe) {
        // Soft sunlight and shade (terminator-style), then limb darkening, then a faint inner rim.
        const sun = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 1.9);
        sun.addColorStop(0, rgba(tk["--white"], 0.07));
        sun.addColorStop(0.28, rgba(tk["--white"], 0));
        sun.addColorStop(0.62, rgba(tk["--bg"], 0.18));
        sun.addColorStop(1, rgba(tk["--bg"], 0.72));
        ctx.beginPath();
        path(SPHERE);
        ctx.fillStyle = sun;
        ctx.fill();
        const limb = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
        limb.addColorStop(0, rgba(tk["--bg"], 0));
        limb.addColorStop(1, rgba(tk["--bg"], 0.35));
        ctx.fillStyle = limb;
        ctx.fill();
        const inner = ctx.createRadialGradient(cx, cy, R * 0.93, cx, cy, R);
        inner.addColorStop(0, `rgba(${E.atmosphere},0)`);
        inner.addColorStop(1, `rgba(${E.atmosphere},0.14)`);
        ctx.fillStyle = inner;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = E.limb;
        ctx.stroke();
      }

      // Detailed local cells: only the API's own cells, no smoothing. Always on top of the coarse preview.
      let fieldAnimating = false;
      if (L.field) {
        const fa = fieldAnim.current;
        const res = drawField(
          ctx,
          { path, proj, center: [v.lon, v.lat], isGlobe, R },
          { ...L.field, revealAt: L.field.loading ? 0 : fa.revealAt, delays: fa.delays, changedAt: fa.changedAt },
          tk,
          patterns.current,
          now,
          { reduced: L.reduced, hoverId: L.hoverField, selectedId: null },
        );
        fieldAnimating = res.animating;
      }

      // Scan cells (Explore): fill = data scale; outline style = evidence (solid / dashed / none / dotted).
      let revealing = false;
      L.cells.forEach((cell, i) => {
        const delay = L.reveal.delays[i] ?? 0;
        const t = L.reduced ? 1 : clamp((now - L.reveal.at - delay) / 320, 0, 1);
        if (t < 1) revealing = true;
        if (t <= 0) return;
        const a = easeOutCubic(t);
        ctx.beginPath();
        path(L.polys[i]);
        ctx.globalAlpha = a * (cell.alpha ?? 0.5);
        ctx.fillStyle = cell.fill;
        ctx.fill();
        if (cell.stroke) {
          ctx.globalAlpha = a;
          ctx.strokeStyle = cell.stroke;
          ctx.lineWidth = cell.strokeWidth ?? 1;
          ctx.setLineDash(cell.dash ?? []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
      ctx.globalAlpha = 1;
      for (const [idx, color, width] of [[L.hoverCell, rgba(tk["--white"], 0.9), 2], [-2, tk["--white"], 2.4]]) {
        const target = idx === -2 ? L.cells.findIndex((c) => L.selectedCell && c.lat === L.selectedCell.lat && c.lon === L.selectedCell.lon) : idx;
        if (target >= 0 && L.polys[target]) {
          ctx.beginPath();
          path(L.polys[target]);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      }

      // Location-precision circle around an open news marker: dashed, no fill.
      const openMarker = L.markers.find((m) => m.open && Number.isFinite(m.uncertaintyKm));
      if (openMarker) {
        const circle = geoCircle().center([openMarker.lon, openMarker.lat]).radius(openMarker.uncertaintyKm / 111.2)();
        ctx.beginPath();
        path(circle);
        ctx.strokeStyle = tk["--text-faint"];
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Data markers (saved places on Main; sample sites in Explore > World). No glow.
      const positions = [];
      L.dots.forEach((dot, i) => {
        if (isGlobe && geoDistance([dot.lon, dot.lat], [v.lon, v.lat]) > Math.PI / 2 - 0.02) return;
        const pt = proj([dot.lon, dot.lat]);
        if (!pt) return;
        const r = dot.failed ? 3.5 : dot.r ?? 5;
        positions.push({ i, x: pt[0], y: pt[1], r });
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
        if (dot.failed) {
          // A site that could not be measured: hollow, dotted, neutral.
          ctx.strokeStyle = L.hoverDot === i ? tk["--white"] : tk["--missing-fg"];
          ctx.lineWidth = 1;
          ctx.setLineDash([1.5, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
          return;
        }
        ctx.fillStyle = withAlpha(dot.color, dot.ring ? 0.9 : 0.6);
        ctx.fill();
        ctx.lineWidth = dot.ring || L.hoverDot === i ? 2 : 1;
        ctx.strokeStyle = L.hoverDot === i ? tk["--white"] : dot.ring ? rgba(tk["--white"], 0.85) : rgba(tk["--bg"], 0.7);
        ctx.stroke();
        if ((dot.sign === "up" || dot.sign === "down") && r >= 6) {
          // Second, non-colour direction cue: a small notch inside the dot.
          const s = 2.5;
          ctx.beginPath();
          if (dot.sign === "up") {
            ctx.moveTo(pt[0], pt[1] - s);
            ctx.lineTo(pt[0] + s, pt[1] + s * 0.8);
            ctx.lineTo(pt[0] - s, pt[1] + s * 0.8);
          } else {
            ctx.moveTo(pt[0], pt[1] + s);
            ctx.lineTo(pt[0] + s, pt[1] - s * 0.8);
            ctx.lineTo(pt[0] - s, pt[1] - s * 0.8);
          }
          ctx.closePath();
          ctx.fillStyle = rgba(tk["--bg"], 0.85);
          ctx.fill();
        }
      });
      dotPositions.current = positions;

      // Pins (no radar, no pulse).
      L.pins.forEach((pin) => {
        if (isGlobe && geoDistance([pin.lon, pin.lat], [v.lon, v.lat]) > Math.PI / 2 - 0.03) return;
        const pt = proj([pin.lon, pin.lat]);
        if (pt) drawPin(ctx, pt[0], pt[1], pin, tk);
      });

      placeOverlays(proj, isGlobe, v, R, now);

      return revealing || fieldAnimating || coarseAnimating;
    };

    let animatingDraw = false;
    let lastLayout = 0;
    const loop = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const moved = step(dt, now);
      const L = live.current;
      const revealing = L.reveal.total > 0 && now - L.reveal.at < L.reveal.total + 120;
      // Callout selection settles a moment after the last change: one more pass picks it up.
      const relayout = layout.current.at === 0 && now - lastLayout > 50;
      if (moved || dirty.current || revealing || animatingDraw || relayout) {
        dirty.current = false;
        if (relayout) lastLayout = now;
        animatingDraw = draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      fly.current = null;
      interacted();
      const [lo, hi] = K_LIMITS[live.current.mode];
      view.current.k = clamp(view.current.k * Math.exp(-e.deltaY * 0.0012), lo, hi);
      dirty.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes the info popover.
  useEffect(() => {
    if (!infoOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setInfoOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoOpen]);

  const eventPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const lonLatAt = (x, y) => {
    const { w, h } = sizeRef.current;
    const proj = buildProjection(live.current.mode, view.current, w, h);
    const ll = proj.invert?.([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || Math.abs(ll[1]) > 90) return null;
    return { lat: ll[1], lon: wrapLon(ll[0]) };
  };

  /** Index of the data marker under a screen point, or -1. */
  const dotAt = (x, y) => {
    let best = -1;
    let bestDist = Infinity;
    for (const p of dotPositions.current) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= Math.max(p.r + 5, 10) && d < bestDist) {
        best = p.i;
        bestDist = d;
      }
    }
    return best;
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fly.current = null;
    interacted();
    drag.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY,
      lon0: view.current.lon, lat0: view.current.lat, moved: false, t0: performance.now(),
    };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      if (d.moved) {
        const deg = degreesPerPixel();
        view.current.lon = wrapLon(d.lon0 - dx * deg);
        view.current.lat = clamp(d.lat0 + dy * deg, -85, 85);
        dirty.current = true;
      }
      return;
    }
    const [x, y] = eventPoint(e);
    const ll = lonLatAt(x, y);
    if (!ll) {
      if (hoverKey.current) {
        hoverKey.current = "";
        setHover(null);
        onCellFocus?.(null);
      }
      return;
    }
    const L = live.current;
    const cell = L.cells.findIndex((c) => cellContains(c, ll.lat, ll.lon, L.cellHalf));
    const fc = L.field && !L.field.loading ? L.field.cells.find((c) => cellContains(c, ll.lat, ll.lon, L.field.half)) : null;
    const dot = dotAt(x, y);
    const key = `${ll.lat.toFixed(1)}|${ll.lon.toFixed(1)}|${cell}|${dot}|${fc?.id ?? ""}`;
    if (key !== hoverKey.current) {
      hoverKey.current = key;
      setHover({ ...ll, cell, dot, fieldCell: fc?.id ?? null, fieldTip: fc?.tip ?? null, x, y });
      onCellFocus?.(fc ?? null);
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    interacted();
    if (d && !d.moved && performance.now() - d.t0 < 700) {
      const [x, y] = eventPoint(e);
      const dot = dotAt(x, y);
      if (dot >= 0) {
        onDotPick?.(live.current.dots[dot]);
        return;
      }
      const ll = lonLatAt(x, y);
      if (ll) onPick?.(ll.lat, ll.lon);
    }
  };

  const onPointerLeave = () => {
    hoverKey.current = "";
    setHover(null);
    onCellFocus?.(null);
  };

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // keys on marker buttons and controls are theirs
    const v = view.current;
    const [lo, hi] = K_LIMITS[live.current.mode];
    const step = 10 / Math.max(1, v.k);
    const keys = {
      ArrowLeft: () => (v.lon = wrapLon(v.lon - step)),
      ArrowRight: () => (v.lon = wrapLon(v.lon + step)),
      ArrowUp: () => (v.lat = clamp(v.lat + step, -85, 85)),
      ArrowDown: () => (v.lat = clamp(v.lat - step, -85, 85)),
      "+": () => (v.k = clamp(v.k * 1.25, lo, hi)),
      "=": () => (v.k = clamp(v.k * 1.25, lo, hi)),
      "-": () => (v.k = clamp(v.k / 1.25, lo, hi)),
    };
    if (keys[e.key]) {
      e.preventDefault();
      fly.current = null;
      interacted();
      keys[e.key]();
      dirty.current = true;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      interacted();
      onPick?.(v.lat, v.lon);
    }
  };

  const openNews = (m) => (onOpenNews ?? onMarkerPick)?.(m);
  const readOn = (id) => () => setReading(id);
  const readOff = (id) => () => setReading((r) => (r === id ? null : r));

  const hoveredCell = hover && hover.cell >= 0 ? cells[hover.cell] : null;
  const hoveredDot = hover && hover.dot >= 0 ? dots[hover.dot] : null;
  const tipText = hoveredDot?.tip ?? hover?.fieldTip ?? hoveredCell?.tip ?? null;
  const primary = pins[0];
  const canSpin = idleSpin && !reduced;

  return (
    <div
      className="globe"
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label={`Interactive Earth. Arrow keys turn it, plus and minus zoom, Enter picks the place at the centre.${layerLabel ? ` Showing ${layerLabel}.` : ""}`}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) interacted();
      }}
    >
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        style={hoveredDot ? { cursor: "pointer" } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {liveGlyph && (
        <div className="gl-live-anchor" ref={liveEl} data-hidden="true" aria-hidden="true">
          <LiveGlyph model={liveGlyph.model} reduced={reduced} />
        </div>
      )}

      {savedPins.length > 0 && (
        <ul className="gl-pins" aria-label="Saved pins">
          {savedPins.map((sp) => {
            const c = pinColor(sp.colorId ?? sp.color);
            if (sp.outline) c.outline = sp.outline;
            return (
              <li
                key={sp.id}
                className="gl-pin"
                data-hidden="true"
                ref={(el) => {
                  if (el) pinEls.current.set(sp.id, el);
                  else pinEls.current.delete(sp.id);
                }}
              >
                <button
                  type="button"
                  className="gl-pin-btn"
                  aria-label={`Saved pin ${sp.label}. Opens it.`}
                  onClick={() => {
                    onOpenSavedPin?.(sp.id);
                    onSavedPinPick?.(sp);
                  }}
                  onPointerEnter={readOn(`pin:${sp.id}`)}
                  onPointerLeave={readOff(`pin:${sp.id}`)}
                  onFocus={readOn(`pin:${sp.id}`)}
                  onBlur={readOff(`pin:${sp.id}`)}
                >
                  <span className="gl-pin-mark" style={{ background: c.fill, ...(c.outline ? { borderColor: c.outline } : {}) }} aria-hidden="true" />
                  <span className="gl-pin-label">{sp.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {markers.length > 0 && (
        <ul className="gl-news-layer" aria-label="News context markers">
          {markers.map((m) => (
            <li
              key={m.id}
              className={`gl-news gl-news--${m.tone}${m.open ? " is-open" : ""}`}
              data-state="hidden"
              ref={(el) => {
                if (el) newsEls.current.set(m.id, el);
                else newsEls.current.delete(m.id);
              }}
            >
              <span className="gl-news-leader" aria-hidden="true"><i /></span>
              <button
                type="button"
                className="gl-news-dot"
                aria-label={`News context near ${m.name}: ${m.count} ${m.count === 1 ? "story" : "stories"}${m.verified ? "" : ", unverified news context"}${m.stale ? ", saved earlier" : ""}. Opens the details.`}
                aria-haspopup="dialog"
                onClick={() => openNews(m)}
                onPointerEnter={readOn(m.id)}
                onPointerLeave={readOff(m.id)}
                onFocus={readOn(m.id)}
                onBlur={readOff(m.id)}
              >
                <span className="gl-news-glyph" aria-hidden="true">{m.verified ? m.glyph : ""}</span>
                <span className="gl-news-cluster mono" aria-hidden="true" />
              </button>
              <span className="gl-callout-pos">
                <button
                  type="button"
                  className="gl-callout"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => openNews(m)}
                  onPointerEnter={readOn(m.id)}
                  onPointerLeave={readOff(m.id)}
                >
                  {renderMarkerCard ? renderMarkerCard(m) : <span className="gl-callout-headline">{m.lead?.headline ?? m.name}</span>}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {controls && (
        <div className="hud hud-tr gl-controls">
          {canSpin && (
            <button
              type="button"
              className="gl-ctl"
              aria-pressed={userPaused}
              aria-label={userPaused ? "Resume rotation" : "Pause rotation"}
              title={userPaused ? "Resume rotation" : "Pause rotation"}
              onClick={() => {
                setUserPaused((p) => !p);
                spinSince.current = null;
              }}
            >
              <span aria-hidden="true">{userPaused ? "▶" : "❚❚"}</span>
            </button>
          )}
          <button type="button" className="gl-ctl" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out"><span aria-hidden="true">−</span></button>
          <button type="button" className="gl-ctl" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in"><span aria-hidden="true">+</span></button>
          <button
            type="button"
            className="gl-ctl"
            aria-expanded={infoOpen}
            aria-controls="globe-help"
            aria-label="How to use the Earth"
            title="How to use the Earth"
            onClick={() => setInfoOpen((o) => !o)}
          >
            <span aria-hidden="true">?</span>
          </button>
          {infoOpen && (
            <div className="gl-help" id="globe-help" role="region" aria-label="How to use the Earth">
              <ul>
                <li>Drag to turn the Earth</li>
                <li>Scroll, or use + and −, to zoom</li>
                <li>Click or tap to choose a place</li>
                <li>Keyboard: arrow keys turn, + and − zoom, Enter picks the centre</li>
              </ul>
              <div className="gl-help-row">
                <div className="seg" role="group" aria-label="Map style">
                  <button type="button" className={mode === "globe" ? "on" : ""} aria-pressed={mode === "globe"} onClick={() => switchMode("globe")}>Globe</button>
                  <button type="button" className={mode === "flat" ? "on" : ""} aria-pressed={mode === "flat"} onClick={() => switchMode("flat")}>Map</button>
                </div>
                {primary && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => startFly({ lon: primary.lon, lat: clamp(primary.lat, -80, 80) }, 900)}>
                    Recentre
                  </button>
                )}
              </div>
              <p className="gl-help-note">Land and borders: Natural Earth (public domain). The Earth is drawn, not a photo.</p>
            </div>
          )}
        </div>
      )}

      <div className="hud hud-bl">{children}</div>

      {tipText && (
        <div className="globe-tip" style={{ left: Math.min(hover.x + 16, sizeRef.current.w - 230), top: Math.max(8, hover.y - 8) }}>
          {tipText}
        </div>
      )}
    </div>
  );
}

/**
 * Where a callout goes: outward from the marker along the limb normal (the screen direction from the disc centre),
 * ending just outside the curved surface, clamped inside the stage. Returns the leader end (ax, ay) and the callout
 * box's top-left (bx, by).
 */
function calloutEnd(pt, isGlobe, cx, cy, R, w, h) {
  let dx = pt[0] - cx;
  let dy = pt[1] - cy;
  let d = Math.hypot(dx, dy);
  if (!isGlobe || d < 8) {
    dx = 0.72;
    dy = -0.7;
    d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const dist = Math.hypot(pt[0] - cx, pt[1] - cy);
  const len = isGlobe ? clamp(R * 1.06 - dist, 34, 120) : 48;
  let ax = pt[0] + ux * len;
  let ay = pt[1] + uy * len;
  const right = ux >= 0;
  let bx = right ? ax : ax - CALLOUT_W;
  let by = ay - CALLOUT_H / 2;
  const cbx = clamp(bx, 8, w - CALLOUT_W - 8);
  const cby = clamp(by, 8, h - CALLOUT_H - 8);
  // If the stage edge pushed the box, keep the leader ending on the box's near edge.
  ax += cbx - bx;
  ay += cby - by;
  bx = cbx;
  by = cby;
  return { ax, ay, bx, by };
}
