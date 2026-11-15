import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWidth } from "../../hooks.js";
import {
  chartSpec,
  convertSpec,
  extent,
  linePath,
  linearScale,
  logAxisGuard,
  logScale,
  logTicks,
  niceTicks,
  padExtent,
  slugify,
  specXValues,
  specYValues,
} from "../../lib/chart.js";
import { chartCsv, downloadBlob, downloadText } from "../../lib/csv.js";
import { MONTHS, sig } from "../../lib/format.js";
import { readTokens } from "../../lib/tokens.js";
import { isApproximate, parseUnit, unitInfo, unitOptions } from "../../lib/units.js";
import { useDialogFocus } from "../Modal.jsx";

/*
 * Shared expandable chart viewer (owner item 7).
 *
 *   <ExpandableChart spec={spec} title="…" source="…" unit="°C">{inline chart}</ExpandableChart>
 *
 * Click / tap the chart, or press Enter / Space on its "Expand" button, to open a large view with:
 * linear / log y-axis (log disabled with a reason when a value is ≤ 0), unit switch (lib/units.js: display only),
 * editable x and y ranges with reset, a hover / arrow-key readout of exact values, and PNG / CSV export.
 *
 * `spec` is a ChartSpec (see chartSpec in lib/chart.js), a function returning one, or an array of them (shown as
 * views the reader can switch between, e.g. annual / monthly).
 */

const M = { t: 22, r: 20, b: 44, l: 68 };

// ---------------------------------------------------------------- hatch pattern (forecast bands)

export function HatchPattern({ id }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
      <line className="ch-hatch-line" x1="0" y1="0" x2="0" y2="7" />
    </pattern>
  );
}

/** Legend key for a line style (same class as the drawn line, so dashes match exactly). */
export function LineSwatch({ style }) {
  return (
    <svg className="ch-sw-svg" width="22" height="12" aria-hidden="true">
      <line x1="1" x2="21" y1="6" y2="6" className={`ch-line ${style}`} />
    </svg>
  );
}

