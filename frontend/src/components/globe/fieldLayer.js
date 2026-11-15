/**
 * Canvas drawing for the local NASA POWER field and the forecast cells (spec 3.2-3.4, 4.4, 4.5).
 *
 * Only the API's own 1x1-3x3 cells are drawn, each as its own inset quadrilateral: no blur, no glow, no smoothing
 * between cells and nothing outside the grid's footprint. Missing cells are a neutral cross-hatch; forecast cells
 * carry a one-direction hatch and a dashed outline. Colour can tween only where the timeline's transition plan says
 * "tween" (adjacent months of the same kind, valid in both).
 */
import { geoDistance } from "d3-geo";
import { cellRing } from "../../lib/geo.js";
import { mixLinear, rgba } from "../../lib/tokens.js";

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - t) ** 3;

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

function drawBrackets(ctx, box, color, dashed) {
  const pad = 6;
  const arm = 10;
  const x0 = box.x0 - pad;
  const y0 = box.y0 - pad;
  const x1 = box.x1 + pad;
  const y1 = box.y1 + pad;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    ctx.moveTo(x + dx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * arm);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  return { x0, y0, x1, y1 };
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

/**
 * Draw the field. `field` is the Globe `field` prop:
 *   { key, cells, half, kind, loading, extent, tag, swatchToken, plan, prevCells, fadeMs, changedAt, revealAt }
 * Returns { animating, hits } where hits are screen polygons for hover (index into field.cells).
 */
export function drawField(ctx, { path, proj, center, isGlobe, R }, field, tokens, patterns, now, { reduced, hoverId, selectedId }) {
  if (!field || !field.cells?.length) return { animating: false };
  const ext = field.extent;
  if (isGlobe && ext && geoDistance([ext.lon, ext.lat], center) > Math.PI / 2 - 0.02) return { animating: false };

  const degPerPx = isGlobe && R ? 180 / Math.PI / R : 0.05;
  const cellPx = (2 * field.half) / degPerPx;
  const insetHalf = Math.max(field.half * 0.25, field.half - 1.5 * degPerPx);
  const forecast = field.kind === "forecast";
  let animating = false;

  const box = ext ? screenBox(proj, ext) : null;
  const tiny = box && Math.max(box.x1 - box.x0, box.y1 - box.y0) < 24;

  // Overview zoom: collapse to the bracket frame plus one swatch, so nothing implies detail that cannot be seen.
  if (tiny && !field.loading) {
    const b = drawBrackets(ctx, box, tokens["--text-dim"], forecast);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    ctx.beginPath();
    ctx.rect(cx - 5, cy - 5, 10, 10);
    if (field.swatchToken) {
      ctx.fillStyle = tokens[field.swatchToken];
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
    } else {
      ctx.fillStyle = rgba(tokens["--missing-fg"], 0.1);
      ctx.fill();
      if (patterns.missing) {
        ctx.fillStyle = patterns.missing;
        ctx.fill();
      }
      ctx.strokeStyle = tokens["--missing-fg"];
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    return { animating: false };
  }

  const fadeT = field.fadeMs > 0 ? clamp01((now - (field.changedAt ?? 0)) / field.fadeMs) : 1;
  if (fadeT < 1) animating = true;
  const prev = field.prevCells ?? new Map();

  field.cells.forEach((cell, i) => {
    const poly = polygon(cell.lat, cell.lon, insetHalf);
    // Arrival ripple: centre-out, 450 ms per cell, up to 650 ms stagger.
    let reveal = 1;
    if (!reduced && field.revealAt && cell.state !== "pending") {
      const delay = field.delays?.[i] ?? 0;
      reveal = clamp01((now - field.revealAt - delay) / 450);
      if (reveal < 1) animating = true;
      reveal = easeOut(reveal);
    }

    if (cell.state === "pending") {
      // Data-scan: empty dashed outlines only, no fill, brightening one after another.
      let a = 0.6;
      if (!reduced) {
        const n = field.cells.length;
        const phase = ((now / 180) % (n + 2)) - i;
        a = phase >= 0 && phase < 1 ? 0.8 : 0.3;
        animating = true;
      }
      ctx.beginPath();
      path(poly);
      ctx.strokeStyle = rgba(tokens["--text-faint"], a);
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
      ctx.lineWidth = forecast ? 2 : 1;
      ctx.strokeStyle = forecast ? tokens["--forecast-line"] : "rgba(255,255,255,0.6)";
      ctx.setLineDash(forecast ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else {
      // valid -> missing in adjacent frames: the old fill fades out first, then the pattern appears.
      if (fadeT < 1 && mode === "fadeOut" && before?.state === "valid") {
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
        ctx.fillStyle = rgba(tokens["--missing-fg"], 0.1);
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
    }

    // Glyphs at the cell centre: value dot (>= 28 px), +/- sign (>= 36 px), x for missing (>= 28 px).
    const c = proj([cell.lon, cell.lat]);
    if (c && reveal >= 1) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (valid && cellPx >= 36 && cell.sign !== 0) {
        ctx.font = '700 11px "JetBrains Mono Variable", ui-monospace, monospace';
        ctx.fillStyle = tokens["--text-on-data"];
        ctx.fillText(cell.sign > 0 ? "+" : "−", c[0], c[1] - 9);
      }
      if (valid && cellPx >= 28) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], 1, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(5,7,13,0.6)";
        ctx.fill();
      }
      if (!valid && cellPx >= 28 && !(fadeT < 1 && mode === "fadeOut")) {
        ctx.font = '11px "JetBrains Mono Variable", ui-monospace, monospace';
        ctx.fillStyle = tokens["--missing-fg"];
        ctx.fillText("×", c[0], c[1]);
      }
    }

    if (cell.id === hoverId || cell.id === selectedId) {
      ctx.beginPath();
      path(poly);
      if (cell.id === hoverId) {
        ctx.strokeStyle = "rgba(179,161,255,0.6)";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = cell.id === selectedId ? 2.4 : 2;
      ctx.stroke();
    }
  });

  if (box) {
    const b = drawBrackets(ctx, box, tokens["--text-dim"], forecast);
    if (field.tag) {
      ctx.font = '700 10px "JetBrains Mono Variable", ui-monospace, monospace';
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const tw = ctx.measureText(field.tag).width + 8;
      ctx.fillStyle = "rgba(5,7,13,0.78)";
      ctx.fillRect(b.x0, b.y0 - 17, tw, 14);
      ctx.fillStyle = forecast ? tokens["--forecast-line"] : tokens["--text-dim"];
      ctx.fillText(field.tag, b.x0 + 4, b.y0 - 4);
    }
  }
  return { animating };
}
