/**
 * The bottom timeline rail (spec 3.4, 4.4, 5.10). Observed NASA POWER months on the left, a dashed divider, and the
 * forecast zone on the right (frames only when the forecast is eligible). No autoplay; play stops on the last observed
 * month; entering the forecast is a deliberate step, drag or "Show forecast". Every frame shows month, source, unit
 * and the local-grid caveat. Live weather never appears here.
 */
import { useEffect, useRef, useState } from "react";
import {
  atPlayEnd, coverageBadge, FORECAST_BADGE, isForecastIndex, meanReadout, OBSERVED_BADGE, railCaption, RANGES, REDUCED_SPEEDS,
  SPEEDS, sliderText, stepIndex, tableRows, trackBars, yearTicks,
} from "../../lib/globeFrames.js";
import { Badge, Disclosure, StateCard } from "../shell/ui.jsx";
import { useGlobeLayers } from "./useGlobeLayers.jsx";
import "../../styles/globe.css";

const GAP = 12; // px between the observed and forecast zones

/** CSS left position of slot i's centre on a track with `obs` observed slots, `total` slots and a fixed gap. */
const slotLeft = (i, obs, total, hasZone) => {
  const gap = hasZone ? GAP : 0;
  return `calc((100% - ${gap}px) * ${(i + 0.5) / total} + ${i >= obs ? gap : 0}px)`;
};

function ForecastSlotOnRail({ L, onWithheld }) {
  const s = L.forecastStatus;
  if (s.kind === "idle") return <button type="button" className="rail-fc-btn" onClick={() => L.requestForecast()}>Check forecast</button>;
  if (s.kind === "loading") return <span className="rail-fc-note" role="status">Backtesting…</span>;
  if (s.kind === "error") return <button type="button" className="rail-fc-btn" onClick={() => L.requestForecast(true)}>Forecast failed · retry</button>;
  if (s.kind === "withheld") {
    return (
      <button type="button" className="rail-fc-btn is-withheld" onClick={onWithheld} aria-expanded={false}>
        <span aria-hidden="true">🔒︎</span> Forecast withheld
      </button>
    );
  }
  return null;
}