/** A DOM-safe id (React's useId contains colons, which break `url(#…)`). */
export function useSvgId(prefix) {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

// ---------------------------------------------------------------- formatting

function formatX(x, kind) {
  if (!Number.isFinite(x)) return "—";
  if (kind === "month") return MONTHS[Math.round(x) - 1] ?? String(x);
  if (kind === "time") {
    const year = Math.floor(x);
    const m = Math.min(11, Math.max(0, Math.floor((x - year) * 12)));
    return `${MONTHS[m]} ${year}`;
  }
  if (kind === "year") return String(Math.round(x));
  return sig(x, 4);
}

function nearestDatum(data, x, tol) {
  let best = null;
  let bestD = Infinity;
  for (const d of data) {
    const dist = Math.abs(d.x - x);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return bestD <= tol ? best : null;
}

function medianStep(xs) {
  if (xs.length < 2) return 1;
  const steps = [];
  for (let i = 1; i < xs.length; i += 1) if (xs[i] > xs[i - 1]) steps.push(xs[i] - xs[i - 1]);
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? 1;
}

const num = (s) => (s === "" || s == null ? null : Number(s));

// ---------------------------------------------------------------- PNG export

const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline",
  "visibility", "display",
];

function inlineStyles(source, target) {
  const cs = getComputedStyle(source);
  const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
  target.setAttribute("style", style);
  const a = source.children;
  const b = target.children;
  for (let i = 0; i < a.length; i += 1) inlineStyles(a[i], b[i]);
}

/**
 * Render a chart SVG to a 2x PNG on the page black, with a small caption (title, source, units), and download it.
 * Fonts inside the SVG fall back to the system stack (an SVG image cannot load web fonts); the caption uses the app fonts.
 */
export async function exportChartPng(svg, { title, source, unit, filename }) {
  const tokens = readTokens();
  const rect = svg.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const clone = svg.cloneNode(true);
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.querySelectorAll("[data-export-skip]").forEach((el) => el.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();

  const pad = 24;
  const headH = 40;
  const footH = 36;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (w + pad * 2) * scale;
  canvas.height = (h + pad * 2 + headH + footH) * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = tokens["--bg"];
  ctx.fillRect(0, 0, w + pad * 2, h + pad * 2 + headH + footH);
  const ui = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "sans-serif";
  ctx.fillStyle = tokens["--text"];
  ctx.font = `500 17px ${ui}`;
  ctx.textBaseline = "top";
  ctx.fillText(title, pad, pad);
  ctx.drawImage(img, pad, pad + headH, w, h);
  ctx.fillStyle = tokens["--text-faint"];
  ctx.font = `13px ${ui}`;
  const caption = [source && `Source: ${source}`, unit && `Units: ${unit}`, "Trend Detective"].filter(Boolean).join("  ·  ");
  ctx.fillText(caption, pad, pad + headH + h + 14, w);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) downloadBlob(filename, blob);
}

// ---------------------------------------------------------------- the large plot

function Plot({ spec, log, xDomain, yDomain, svgRef, readX, setReadX, hatchId }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 820);
  const roomY = typeof window === "undefined" ? 520 : window.innerHeight - 380;
  const height = Math.round(Math.max(220, Math.min(520, width * 0.52, roomY)));
  const iw = Math.max(120, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const clipId = useSvgId("cv-clip");

  const xs = linearScale(xDomain[0], xDomain[1], 0, iw);
  const ys = log ? logScale(yDomain[0], yDomain[1], ih, 0) : linearScale(yDomain[0], yDomain[1], ih, 0);
  const yTicks = log ? logTicks(yDomain[0], yDomain[1]) : niceTicks(yDomain[0], yDomain[1], Math.max(4, Math.floor(ih / 70)));
  const xTicks = spec.xKind === "month"
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => m >= xDomain[0] && m <= xDomain[1])
    : niceTicks(xDomain[0], xDomain[1], Math.max(3, Math.floor(iw / 100))).filter((v) => spec.xKind !== "year" || Number.isInteger(v));
  const baseline = log ? yDomain[0] : Math.min(Math.max(0, yDomain[0]), yDomain[1]);

  const allX = useMemo(() => [...new Set(specXValues(spec))].sort((a, b) => a - b), [spec]);
  const step = medianStep(allX);
  const inView = allX.filter((x) => x >= xDomain[0] && x <= xDomain[1]);

  const pointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = xs.invert(e.clientX - rect.left - M.l);
    let best = null;
    for (const x of inView) if (best == null || Math.abs(x - t) < Math.abs(best - t)) best = x;
    setReadX(best);
  };
  const onKey = (e) => {
    if (!inView.length) return;
    const i = readX == null ? -1 : inView.indexOf(readX);
    let next = null;
    if (e.key === "ArrowRight") next = inView[Math.min(inView.length - 1, i + 1)];
    else if (e.key === "ArrowLeft") next = inView[Math.max(0, i < 0 ? inView.length - 1 : i - 1)];
    else if (e.key === "Home") next = inView[0];
    else if (e.key === "End") next = inView[inView.length - 1];
    else if (e.key === "PageUp") next = inView[Math.min(inView.length - 1, i + 10)];
    else if (e.key === "PageDown") next = inView[Math.max(0, i - 10)];
    if (next != null) {
      e.preventDefault();
      setReadX(next);
    }
  };

  const segments = (data) => {
    const out = [];
    let cur = [];
    for (const d of data) {
      if (d.y == null || !Number.isFinite(d.y) || (log && d.y <= 0)) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push([xs(d.x), ys(d.y)]);
    }
    if (cur.length) out.push(cur);
    return out;
  };
  const bandD = (data) => {
    const pts = data.filter((d) => Number.isFinite(d.lo) && Number.isFinite(d.hi) && (!log || (d.lo > 0 && d.hi > 0)));
    if (pts.length < 2) return null;
    return `${linePath(pts.map((d) => [xs(d.x), ys(d.hi)]))}${[...pts].reverse().map((d) => `L${xs(d.x).toFixed(1)},${ys(d.lo).toFixed(1)}`).join("")}Z`;
  };
  const barW = Math.max(1, Math.min(28, (iw / Math.max(1, inView.length)) * 0.78));
  const readPx = readX != null ? xs(readX) : null;

  return (
    <div
      ref={wrapRef}
      className="cv-plot"
      tabIndex={0}
      role="group"
      aria-label={`${spec.title}. Use the left and right arrow keys to read exact values.`}
      onKeyDown={onKey}
    >
      <svg ref={svgRef} width={width} height={height} role="img" aria-label={`${spec.title}, ${spec.unit || "no units"}${log ? ", log scale" : ""}`}>
        <defs>
          <clipPath id={clipId}><rect x={0} y={-2} width={iw} height={ih + 4} /></clipPath>
          <HatchPattern id={hatchId} />
        </defs>
        <text className="ch-unit" x={M.l} y={13}>{spec.unit}{spec.yLabel ? ` ${spec.yLabel}` : ""}{log ? " · log scale" : ""}</text>
        <g transform={`translate(${M.l},${M.t})`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className="ch-grid" x1={0} x2={iw} y1={ys(v)} y2={ys(v)} />
              <text className="ch-tick" x={-10} y={ys(v)} textAnchor="end" dominantBaseline="middle">{sig(v, 4)}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={v} className="ch-tick" x={xs(v)} y={ih + 22} textAnchor="middle">{spec.xKind === "month" && iw < 420 ? MONTHS[v - 1].slice(0, 1) : formatX(v, spec.xKind === "time" ? "year" : spec.xKind)}</text>
          ))}
          <text className="ch-axis-label" x={iw} y={ih + 40} textAnchor="end">{spec.xLabel}</text>
          <line className="ch-axis" x1={0} x2={iw} y1={ih} y2={ih} />

          <g clipPath={`url(#${clipId})`}>
            {spec.forecastFrom != null && spec.forecastFrom < xDomain[1] && (
              <g>
                <rect className="ch-forecast-zone" x={Math.max(0, xs(spec.forecastFrom))} y={0} width={Math.max(0, iw - Math.max(0, xs(spec.forecastFrom)))} height={ih} />
                <line className="ch-forecast-divider" x1={xs(spec.forecastFrom)} x2={xs(spec.forecastFrom)} y1={0} y2={ih} />
              </g>
            )}
            {!log && spec.zeroLine && yDomain[0] < 0 && yDomain[1] > 0 && <line className="ch-zero" x1={0} x2={iw} y1={ys(0)} y2={ys(0)} />}
            {(spec.thresholds ?? []).map((t) => (!log || t.y > 0) && t.y >= yDomain[0] && t.y <= yDomain[1] && (
              <g key={`t${t.y}`}>
                <line className="ch-threshold" x1={0} x2={iw} y1={ys(t.y)} y2={ys(t.y)} />
                <text className="ch-note" x={6} y={ys(t.y) + (t.y >= 0 ? -6 : 16)}>{t.label}</text>
              </g>
            ))}
            {spec.series.map((s) => {
              if (s.type === "band") {
                const d = bandD(s.data);
                return d && <path key={s.id} d={d} className={`ch-band ${s.style ?? ""}`} fill={s.style === "forecast" ? `url(#${hatchId})` : undefined} />;
              }
              if (s.type === "bars") {
                return (
                  <g key={s.id}>
                    {s.data.filter((d) => Number.isFinite(d.y) && (!log || d.y > 0)).map((d) => {
                      const y1 = ys(Math.max(d.y, baseline));
                      const y2 = ys(Math.min(d.y, baseline));
                      return <rect key={d.x} x={xs(d.x) - barW / 2} y={y1} width={barW} height={Math.max(0.8, y2 - y1)} style={{ fill: d.color ?? s.color }} className={`ch-bar ${s.style ?? ""}`} />;
                    })}
                  </g>
                );
              }
              if (s.type === "points") {
                return (
                  <g key={s.id}>
                    {s.data.filter((d) => Number.isFinite(d.y) && (!log || d.y > 0)).map((d) => (
                      <circle key={d.x} cx={xs(d.x)} cy={ys(d.y)} r={3.2} className={`ch-point ${s.style ?? ""}`} style={d.color ? { fill: d.color } : undefined} />
                    ))}
                  </g>
                );
              }
              return segments(s.data).map((seg, i) => (
                <path key={`${s.id}${i}`} d={linePath(seg)} className={`ch-line ${s.style ?? ""}`} />
              ));
            })}
            {(spec.markers ?? []).filter((m) => m.x >= xDomain[0] && m.x <= xDomain[1]).map((m) => (
              <g key={`m${m.x}${m.label}`}>
                <line className="ch-marker" x1={xs(m.x)} x2={xs(m.x)} y1={0} y2={ih} />
                <text className="ch-note" x={Math.min(xs(m.x) + 6, iw - 4)} y={14} textAnchor={xs(m.x) + 80 > iw ? "end" : "start"}>{m.label}</text>
              </g>
            ))}
            {spec.forecastFrom != null && spec.forecastFrom < xDomain[1] && (
              <text className="ch-note" x={Math.min(Math.max(0, xs(spec.forecastFrom)) + 6, iw - 4)} y={ih - 8} textAnchor={xs(spec.forecastFrom) + 70 > iw ? "end" : "start"}>Forecast</text>
            )}
          </g>

          {readPx != null && readPx >= 0 && readPx <= iw && (
            <g pointerEvents="none" data-export-skip>
              <line className="ch-cross" x1={readPx} x2={readPx} y1={0} y2={ih} />
              {spec.series.filter((s) => s.type !== "band").map((s) => {
                const d = nearestDatum(s.data, readX, step * 0.51);
                if (!d || !Number.isFinite(d.y) || (log && d.y <= 0) || d.y < yDomain[0] || d.y > yDomain[1]) return null;
                return <circle key={s.id} cx={xs(d.x)} cy={ys(d.y)} r={5} className="ch-focus-dot" />;
              })}
            </g>
          )}
          <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={pointer} onPointerDown={pointer} data-export-skip />
        </g>
      </svg>
    </div>
  );
}

