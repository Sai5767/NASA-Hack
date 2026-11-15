/**
 * Forecast status card (spec 5.10, dashboard slot 5). /api/monthly-forecast is requested only when the user presses
 * "Check forecast". Frames are shown only when `eligible === true`; otherwise the backend `reason` is shown verbatim
 * and the observed timeline stays usable. Every number is a backend value.
 */
import { Badge, Disclosure, StateCard } from "../shell/ui.jsx";
import { useGlobeLayers } from "./useGlobeLayers.jsx";

const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 1000) / 10}%`);

export default function ForecastStatus() {
  const L = useGlobeLayers();
  if (!L) return null;
  const head = (
    <header className="slot-head">
      <h2 className="slot-title">Forecast status</h2>
      <Badge kind="forecast">Forecast — not observed</Badge>
    </header>
  );
  if (!L.place || !L.variable) {
    return (
      <>
        {head}
        <StateCard kind="empty" title="Choose a place first">1–3 month statistical outlook, shown only if it passes its own accuracy checks.</StateCard>
      </>
    );
  }
  const s = L.forecastStatus;
  let body;
  if (s.kind === "idle") {
    body = (
      <>
        <p className="small dim">1–3 month statistical outlook, shown only if it passes its own accuracy checks.</p>
        <button type="button" className="btn btn-sm" onClick={() => L.requestForecast()}>Check forecast</button>
      </>
    );
  } else if (s.kind === "loading") {
    body = <StateCard kind="loading" title="Backtesting the forecast… this can take a while." slowText="Still working — the backtest runs on the server." />;
  } else if (s.kind === "error") {
    body = (
      <StateCard kind="error" title="We couldn't check the forecast" action={<button type="button" className="btn btn-sm" onClick={() => L.requestForecast(true)}>Try again</button>}>
        {s.message}
      </StateCard>
    );
  } else if (s.kind === "withheld") {
    body = (
      <StateCard kind="withheld" title="Forecast withheld">
        {s.reason}
        {s.reasonCode !== "unsupported_variable" && " Observed history is still available."}
      </StateCard>
    );
  } else {
    const d = s.data;
    const selected = (d.models ?? []).find((m) => m.is_selected);
    const cal = d.calibration;
    const sameRange = s.first === s.last;
    body = (
      <>
        <p className="fc-available">
          <Badge kind="forecast">Forecast available</Badge> <b>{sameRange ? s.first : `${s.first} – ${s.last}`}</b>
        </p>
        <p className="small dim">{d.label || "Forecast — not observed data"}. A statistical extrapolation from NASA POWER monthly history, not an observation.</p>
        {d.alignment?.common_end_month && (
          <p className="small faint mono">Trained to {d.alignment.common_end_month}, the last month every grid cell has data.</p>
        )}
        <button type="button" className="btn btn-sm" onClick={L.showForecast} disabled={!L.timeline}>Show on timeline</button>
        <Disclosure summary="How good is it?">
          <dl className="fc-facts">
            <dt>Model</dt>
            <dd>{d.selected_model_label ?? d.selected_model ?? "—"}</dd>
            <dt>Skill vs seasonal naive</dt>
            <dd className="mono">{selected ? `${pct(selected.skill_vs_seasonal_naive)} lower error` : "—"}</dd>
            <dt>Interval coverage</dt>
            <dd className="mono">{cal ? `${pct(cal.empirical_coverage)} measured vs ${pct(cal.nominal_coverage)} intended (minimum ${pct(cal.min_required_coverage)})` : "—"}</dd>
            <dt>Backtests</dt>
            <dd className="mono">{cal ? `${cal.n_test_origins} origins · ${cal.n_test_pairs} scored pairs` : "—"}</dd>
            <dt>Training months</dt>
            <dd className="mono">{d.training_range ? `${d.training_range.start_month} to ${d.training_range.end_month} (${d.training_range.n_months})` : "—"}</dd>
          </dl>
          <p className="small faint">All values come from the server's rolling-origin backtest.</p>
        </Disclosure>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="fc-body">{body}</div>
    </>
  );
}
