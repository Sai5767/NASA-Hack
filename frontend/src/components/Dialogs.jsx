import { useMemo, useState } from "react";
import { CASES, INTAKE_PLACES, INTAKE_TOPICS, SURPRISES } from "../lib/cases.js";
import { GLOSSARY } from "../lib/glossary.js";
import Modal from "./Modal.jsx";

const TAB_LABEL = { investigate: "Case file", sweep: "Sweep", scan: "Region scan", duel: "Duel", world: "World survey", vitals: "Planet vitals" };

export function CasesDialog({ variables, onOpen, onClose }) {
  const name = (id) => variables.find((v) => v.id === id)?.label ?? id;
  return (
    <Modal eyebrow="Guided demonstrations" title="Open a case file" onClose={onClose} wide>
      <p className="dim">
        Each case poses a question. Open one to watch the investigation run, then read the evidence and decide for yourself.
      </p>
      <ul className="case-grid">
        {CASES.map((c, i) => (
          <li key={c.id} className="reveal" style={{ "--d": `${i * 70}ms` }}>
            <button type="button" className="case-card" onClick={() => onOpen(c)}>
              <span className="eyebrow">Case {String(i + 1).padStart(2, "0")} · {TAB_LABEL[c.tab]}</span>
              <b>{c.codename}</b>
              <span className="dim">{c.question}</span>
              <span className="tags mono">
                <i>{name(c.variable)}</i>
                <i>{c.a?.name ?? "Worldwide"}{c.b ? ` vs ${c.b.name}` : ""}</i>
              </span>
              <span className="open">Open case ▸</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function IntakeDialog({ variables, onOpen, onClose }) {
  const [topic, setTopic] = useState(null);
  const name = (id) => variables.find((v) => v.id === id)?.label ?? id;

  const surprise = () => {
    const pick = SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
    onOpen({ variable: pick.variable, lat: pick.lat, lon: pick.lon, name: pick.name });
  };

  return (
    <Modal eyebrow={topic ? "Step 2 of 2" : "Step 1 of 2"} title={topic ? "Where in the world?" : "What are you curious about?"} onClose={onClose}>
      {!topic ? (
        <>
          <p className="dim">Pick a kind of change and we'll choose the matching Earth-system variable.</p>
          <ul className="choice-grid">
            {INTAKE_TOPICS.map((t, i) => (
              <li key={t.id} className="reveal-pop" style={{ "--d": `${i * 50}ms` }}>
                <button type="button" className="choice" onClick={() => setTopic(t)}>
                  <b>{t.label}</b>
                  <small>{t.hint}</small>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={surprise}>✦ Surprise me</button>
        </>
      ) : (
        <>
          <p className="dim">Investigating <b>{name(topic.variable)}</b>. Choose a kind of place, or pick your own spot on the globe.</p>
          <ul className="choice-grid">
            {INTAKE_PLACES.map((p, i) => (
              <li key={p.id} className="reveal-pop" style={{ "--d": `${i * 50}ms` }}>
                <button type="button" className="choice" onClick={() => onOpen({ variable: topic.variable, lat: p.lat, lon: p.lon, name: p.hint })}>
                  <b>{p.label}</b>
                  <small>{p.hint}</small>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="choice own" onClick={() => onOpen({ variable: topic.variable, own: true })}>
                <b>My own spot</b>
                <small>Click anywhere on the globe</small>
              </button>
            </li>
          </ul>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTopic(null)}>← Back</button>
        </>
      )}
    </Modal>
  );
}

export function GlossaryDialog({ onClose }) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? GLOSSARY.filter((g) => g.term.toLowerCase().includes(q) || g.short.toLowerCase().includes(q)) : GLOSSARY;
  }, [query]);
  return (
    <Modal eyebrow="Plain-language guide" title="Detective's glossary" onClose={onClose} wide>
      <label className="field">
        Search
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="p-value, trend, anomaly…" />
      </label>
      <dl className="glossary">
        {items.map((g) => (
          <div key={g.id}>
            <dt>{g.term}</dt>
            <dd>{g.short}</dd>
          </div>
        ))}
        {items.length === 0 && <p className="dim">Nothing matches that. Try another word.</p>}
      </dl>
    </Modal>
  );
}

export function AboutDialog({ onClose }) {
  return (
    <Modal eyebrow="About & credits" title="Trend Detective" onClose={onClose} wide>
      <div className="about">
        <p>
          An independent project for the <b>2026 NASA Space Apps Challenge</b>, <i>Be an Earth System Trend Detective</i>. It lets
          anyone pick a variable and a place, then answers four questions: <b>what</b> is changing, <b>where</b>, <b>how much</b>, and
          whether the change is <b>statistically significant</b>.
        </p>
        <h3>Data and credits</h3>
        <ul>
          <li>Monthly Earth-system data at any place: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program.</li>
          <li>Planet-wide records: NASA GISS Surface Temperature Analysis (GISTEMP v4); NOAA Global Monitoring Laboratory (CO₂ at Mauna Loa); NSIDC Sea Ice Index (NOAA@NSIDC); NOAA Climate Prediction Center and NCEI (ENSO, NAO, PDO).</li>
          <li>Land and borders: Natural Earth (public domain), via the world-atlas package. Fonts: Space Grotesk and JetBrains Mono (SIL Open Font License).</li>
          <li>This project is not affiliated with or endorsed by NASA.</li>
        </ul>
        <h3>How the statistics work</h3>
        <ul>
          <li>Yearly averages are built only from complete 12-month years, so seasons are never under-weighted.</li>
          <li>Trend size: Sen's slope with a 95% interval. Significance: Mann–Kendall test, cross-checked with a regression t-test.</li>
          <li>If neighboring years resemble each other, uncertainty is widened (serial-correlation correction).</li>
          <li>When many places or variables are tested together, Benjamini–Hochberg false-discovery control is applied.</li>
          <li>The evidence grade comes from five visible checks, including whether the trend survives trimming five years from either end.</li>
        </ul>
        <h3>Honest limits</h3>
        <ul>
          <li>Trends are straight-line summaries. Cycles, sudden jumps and curved change are not modeled.</li>
          <li>NASA POWER is reanalysis on a grid about half a degree wide, and some variables blend sources that change over time.</li>
          <li>A significant trend shows direction, not cause. A different start or end year can change the answer.</li>
        </ul>
        <h3>Transparency</h3>
        <p>
          This app was built with the help of an AI coding assistant (Claude). Its statistics are checked against published reference
          values in an automated test suite.
        </p>
      </div>
    </Modal>
  );
}
