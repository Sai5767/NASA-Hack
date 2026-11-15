/**
 * The thin floating timeline (plan 6C):   previous · play/pause · May 2024 · thin draggable line · next
 *
 * Default view: month, the real accessible range input and quiet playback/step controls. Everything else (speed,
 * years shown, grid table, source, coverage, forecast check and diagnostics) sits behind one Details disclosure.
 * Keys: arrows move one month, PageUp/PageDown 12, Home/End the bounds; aria-valuetext describes the month.
 * The observed/forecast boundary (label + hatch + divider) appears only when forecast frames exist.
 * With no place chosen, the same slider moves the coarse whole-Earth preview's months.
 * Live weather never appears here.
 */
import { useEffect, useRef, useState } from "react";
import {
  atPlayEnd, coverageBadge, FORECAST_BADGE, isForecastIndex, meanReadout, OBSERVED_BADGE, railCaption, RANGES, REDUCED_SPEEDS,
  SPEEDS, sliderText, tableRows,
} from "../../lib/globeFrames.js";
import { COARSE_LABEL } from "../../lib/coarsePreview.js";
import { useGlobeLayers } from "./useGlobeLayers.jsx";
import "../../styles/globe.css";

function ForecastCheck({ L }) {
  const s = L.forecastStatus;
  if (s.kind === "idle") return <button type="button" className="btn btn-sm" onClick={() => L.requestForecast()}>Check for a forecast</button>;
  if (s.kind === "loading") return <span className="tl-note" role="status">Checking the forecast’s own accuracy…</span>;
  if (s.kind === "error") return <button type="button" className="btn btn-sm" onClick={() => L.requestForecast(true)}>Forecast check failed · try again</button>;
  if (s.kind === "withheld") return <p className="tl-note">Forecast withheld: {s.reason} Observed history is still shown.</p>;
  return <p className="tl-note">Forecast available: {s.first}–{s.last}. It is a statistical estimate, not observed data.</p>;
}

/** The bar itself: shared by the local frames and the coarse preview months. */
function Scrubber({ count, index, setIndex, playing, onPlay, atEnd, monthText, valueText, observedCount = count, forecastTag = false, label = "Month", reduced }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const sliderRef = useRef(null);
  const max = Math.max(0, count - 1);
  const pct = (i) => (max > 0 ? (i / max) * 100 : 0);
  const hasZone = observedCount < count;
  const boundary = hasZone ? (pct(observedCount - 1) + pct(observedCount)) / 2 : null;

  const indexAtX = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return index;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max);
  };
  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    setIndex(indexAtX(e.clientX));
    sliderRef.current?.focus({ preventScroll: true });
  };
  const onMove = (e) => {
    if (dragging.current) setIndex(indexAtX(e.clientX));
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e) => {
    const map = { PageUp: 12, PageDown: -12 };
    if (e.key in map) {
      e.preventDefault();
      setIndex(Math.max(0, Math.min(max, index + map[e.key])));
    } else if (e.key === "Home") {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIndex(max);
    }
  };

  return (
    <div className="tl-bar">
      <button type="button" className="tl-btn" onClick={() => setIndex(Math.max(0, index - 1))} aria-label="Previous month" disabled={index <= 0}>
        <span aria-hidden="true">‹</span>
      </button>
      <button type="button" className="tl-btn tl-play" onClick={onPlay} aria-label={playing ? "Pause" : atEnd ? "Play again from the start" : "Play"}>
        <span aria-hidden="true">{playing ? "❚❚" : atEnd ? "↺" : "▶"}</span>
      </button>
      <span className={`tl-month mono${forecastTag ? " is-forecast" : ""}`}>
        {monthText}
        {forecastTag && <span className="tl-tag">Forecast</span>}
      </span>
      <div
        className={`tl-track${hasZone ? " has-zone" : ""}`}
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ "--tl-pos": `${pct(index)}%`, "--tl-boundary": boundary == null ? "100%" : `${boundary}%`, "--tl-step": playing && !reduced ? "var(--dur-fast)" : "0ms" }}
      >
        <span className="tl-line" aria-hidden="true" />
        {hasZone && (
          <>
            <span className="tl-zone" aria-hidden="true" />
            <span className="tl-divider" aria-hidden="true" />
            <span className="tl-zone-label" aria-hidden="true">Forecast</span>
          </>
        )}
        <span className="tl-thumb" aria-hidden="true" />
        <input
          ref={sliderRef}
          className="tl-slider"
          type="range"
          min={0}
          max={max}
          step={1}
          value={index}
          aria-label={label}
          aria-valuetext={valueText}
          onChange={(e) => setIndex(Number(e.target.value))}
          onKeyDown={onKey}
        />
      </div>
      <button type="button" className="tl-btn" onClick={() => setIndex(Math.min(max, index + 1))} aria-label="Next month" disabled={index >= max}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

