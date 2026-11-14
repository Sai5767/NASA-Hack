import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoDistance, geoEqualEarth, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { cellContains, cellRing } from "../lib/geo.js";
import { clamp, easeInOutCubic, easeOutCubic, formatLat, formatLon, lerp, mean, wrapLon } from "../lib/format.js";
import { useReducedMotion } from "../hooks.js";

// Natural Earth land and borders (public domain) via the world-atlas package.
const LAND = feature(world, world.objects.land);
const BORDERS = mesh(world, world.objects.countries, (a, b) => a !== b);
const GRATICULE = geoGraticule10();
const SPHERE = { type: "Sphere" };

const PAL = {
  atmosphere: "77,255,217",
  oceanA: "#143a78",
  oceanB: "#050a1c",
  flatOcean: "#07102a",
  land: "#16486e",
  coast: "rgba(130, 215, 255, 0.62)",
  border: "rgba(150, 205, 255, 0.17)",
  grid: "rgba(110, 165, 255, 0.11)",
};

const VIEW_DEFAULTS = {
  globe: { lon: -40, lat: 24, k: 1 },
  flat: { lon: 0, lat: 12, k: 1.7 },
};
const K_LIMITS = { globe: [0.8, 14], flat: [1, 24] };

function buildProjection(mode, v, w, h) {
  if (mode === "globe") {
    const radius = (Math.min(w, h) / 2) * 0.88;
    return geoOrthographic()
      .rotate([-v.lon, -v.lat, 0])
      .scale(radius * v.k)
      .translate([w / 2, h / 2])
      .clipAngle(90);
  }
  const base = (w * 0.94) / 5.41;
  return geoEqualEarth()
    .rotate([-v.lon, 0, 0])
    .center([0, v.lat])
    .scale(base * v.k)
    .translate([w / 2, h / 2]);
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawPin(ctx, x, y, pin, now, reduced) {
  const color = pin.color;
  if (!reduced) {
    for (const offset of [0, 0.5]) {
      const phase = (now / 1700 + (pin.phase ?? 0) + offset) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 6 + 26 * phase, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(color, (1 - phase) * 0.6);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  // Reticle ticks
  ctx.strokeStyle = withAlpha(color, 0.9);
  ctx.lineWidth = 1.5;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * 9, y + dy * 9);
    ctx.lineTo(x + dx * 15, y + dy * 15);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(4,6,13,0.9)";
  ctx.stroke();
  if (pin.label) {
    ctx.font = '700 11px "JetBrains Mono Variable", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(pin.label).width + 10;
    ctx.fillStyle = "rgba(4,6,13,0.82)";
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - 34, tw, 17, 4);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(pin.label, x, y - 25.5);
  }
}

function drawRadar(ctx, x, y, color, now) {
  for (let i = 0; i < 3; i += 1) {
    const phase = (now / 1100 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(x, y, 8 + 70 * phase, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(color, (1 - phase) * 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const angle = (now / 520) % (Math.PI * 2);
  if (ctx.createConicGradient) {
    const sweep = ctx.createConicGradient(angle - Math.PI * 0.7, x, y);
    sweep.addColorStop(0, withAlpha(color, 0));
    sweep.addColorStop(0.2, withAlpha(color, 0.38));
    sweep.addColorStop(0.2001, withAlpha(color, 0));
    sweep.addColorStop(1, withAlpha(color, 0));
    ctx.beginPath();
    ctx.arc(x, y, 78, 0, Math.PI * 2);
    ctx.fillStyle = sweep;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * 78, y + Math.sin(angle) * 78);
  ctx.strokeStyle = withAlpha(color, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Interactive globe / flat map drawn on a canvas.
 *
 * pins:   [{ lat, lon, color, label, phase }]
 * cells:  [{ lat, lon, fill, alpha, stroke, strokeWidth, dash, tip }] drawn as `cellHalf`-degree squares
 * dots:   [{ lat, lon, color, r, ring, tip }] data markers; clicking one calls onDotPick(dot)
 * focus:  { lat, lon, k?, nonce } -> flies the camera there whenever `nonce` changes
 * modeRequest: { mode: "globe" | "flat", nonce } -> switches the map style
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
  children,
}) {
  const reduced = useReducedMotion();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [mode, setMode] = useState("globe");
  const [hover, setHover] = useState(null);
  const sizeRef = useRef({ w: 600, h: 600 });
  const [sizeTick, setSizeTick] = useState(0);
  const view = useRef({ ...VIEW_DEFAULTS.globe });
  const fly = useRef(null);
  const drag = useRef(null);
  const idleAt = useRef(0);
  const dirty = useRef(true);
  const hoverKey = useRef("");
  const dotPositions = useRef([]);
  const live = useRef({});

  const polys = useMemo(
    () => cells.map((c) => ({ type: "Polygon", coordinates: [cellRing(c.lat, c.lon, cellHalf)] })),
    [cells, cellHalf],
  );
  const reveal = useMemo(() => {
    if (!cells.length) return { delays: [], total: 0, at: 0 };
    const center = [mean(cells.map((c) => c.lon)), mean(cells.map((c) => c.lat))];
    const dists = cells.map((c) => geoDistance([c.lon, c.lat], center));
    const maxDist = Math.max(...dists) || 1;
    return { delays: dists.map((d) => (d / maxDist) * 650), total: 1100, at: performance.now() };
  }, [cells]);

  live.current = { pins, cells, polys, cellHalf, selectedCell, dots, busy, idleSpin, reduced, mode, reveal, hoverCell: hover?.cell ?? -1, hoverDot: hover?.dot ?? -1 };

  useEffect(() => {
    dirty.current = true;
  }, [pins, cells, selectedCell, dots, busy, mode, hover, sizeTick, reduced]);

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

  const startFly = useCallback((to, duration = 1400, arc = true) => {
    const v = view.current;
    fly.current = { from: { ...v }, to: { ...v, ...to }, t0: performance.now(), dur: live.current.reduced ? 1 : duration, arc };
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
      if (L.idleSpin && !L.reduced && !drag.current && now > idleAt.current && L.mode === "globe") {
        v.lon = wrapLon(v.lon + dt * 0.006);
        return true;
      }
      return false;
    };

    const draw = (now) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = sizeRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const L = live.current;
      const v = view.current;
      const isGlobe = L.mode === "globe";
      const proj = buildProjection(L.mode, v, w, h);
      const path = geoPath(proj, ctx);
      const R = isGlobe ? proj.scale() : 0;

      if (isGlobe) {
        const halo = ctx.createRadialGradient(w / 2, h / 2, R * 0.97, w / 2, h / 2, R * 1.24);
        halo.addColorStop(0, `rgba(${PAL.atmosphere},0.36)`);
        halo.addColorStop(1, `rgba(${PAL.atmosphere},0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, R * 1.24, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      path(SPHERE);
      if (isGlobe) {
        const ocean = ctx.createRadialGradient(w / 2 - R * 0.35, h / 2 - R * 0.4, R * 0.1, w / 2, h / 2, R * 1.05);
        ocean.addColorStop(0, PAL.oceanA);
        ocean.addColorStop(1, PAL.oceanB);
        ctx.fillStyle = ocean;
      } else {
        ctx.fillStyle = PAL.flatOcean;
      }
      ctx.fill();

      ctx.beginPath();
      path(GRATICULE);
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.beginPath();
      path(LAND);
      ctx.fillStyle = PAL.land;
      ctx.fill();
      ctx.strokeStyle = PAL.coast;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      path(BORDERS);
      ctx.strokeStyle = PAL.border;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      if (isGlobe) {
        // Limb darkening and a soft highlight give the sphere depth.
        const shade = ctx.createRadialGradient(w / 2, h / 2, R * 0.55, w / 2, h / 2, R);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(2,5,16,0.55)");
        ctx.beginPath();
        path(SPHERE);
        ctx.fillStyle = shade;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "rgba(130, 220, 255, 0.45)";
        ctx.stroke();
      }

      // Scan cells (ripple in from the center).
      let revealing = false;
      L.cells.forEach((cell, i) => {
        const delay = L.reveal.delays[i] ?? 0;
        const t = L.reduced ? 1 : clamp((now - L.reveal.at - delay) / 450, 0, 1);
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
      for (const [idx, color, width] of [[L.hoverCell, "rgba(255,255,255,0.9)", 2], [-2, "#ffffff", 2.4]]) {
        const target = idx === -2 ? L.cells.findIndex((c) => L.selectedCell && c.lat === L.selectedCell.lat && c.lon === L.selectedCell.lon) : idx;
        if (target >= 0 && L.polys[target]) {
          ctx.beginPath();
          path(L.polys[target]);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      }

      // Data markers (one per place in the World view).
      const positions = [];
      L.dots.forEach((dot, i) => {
        if (isGlobe && geoDistance([dot.lon, dot.lat], [v.lon, v.lat]) > Math.PI / 2 - 0.02) return;
        const pt = proj([dot.lon, dot.lat]);
        if (!pt) return;
        const r = dot.r ?? 5;
        positions.push({ i, x: pt[0], y: pt[1], r });
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(dot.color, dot.ring ? 0.9 : 0.55);
        ctx.shadowColor = dot.color;
        ctx.shadowBlur = dot.ring ? 12 : 4;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = dot.ring || L.hoverDot === i ? 2 : 1;
        ctx.strokeStyle = L.hoverDot === i ? "#ffffff" : dot.ring ? "rgba(255,255,255,0.85)" : "rgba(4,6,13,0.7)";
        ctx.stroke();
      });
      dotPositions.current = positions;

      // Pins and the radar sweep.
      L.pins.forEach((pin, idx) => {
        if (isGlobe && geoDistance([pin.lon, pin.lat], [v.lon, v.lat]) > Math.PI / 2 - 0.03) return;
        const pt = proj([pin.lon, pin.lat]);
        if (!pt) return;
        if (L.busy && idx === 0 && !L.reduced) drawRadar(ctx, pt[0], pt[1], pin.color, now);
        drawPin(ctx, pt[0], pt[1], pin, now, L.reduced);
      });

      return revealing || (L.busy && !L.reduced);
    };

    const loop = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const L = live.current;
      const moved = step(dt, now);
      const animating = !L.reduced && (L.idleSpin || L.pins.length > 0 || L.busy);
      const revealing = L.reveal.total > 0 && now - L.reveal.at < L.reveal.total + 120;
      if (moved || dirty.current || animating || revealing) {
        dirty.current = false;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      fly.current = null;
      const [lo, hi] = K_LIMITS[live.current.mode];
      view.current.k = clamp(view.current.k * Math.exp(-e.deltaY * 0.0012), lo, hi);
      dirty.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

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
      }
      return;
    }
    const L = live.current;
    const cell = L.cells.findIndex((c) => cellContains(c, ll.lat, ll.lon, L.cellHalf));
    const dot = dotAt(x, y);
    const key = `${ll.lat.toFixed(1)}|${ll.lon.toFixed(1)}|${cell}|${dot}`;
    if (key !== hoverKey.current) {
      hoverKey.current = key;
      setHover({ ...ll, cell, dot, x, y });
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    idleAt.current = performance.now() + 6000;
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
  };

  const onKeyDown = (e) => {
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
      keys[e.key]();
      dirty.current = true;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick?.(v.lat, v.lon);
    }
  };

  const hoveredCell = hover && hover.cell >= 0 ? cells[hover.cell] : null;
  const hoveredDot = hover && hover.dot >= 0 ? dots[hover.dot] : null;
  const primary = pins[0];

  return (
    <div
      className="globe"
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="Interactive map. Click to drop a pin. Arrow keys rotate, plus and minus zoom, Enter drops a pin at the center."
      onKeyDown={onKeyDown}
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
      <div className="globe-scan" aria-hidden="true" />

      <div className="hud hud-tl" aria-live="off">
        <span className="hud-key">CURSOR</span>
        <span className="hud-val">{hover ? `${formatLat(hover.lat)} ${formatLon(hover.lon)}` : "—"}</span>
        <span className="hud-key">PIN A</span>
        <span className="hud-val">{primary ? `${formatLat(primary.lat)} ${formatLon(primary.lon)}` : "none yet"}</span>
      </div>

      <div className="hud hud-tr">
        <div className="seg" role="group" aria-label="Map style">
          <button type="button" className={mode === "globe" ? "on" : ""} onClick={() => switchMode("globe")}>Globe</button>
          <button type="button" className={mode === "flat" ? "on" : ""} onClick={() => switchMode("flat")}>Map</button>
        </div>
        <div className="seg" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
          <button
            type="button"
            onClick={() => primary && startFly({ lon: primary.lon, lat: clamp(primary.lat, -80, 80) }, 900)}
            aria-label="Recenter on pin A"
            disabled={!primary}
          >
            ◎
          </button>
        </div>
      </div>

      <div className="hud hud-bl">{children}</div>
      {Children.toArray(children).length === 0 && (
        <div className="hud hud-br hint" aria-hidden="true">drag · rotate &nbsp; scroll · zoom &nbsp; click · drop pin</div>
      )}

      {(hoveredDot?.tip || hoveredCell?.tip) && (
        <div className="globe-tip" style={{ left: Math.min(hover.x + 16, sizeRef.current.w - 230), top: Math.max(8, hover.y - 8) }}>
          {hoveredDot?.tip ?? hoveredCell.tip}
        </div>
      )}
    </div>
  );
}
