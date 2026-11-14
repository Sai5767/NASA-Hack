import { useState } from "react";
import Term from "./Term.jsx";

export const CLUSTER_COLORS = ["#4dffd9", "#ff6bd5", "#ffc24d", "#a78bfa", "#b6ff5c", "#ff9f43"];

const sign = (v) => (v > 0 ? "▲" : "▼");

function Signature({ cluster }) {
  const parts = [
    ...cluster.top_up.map((v) => ({ ...v, dir: "up" })),
    ...cluster.top_down.map((v) => ({ ...v, dir: "down" })),
  ];
  if (parts.length === 0) return <p className="dim small">No variable stands clearly above its normal swings in this group.</p>;
  return (
    <ul className="signature">
      {parts.map((v) => (
        <li key={`${v.id}${v.dir}`} className={v.dir}>
          <span>{sign(v.value)} {v.label}</span>
          <span className="mono">{v.value > 0 ? "+" : ""}{v.value.toFixed(1)}×</span>
        </li>
      ))}
    </ul>
  );
}

/** Places grouped by how ALL their variables are changing, with quality scores and a "climate twins" finder. */
export default function Archetypes({ data, onChooseK, onOpen }) {
  const { quality, clusters, places } = data;
  const [twinId, setTwinId] = useState(places[0]?.id);
  const byId = Object.fromEntries(places.map((p) => [p.id, p]));
  const twinPlace = byId[twinId] ?? places[0];
  const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="archetypes">
      <header className="card hud-card arch-head reveal">
        <p className="eyebrow">Trend archetypes <span className="badge ml">machine learning</span></p>
        <h2>Which places are changing in the same way?</h2>
        <p className="dim">
          Each of {quality.n_places} sample places gets a fingerprint: how far each of {data.variables.length} variables has moved compared with its normal
          swings. <Term id="kmeans">k-means clustering</Term> then groups similar fingerprints into archetypes. Temperatures are down-weighted so
          five heat variables cannot drown out everything else.
        </p>

        <div className="arch-quality">
          <div>
            <span className="eyebrow"><Term id="silhouette">Separation</Term></span>
            <b className="mono">{quality.silhouette.toFixed(2)}</b>
            <small className={`q ${quality.structure}`}>{quality.structure}</small>
          </div>
          <div>
            <span className="eyebrow"><Term id="stability">Stability</Term></span>
            <b className="mono">{quality.stability.toFixed(2)}</b>
            <small className={`q ${quality.steadiness === "stable" ? "strong" : quality.steadiness === "unstable" ? "weak" : "reasonable"}`}>{quality.steadiness}</small>
          </div>
        </div>

        <div className="kpicker" role="group" aria-label="Number of archetypes">
          <span className="dim small">How many archetypes?</span>
          {quality.by_k.map((s) => (
            <button key={s.k} type="button" className={`chip${data.k === s.k ? " on" : ""}`} onClick={() => onChooseK(s.k)} title={`Separation ${s.silhouette.toFixed(2)}`}>
              {s.k}{s.k === data.best_k ? " ★" : ""} <small className="mono">{s.silhouette.toFixed(2)}</small>
            </button>
          ))}
        </div>
        <p className="faint small">★ = best separated. {quality.structure === "weak" ? "Structure is weak: treat these groups as a convenience, not as real climate regimes. " : ""}{data.caveat}</p>
      </header>

      <div className="arch-grid">
        {clusters.map((c, i) => (
          <article key={c.id} className="card arch-card reveal" style={{ "--d": `${i * 90}ms`, "--c": CLUSTER_COLORS[c.id % CLUSTER_COLORS.length] }}>
            <header>
              <span className="swatch" />
              <b>Archetype {c.id + 1}</b>
              <span className="dim small">{c.size} places</span>
            </header>
            <Signature cluster={c} />
            <p className="chips">
              {c.members.map((id) => (
                <button key={id} type="button" className="chip" onClick={() => onOpen(byId[id])}>{byId[id].name}</button>
              ))}
            </p>
          </article>
        ))}
      </div>

      <div className="card twins reveal" style={{ "--d": "300ms" }}>
        <h3>Climate twins</h3>
        <p className="dim small">The places whose whole pattern of change looks most like this one (cosine similarity of fingerprints).</p>
        <label className="field">
          Place
          <select value={twinPlace.id} onChange={(e) => setTwinId(e.target.value)}>
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <ul className="twin-list">
          {twinPlace.twins.map((t) => (
            <li key={t.id}>
              <button type="button" className="world-row compact" onClick={() => onOpen(byId[t.id])}>
                <span className="world-name"><b>{t.name}</b><small className="mono">{byId[t.id].kind}</small></span>
                <span className="mono">{t.similarity.toFixed(2)}</span>
                <span className="dim small">archetype {byId[t.id].cluster + 1}</span>
              </button>
            </li>
          ))}
        </ul>
        {data.excluded.length > 0 && <p className="faint small">Left out for lack of data: {data.excluded.map((p) => p.name).join(", ")}.</p>}
      </div>
    </section>
  );
}