function LegendSwatch({ s, hatchId }) {
  if (s.type === "bars") return <i className="ch-sw box" style={{ background: s.color ?? "var(--text-dim)" }} />;
  if (s.type === "band") {
    return (
      <svg className="ch-sw-svg" width="22" height="12" aria-hidden="true">
        <rect x="1" y="1" width="20" height="10" className={`ch-band ${s.style ?? ""}`} fill={s.style === "forecast" ? `url(#${hatchId})` : undefined} />
      </svg>
    );
  }
  if (s.type === "points") {
    return <svg className="ch-sw-svg" width="22" height="12" aria-hidden="true"><circle cx="11" cy="6" r="3.2" className={`ch-point ${s.style ?? ""}`} /></svg>;
  }
  return <svg className="ch-sw-svg" width="22" height="12" aria-hidden="true"><line x1="1" x2="21" y1="6" y2="6" className={`ch-line ${s.style ?? ""}`} /></svg>;
}

export function ChartLegend({ series, hatchId }) {
  return (
    <ul className="ch-legend">
      {series.flatMap((s) =>
        s.legend
          ? s.legend.map((l) => <li key={`${s.id}${l.label}`}><i className="ch-sw box" style={{ background: l.color }} />{l.label}</li>)
          : [<li key={s.id}><LegendSwatch s={s} hatchId={hatchId} />{s.label}</li>],
      )}
    </ul>
  );
}