export default function TimelineRail() {
  const L = useGlobeLayers();
  const [announce, setAnnounce] = useState("");
  const tl = L?.timeline;
  const frame = L?.frame;
  const scrub = L?.scrub;
  const coarse = L?.coarse;

  // Announce the month when paused (stepping/scrubbing), never while playing.
  const spoken = tl && frame ? sliderText(frame, tl.units) : scrub?.mode === "coarse" ? `${COARSE_LABEL}, ${scrub.label(scrub.index)}` : "";
  const busyPlaying = tl ? L.playing : scrub?.playing;
  useEffect(() => {
    if (!spoken || busyPlaying) return undefined;
    const t = setTimeout(() => setAnnounce(spoken), 300);
    return () => clearTimeout(t);
  }, [spoken, busyPlaying]);

  if (!L) return null;
  const live = <p className="sr-only" aria-live="polite">{announce}</p>;

  // ---- local monthly frames for the active place
  if (L.place && L.variable) {
    const req = L.framesReq;
    if (req.loading && !req.data) {
      return (
        <div className="tl" role="group" aria-label="Timeline">
          <p className="tl-status" role="status"><span className="tl-dot" aria-hidden="true" /> Loading monthly history…</p>
        </div>
      );
    }
    if (req.error) {
      return (
        <div className="tl" role="group" aria-label="Timeline">
          <p className="tl-status">
            We couldn’t load the monthly history.
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => L.loadFrames(true)}>Try again</button>
          </p>
        </div>
      );
    }
    if (tl && tl.frames.length) {
      const total = tl.frames.length;
      const inForecast = isForecastIndex(tl, L.index);
      const coverage = coverageBadge(frame, tl.grid);
      const speeds = L.reduced ? REDUCED_SPEEDS : SPEEDS;
      const rows = tableRows(tl, frame);
      return (
        <div className={`tl${inForecast ? " is-forecast" : ""}`} role="group" aria-label="Timeline">
          <Scrubber
            count={total}
            observedCount={tl.observedCount}
            index={L.index}
            setIndex={L.setIndex}
            playing={L.playing}
            onPlay={L.togglePlay}
            atEnd={atPlayEnd(tl, L.index)}
            monthText={frame?.label ?? ""}
            forecastTag={inForecast}
            valueText={sliderText(frame, tl.units)}
            reduced={L.reduced}
          />
          <details className="tl-details">
            <summary>Details</summary>
            <div className="tl-details-body">
              <p className="tl-line-text">
                <span className="mono">{frame?.badge || (inForecast ? FORECAST_BADGE : OBSERVED_BADGE)}</span>
                {" · "}
                <span className="mono">{meanReadout(frame, tl.units)}</span>
                {coverage && <> · <span title="Some grid cells have no value this month; they are drawn as missing, never filled in.">{coverage}</span></>}
              </p>
              <div className="tl-opts">
                <div className="seg" role="group" aria-label="Playback speed">
                  {speeds.map((s) => (
                    <button key={s.id} type="button" className={L.speed === s.id ? "on" : ""} aria-pressed={L.speed === s.id} onClick={() => L.setSpeed(s.id)}>{s.label}</button>
                  ))}
                </div>
                <div className="seg" role="group" aria-label="Years shown">
                  {RANGES.map((r) => (
                    <button key={r} type="button" className={L.range === r ? "on" : ""} aria-pressed={L.range === r} onClick={() => L.setRange(r)}>{r} years</button>
                  ))}
                </div>
                {tl.forecastCount > 0 && (inForecast ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => L.setIndex(tl.lastObserved)}>Back to observed</button>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={L.showForecast}>Show forecast</button>
                ))}
              </div>
              <ForecastCheck L={L} />
              <p className="tl-note">
                {railCaption(tl, frame)}
                {" · "}
                <a href={tl.provenance?.source_url ?? "https://power.larc.nasa.gov/"} target="_blank" rel="noopener noreferrer">Source ↗</a>
              </p>
              {tl.grid?.resolution_note && <p className="tl-note">{tl.grid.resolution_note}</p>}
              {tl.provenance?.caveat && <p className="tl-note">{tl.provenance.caveat}</p>}
              {inForecast && tl.forecastProvenance?.caveat && <p className="tl-note">{tl.forecastProvenance.caveat}</p>}
              {tl.coverage && (
                <p className="tl-note mono">
                  Cells loaded {tl.coverage.cells_succeeded} of {tl.coverage.cells_requested} · months with data {tl.coverage.total_cell_months_valid} of {tl.coverage.total_cell_months_expected}
                </p>
              )}
              {tl.provenance?.fetched_at && <p className="tl-note mono">Fetched {tl.provenance.fetched_at}{tl.provenance.stale ? " (saved copy)" : ""}</p>}
              <details className="tl-table">
                <summary>Show grid values as a table</summary>
                <table className="gl-table">
                  <caption className="sr-only">{frame?.label} · {frame?.badge} · {tl.units}</caption>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row}>
                        <th scope="row">Row {r.row}</th>
                        {r.cells.map((c) => (
                          <td key={c.id} className={c.missing ? "is-missing" : ""}>
                            <span className="tl-note mono">{c.where}</span>
                            <br />
                            {c.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </details>
          {live}
        </div>
      );
    }
    if (tl && !tl.frames.length) {
      return <div className="tl" role="group" aria-label="Timeline"><p className="tl-status">No monthly data for this place.</p></div>;
    }
  }

  // ---- no place yet: the same slider moves the coarse whole-Earth preview
  if (scrub?.mode === "coarse" && coarse?.doc) {
    return (
      <div className="tl is-coarse" role="group" aria-label="Timeline, coarse global preview">
        <Scrubber
          count={scrub.count}
          index={scrub.index}
          setIndex={scrub.setIndex}
          playing={scrub.playing}
          onPlay={scrub.togglePlay}
          atEnd={scrub.atEnd}
          monthText={scrub.label(scrub.index)}
          valueText={`${scrub.label(scrub.index)}, ${COARSE_LABEL.toLowerCase()}, approximate pattern`}
          label="Preview month"
          reduced={L.reduced}
        />
        <details className="tl-details">
          <summary>Details</summary>
          <div className="tl-details-body">
            <p className="tl-note">
              {COARSE_LABEL}: NASA POWER monthly means on a coarse 15° grid, retrieved {coarse.doc.retrieved}. An approximate
              pattern to orient you, not a measurement. Choose a place for detailed local data.
            </p>
            <p className="tl-note"><a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer">Source ↗</a></p>
          </div>
        </details>
        {live}
      </div>
    );
  }

  if (!L.variable) return <div className="tl" role="group" aria-label="Timeline"><p className="tl-status">Pick something to follow.</p></div>;
  if (!L.place) return <div className="tl" role="group" aria-label="Timeline"><p className="tl-status">Choose a place to move through time.</p></div>;
  return null;
}

