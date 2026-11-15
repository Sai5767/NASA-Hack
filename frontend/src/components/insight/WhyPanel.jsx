import { useEffect, useId, useState } from "react";
import "../../styles/insight.css";
import { StateCard } from "../shell/ui.jsx";
import { QUESTION_MAX, WHY_BUTTON, WHY_DISCLAIMER, canExplain, cleanQuestion, formatGenerated, whyContent, whyErrorMessage, whyStatus } from "./logic.js";
import { useCountdown, useExplanation } from "./useWhy.js";

function Banner({ status, left }) {
  if (status.kind === "ok") return <p className="why-ok"><span className="td-badge td-badge--source mono">{status.text}</span></p>;
  const text = status.kind === "rate_limited" && left > 0
    ? `Too many requests for now. Try again in about ${left} seconds. Meanwhile, here is our curated summary.`
    : status.kind === "rate_limited"
      ? "You can ask again now. Meanwhile, here is our curated summary."
      : status.text;
  return (
    <div className={`why-banner why-banner--${status.tone}`} role={status.kind === "rate_limited" ? "status" : undefined} aria-live={status.kind === "rate_limited" ? "polite" : undefined}>
      <span className="why-banner-glyph" aria-hidden="true">{status.glyph}</span>
      <div>
        <p>{text}</p>
        {status.detail && <p className="why-banner-detail">{status.detail}</p>}
      </div>
    </div>
  );
}

function Driver({ d }) {
  return (
    <li className={`why-driver${d.measured ? " why-driver--measured" : ""}`}>
      <p className="why-driver-meta">
        <span className={`td-badge mono ${d.measured ? "td-badge--observed" : "td-badge--source"}`}>{d.badge}</span>
        {d.confidence && <span className="why-confidence">{d.confidence}</span>}
      </p>
      <h4 className="why-driver-title">{d.title}</h4>
      <p className="why-driver-text">
        {d.explanation}{" "}
        {d.cites.map((c) => (
          <a key={c.id} className="why-cite mono" href={`#why-src-${c.n}`} aria-label={`Source ${c.n}`}>[{c.n}]</a>
        ))}
      </p>
    </li>
  );
}

/**
 * "Why might this be happening?" (spec 5.7). Mount it only when the user pressed the button: it sends the request
 * on mount (manual, opt-in), then lets the user ask one short follow-up at a time.
 *
 * Props:
 *   data               the /api/trend response for the case (must carry case_signature)
 *   onTrendRefreshed(t) optional: called with the refetched trend after a stale-signature (HTTP 422) retry
 *   autoStart          default true: request on mount (the button press is the opt-in)
 */
export default function WhyPanel({ data, onTrendRefreshed, autoStart = true }) {
  const why = useExplanation(data, { onTrendRefreshed });
  const [question, setQuestion] = useState("");
  const inputId = useId();
  // The button press that mounted this panel is the opt-in for this one case only. (Effect deps never change, so it
  // runs once; React StrictMode's dev re-run aborts the first request and sends it again, which is harmless.)
  const [firstSig] = useState(() => data?.case_signature ?? null);
  const status = why.res ? whyStatus(why.res) : null;
  const left = useCountdown(status?.retryAfter, why.receivedAt);
  const busy = why.phase === "loading" || why.phase === "refreshing";

  useEffect(() => {
    if (!autoStart || !canExplain(data) || data.case_signature !== firstSig) return;
    why.ask("");
  }, [autoStart, firstSig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canExplain(data)) {
    return (
      <div className="why-panel">
        <p className="why-disclaimer">{WHY_DISCLAIMER}</p>
        <StateCard kind="empty" title="There isn't a result to explain yet">
          Explanations are offered only after a complete analysis with enough years of data.
        </StateCard>
      </div>
    );
  }

  const content = why.res ? whyContent(why.res) : null;
  const submit = (e) => {
    e.preventDefault();
    if (busy || left > 0) return;
    why.ask(cleanQuestion(question));
  };

  return (
    <div className="why-panel" aria-busy={busy}>
      <p className="why-disclaimer"><span aria-hidden="true">⚠ </span>{WHY_DISCLAIMER}</p>

      {why.phase === "idle" && (
        <div className="why-idle">
          <p className="dim">Nothing has been requested for this result yet.</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => why.ask("")}>{WHY_BUTTON}</button>
        </div>
      )}
      {why.phase === "loading" && (
        <StateCard kind="loading" title="Looking for published explanations…" slowText="Still working — live searches can take up to a minute.">
          This is on request only and can take a little while.
        </StateCard>
      )}
      {why.phase === "refreshing" && <StateCard kind="loading" title="Refreshing the analysis…">The saved case had expired, so it is being checked again once.</StateCard>}
      {why.phase === "error" && (
        <StateCard kind="error" title={whyErrorMessage(why.error)} action={<button type="button" className="btn btn-sm" onClick={() => why.ask(cleanQuestion(why.question))}>Try again</button>} />
      )}
      {busy && !content && (
        <div className="why-skeleton" aria-hidden="true"><i /><i /><i /></div>
      )}

      {status && content && !busy && (
        <>
          <Banner status={status} left={left} />
          {why.question && <p className="why-asked">You asked: “{why.question}”</p>}

          {content.summary && (
            <section className="why-section">
              <h3 className="why-h">Summary</h3>
              <p>{content.summary}</p>
            </section>
          )}
          {content.measured.length > 0 && (
            <section className="why-section">
              <h3 className="why-h">What was measured</h3>
              <ul className="why-drivers">{content.measured.map((d) => <Driver key={d.key} d={d} />)}</ul>
            </section>
          )}
          {content.drivers.length > 0 && (
            <section className="why-section">
              <h3 className="why-h">Possible drivers</h3>
              <ul className="why-drivers">{content.drivers.map((d) => <Driver key={d.key} d={d} />)}</ul>
            </section>
          )}
          {content.limitations.length > 0 && (
            <section className="why-section">
              <h3 className="why-h">Limitations</h3>
              <ul className="why-list">{content.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
          )}
          {content.sources.length > 0 && (
            <section className="why-section">
              <h3 className="why-h">Sources</h3>
              <ol className="why-sources">
                {content.sources.map((s) => (
                  <li key={s.id} id={`why-src-${s.n}`} tabIndex={-1}>
                    <span className="mono">[{s.n}]</span>{" "}
                    <a href={s.href} target="_blank" rel="noopener noreferrer">
                      {s.title} <span className="why-domain mono">{s.domain} ↗</span>
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {(content || why.phase === "error") && (
        <form className="why-ask" onSubmit={submit}>
          <label htmlFor={inputId}>Ask a follow-up (optional)</label>
          <div className="why-ask-row">
            <input
              id={inputId}
              type="text"
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="A short question in plain words…"
              autoComplete="off"
              disabled={busy}
            />
            <button type="submit" className="btn btn-sm" disabled={busy || left > 0 || !cleanQuestion(question)}>
              {left > 0 ? `Ask (${left}s)` : "Ask"}
            </button>
          </div>
          <p className="why-ask-hint faint">Sent only when you press Ask. Up to {QUESTION_MAX} characters.</p>
        </form>
      )}

      {content?.generatedAt && (
        <p className="why-generated mono faint">Generated {formatGenerated(content.generatedAt)}{content.cached ? " · saved answer" : ""}</p>
      )}
    </div>
  );
}
