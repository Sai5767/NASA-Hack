/**
 * Colour-class lookup for the local field (spec 2.5). This is display binning only: the anomaly values come from the
 * backend and nothing here computes a statistic. The scale is a plain maximum of the loaded observed anomalies.
 */

const RAMPS = {
  thermal: { pos: "warm", neg: "cool", above: "Warmer than usual", below: "Cooler than usual", sentence: "Warmer or cooler than this place usually is in this month" },
  water: { pos: "wet", neg: "dry", above: "Wetter than usual", below: "Drier than usual", sentence: "Wetter or drier than this place usually is in this month" },
  cloud: { pos: "cloud", neg: "cool", above: "More cloud than usual", below: "Less cloud than usual", sentence: "Cloudier or clearer than this place usually is in this month" },
  other: { pos: "warm", neg: "cool", above: "Higher than usual", below: "Lower than usual", sentence: "Higher or lower than this place usually is in this month" },
};

/** Which ramp a /api/variables entry uses: by group, with CLOUD_AMT as the one per-variable exception. */
export function rampFor(variable) {
  if (variable?.id === "CLOUD_AMT") return { id: "cloud", ...RAMPS.cloud };
  if (variable?.group === "Heat") return { id: "thermal", ...RAMPS.thermal };
  if (variable?.group === "Water") return { id: "water", ...RAMPS.water };
  return { id: "other", ...RAMPS.other };
}

/** Fill alpha per class step (spec 3.2): neutral 0.55, steps 1-4 0.70 / 0.78 / 0.86 / 0.92. */
export const STEP_ALPHA = [0.55, 0.7, 0.78, 0.86, 0.92];

/**
 * Symmetric scale for a loaded frame set: the largest absolute non-missing cell anomaly in the OBSERVED frames
 * (forecast frames reuse the scale of the observed frames they follow). Returns null when there is no valid cell.
 */
export function scaleFor(frames) {
  let max = 0;
  let any = false;
  for (const f of frames ?? []) {
    if (f?.kind !== "observed") continue;
    for (const c of f.cells ?? []) {
      if (c.missing || c.anomaly == null || !Number.isFinite(c.anomaly)) continue;
      any = true;
      max = Math.max(max, Math.abs(c.anomaly));
    }
  }
  if (!any) return null;
  return max > 0 ? max : 1e-9;
}

/**
 * Class of one anomaly on the scale: { side: "pos" | "neg" | "neutral", step: 0..4 }.
 * Neutral band |a| < 0.1 * scale, then four equal-width steps from 0.1 * scale up to the scale (values beyond the
 * scale, such as a forecast, are clamped to step 4). A null anomaly has no class (it is missing, not neutral).
 */
export function classify(anomaly, scale) {
  if (anomaly == null || !Number.isFinite(anomaly) || !scale) return null;
  const a = Math.abs(anomaly);
  if (a < 0.1 * scale) return { side: "neutral", step: 0 };
  const width = (0.9 * scale) / 4;
  const step = Math.min(4, Math.max(1, Math.floor((a - 0.1 * scale) / width) + 1));
  return { side: anomaly > 0 ? "pos" : "neg", step };
}

/** Token name of a class on a ramp. */
export function tokenFor(cls, ramp) {
  if (!cls) return null;
  if (cls.side === "neutral") return "--data-neutral";
  return `--data-${cls.side === "pos" ? ramp.pos : ramp.neg}-${cls.step}`;
}

/** The nine legend swatches, coolest/driest first, and the break values printed under the ends. */
export function legendSwatches(ramp, scale) {
  const neg = [4, 3, 2, 1].map((s) => `--data-${ramp.neg}-${s}`);
  const pos = [1, 2, 3, 4].map((s) => `--data-${ramp.pos}-${s}`);
  return { tokens: [...neg, "--data-neutral", ...pos], low: scale == null ? null : -scale, high: scale };
}
