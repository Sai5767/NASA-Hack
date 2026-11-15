import { useMemo, useState } from "react";
import { formatPEq, signed } from "../lib/format.js";
import { CorrectionTag, TrendArrow, TrendKey, Unit } from "./insight/Evidence.jsx";
import { rateUnits, rowDirection } from "./insight/logic.js";
import Term from "./Term.jsx";

const PAGE = 25;

const SORTS = [
  { id: "p", label: "Strength of evidence", hint: "Least likely to be chance first (by p-value)" },
  { id: "snr", label: "Change vs normal swings", hint: "Change compared with ordinary year-to-year ups and downs" },
  { id: "pct", label: "Size of change", hint: "Change as a percent of the average" },
];
const SORT_KEY = {
  p: (a, b) => a.rank - b.rank,
  snr: (a, b) => Math.abs(b.signal_to_noise ?? 0) - Math.abs(a.signal_to_noise ?? 0),
  pct: (a, b) => Math.abs(b.percent_of_mean ?? 0) - Math.abs(a.percent_of_mean ?? 0),
};

function Row({ r, pos, open, onToggle, onOpen }) {
  const dir = rowDirection(r);
  const units = rateUnits(r.units);
  const glyph = r.sign === "up" ? "▲" : r.sign === "down" ? "▼" : "–";
  return (
    <li className={`ledger-row${open ? " open" : ""}`}>
      <button type="button" className="ledger-main" onClick={onToggle} aria-expanded={open}>
        <span className="rank mono">{pos}</span>
        <span className="what">
          <b>{r.label}</b>
          <small className="dim">{r.place}</small>
        </span>
        <span className="rate mono">
          <b><span aria-hidden="true">{glyph}</span> {signed(r.slope_per_decade, 3)}</b>
          <small>{units} per decade</small>
          <span className="sr-only">{r.sign === "up" ? "rising" : r.sign === "down" ? "falling" : ""}</span>
        </span>
        <span className="pv mono">{formatPEq(r.p_value)}</span>
        <span className="fdr"><CorrectionTag row={r} term={false} /></span>
      </button>
      {open && (
        <div className="ledger-detail">
          <p className="ledger-detail-line">
            <TrendArrow dir={dir} /> · <CorrectionTag row={r} />
          </p>
          <p className="mono dim">
            {signed(r.percent_of_mean ?? 0, 3)}% of the average · {r.signal_to_noise == null ? "no" : Math.abs(r.signal_to_noise).toFixed(1)}× the usual{" "}
            year-to-year swing · <Term id="pvalue">p-value</Term> {formatPEq(r.p_value)}
          </p>
          {r.reason ? (
            <div className="why">
              <p className="why-title">
                Why might this be? <span className="conf">{r.reason.confidence}</span>
              </p>
              <p>{r.reason.text}</p>
              {r.reason.sources.length > 0 && <p className="faint">Sources: {r.reason.sources.join("; ")}.</p>}
              <p className="faint">Background from published science, not something this data can prove.</p>
            </div>
          ) : (
            <p className="dim">This one does not hold after allowing for testing so many things at once, so there is nothing solid to explain.</p>
          )}
          <button type="button" className="btn btn-sm" onClick={() => onOpen(r)}>
            {r.kind === "planet" ? "Open planet vitals ›" : "Open this case file ›"}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Every trend measured, ranked by evidence, with published context for why each solid one might exist (owner items 4, 5).
 * Units on every value; "holds after correction" / "only before correction" are defined terms with the same line-style
 * swatches as the globe; arrows are monochrome ▲ ▼ with a key; the variable chips are labelled, visibly selected filters.
 *
 * Props: data (/api/ledger), onOpen(row), variables (optional /api/variables, for each chip's units).
 */
export default function Ledger({ data, onOpen, variables = [] }) {
  const [mode, setMode] = useState("solid");
  const [group, setGroup] = useState("all");
  const [dir, setDir] = useState("all");
  const [variable, setVariable] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("p");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState(null);

  const groups = useMemo(() => [...new Set(data.rows.map((r) => r.group))], [data.rows]);
  // Units per variable: from /api/variables when given, else from the ledger rows themselves (both are backend values).
  const unitsOf = useMemo(() => {
    const out = {};
    for (const r of data.rows) if (r.variable && r.units && !out[r.variable]) out[r.variable] = r.units;
    for (const v of variables) if (v.id && v.units) out[v.id] = v.units;
    return out;
  }, [data.rows, variables]);
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
  const varLabel = data.by_variable.find((v) => v.id === variable)?.label;

  return (
    <section className="ledger">
      <header className="ledger-head">
        <h2 className="tool-title">Every trend, ranked by evidence</h2>
        <p className="tool-lead">
          {c.tests.toLocaleString()} trends tested across {c.places} places and {c.variables} variables, plus the planet's vital signs.{" "}
          <b>{c.survive_correction.toLocaleString()}</b> <Term id="holds">hold after correction</Term> (▲ {c.rising.toLocaleString()} rising,
          ▼ {c.falling.toLocaleString()} falling). Another {(c.nominal - c.survive_correction).toLocaleString()} are{" "}
          <Term id="beforeonly">only significant before correction</Term> and could be luck.
        </p>
        <TrendKey />
        {c.failed_places > 0 && <p className="faint">{c.failed_places} places could not be reached and are not in the totals.</p>}
      </header>

      <div className="ledger-vars-wrap">
        <div className="ledger-vars-head">
          <span id="ledger-var-label" className="ledger-label">Filter by variable</span>
          {variable !== "all" && (
            <button type="button" className="linklike" onClick={() => reset(setVariable)("all")}>
              Clear filter{varLabel ? ` (${varLabel})` : ""}
            </button>
          )}
        </div>
        <ul className="ledger-vars" role="group" aria-labelledby="ledger-var-label">
          {data.by_variable.slice(0, 8).map((v) => {
            const on = variable === v.id;
            const u = unitsOf[v.id];
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className={`chip ledger-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  title={on ? `Showing only ${v.label}. Click again to show every variable.` : `Show only ${v.label} trends`}
                  onClick={() => reset(setVariable)(on ? "all" : v.id)}
                >
                  {on && <span aria-hidden="true">✓ </span>}
                  {v.label}
                  {u && <span className="chip-unit mono"> {u}</span>}
                  <span className="chip-counts mono"> ▲{v.rising} ▼{v.falling}</span>
                  <span className="sr-only">: {v.rising} rising, {v.falling} falling</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ledger-filters">
        <div className="seg" role="group" aria-label="Which trends">
          <button type="button" className={mode === "solid" ? "on" : ""} aria-pressed={mode === "solid"} onClick={() => reset(setMode)("solid")}>Holds after correction</button>
          <button type="button" className={mode === "all" ? "on" : ""} aria-pressed={mode === "all"} onClick={() => reset(setMode)("all")}>Everything tested</button>
        </div>
        <div className="seg" role="group" aria-label="Direction">
          {["all", "up", "down"].map((d) => (
            <button key={d} type="button" className={dir === d ? "on" : ""} aria-pressed={dir === d} onClick={() => reset(setDir)(d)}>
              {d === "all" ? "Both" : d === "up" ? "▲ Rising" : "▼ Falling"}
            </button>
          ))}
        </div>
        <label className="field ledger-sort">
          Order by
          <select value={sort} onChange={(e) => reset(setSort)(e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <div className="chip-row" role="group" aria-label="Kind of variable">
          <button type="button" className={`chip${group === "all" ? " on" : ""}`} aria-pressed={group === "all"} onClick={() => reset(setGroup)("all")}>All kinds</button>
          {groups.map((g) => (
            <button key={g} type="button" className={`chip${group === g ? " on" : ""}`} aria-pressed={group === g} onClick={() => reset(setGroup)(g)}>{g}</button>
          ))}
        </div>
        <label className="field">
          Find a place or variable
          <input type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder="Delhi, rainfall, Arctic…" />
        </label>
      </div>

      <div className="ledger-list">
        <div className="ledger-cols" aria-hidden="true">
          <span>#</span><span>Variable · place</span><span>Change per decade</span><span>p-value</span><span>After correction?</span>
        </div>
        <p className="faint mono ledger-count">
          {filtered.length.toLocaleString()} shown{data.truncated ? ` (the top ${data.rows.length.toLocaleString()} by evidence are loaded)` : ""}
        </p>
        {ordered.length === 0 ? (
          <p className="dim">Nothing matches those filters. <button type="button" className="linklike" onClick={() => { setVariable("all"); setGroup("all"); setDir("all"); setQuery(""); setMode("all"); }}>Clear all filters</button></p>
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
        <details className="td-disclosure">
          <summary>About these numbers</summary>
          <div className="td-disclosure-body">
            <p className="dim">
              Rates use each variable's own unit (for example °C for temperature, mm/day for rain, <Unit u="MJ/m²/day" /> for sunlight). The{" "}
              <Term id="pvalue">p-value</Term> is deliberately cautious for smooth, curving records such as atmospheric CO₂, so to compare how
              big each change is, order by “Change vs normal swings”.
            </p>
            {data.note && <p className="faint">{data.note}</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