// ---------------------------------------------------------------- the viewer dialog

export function ChartViewer({ spec: input, onClose }) {
  const views = useMemo(() => (Array.isArray(input) ? input : [input]).map(chartSpec), [input]);
  const [viewIndex, setViewIndex] = useState(() => Math.max(0, views.findIndex((v) => v.initial)));
  const raw = views[Math.min(viewIndex, views.length - 1)];
  const panelRef = useRef(null);
  const svgRef = useRef(null);
  const titleId = useSvgId("cv-title");
  const logNoteId = useSvgId("cv-log-note");
  const hatchId = useSvgId("cv-hatch");
  useDialogFocus(panelRef, onClose);

  const baseUnit = parseUnit(raw.unit).id;
  const options = raw.convertible ? unitOptions(raw.unit) : [];
  const [unit, setUnit] = useState(baseUnit);
  const [log, setLog] = useState(false);
  const [range, setRange] = useState({ x0: "", x1: "", y0: "", y1: "" });
  const [readX, setReadX] = useState(null);
  const [busy, setBusy] = useState(false);

  // A new view or unit invalidates typed ranges (y numbers change with the unit).
  useEffect(() => { setUnit(parseUnit(raw.unit).id); setRange({ x0: "", x1: "", y0: "", y1: "" }); setReadX(null); }, [raw]);
  useEffect(() => { setRange((r) => ({ ...r, y0: "", y1: "" })); }, [unit]);

  const spec = useMemo(() => (unit && unit !== baseUnit ? convertSpec(raw, unit) : raw), [raw, unit, baseUnit]);
  const approx = unit && baseUnit ? isApproximate(baseUnit, unit) : false;
  const guard = useMemo(() => logAxisGuard(specYValues(spec)), [spec]);
  const useLog = log && guard.ok;

  const allX = specXValues(spec);
  const [ax0, ax1] = allX.length ? extent([...allX, ...(spec.markers ?? []).map((m) => m.x)]) : [0, 1];
  const xDomainAuto = spec.xKind === "month" ? [0.5, 12.5] : [ax0, ax1 > ax0 ? ax1 : ax0 + 1];
  const nx0 = num(range.x0);
  const nx1 = num(range.x1);
  const xErr = nx0 != null && nx1 != null && !(nx1 > nx0) ? "The x minimum must be below the maximum." : "";
  const xDomain = xErr ? xDomainAuto : [nx0 ?? xDomainAuto[0], nx1 ?? xDomainAuto[1]];
  const safeX = xDomain[1] > xDomain[0] ? xDomain : xDomainAuto;

  const yAuto = useMemo(() => {
    const vis = [];
    for (const s of spec.series) {
      for (const d of s.data) {
        if (d.x < safeX[0] || d.x > safeX[1]) continue;
        for (const v of s.type === "band" ? [d.lo, d.hi] : [d.y]) if (Number.isFinite(v) && (!useLog || v > 0)) vis.push(v);
      }
    }
    for (const t of spec.thresholds ?? []) if (!useLog || t.y > 0) vis.push(t.y);
    if (spec.series.some((s) => s.type === "bars") && !useLog) vis.push(0);
    if (!vis.length) return useLog ? [1, 10] : [0, 1];
    const [lo, hi] = extent(vis);
    if (useLog) {
      const l0 = Math.log10(lo);
      const l1 = Math.log10(hi);
      const pad = Math.max((l1 - l0) * 0.07, 0.004);
      return [10 ** (l0 - pad), 10 ** (l1 + pad)];
    }
    return padExtent([lo, hi], 0.07);
  }, [spec, safeX[0], safeX[1], useLog]);
  const ny0 = num(range.y0);
  const ny1 = num(range.y1);
  let yErr = "";
  if (ny0 != null && ny1 != null && !(ny1 > ny0)) yErr = "The y minimum must be below the maximum.";
  else if (useLog && ((ny0 != null && ny0 <= 0) || (ny1 != null && ny1 <= 0))) yErr = "On a log scale the y range must be above zero.";
  const yDomain = yErr ? yAuto : [ny0 ?? yAuto[0], ny1 ?? yAuto[1]];
  const safeY = yDomain[1] > yDomain[0] ? yDomain : yAuto;

  const readout = useMemo(() => {
    if (readX == null) return null;
    const step = medianStep([...new Set(allX)].sort((a, b) => a - b));
    const rows = [];
    let label = null;
    for (const s of spec.series) {
      const d = nearestDatum(s.data, readX, step * 0.51);
      if (!d) continue;
      label = label ?? d.label;
      const value = s.type === "band"
        ? `${sig(d.lo, 4)} to ${sig(d.hi, 4)}`
        : sig(d.y, 4);
      rows.push({ id: s.id, name: s.label, value, note: d.note });
    }
    return { label: label ?? formatX(readX, spec.xKind), rows };
  }, [readX, spec]);

  const filename = (ext) => `${slugify(spec.title)}${unit && unit !== baseUnit ? `_${slugify(unit)}` : ""}.${ext}`;
  const exportCsv = () =>
    downloadText(
      filename("csv"),
      chartCsv(spec, { range: { x0: safeX[0], x1: safeX[1] }, originalUnit: unit !== baseUnit ? raw.unit : null, approximate: approx }),
    );
  const exportPng = async () => {
    if (!svgRef.current) return;
    setBusy(true);
    try {
      await exportChartPng(svgRef.current, { title: spec.title, source: spec.source, unit: `${spec.unit}${approx ? " (approx.)" : ""}`, filename: filename("png") });
    } finally {
      setBusy(false);
    }
  };
  const set = (key) => (e) => setRange((r) => ({ ...r, [key]: e.target.value }));
  const unitNote = unit && unit !== baseUnit
    ? `Shown in ${unitInfo(unit)?.label ?? unit}, converted from ${raw.unit} for display only.${approx ? " Approximate: an average month of 30.44 days." : ""}${spec.delta ? " Differences and trends use the scale factor only." : ""}`
    : "";

  return createPortal(
    <div className="cv-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className="cv-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="cv-head">
          <div className="cv-titles">
            <h2 id={titleId} className="cv-title">{spec.title}</h2>
            <p className="cv-sub">{[spec.source, spec.unit].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" className="btn btn-sm cv-close" onClick={onClose} aria-label="Close chart" data-autofocus>
            <span aria-hidden="true">×</span> Close
          </button>
        </header>

        <div className="cv-toolbar" role="group" aria-label="Chart controls">
          {views.length > 1 && (
            <div className="cv-ctl">
              <span className="cv-ctl-label">View</span>
              <div className="seg" role="group" aria-label="Chart view">
                {views.map((v, i) => (
                  <button key={v.viewLabel ?? i} type="button" aria-pressed={i === viewIndex} onClick={() => setViewIndex(i)}>{v.viewLabel ?? `View ${i + 1}`}</button>
                ))}
              </div>
            </div>
          )}
          <div className="cv-ctl">
            <span className="cv-ctl-label">Y scale</span>
            <div className="seg" role="group" aria-label="Y-axis scale">
              <button type="button" aria-pressed={!useLog} onClick={() => setLog(false)}>Linear</button>
              <button type="button" aria-pressed={useLog} disabled={!guard.ok} aria-describedby={!guard.ok ? logNoteId : undefined} onClick={() => setLog(true)}>Log</button>
            </div>
          </div>
          {options.length > 1 && (
            <label className="field cv-ctl">
              <span className="cv-ctl-label">Units</span>
              <select value={unit ?? ""} onChange={(e) => setUnit(e.target.value)}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
          <fieldset className="cv-range">
            <legend className="cv-ctl-label">{spec.xLabel} range</legend>
            <input type="number" inputMode="decimal" step={spec.xKind === "year" || spec.xKind === "month" ? 1 : "any"} aria-label={`${spec.xLabel} minimum`} placeholder={spec.xKind === "month" ? "1" : formatX(xDomainAuto[0], "year")} value={range.x0} onChange={set("x0")} />
            <span aria-hidden="true">to</span>
            <input type="number" inputMode="decimal" step={spec.xKind === "year" || spec.xKind === "month" ? 1 : "any"} aria-label={`${spec.xLabel} maximum`} placeholder={spec.xKind === "month" ? "12" : formatX(xDomainAuto[1], "year")} value={range.x1} onChange={set("x1")} />
          </fieldset>
          <fieldset className="cv-range">
            <legend className="cv-ctl-label">Y range</legend>
            <input type="number" inputMode="decimal" step="any" aria-label="Y minimum" placeholder={sig(yAuto[0], 3)} value={range.y0} onChange={set("y0")} />
            <span aria-hidden="true">to</span>
            <input type="number" inputMode="decimal" step="any" aria-label="Y maximum" placeholder={sig(yAuto[1], 3)} value={range.y1} onChange={set("y1")} />
          </fieldset>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setRange({ x0: "", x1: "", y0: "", y1: "" }); setLog(false); setUnit(baseUnit); }}>Reset</button>
          <span className="cv-spacer" />
          <button type="button" className="btn btn-sm" onClick={exportPng} disabled={busy}>{busy ? "Saving…" : "Save PNG"}</button>
          <button type="button" className="btn btn-sm" onClick={exportCsv}>Save CSV</button>
        </div>

        {(!guard.ok || xErr || yErr || unitNote) && (
          <div className="cv-notes" aria-live="polite">
            {!guard.ok && <p id={logNoteId}>{guard.reason}</p>}
            {xErr && <p>{xErr}</p>}
            {yErr && <p>{yErr}</p>}
            {unitNote && <p>{unitNote}</p>}
          </div>
        )}

        <Plot spec={spec} log={useLog} xDomain={safeX} yDomain={safeY} svgRef={svgRef} readX={readX} setReadX={setReadX} hatchId={hatchId} />

        <div className="cv-readout" aria-live="polite">
          {readout ? (
            <>
              <span className="cv-readout-x">{readout.label}</span>
              {readout.rows.map((r) => (
                <span key={r.id} className="cv-readout-row">
                  <span className="cv-readout-name">{r.name}</span>
                  <span className="mono">{r.value} {spec.unit}</span>
                  {r.note && <span className="cv-readout-note">{r.note}</span>}
                </span>
              ))}
            </>
          ) : (
            <span className="cv-readout-hint">Point at the chart, or focus it and use the arrow keys, to read exact values.</span>
          )}
        </div>

        <ChartLegend series={spec.series} hatchId={hatchId} />
        {spec.footnote && <p className="cv-foot">{spec.footnote}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- hook + wrapper

/**
 * `const { open, close, isOpen, viewer } = useChartViewer();`
 * `open(spec)` shows the viewer for a ChartSpec (or array / function); render `{viewer}` somewhere in your tree
 * (it portals to <body>). Focus returns to `returnFocusRef.current` (or the previously focused element) on close.
 */
export function useChartViewer(returnFocusRef) {
  const [spec, setSpec] = useState(null);
  const wasOpen = useRef(false);
  const open = useCallback((s) => setSpec(() => (typeof s === "function" ? s() : s)), []);
  const close = useCallback(() => setSpec(null), []);
  useEffect(() => {
    if (spec) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      returnFocusRef?.current?.focus?.();
    }
  }, [spec, returnFocusRef]);
  const viewer = spec ? <ChartViewer spec={spec} onClose={close} /> : null;
  return { open, close, isOpen: Boolean(spec), viewer };
}

const INTERACTIVE = "button, a, input, select, textarea, label, [role='button'], [data-no-expand]";

/**
 * Wrap any chart to make it expandable. Click / tap anywhere on it (except its own buttons and markers), or press
 * Enter / Space on its "Expand" button.
 *
 * Props: spec (ChartSpec | ChartSpec[] | () => spec), title, source, unit, variable (override the spec's metadata),
 * disabled (render children only), label (button text, default "Expand"), className, children.
 */
export function ExpandableChart({ spec, title, source, unit, variable, disabled = false, label = "Expand", className = "", children }) {
  const buttonRef = useRef(null);
  const { open, viewer } = useChartViewer(buttonRef);
  if (disabled || !spec) return children;
  const meta = (s) => ({
    ...s,
    ...(title != null ? { title } : null),
    ...(source != null ? { source } : null),
    ...(unit != null && !s.unit ? { unit } : null),
    ...(variable != null ? { variable } : null),
  });
  const show = () => {
    const s = typeof spec === "function" ? spec() : spec;
    if (!s) return;
    open(Array.isArray(s) ? s.map(meta) : meta(s));
  };
  const name = title ?? (Array.isArray(spec) ? spec[0]?.title : typeof spec === "object" ? spec.title : null) ?? "chart";
  return (
    <div
      className={`xc ${className}`}
      onClick={(e) => {
        // Clicks inside the (portalled) viewer bubble here through React; ignore anything outside this chart's DOM.
        if (!e.currentTarget.contains(e.target)) return;
        const hit = e.target.closest?.(INTERACTIVE);
        if (hit && e.currentTarget.contains(hit)) return;
        show();
      }}
    >
      {children}
      <button ref={buttonRef} type="button" className="xc-open" aria-haspopup="dialog" aria-label={`${label}: ${name}`} onClick={show}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 1.5h4v4M12.5 1.5 8 6M5.5 12.5h-4v-4M1.5 12.5 6 8" /></svg>
        <span>{label}</span>
      </button>
      {viewer}
    </div>
  );
}

export default ExpandableChart;
