import { useEffect, useState } from "react";
import { fetchForecast } from "../api.js";
import { formatPlace, signed } from "../lib/format.js";
import { directionWord, noiseSentence, pValueMeaning } from "../lib/words.js";
import { Verdict } from "./CaseParts.jsx";
import TrendChart from "./charts/TrendChart.jsx";
import InView from "./InView.jsx";
import { verdictView } from "./insight/logic.js";
import Term from "./Term.jsx";

const GRADE_WORDS = { strong: "Strong evidence", moderate: "Likely real", weak: "Faint signal", none: "Inconclusive" };

function Answer({ n, question, tone = "", headline, children, more, onMore }) {
  return (
    <section className={`answer ${tone}`}>
      <p className="eyebrow">{question}</p>
      <h3>{headline}</h3>
      {children}
      {onMore && (
        <button type="button" className="linklike" onClick={onMore}>
          {more} ▸
        </button>
      )}
    </section>
  );
}

/** One machine-learning headline: where the next five years may go, and whether that is worth believing. */
function ForecastHeadline({ data, onMore }) {
  const { variable, location, period } = data;
  const [state, setState] = useState({ loading: true, lab: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, lab: null, error: "" });
    fetchForecast(
      { variable: variable.id, lat: location.lat, lon: location.lon, start_year: period.start_year, end_year: period.end_year },
      controller.signal,
    )
      .then((lab) => setState({ loading: false, lab, error: "" }))
      .catch((e) => {
        if (e.name !== "AbortError") setState({ loading: false, lab: null, error: e.message });
      });
    return () => controller.abort();
  }, [variable.id, location.lat, location.lon, period.start_year, period.end_year]);

  const { loading, lab, error } = state;
  const last = lab?.ok ? lab.forecast[lab.forecast.length - 1] : null;
  const best = lab?.ok ? lab.models.find((m) => m.is_best) : null;
  const units = variable.units;

  return (
    <section className="forecast-head">
      <p className="eyebrow">What might come next <span className="badge ml">machine learning, run locally</span></p>
      {loading && <p className="mono dim">Backtesting eight forecasting models…</p>}
      {error && <p className="dim">The forecast is unavailable right now: {error}</p>}
      {lab && !lab.ok && <p className="dim">{lab.message}</p>}
      {last && lab.beats_baseline && (
        <>
          <h3>
            About <span className="mono">{last.value.toPrecision(3)} {units}</span> by {last.year}
          </h3>
          <p className="dim">
            Likely range <span className="mono">{last.lo?.toPrecision(3)}</span> to <span className="mono">{last.hi?.toPrecision(3)}</span> (80% band). The{" "}
            <b>{lab.best_label}</b> model made errors {Math.round((best?.skill ?? 0) * 100)}% smaller than a naive guess in backtests on past years.
          </p>
        </>
      )}
      {last && !lab.beats_baseline && (
        <>
          <h3>Hard to forecast</h3>
          <p className="dim">
            No model reliably beat a naive guess on this record, so any forecast would be little better than a guess. That is a finding too.
          </p>
        </>
      )}
      <p className="small faint">Statistical extrapolation of a short record, not a climate projection.</p>
      {onMore && (
        <button type="button" className="linklike" onClick={onMore}>
          Open the forecast lab ▸
        </button>
      )}
    </section>
  );
}

/** The challenge's four questions, answered at a glance. Everything technical lives one click away in Detail. */
export default function Overview({ data, onDetail, onGo, events = [], onEvent, verdict }) {
  const { variable, location, period, quality, stats, grade } = data;
  const units = variable.units;
  const tone = stats.significant ? stats.sign : "flat";
  const percent = stats.percent_of_mean != null ? ` (${signed(stats.percent_of_mean, 3)}% of the average)` : "";
  const v = verdictView(data);

  return (
    <div className="overview">
      {verdict ?? <Verdict data={data} />}

      <div className="answers">
        <Answer n={0} question="1 · What is changing?" tone={tone} headline={`${variable.label} is ${directionWord(stats)}`}>
          <p className="dim">Measured in {units}, as yearly averages of NASA's monthly data.</p>
        </Answer>

        <Answer n={1} question="2 · Where?" headline={formatPlace(location.lat, location.lon)} more="See the region around it" onMore={() => onGo("scan")}>
          <p className="dim">
            {period.start_year} to {period.end_year}: {quality.years_used} complete years from one NASA grid cell, about 50 km across.
          </p>
        </Answer>

        <Answer n={2} question="3 · How much?" tone={tone} headline={`${signed(stats.slope_per_decade, 3)} ${units} per decade`} more="See the rate in detail" onMore={() => onDetail("evidence")}>
          <p className="dim">
            {signed(stats.total_change, 3)} {units} over {stats.span_years} years{percent}. That is {noiseSentence(stats.signal_to_noise)}.
          </p>
        </Answer>

        <Answer n={3} question="4 · Is it real?" tone={grade.code === "none" ? "flat" : tone} headline={v?.label ?? GRADE_WORDS[grade.code]} more="See the evidence" onMore={() => onDetail("evidence")}>
          <p className="dim">
            {grade.passed} of {grade.total} <Term id="grade">checks</Term> passed. {pValueMeaning(stats)}
          </p>
        </Answer>
      </div>

      <InView minHeight={380}>
        <section className="chart-card">
          <h3>The record</h3>
          <TrendChart data={data} events={events} onEvent={onEvent} title={`${data.variable.label}, yearly average`} source="NASA POWER" />
        </section>
      </InView>

      {events.length > 0 && (
        <section className="events-strip">
          <p className="eyebrow">Major events near here</p>
          <div className="chip-row">
            {events.map((ev) => (
              <button key={ev.id} type="button" className="chip" onClick={() => onEvent?.(ev)}>
                {ev.year} · {ev.name}
              </button>
            ))}
          </div>
          <p className="faint small">Marked on the chart. Open one to see what the data show at that place and year.</p>
        </section>
      )}

      <ForecastHeadline data={data} onMore={() => onDetail("forecast")} />

      <section className="go-deeper">
        <p className="eyebrow">Go deeper</p>
        <div className="chip-row">
          <button type="button" className="chip" onClick={() => onDetail("evidence")}>Evidence and tests</button>
          <button type="button" className="chip" onClick={() => onDetail("rhythms")}>What moves with it</button>
          <button type="button" className="chip" onClick={() => onDetail("pattern")}>Seasons and timing</button>
          <button type="button" className="chip" onClick={() => onDetail("notes")}>Detective's notes</button>
          <button type="button" className="chip" onClick={() => onGo("sweep")}>Compare every variable here</button>
          <button type="button" className="chip" onClick={() => onGo("duel")}>Compare with another place</button>
        </div>
      </section>
    </div>
  );
}
