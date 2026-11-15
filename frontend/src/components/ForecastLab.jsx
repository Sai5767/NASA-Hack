import { useEffect, useState } from "react";
import { fetchForecast } from "../api.js";
import ForecastChart from "./charts/ForecastChart.jsx";
import { replayBasisText } from "./insight/logic.js";
import Term from "./Term.jsx";

const KIND_LABEL = { baseline: "baseline", statistical: "statistical", learned: "machine learning", ensemble: "ensemble" };
const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;

function Scoreboard({ models, baselineId }) {
  const sorted = [...models].sort((a, b) => b.skill - a.skill);
  const maxAbs = Math.max(0.2, ...models.map((m) => Math.abs(m.skill)));
  return (
    <ul className="scoreboard" aria-label="Model scoreboard">
      {sorted.map((m, i) => (
        <li key={m.id} className={`${m.is_best ? "best" : ""} reveal-slide`} style={{ "--d": `${i * 70}ms` }}>
          <span className="sb-name">
            {m.label}
            <small className={`kind ${m.kind}`}>{KIND_LABEL[m.kind]}</small>
            {m.is_best && <small className="winner">winner</small>}
          </span>
          <span className="sb-bar" aria-hidden="true">
            <i className={m.skill >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(m.skill) / maxAbs) * 50}%`, [m.skill >= 0 ? "left" : "right"]: "50%" }} />
          </span>
          <span className="mono sb-val">{m.id === baselineId ? "baseline" : pct(m.skill)}</span>
        </li>
      ))}
    </ul>
  );
}

function coverageNote(cov, models) {
  if (cov.test == null) return "Too few backtests to check the band.";
  // Backend B3: the coverage check re-runs model choice and band calibration using only years up to
  // calibration_end_year, then scores later years. That model can differ from today's winner.
  const chosen = cov.model ? models.find((m) => m.id === cov.model)?.label ?? cov.model : null;
  const how = cov.calibration_end_year != null
    ? `Re-running the whole procedure with data only up to ${cov.calibration_end_year}${chosen ? ` (which picked ${chosen})` : ""}, the 80% band then held the true value ${Math.round(cov.test * 100)}% of the time in later years (${cov.n_test} checks).`
    : `In backtests on years it was not calibrated on, the 80% band held the true value ${Math.round(cov.test * 100)}% of the time (${cov.n_test} checks).`;
  if (cov.test < 0.7) return `${how} That is below the 80% target, so treat this band as too narrow.`;
  if (cov.test > 0.92) return `${how} The band is conservative: wider than it needs to be.`;
  return `${how} That is close to the 80% target.`;
}

/** Machine-learning forecast lab: models compete in a backtest; the winner forecasts with a calibrated error band. */
export default function ForecastLab({ data }) {
  const { variable, location, period } = data;
  const [state, setState] = useState({ loading: true, lab: null, error: "" });
  const [replayIndex, setReplayIndex] = useState(null);
  const [showReplay, setShowReplay] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, lab: null, error: "" });
    fetchForecast(
      { variable: variable.id, lat: location.lat, lon: location.lon, start_year: period.start_year, end_year: period.end_year },
      controller.signal,
    )
      .then((lab) => {
        setState({ loading: false, lab, error: "" });
        setReplayIndex(lab.ok ? Math.max(0, lab.replays.length - 1) : null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setState({ loading: false, lab: null, error: e.message });
      });
    return () => controller.abort();
  }, [variable.id, location.lat, location.lon, period.start_year, period.end_year]);

  const { loading, lab, error } = state;
  const baselineLabel = lab?.ok ? lab.models.find((m) => m.id === lab.baseline)?.label.toLowerCase() : "";
  const best = lab?.ok ? lab.models.find((m) => m.is_best) : null;
  const replay = lab?.ok && showReplay && replayIndex != null ? lab.replays[replayIndex] : null;

  return (
    <section className="card forecastlab">
      <div className="lab-head">
        <h3>Forecast lab <span className="badge ml">machine learning</span></h3>
        <p className="dim small">
          Could the next five years be predicted? Eight models compete in a <Term id="backtest">backtest</Term>: each is trained only on data up to a
          past year, asked for the next one to five years, and scored against what really happened.
        </p>
      </div>

      {loading && <p className="mono dim">Running the backtest…</p>}
      {error && <p className="dim">The forecast lab is unavailable right now: {error}</p>}
      {lab && !lab.ok && <p className="dim">{lab.message}</p>}

      {lab?.ok && (
        <>
          <p className={`lab-verdict ${lab.beats_baseline ? "win" : "nowin"}`}>
            {lab.beats_baseline ? (
              <>
                <b>{lab.best_label}</b> won. Across {lab.n_origins} backtests its errors were <b>{Math.round(best.skill * 100)}% smaller</b> than the best naive
                baseline ({baselineLabel}).
              </>
            ) : (
              <>
                No model reliably beat the naive baseline ({baselineLabel}). This series is hard to forecast, so treat the forecast below as little
                better than a guess.
              </>
            )}
          </p>

          <ForecastChart lab={lab} replay={replay} units={variable.units} />

          <div className="replay">
            <label>
              <span className="eyebrow">Replay the past <span className="badge">illustration, in-sample</span></span>
              <input
                type="range"
                min={0}
                max={lab.replays.length - 1}
                step={1}
                value={replayIndex ?? 0}
                onChange={(e) => {
                  setReplayIndex(Number(e.target.value));
                  setShowReplay(true);
                }}
                aria-valuetext={replay ? `Forecast made in ${replay.origin_year}` : "Replay off"}
              />
            </label>
            <p className="small dim">
              {replay
                ? `Standing in ${replay.origin_year}, this model forecast the pink line; the white dots are what actually happened.${replay.band_basis === "in_sample" ? " The band shown is today's band, so this is an illustration, not a test." : ""}`
                : "Replay is hidden."}{" "}
              <button type="button" className="linklike" onClick={() => setShowReplay((s) => !s)}>{showReplay ? "Hide replay" : "Show replay"}</button>
            </p>
          </div>

          {lab.replays.length > 0 && <p className="small faint">{replayBasisText(replay ?? lab.replays[0], lab)}</p>}
          <p className="small">{coverageNote(lab.coverage, lab.models)} <Term id="conformal">How the band is built.</Term></p>

          <h4 className="sb-title">Model scoreboard <span className="dim small">(error versus the best naive baseline)</span></h4>
          <Scoreboard models={lab.models} baselineId={lab.baseline} />
          <p className="faint small">{lab.caveat}</p>
        </>
      )}
    </section>
  );
}
