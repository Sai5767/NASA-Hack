import { useMemo } from "react";
import { chartSpec, directionColor, rampColor, rampFamily } from "../../lib/chart.js";
import { mean, signed } from "../../lib/format.js";
import { ExpandableChart } from "./ChartViewer.jsx";
import { DEFAULT_SOURCE } from "./TrendChart.jsx";

/** ChartViewer spec: each year's departure from this record's own average (a difference: delta units). */
export function stripesSpec(annual, units, { title, source, variable } = {}) {
  const avg = mean(annual.map((a) => a.value));
  const dev = annual.map((a) => a.value - avg);
  const maxAbs = Math.max(...dev.map(Math.abs), 1e-9);
  const fam = rampFamily(units, variable);
  return chartSpec({
    title: title ?? `Yearly stripes${variable?.label ? `: ${variable.label}` : ""}`,
    source: source ?? variable?.source ?? DEFAULT_SOURCE,
    unit: units,
    yLabel: "vs average",
    variable,
    delta: true,
    zeroLine: true,
    xKind: "year",
    xLabel: "Year",
    footnote: "Departures are from the average of the years shown.",
    series: [
      {
        id: "dev",
        label: "Departure from average",
        type: "bars",
        legend: [
          { label: "Above average", color: directionColor(1, fam) },
          { label: "Below average", color: directionColor(-1, fam) },
        ],
        data: annual.map((a, i) => ({ x: a.year, y: dev[i], label: String(a.year), color: rampColor(dev[i], maxAbs, fam) })),
      },
    ],
  });
}

/** One coloured stripe per year: how far that year sits above or below this place's average. Click to expand. */
export default function Stripes({ annual, units, title, source, variable, unit, expandable = true }) {
  const shownUnit = unit ?? units;
  const fam = rampFamily(shownUnit, variable);
  const avg = mean(annual.map((a) => a.value));
  const deviations = annual.map((a) => a.value - avg);
  const maxAbs = Math.max(...deviations.map(Math.abs), 1e-9);
  const spec = useMemo(() => stripesSpec(annual, shownUnit, { title, source, variable }), [annual, shownUnit, title, source, variable]);

  return (
    <div className="stripes-block">
      <ExpandableChart spec={spec} disabled={!expandable}>
        <div className="stripes" role="img" aria-label="Yearly departures from the average, one stripe per year">
          {annual.map((a, i) => (
            <i key={a.year} title={`${a.year}: ${signed(deviations[i])} ${shownUnit} vs average`} style={{ background: rampColor(deviations[i], maxAbs, fam) }} />
          ))}
        </div>
      </ExpandableChart>
      <div className="stripes-key">
        <span className="mono">{annual[0].year}</span>
        <span>
          <i className="ch-sw box" style={{ background: directionColor(-1, fam) }} /> Below average
          <i className="ch-sw box ch-sw-gap" style={{ background: directionColor(1, fam) }} /> Above average
        </span>
        <span className="mono">{annual[annual.length - 1].year}</span>
      </div>
    </div>
  );
}
