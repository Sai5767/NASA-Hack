/** Plain-language phrases shared by the Overview and the Detail view. */

export const STAMP_WORDS = { strong: "STRONG TREND", moderate: "LIKELY TREND", weak: "FAINT SIGNAL", none: "INCONCLUSIVE" };

export function shapeWord(shape) {
  if (shape.label === "step") return `Step near ${shape.step_year}`;
  if (shape.label === "steady") return "Steady ramp";
  return "No clear shape";
}

export function shapeSub(shape, units) {
  const line = Math.round(shape.r2_line * 100);
  const step = shape.r2_step == null ? null : Math.round(shape.r2_step * 100);
  if (shape.label === "step") {
    return `Average ${shape.mean_before.toPrecision(3)} → ${shape.mean_after.toPrecision(3)} ${units}. One step explains ${step}% of the variance, a straight line ${line}%.`;
  }
  if (shape.label === "steady") return `A straight line explains ${line}% of the variance${step != null ? `, a single step ${step}%` : ""}.`;
  return `Neither a line (${line}%) nor a single step${step != null ? ` (${step}%)` : ""} explains much of the variance.`;
}

export function noiseSentence(snr) {
  if (snr == null) return "no variation to compare";
  const x = Math.abs(snr);
  if (x >= 2) return "clearly larger than a normal year-to-year swing";
  if (x >= 1) return "larger than a normal year-to-year swing";
  return "smaller than a normal swing: easy for natural variability to hide";
}

export function directionWord(stats) {
  if (!stats.significant) return "showing no clear direction";
  return stats.sign === "up" ? "rising" : "falling";
}

/** What a p-value means, in one sentence, for the number actually observed. */
export function pValueMeaning(stats) {
  if (stats.significant) {
    const odds = stats.p_value < 0.001 ? "far less than 1 in 1,000" : `about ${(stats.p_value * 100).toFixed(stats.p_value < 0.01 ? 1 : 0)} in 100`;
    return `If nothing were really changing, a pattern this strong would turn up by luck ${odds} of the time.`;
  }
  return "Chance alone could easily produce a pattern like this, so the data do not settle it.";
}
