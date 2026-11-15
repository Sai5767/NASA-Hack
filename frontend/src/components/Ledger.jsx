import { useMemo, useState } from "react";
import { formatPEq, signed } from "../lib/format.js";

const PAGE = 25;

const SORTS = [
  { id: "p", label: "p-value", hint: "How unlikely chance is" },
  { id: "snr", label: "Signal vs noise", hint: "Change against normal swings" },
  { id: "pct", label: "Size of change", hint: "Percent of the average" },
];
const SORT_KEY = {
  p: (a, b) => a.rank - b.rank,
  snr: (a, b) => Math.abs(b.signal_to_noise ?? 0) - Math.abs(a.signal_to_noise ?? 0),
  pct: (a, b) => Math.abs(b.percent_of_mean ?? 0) - Math.abs(a.percent_of_mean ?? 0),
};

function Row({ r, pos, open, onToggle, onOpen }) {
  const tone = r.significant_fdr ? (r.sign === "up" ? "up" : "down") : "flat";
  const status = r.significant_fdr ? "survives correction" : r.significant ? "nominal only" : "no clear trend";
  return (
    <li className={`ledger-row ${tone}${open ? " open" : ""}`}>
      <button type="button" className="ledger-main" onClick={onToggle} aria-expanded={open}>
        <span className="rank mono">#{pos}</span>
        <span className="what">
          <b>{r.label}</b>
          <small className="dim">{r.place}</small>
        </span>
        <span className="rate mono">
          <b>{r.sign === "up" ? "▲" : "▼"} {signed(r.slope_per_decade, 3)}</b>
          <small>{r.units}/decade</small>
        </span>
        <span className="pv mono">{formatPEq(r.p_value)}</span>
        <span className={`fdr ${r.significant_fdr ? "yes" : "no"}`}>{status}</span>
      </button>
      {open && (
        <div className="ledger-detail">
          {r.reason ? (
            <div className="why">
              <p className="eyebrow">
                Why might this be? <span className={`conf ${r.reason.confidence.replace(/\s/g, "-")}`}>{r.reason.confidence}</span>
              </p>
              <p>{r.reason.text}</p>
              {r.reason.sources.length > 0 && <p className="faint small">Sources: {r.reason.sources.join("; ")}.</p>}
              <p className="faint small">Background from published science, not something this data can prove.</p>
            </div>
          ) : (
            <p className="dim">This trend does not survive the correction for testing so many things at once, so there is nothing solid to explain.</p>
          )}
          <p className="mono dim small">
            {signed(r.percent_of_mean ?? 0, 3)}% of the average · {r.signal_to_noise == null ? "no" : Math.abs(r.signal_to_noise).toFixed(1)}× the usual year-to-year swing
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen(r)}>
            {r.kind === "planet" ? "Open planet vitals ▸" : "Open this case file ▸"}
          </button>
        </div>
      )}
    </li>
  );
}

/** Every trend measured, ranked by p-value, with published context for why each solid one might exist. */
export default function Ledger({ data, onOpen }) {
  const [mode, setMode] = useState("solid");
  const [group, setGroup] = useState("all");
  const [dir, setDir] = useState("all");
  const [variable, setVariable] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("p");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState(null);

  const groups = useMemo(() => [...new Set(data.rows.map((r) => r.group))], [data.rows]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      data.rows.filter(
        (r) =>
          (mode === "all" || r.significant_fdr) &&
          (group === "all" || r.group === group) &&
          (dir === "all" || r.sign === dir) &&
          (variable === "all" || r.variable === variable) &&
          (!q || r.place.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)),
      ),
    [data.rows, mode, group, dir, variable, q],
  );
  const ordered = useMemo(() => [...filtered].sort(SORT_KEY[sort]), [filtered, sort]);
  const c = data.counts;
  const reset = (fn) => (v) => {
    fn(v);
    setShown(PAGE);
  };

  return (
    <section className="ledger">
      <div className="card ledger-head reveal">
        <p className="eyebrow">Trend ledger</p>
        <h2>Every trend, ranked by evidence</h2>
        <p className="dim">
          {c.tests.toLocaleString()} trends measured across {c.places} places and {c.variables} variables, plus the planet's vital signs, all
          tested together. <b>{c.survive_correction.toLocaleString()}</b> survive the correction for testing so many things at once
          ({c.rising.toLocaleString()} rising, {c.falling.toLocaleString()} falling); another {(c.nominal - c.survive_correction).toLocaleString()} look
          significant on their own but could be luck. Open any row for published context on why it might be happening.
        </p>
        <ul className="ledger-vars">
          {data.by_variable.slice(0, 8).map((v) => (
            <li key={v.id}>
              <button type="button" className={`chip${variable === v.id ? " on" : ""}`} onClick={() => reset(setVariable)(variable === v.id ? "all" : v.id)}>
                {v.label} <span className="up">▲{v.rising}</span> <span className="down">▼{v.falling}</span>
              </button>
            </li>
          ))}
        </ul>
        {c.failed_places > 0 && <p className="faint small">{c.failed_places} places could not be reached and are not in the totals.</p>}
      </div>

      <div className="card ledger-filters reveal" style={{ "--d": "120ms" }}>
        <div className="seg" role="group" aria-label="Which trends">
          <button type="button" className={mode === "solid" ? "on" : ""} onClick={() => reset(setMode)("solid")}>Survive correction</button>
          <button type="button" className={mode === "all" ? "on" : ""} onClick={() => reset(setMode)("all")}>Everything tested</button>
        </div>
        <div className="seg" role="group" aria-label="Direction">
          {["all", "up", "down"].map((d) => (
            <button key={d} type="button" className={dir === d ? "on" : ""} onClick={() => reset(setDir)(d)}>
              {d === "all" ? "Both" : d === "up" ? "▲ Rising" : "▼ Falling"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Order by">
          {SORTS.map((s) => (
            <button key={s.id} type="button" className={sort === s.id ? "on" : ""} title={s.hint} onClick={() => reset(setSort)(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="chip-row">
          <button type="button" className={`chip${group === "all" ? " on" : ""}`} onClick={() => reset(setGroup)("all")}>All kinds</button>
          {groups.map((g) => (
            <button key={g} type="button" className={`chip${group === g ? " on" : ""}`} onClick={() => reset(setGroup)(g)}>{g}</button>
          ))}
        </div>
        <label className="field">
          Find a place or variable
          <input type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder="Delhi, rainfall, Arctic…" />
        </label>
      </div>

      <div className="card ledger-list reveal" style={{ "--d": "200ms" }}>
        <p className="faint small mono">
          {filtered.length.toLocaleString()} shown{data.truncated ? ` (the top ${data.rows.length.toLocaleString()} by evidence are loaded)` : ""}
        </p>
        {ordered.length === 0 ? (
          <p className="dim">Nothing matches those filters.</p>
        ) : (
          <ol>
            {ordered.slice(0, shown).map((r, i) => (
              <Row key={r.id} r={r} pos={i + 1} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} onOpen={onOpen} />
            ))}
          </ol>
        )}
        {ordered.length > shown && (
          <button type="button" className="btn btn-sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, ordered.length - shown)} more
          </button>
        )}
        {sort === "p" && (
          <p className="faint small">
            p-values are deliberately cautious for smooth, curving records such as atmospheric CO₂: the correction for years that resemble their
            neighbours treats a steady curve as persistence and widens the uncertainty. To compare how strong each change is, order by signal vs noise.
          </p>
        )}
        <p className="faint small">{data.note}</p>
      </div>
    </section>
  );
}
