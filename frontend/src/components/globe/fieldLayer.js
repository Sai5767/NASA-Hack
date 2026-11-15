/**
 * Canvas drawing for the globe's data layers (plan 6B):
 *   drawCoarse  the coarse whole-Earth preview: soft, sphere-clipped, deliberately low resolution (orientation only)
 *   drawField   the detailed local NASA POWER / forecast cells (the API's own 1x1-3x3 cells, always on top)
 *
 * Detailed cells: each cell is its own inset quadrilateral following the sphere; no blur, no smoothing between cells,
 * nothing outside the grid's footprint. Missing = neutral cross-hatch + x; forecast = one-direction hatch + dashed
 * outline + label. Colour can change smoothly only where the transition plan says "tween" (actual adjacent months).
 * Every colour comes from the CSS tokens (lib/tokens.js); nothing is hard-coded.
 */
import { geoDistance } from "d3-geo";
import { cellRing } from "../../lib/geo.js";
import { coarseColor } from "../../lib/coarsePreview.js";
import { mixLinear, rgba } from "../../lib/tokens.js";

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - t) ** 3;
const UI_FONT = '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif';
const VALUE_FONT = '"JetBrains Mono Variable", ui-monospace, monospace';

function patternCanvas(draw) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g);
  return c;
}

/** The two 8x8 patterns: neutral two-direction cross-hatch (missing) and one-direction hatch (forecast). */
export function makePatterns(ctx, tokens) {
  const missing = patternCanvas((g) => {
    g.strokeStyle = rgba(tokens["--missing-fg"], 0.55);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 8); g.lineTo(8, 0);
    g.moveTo(0, 0); g.lineTo(8, 8);
    g.stroke();
  });
  const forecast = patternCanvas((g) => {
    g.strokeStyle = rgba(tokens["--forecast-line"], 0.7);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-1, 9); g.lineTo(9, -1);
    g.moveTo(-1, 1); g.lineTo(1, -1);
    g.moveTo(7, 9); g.lineTo(9, 7);
    g.stroke();
  });
  return {
    missing: missing ? ctx.createPattern(missing, "repeat") : null,
    forecast: forecast ? ctx.createPattern(forecast, "repeat") : null,
  };
}

const polygon = (lat, lon, half) => ({ type: "Polygon", coordinates: [cellRing(lat, lon, half)] });

// ------------------------------------------------------------------ coarse whole-Earth preview

const COARSE_SCALE = 1 / 5; // drawn at a fifth of the resolution, then softened and scaled up
const coarseBuffers = { a: null, b: null };
export const COARSE_ALPHA = { globe: 0.36, flat: 0.32, dim: 0.14 };

