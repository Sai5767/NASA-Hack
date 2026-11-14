import { divergingColor } from "../../lib/chart.js";
import { mean, signed } from "../../lib/format.js";

/** One colored stripe per year: how far that year sits above or below this place's average. */
export default function Stripes({ annual, units }) {
  const avg = mean(annual.map((a) => a.value));
  const deviations = annual.map((a) => a.value - avg);
  const maxAbs = Math.max(...deviations.map(Math.abs), 1e-9);

  return (
    <div className="stripes-block">
      <div className="stripes" role="img" aria-label="Yearly departures from the average, one stripe per year, blue below and red above">
        {annual.map((a, i) => (
          <i
            key={a.year}
            title={`${a.year}: ${signed(deviations[i])} ${units} vs average`}
            style={{ background: divergingColor(deviations[i], maxAbs), "--d": `${600 + i * 16}ms` }}
          />
        ))}
      </div>
      <div className="stripes-key">
        <span>{annual[0].year}</span>
        <span className="mono dim"><i className="sw box" style={{ background: "var(--down)" }} /> below average &nbsp; <i className="sw box" style={{ background: "var(--up)" }} /> above average</span>
        <span>{annual[annual.length - 1].year}</span>
      </div>
    </div>
  );
}