export default function TimelineRail() {
  const L = useGlobeLayers();
  const [showReason, setShowReason] = useState(false);
  const [announce, setAnnounce] = useState("");
  const trackRef = useRef(null);
  const sliderRef = useRef(null);
  const dragging = useRef(false);

  const tl = L?.timeline;
  const frame = L?.frame;
  useEffect(() => setShowReason(false), [L?.forecastStatus.kind, L?.place?.id, L?.variable?.id]);
  // Announce the month when paused (stepping/scrubbing), never while playing.
  useEffect(() => {
    if (!frame || L.playing) return undefined;
    const t = setTimeout(() => setAnnounce(sliderText(frame, tl.units)), 250);
    return () => clearTimeout(t);
  }, [frame, L?.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!L) return null;
  if (!L.place) return <div className="rail-empty"><StateCard kind="empty" title="Choose a place to see its history" /></div>;
  if (!L.variable) return <div className="rail-empty"><StateCard kind="empty" title="Choose a variable to see its monthly history" /></div>;

  const req = L.framesReq;
  if (req.loading && !req.data) {
    return (
      <div className="rail rail--loading">
        <div className="rail-skeleton" aria-hidden="true" />
        <StateCard kind="loading" title="Loading monthly history…" slowText="Still working — NASA POWER can be slow.">
          Requesting NASA POWER monthly data… nothing is shown yet.
        </StateCard>
      </div>
    );
  }
  if (req.error) {
    return (
      <div className="rail-empty">
        <StateCard kind="error" title="We couldn't load the monthly history" action={<button type="button" className="btn btn-sm" onClick={() => L.loadFrames(true)}>Try again</button>}>
          {req.error}
        </StateCard>
      </div>
    );
  }
  if (!tl || !tl.frames.length) {
    return <div className="rail-empty"><StateCard kind="empty" title="No monthly frames for this place" /></div>;
  }

  const total = tl.frames.length;
  const obs = tl.observedCount;
  const fStatus = L.forecastStatus;
  const hasZone = tl.forecastCount > 0;
  const inForecast = isForecastIndex(tl, L.index);
  const bars = trackBars(tl);
  const ticks = yearTicks(tl);
  const coverage = coverageBadge(frame, tl.grid);
  const speeds = L.reduced ? REDUCED_SPEEDS : SPEEDS;
  const playLabel = L.playing ? "❚❚ Pause" : atPlayEnd(tl, L.index) ? "↺ Replay" : "▶ Play";
  const fadeVar = { "--rail-step": L.playing && !L.reduced ? "var(--dur-fast)" : "0ms" };

  const indexAtX = (clientX) => {
    const el = trackRef.current;
    if (!el) return L.index;
    const r = el.getBoundingClientRect();
    const gap = hasZone ? GAP : 0;
    const slotW = (r.width - gap) / total;
    let x = clientX - r.left;
    if (hasZone && x > obs * slotW + gap / 2) x -= gap;
    return Math.max(0, Math.min(total - 1, Math.floor(x / slotW)));
  };
  const onTrackDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    L.setIndex(indexAtX(e.clientX));
    sliderRef.current?.focus({ preventScroll: true });
  };
  const onTrackMove = (e) => {
    if (dragging.current) L.setIndex(indexAtX(e.clientX));
  };
  const onTrackUp = () => {
    dragging.current = false;
  };
  const onSliderKey = (e) => {
    const map = { PageUp: 12, PageDown: -12 };
    if (e.key in map) {
      e.preventDefault();
      L.setIndex(stepIndex(tl, L.index, map[e.key]));
    } else if (e.key === "Home") {
      e.preventDefault();
      L.setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      L.setIndex(total - 1);
    }
  };
  const rows = tableRows(tl, frame);

  return (
    <div className={`rail${inForecast ? " rail--forecast" : ""}`} style={fadeVar}>
      <div className="rail-row rail-controls">
        <button type="button" className="btn btn-sm rail-play" onClick={L.togglePlay} aria-label={L.playing ? "Pause" : atPlayEnd(tl, L.index) ? "Replay" : "Play"}>
          {playLabel}
        </button>
        <div className="seg rail-steps" role="group" aria-label="Step one month">
          <button type="button" onClick={() => L.setIndex(stepIndex(tl, L.index, -1))} aria-label="Previous month" disabled={L.index <= 0}>⏮</button>
          <button type="button" onClick={() => L.setIndex(stepIndex(tl, L.index, 1))} aria-label="Next month" disabled={L.index >= total - 1}>⏭</button>
        </div>
        <div className="seg rail-speed" role="group" aria-label="Playback speed">
          {speeds.map((s) => (
            <button key={s.id} type="button" className={L.speed === s.id ? "on" : ""} aria-pressed={L.speed === s.id} onClick={() => L.setSpeed(s.id)}>{s.label}</button>
          ))}
        </div>
        <b className={`rail-month mono${inForecast ? " is-forecast" : ""}`}>{frame?.label?.toUpperCase()}</b>
        <Badge kind={inForecast ? "forecast" : "observed"}>{frame?.badge || (inForecast ? FORECAST_BADGE : OBSERVED_BADGE)}</Badge>
        <span className="rail-mean mono">{meanReadout(frame, tl.units)}</span>
        {coverage && <Badge kind="source" title="Some grid cells have no value this month; they are drawn as missing, never filled in.">{coverage}</Badge>}
        <span className="rail-spacer" />
        {inForecast ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => L.setIndex(tl.lastObserved)}>◂ Back to observed</button>
        ) : (
          hasZone && <button type="button" className="btn btn-sm btn-ghost" onClick={L.showForecast}>Show forecast ▸</button>
        )}
        <div className="seg rail-range" role="group" aria-label="Years shown">
          {RANGES.map((r) => (
            <button key={r} type="button" className={L.range === r ? "on" : ""} aria-pressed={L.range === r} onClick={() => L.setRange(r)}>{r}y</button>
          ))}
        </div>
      </div>

      <div className="rail-row rail-trackrow">
        <div className="rail-zones" aria-hidden="true">
          <span className="rail-zone-label">Observed</span>
          {(hasZone || fStatus.kind !== "eligible") && <span className="rail-zone-label is-forecast">Forecast</span>}
        </div>
        <div className="rail-trackwrap">
          <div
            className="rail-track"
            ref={trackRef}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            style={{ gridTemplateColumns: hasZone ? `repeat(${obs}, 1fr) ${GAP}px repeat(${tl.forecastCount}, 1fr)` : `repeat(${total}, 1fr)` }}
          >
            {bars.map((b) => (
              <span key={b.i} className={`rail-bar${b.kind === "forecast" ? " is-forecast" : ""}${b.missing ? " is-missing" : ""}`} style={{ gridColumn: hasZone && b.i >= obs ? b.i + 2 : b.i + 1, gridRow: 1 }}>
                {!b.missing && (
                  <i className={b.up ? "up" : "down"} style={{ height: `${Math.max(4, b.h * 50)}%`, background: `var(${b.token})` }} />
                )}
              </span>
            ))}
            {hasZone && <span className="rail-divider" style={{ gridColumn: obs + 1, gridRow: 1 }} />}
            <span className="rail-thumb" style={{ left: slotLeft(L.index, obs, total, hasZone) }} aria-hidden="true" />
            <input
              ref={sliderRef}
              className="rail-slider"
              type="range"
              min={0}
              max={total - 1}
              step={1}
              value={L.index}
              aria-label="Month"
              aria-valuetext={sliderText(frame, tl.units)}
              onChange={(e) => L.setIndex(Number(e.target.value))}
              onKeyDown={onSliderKey}
            />
          </div>
          {!hasZone && (
            <div className={`rail-fc-slot${fStatus.kind === "withheld" ? " is-withheld" : ""}`}>
              <ForecastSlotOnRail L={L} onWithheld={() => setShowReason((v) => !v)} />
            </div>
          )}
        </div>
        <div className="rail-years mono" aria-hidden="true">
          {ticks.map(({ i, f }) => (
            <span key={i} style={{ left: slotLeft(i, obs, total, hasZone) }}>{f.year}</span>
          ))}
        </div>
      </div>

      {showReason && fStatus.kind === "withheld" && (
        <div className="rail-reason">
          <StateCard kind="withheld" title="Forecast withheld">
            {fStatus.reason} Observed history is still available.
          </StateCard>
        </div>
      )}

      <div className="rail-row rail-caption">
        <span className="td-source">
          {railCaption(tl, frame)}
          {" · "}
          <a href={tl.provenance?.source_url ?? "https://power.larc.nasa.gov/"} target="_blank" rel="noopener noreferrer">source ↗</a>
        </span>
        <Disclosure summary={<span aria-label="About this grid">ⓘ</span>} className="rail-about">
          <p className="small">{tl.grid?.resolution_note}</p>
          {tl.provenance?.caveat && <p className="small dim">{tl.provenance.caveat}</p>}
          {inForecast && tl.forecastProvenance?.caveat && <p className="small dim">{tl.forecastProvenance.caveat}</p>}
          {tl.coverage && (
            <p className="small dim mono">
              Cells loaded {tl.coverage.cells_succeeded} of {tl.coverage.cells_requested} · cell-months with data {tl.coverage.total_cell_months_valid} of {tl.coverage.total_cell_months_expected}
            </p>
          )}
          {tl.provenance?.fetched_at && <p className="small faint mono">Fetched {tl.provenance.fetched_at}{tl.provenance.stale ? " (saved copy)" : ""}</p>}
        </Disclosure>
      </div>

      <Disclosure summary="Show grid values as a table" className="rail-table">
        <table className="gl-table">
          <caption className="sr-only">{frame?.label} · {frame?.badge} · {tl.units}</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row}>
                <th scope="row">Row {r.row}</th>
                {r.cells.map((c) => (
                  <td key={c.id} className={c.missing ? "is-missing" : ""}>
                    <span className="faint mono small">{c.where}</span>
                    <br />
                    {c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>

      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
