import "../../styles/insight.css";
import Term from "../Term.jsx";
import { correctionLevel, DIRECTION, GRADE_TIER, STRENGTH_WORDS } from "./logic.js";

/**
 * The one monochrome visual language for change and significance (plan 6B/7, spec 4.5). Direction is a glyph
 * (▲ rising, ▼ falling, – no clear change), strength is a count of filled marks, and "correction" results are a line
 * style (solid = holds after correction, dashed = only before correction, plain = no clear trend), matching the scan
 * cells on the globe. Never red/blue/amber/green. Everything is chosen from backend fields; nothing is computed here.
 */

/** ▲ / ▼ / – with an optional word. `dir` is "up" | "down" | "flat". */
export function TrendArrow({ dir, label = true, className = "" }) {
  const d = DIRECTION[dir] ?? DIRECTION.flat;
  return (
    <span className={`td-dir td-dir--${d.kind} ${className}`}>
      <span className="td-dir-glyph" aria-hidden="true">{d.glyph}</span>
      {label ? <span className="td-dir-word">{d.word}</span> : <span className="sr-only">{d.word}</span>}
    </span>
  );
}

/** "How sure are we?": 0–3 filled marks. `tier` comes from the backend verdict or from a backend grade code. */
export function EvidenceMeter({ tier, code, size = "md", showLabel = false }) {
  const t = Math.max(0, Math.min(3, Number.isInteger(tier) ? tier : 0));
  const word = STRENGTH_WORDS[t];
  return (
    <span className={`ev-meter ev-meter--${size}${code ? ` ev-meter--${code}` : ""}`} role="img" aria-label={`How sure are we: ${word} (${t} of 3 marks)`}>
      {[1, 2, 3].map((n) => <i key={n} className={n <= t ? "on" : ""} />)}
      {showLabel && <span className="ev-meter-word" aria-hidden="true">{word}</span>}
    </span>
  );
}

/** Meter for a V1 grade code ("strong" | "moderate" | "weak" | "none"). */
export function GradeMeter({ code, showLabel }) {
  return <EvidenceMeter tier={GRADE_TIER[code] ?? 0} showLabel={showLabel} />;
}

/** The small line-style swatch used for "holds after correction" / "only before correction" / "no clear trend". */
export function CorrectionSwatch({ level }) {
  return <i className={`td-swatch td-swatch--${level}`} aria-hidden="true" />;
}

/** Swatch + plain label from a row's backend flags ({ ok, significant, significant_fdr }). */
export function CorrectionTag({ row, term = true }) {
  const lv = correctionLevel(row);
  const text = lv.label;
  return (
    <span className={`td-ctag td-ctag--${lv.level}`}>
      <CorrectionSwatch level={lv.level} />
      {term && lv.term ? <Term id={lv.term}>{text}</Term> : text}
    </span>
  );
}

/** The shared key: arrows plus the three line styles. Put it next to any list or map that uses them. */
export function TrendKey({ correction = true, arrows = true, className = "" }) {
  return (
    <ul className={`td-key ${className}`} aria-label="Key">
      {arrows && (
        <>
          <li><span aria-hidden="true">▲</span> rising</li>
          <li><span aria-hidden="true">▼</span> falling</li>
          <li><span aria-hidden="true">–</span> no clear change</li>
        </>
      )}
      {correction && (
        <>
          <li><CorrectionSwatch level="holds" /> <Term id="holds">holds after correction</Term></li>
          <li><CorrectionSwatch level="before" /> <Term id="beforeonly">only before correction</Term></li>
          <li><CorrectionSwatch level="none" /> no clear trend</li>
        </>
      )}
    </ul>
  );
}

/** A unit, defined on hover/tap (sunlight units get their own entry). */
export function Unit({ u }) {
  if (!u) return null;
  const id = /W\/m|MJ\/m/i.test(u) ? "wm2" : "units";
  return <Term id={id}>{u}</Term>;
}

/** A labelled "How sure are we?" row: meter + plain word + defined term. */
export function HowSure({ tier, code }) {
  const t = Number.isInteger(tier) ? tier : 0;
  return (
    <span className="td-howsure">
      <span className="td-howsure-q"><Term id="evidence">How sure are we?</Term></span>
      <EvidenceMeter tier={t} code={code} />
      <span className="td-howsure-word">{STRENGTH_WORDS[t]}</span>
    </span>
  );
}