function buffer(key, w, h) {
  if (typeof document === "undefined") return null;
  let c = coarseBuffers[key];
  if (!c) {
    c = document.createElement("canvas");
    coarseBuffers[key] = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** Per-doc cache of the polygons and per-month colours (display colours only). */
const coarseCache = new WeakMap();
function coarseModel(doc, tokens) {
  let m = coarseCache.get(doc);
  if (!m || m.tokens !== tokens) {
    m = {
      tokens,
      polys: doc.points.map((p) => polygon(p.lat, p.lon, doc.half)),
      colors: new Map(),
    };
    coarseCache.set(doc, m);
  }
  return m;
}
function monthColors(model, doc, index, tokens) {
  if (!model.colors.has(index)) {
    const f = doc.frames[index];
    model.colors.set(index, Array.from(f ?? [], (v) => coarseColor(doc.variable, v, tokens)));
  }
  return model.colors.get(index);
}

/**
 * Draw the coarse preview. `coarse` = { doc, index, prevIndex, changedAt, fadeMs, dim }.
 * `makeProjection(scale)` returns the current projection scaled to a buffer `scale` times the stage size.
 * Returns { animating }.
 */
export function drawCoarse(ctx, { path, makeProjection, geoPathFor, w, h, isGlobe }, coarse, tokens, now, { reduced }) {
  const doc = coarse?.doc;
  if (!doc || !Number.isInteger(coarse.index)) return { animating: false };
  const bw = Math.max(40, Math.round(w * COARSE_SCALE));
  const bh = Math.max(40, Math.round(h * COARSE_SCALE));
  const a = buffer("a", bw, bh);
  const b = buffer("b", bw, bh);
  if (!a || !b) return { animating: false };
  const ga = a.getContext("2d");
  const gb = b.getContext("2d");
  if (!ga || !gb) return { animating: false };

  const model = coarseModel(doc, tokens);
  const proj = makeProjection(bw / w);
  const p = geoPathFor(proj, ga);
  const t = reduced || !coarse.fadeMs ? 1 : clamp01((now - (coarse.changedAt ?? 0)) / coarse.fadeMs);
  const layers = [];
  if (t < 1 && Number.isInteger(coarse.prevIndex) && coarse.prevIndex !== coarse.index) layers.push([coarse.prevIndex, 1 - t]);
  layers.push([coarse.index, t < 1 && layers.length ? t : 1]);

  ga.setTransform(1, 0, 0, 1, 0, 0);
  ga.clearRect(0, 0, bw, bh);
  for (const [idx, alpha] of layers) {
    const colors = monthColors(model, doc, idx, tokens);
    ga.globalAlpha = alpha;
    model.polys.forEach((poly, i) => {
      const c = colors[i];
      if (!c) return; // no value: nothing drawn, the Earth shows through (never zero, never a guess)
      ga.beginPath();
      p(poly);
      ga.fillStyle = c;
      ga.fill();
    });
  }
  ga.globalAlpha = 1;

  // Soften at low resolution (cheap), then scale up with smoothing: an intentionally atmospheric, low-detail look.
  gb.setTransform(1, 0, 0, 1, 0, 0);
  gb.clearRect(0, 0, bw, bh);
  // Blur in proportion to one preview cell's size on screen, so it stays soft (never blocky) at every zoom.
  const cellBufPx = proj.scale() * ((doc.half * 2 * Math.PI) / 180);
  const blur = Math.max(1.5, Math.min(24, cellBufPx * 0.45));
  if ("filter" in gb) gb.filter = `blur(${blur.toFixed(1)}px)`;
  gb.drawImage(a, 0, 0);
  if ("filter" in gb) gb.filter = "none";

  ctx.save();
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.clip();
  // Low opacity so ocean, land and coastlines stay legible (the caller redraws coastlines on top); dimmer still while
  // a place's detailed cells are shown, so the local grid reads as the data and the preview as background.
  ctx.globalAlpha = coarse.dim ? COARSE_ALPHA.dim : isGlobe ? COARSE_ALPHA.globe : COARSE_ALPHA.flat;
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(b, 0, 0, w, h);
  ctx.restore();
  return { animating: t < 1 };
}

// ------------------------------------------------------------------ detailed local cells

function extentPolygon(ext) {
  const half = Math.max(ext.north - ext.south, ext.east - ext.west) / 2;
  return { type: "Polygon", coordinates: [cellRing((ext.north + ext.south) / 2, (ext.east + ext.west) / 2, half, 0.5)] };
}

function screenBox(proj, ext) {
  const pts = [];
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const la = ext.south + ((ext.north - ext.south) * i) / steps;
    const lo = ext.west + ((ext.east - ext.west) * i) / steps;
    pts.push([ext.west, la], [ext.east, la], [lo, ext.south], [lo, ext.north]);
  }
  const xy = pts.map((p) => proj(p)).filter(Boolean);
  if (!xy.length) return null;
  return {
    x0: Math.min(...xy.map((p) => p[0])),
    y0: Math.min(...xy.map((p) => p[1])),
    x1: Math.max(...xy.map((p) => p[0])),
    y1: Math.max(...xy.map((p) => p[1])),
  };
}

function drawTag(ctx, text, x, y, tokens, forecast) {
  ctx.font = `500 12px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = rgba(tokens["--bg"], 0.78);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y - 20, tw, 18, 6);
  else ctx.rect(x, y - 20, tw, 18);
  ctx.fill();
  ctx.fillStyle = forecast ? tokens["--forecast-line"] : tokens["--text"];
  ctx.fillText(text, x + 6, y - 5);
}

/**
 * Draw the detailed local field. `field` is the Globe `field` prop:
 *   { key, cells, half, kind, loading, extent, tag, swatchToken, plan, prevCells, fadeMs, changedAt, revealAt }
 * Returns { animating }.
 */
export function drawField(ctx, { path, proj, center, isGlobe, R }, field, tokens, patterns, now, { reduced, hoverId, selectedId }) {
  if (!field || !field.cells?.length) return { animating: false };
  const ext = field.extent;
  if (isGlobe && ext && geoDistance([ext.lon, ext.lat], center) > Math.PI / 2 - 0.02) return { animating: false };

  const degPerPx = isGlobe && R ? 180 / Math.PI / R : 0.05;
  const cellPx = (2 * field.half) / degPerPx;
  const insetHalf = Math.max(field.half * 0.25, field.half - 1.5 * degPerPx);
  const forecast = field.kind === "forecast";
  const white = tokens["--white"];
  let animating = false;

  const box = ext ? screenBox(proj, ext) : null;
  const tiny = box && Math.max(box.x1 - box.x0, box.y1 - box.y0) < 24;

  // World zoom: one small swatch disc with a hairline ring, so nothing implies detail that cannot be seen.
  if (tiny && !field.loading) {
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    if (field.swatchToken) {
      ctx.fillStyle = tokens[field.swatchToken];
      ctx.fill();
      ctx.strokeStyle = rgba(white, 0.7);
    } else {
      ctx.fillStyle = rgba(tokens["--missing-fg"], 0.15);
      ctx.fill();
      if (patterns.missing) {
        ctx.fillStyle = patterns.missing;
        ctx.fill();
      }
      ctx.strokeStyle = tokens["--missing-fg"];
    }
    ctx.lineWidth = 1;
    ctx.setLineDash(forecast ? [3, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    return { animating: false };
  }

  const fadeT = field.fadeMs > 0 ? clamp01((now - (field.changedAt ?? 0)) / field.fadeMs) : 1;
  if (fadeT < 1) animating = true;
  const prev = field.prevCells ?? new Map();

  field.cells.forEach((cell, i) => {
    const poly = polygon(cell.lat, cell.lon, insetHalf);
    // Arrival: a short, quiet fade-in (no ripple stagger beyond the provided delays, none with reduced motion).
    let reveal = 1;
    if (!reduced && field.revealAt && cell.state !== "pending") {
      const delay = (field.delays?.[i] ?? 0) * 0.4;
      reveal = clamp01((now - field.revealAt - delay) / 320);
      if (reveal < 1) animating = true;
      reveal = easeOut(reveal);
    }

    if (cell.state === "pending") {
      // Requesting: static faint dashed outlines only, no fill and no scanning motion.
      ctx.beginPath();
      path(poly);
      ctx.strokeStyle = rgba(tokens["--text-faint"], 0.5);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const mode = field.plan?.get(cell.id) ?? "cut";
    const before = prev.get(cell.id);
    const valid = cell.state === "valid";

    if (valid) {
      let color = tokens[cell.token] ?? tokens["--data-neutral"];
      let alpha = cell.alpha;
      if (fadeT < 1 && mode === "tween" && before?.state === "valid") {
        color = mixLinear(tokens[before.token] ?? color, color, fadeT);
        alpha = before.alpha + (cell.alpha - before.alpha) * fadeT;
      } else if (fadeT < 1 && mode === "fadeIn") {
        alpha *= fadeT;
      }
      ctx.beginPath();
      path(poly);
      ctx.globalAlpha = alpha * reveal;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = reveal;
      if (forecast && patterns.forecast) {
        ctx.fillStyle = patterns.forecast;
        ctx.fill();
      }
      ctx.lineWidth = forecast ? 1.5 : 1;
      ctx.strokeStyle = forecast ? tokens["--forecast-line"] : rgba(white, 0.55);
      ctx.setLineDash(forecast ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (fadeT < 1 && mode === "fadeOut" && before?.state === "valid") {
      // valid -> missing in adjacent frames: the old fill fades out first, then the pattern appears.
      ctx.beginPath();
      path(poly);
      ctx.globalAlpha = before.alpha * (1 - fadeT);
      ctx.fillStyle = tokens[before.token] ?? tokens["--data-neutral"];
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      path(poly);
      ctx.globalAlpha = reveal;
      ctx.fillStyle = rgba(tokens["--bg"], 0.55);
      ctx.fill();
      if (patterns.missing) {
        ctx.fillStyle = patterns.missing;
        ctx.fill();
      }
      ctx.strokeStyle = tokens["--missing-fg"];
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Glyphs at the cell centre: +/- sign (>= 36 px), "No data" / x for missing (>= 28 px).
    const c = proj([cell.lon, cell.lat]);
    if (c && reveal >= 1) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (valid && cellPx >= 36 && cell.sign !== 0) {
        ctx.font = `600 13px ${VALUE_FONT}`;
        ctx.fillStyle = tokens["--text-on-data"];
        ctx.fillText(cell.sign > 0 ? "+" : "−", c[0], c[1]);
      }
      if (!valid && cellPx >= 28 && !(fadeT < 1 && mode === "fadeOut")) {
        ctx.font = cellPx >= 64 ? `500 12px ${UI_FONT}` : `13px ${VALUE_FONT}`;
        ctx.fillStyle = tokens["--text-dim"];
        ctx.fillText(cellPx >= 64 ? "No data" : "×", c[0], c[1]);
      }
    }

    if (cell.id === hoverId || cell.id === selectedId) {
      ctx.beginPath();
      path(poly);
      ctx.strokeStyle = rgba(tokens["--bg"], 0.85);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = white;
      ctx.lineWidth = cell.id === selectedId ? 2.4 : 2;
      ctx.stroke();
    }
  });

  // One hairline around the whole grid (follows the sphere, not a screen rectangle) and its short label.
  if (ext) {
    ctx.beginPath();
    path(extentPolygon(ext));
    ctx.strokeStyle = forecast ? tokens["--forecast-line"] : rgba(white, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash(forecast ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (box && field.tag) drawTag(ctx, field.tag, box.x0, box.y0 - 4, tokens, forecast);
  return { animating };
}
