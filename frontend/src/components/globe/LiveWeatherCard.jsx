/**
 * Live weather card (spec 5.8, dashboard slot 4). Meteomatics point weather for the next 1–72 hours, labelled with
 * the response's own `label` ("… not NASA trend data") and `source_note`. Collapsed by default: nothing is requested
 * until it is expanded or "Show on globe" is on. The hourly chart has its own hour axis and colour; it never shares
 * the monthly rail.
 */
import { useEffect, useState } from "react";
import { formatValue, HOURS, hourSeries, LIVE_LABEL, LIVE_SOURCE_NOTE, retryWait, runs, STATE_TITLES, utcTime } from "../../lib/liveWeather.js";
import { Badge, StateCard } from "../shell/ui.jsx";
import { useGlobeLayers } from "./useGlobeLayers.jsx";

function HourChart({ data, hours }) {
  const pts = hourSeries(data, hours);
  if (pts.length < 2) return null;
  const W = 300;
  const H = 64;
  const temps = pts.map((p) => p.temp).filter((v) => v != null);
  const rains = pts.map((p) => p.rain).filter((v) => v != null);
  const tMin = temps.length ? Math.min(...temps) : 0;
  const tMax = temps.length ? Math.max(...temps) : 1;
  const rMax = Math.max(1, ...rains);
  const x = (i) => (i / (pts.length - 1)) * (W - 8) + 4;
  const y = (t) => 6 + (1 - (t - tMin) / (tMax - tMin || 1)) * 30;
  const bw = Math.max(1.5, (W - 8) / pts.length - 1);
  return (
    <figure className="lw-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Next ${pts.length} hours: temperature from ${formatValue(tMin, "°C")} to ${formatValue(tMax, "°C")}`}>
        {runs(pts, "temp").map((run, k) => (
          <polyline key={k} className="lw-line" points={run.map((p) => `${x(p.i)},${y(p.temp)}`).join(" ")} />
        ))}
        {pts.map((p) => (p.rain != null && p.rain > 0 ? <rect key={p.i} className="lw-rain" x={x(p.i) - bw / 2} y={H - 14 - (p.rain / rMax) * 12} width={bw} height={(p.rain / rMax) * 12} /> : null))}
        <line className="lw-nowline" x1={x(0)} x2={x(0)} y1="2" y2={H - 12} />
        {pts.map((p) => (p.i % 6 === 0 ? <text key={`t${p.i}`} className="lw-tick" x={x(p.i)} y={H - 1}>{p.i === 0 ? "now" : `+${p.i}h`}</text> : null))}
      </svg>
      <figcaption className="faint small">Hourly temperature (line) and rain (bars), Meteomatics. Gaps are hours with no value.</figcaption>
    </figure>
  );
}

