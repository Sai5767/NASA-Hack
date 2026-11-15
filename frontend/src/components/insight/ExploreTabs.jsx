import { useId, useRef } from "react";
import "../../styles/insight.css";
import { EXPLORE_GROUPS, EXPLORE_TABS, canCombine, tabLabel, tabsInGroup } from "../../lib/route.js";

/**
 * The grouped Explore tool row (plan 4.5, owner items 3 and 13): "Place tools", "Compare & context" and "Learn", plus an
 * "Open a second tool" disclosure for compatible pairs (e.g. Duel + Scan). Incompatible pairs are shown disabled with
 * their reason. It is a WAI-ARIA tablist: arrow keys move between tools, Home/End jump to the ends.
 *
 * Props:
 *   tab            the primary tool id
 *   also           the second tool id or null
 *   onTab(id)      open a tool (App: goTool)
 *   onAlso(id|null) open/close the second tool (App: setExploreAlso)
 *   panelId        id of the tool panel (default "panel")
 *   scanActive     optional: true while a scan result is held (adds a small dot to "Scan a region")
 */
export default function ExploreTabs({ tab, also = null, onTab, onAlso, panelId = "panel", scanActive = false }) {
  const listRef = useRef(null);
  const pairId = useId();
  const ids = EXPLORE_TABS.map((t) => t.id);

  const onKey = (e) => {
    const i = ids.indexOf(tab);
    let next = null;
    if (e.key === "ArrowRight") next = ids[(i + 1) % ids.length];
    if (e.key === "ArrowLeft") next = ids[(i - 1 + ids.length) % ids.length];
    if (e.key === "Home") next = ids[0];
    if (e.key === "End") next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  const others = EXPLORE_TABS.filter((t) => t.id !== tab && t.group !== "learn");
  const anyPair = others.some((t) => canCombine(tab, t.id).ok);

  return (
    <div className="xt">
      <div className="xt-row" role="tablist" aria-label="Explore tools" ref={listRef} onKeyDown={onKey}>
        {EXPLORE_GROUPS.map((g) => (
          <div key={g.id} className={`xt-group xt-group--${g.id}`} role="presentation">
            <span className="xt-group-label" aria-hidden="true">{g.label}</span>
            <div className="xt-tabs" role="presentation">
              {tabsInGroup(g.id).map((t) => {
                const on = tab === t.id;
                const side = also === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={on}
                    aria-controls={panelId}
                    aria-label={`${t.label} (${g.label})${side ? ", open alongside" : ""}`}
                    tabIndex={on ? 0 : -1}
                    title={t.hint}
                    className={`xt-tab${on ? " is-on" : ""}${side ? " is-side" : ""}`}
                    onClick={() => onTab(t.id)}
                  >
                    {t.label}
                    {t.id === "scan" && scanActive && <i className="xt-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {onAlso && (
        <div className="xt-pair">
          {also ? (
            <p className="xt-pair-on">
              <span className="faint">Open alongside:</span> <b>{tabLabel(also)}</b>{" "}
              <button type="button" className="linklike" onClick={() => onAlso(null)}>Close {tabLabel(also)}</button>
            </p>
          ) : (
            <details className="td-disclosure xt-pair-pick">
              <summary>Open a second tool</summary>
              <div className="td-disclosure-body">
                {!anyPair && <p className="faint xt-pair-none">{tabLabel(tab)} works on its own.</p>}
                <ul className="xt-pair-list" aria-describedby={pairId}>
                  {others.map((t) => {
                    const c = canCombine(tab, t.id);
                    return (
                      <li key={t.id} className={c.ok ? "" : "is-off"}>
                        <button type="button" className="chip" disabled={!c.ok} aria-disabled={!c.ok} onClick={() => c.ok && onAlso(t.id)} title={c.ok ? `Show ${t.label} next to ${tabLabel(tab)}` : c.reason}>
                          + {t.label}
                        </button>
                        {!c.ok && <span className="xt-pair-why faint">{c.reason}</span>}
                      </li>
                    );
                  })}
                </ul>
                <p id={pairId} className="sr-only">Tools that share the same pin can be shown side by side.</p>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