export default function LiveWeatherCard() {
  const L = useGlobeLayers();
  const [tick, setTick] = useState(0);
  const s = L?.weatherState;
  const wait = s?.kind === "rate_limited" ? retryWait(s.retryAfter, L.weatherReq.receivedAt ?? Date.now()) : 0;
  useEffect(() => {
    if (!wait) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [wait, tick]);
  if (!L) return null;

  const open = L.weatherOpen;
  const head = (
    <header className="slot-head">
      <h2 className="slot-title">
        <button type="button" className="lw-toggle" aria-expanded={open} aria-controls="lw-body" onClick={() => L.setWeatherOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Live weather
        </button>
      </h2>
      <Badge kind="live">LIVE · Meteomatics</Badge>
    </header>
  );
  if (!L.place) {
    return (
      <div className="lw">
        {head}
        {open && <StateCard kind="empty" title="Choose a place first">Live weather is shown for one place at a time.</StateCard>}
      </div>
    );
  }
  const d = L.weatherReq.data;
  const canToggle = !["unconfigured", "unavailable", "rate_limited", "error"].includes(s.kind);
  const toggle = (
    <label className={`lw-show${canToggle ? "" : " is-disabled"}`}>
      <input type="checkbox" checked={L.showLive} disabled={!canToggle} onChange={(e) => L.setShowLive(e.target.checked)} /> Show on globe
      {!canToggle && s.reason && <span className="faint small"> — {s.reason}</span>}
    </label>
  );

  let body = null;
  if (s.kind === "idle" || s.kind === "loading") {
    body = <StateCard kind="loading" title={STATE_TITLES.loading}>Current conditions and the next {L.hours} hours near {L.place.name}.</StateCard>;
  } else if (s.kind === "unconfigured") {
    body = <StateCard kind="nokey" title={STATE_TITLES.unconfigured}>{s.reason} NASA trend data and the monthly timeline still work.</StateCard>;
  } else if (s.kind === "unavailable") {
    body = (
      <StateCard kind="unavailable" title={STATE_TITLES.unavailable} action={<button type="button" className="btn btn-sm" onClick={() => L.loadWeather(true)}>Try again</button>}>
        {s.reason}
      </StateCard>
    );
  } else if (s.kind === "rate_limited") {
    body = (
      <StateCard
        kind="ratelimited"
        title={STATE_TITLES.rate_limited}
        action={<button type="button" className="btn btn-sm" disabled={wait > 0} onClick={() => L.loadWeather(true)}>{wait > 0 ? `Try again in ${wait} s` : "Try again"}</button>}
      >
        {s.reason} {s.retryAfter != null && `Try again in about ${s.retryAfter} seconds.`} The NASA timeline is unaffected.
      </StateCard>
    );
  } else if (s.kind === "error") {
    body = (
      <StateCard kind="error" title={STATE_TITLES.error} action={<button type="button" className="btn btn-sm" onClick={() => L.loadWeather(true)}>Try again</button>}>
        {s.message}
      </StateCard>
    );
  } else {
    const c = d.current;
    const units = (k, fallback) => d.parameter_details?.[k]?.unit ?? fallback;
    const stale = s.kind === "stale";
    body = (
      <>
        {stale && (
          <StateCard kind="stale" title={`Showing saved data from ${utcTime(d.fetched_at)}`} action={<button type="button" className="btn btn-sm" onClick={() => L.loadWeather(true)}>Refresh</button>}>
            {s.reason}
          </StateCard>
        )}
        <dl className={`lw-now${stale ? " is-stale" : ""}`}>
          {[
            ["temperature_c", "°C", "Temperature", 1],
            ["cloud_cover_percent", "%", "Cloud", 0],
            ["precipitation_1h_mm", "mm", "Rain (1 h)", 1],
            ["wind_speed_10m_ms", "m/s", "Wind", 1],
          ].map(([k, u, label, digits]) => (
            <div key={k}>
              <dt className="faint small">{d.parameter_details?.[k]?.label ?? label}</dt>
              <dd className="mono" title={c[k] == null ? "Not supplied by Meteomatics" : undefined}>{formatValue(c[k], units(k, u), digits)}</dd>
            </div>
          ))}
        </dl>
        <div className="lw-hours">
          <span className="small dim">Next {L.hours} hours</span>
          <div className="seg" role="group" aria-label="Hours ahead">
            {HOURS.map((h) => (
              <button key={h} type="button" className={L.hours === h ? "on" : ""} aria-pressed={L.hours === h} onClick={() => L.setHours(h)}>{h}h</button>
            ))}
          </div>
        </div>
        <HourChart data={d} hours={L.hours} />
        <p className="td-source">
          Valid from {utcTime(d.request?.start ?? c.time)} · fetched {utcTime(d.fetched_at)} · {s.provider}
        </p>
      </>
    );
  }

  return (
    <div className="lw">
      {head}
      <p className="lw-label small">{s.label || LIVE_LABEL}</p>
      {open ? (
        <div id="lw-body" className="lw-body">
          {body}
          {toggle}
          <p className="faint small">{s.sourceNote ?? d?.source_note ?? LIVE_SOURCE_NOTE}</p>
        </div>
      ) : (
        <div id="lw-body" className="lw-body is-collapsed">{toggle}</div>
      )}
    </div>
  );
}
