function escape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download a Blob as a file from the browser. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download text as a file from the browser (API unchanged since V2). */
export function downloadText(filename, text, type = "text/csv") {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

/** CSV of a case file: a commented header with the key statistics, then the annual series. */
export function caseFileCsv(data) {
  const { variable, location, period, stats, ols, grade, annual } = data;
  const header = [
    `# Trend Detective case file`,
    `# Variable: ${variable.label} (${variable.id}), units: ${variable.units}`,
    `# Location: ${location.lat}, ${location.lon}`,
    `# Period: ${period.start_year}-${period.end_year} (${stats.n_years} complete years)`,
    `# Sen's slope per decade: ${stats.slope_per_decade} (95% range ${stats.ci_low_per_decade} to ${stats.ci_high_per_decade})`,
    `# Mann-Kendall p-value: ${stats.p_value} (unadjusted ${stats.p_naive}); regression p-value: ${ols.p_value}`,
    `# Evidence grade: ${grade.label} (${grade.passed}/${grade.total} checks)`,
    `# Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science/Applied Science Program`,
    `year,annual_mean_${variable.id}`,
  ];
  return [...header, ...annual.map((a) => `${a.year},${escape(a.value)}`)].join("\n");
}

export function sweepCsv(sweep) {
  const rows = sweep.rows.filter((r) => r.ok);
  const header = [
    `# Trend Detective sweep at ${sweep.location.lat}, ${sweep.location.lon}, ${sweep.period.start_year}-${sweep.period.end_year}`,
    "variable,units,slope_per_decade,ci_low_per_decade,ci_high_per_decade,total_change,percent_of_mean,signal_to_noise,p_value,significant,significant_after_fdr,grade",
  ];
  return [
    ...header,
    ...rows.map((r) =>
      [r.label, r.units, r.slope_per_decade, r.ci_low_per_decade, r.ci_high_per_decade, r.total_change, r.percent_of_mean ?? "", r.signal_to_noise ?? "", r.p_value, r.significant, r.significant_fdr, r.grade.label]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

export function worldCsv(world) {
  const header = [
    `# Trend Detective world survey: ${world.variable.label} (${world.variable.units}), ${world.period.start_year}-${world.period.end_year}`,
    "# Sample places only; not an evenly spaced or complete picture of the planet.",
    "place,kind,lat,lon,slope_per_decade,ci_low_per_decade,ci_high_per_decade,percent_of_mean,p_value,significant,significant_after_fdr,note",
  ];
  return [
    ...header,
    ...world.places.map((p) =>
      p.ok
        ? [p.name, p.kind, p.lat, p.lon, p.slope_per_decade, p.ci_low_per_decade, p.ci_high_per_decade, p.percent_of_mean ?? "", p.p_value, p.significant, p.significant_fdr, ""].map(escape).join(",")
        : [p.name, p.kind, p.lat, p.lon, "", "", "", "", "", "", "", p.message].map(escape).join(","),
    ),
  ].join("\n");
}

export function scanCsv(grid) {
  const header = [
    `# Trend Detective region scan: ${grid.variable.label}, ${grid.period.start_year}-${grid.period.end_year}`,
    "lat,lon,slope_per_decade,p_value,significant,significant_after_fdr,signal_to_noise,note",
  ];
  return [
    ...header,
    ...grid.cells.map((c) =>
      c.ok
        ? [c.lat, c.lon, c.slope_per_decade, c.p_value, c.significant, c.significant_fdr, c.signal_to_noise ?? "", ""].map(escape).join(",")
        : [c.lat, c.lon, "", "", "", "", "", c.message].map(escape).join(","),
    ),
  ].join("\n");
}

const csvNumber = (v) => (v == null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(10))));

/**
 * CSV of the values a ChartViewer plots (see chartSpec in lib/chart.js), in the unit currently displayed.
 * One row per x value; band series give a low and a high column; `note` text (p-values, grades) is copied verbatim
 * and never converted. `range` ({ x0, x1 }) limits the rows to the visible x range.
 */
export function chartCsv(spec, { range, originalUnit, approximate } = {}) {
  const header = [
    `# Trend Detective chart: ${spec.title}`,
    spec.source ? `# Source: ${spec.source}` : null,
    spec.unit ? `# Units: ${spec.unit}${spec.yLabel ? ` ${spec.yLabel}` : ""}` : null,
    originalUnit && originalUnit !== spec.unit
      ? `# Converted for display from ${originalUnit}${approximate ? " (approximate)" : ""}. p-values, significance and evidence labels are not converted.`
      : null,
    "# Values are the plotted values returned by the backend; nothing is smoothed or filled in.",
  ].filter(Boolean);
  const cols = [];
  for (const s of spec.series) {
    if (s.type === "band") {
      cols.push({ name: `${s.label} low`, s, key: "lo" }, { name: `${s.label} high`, s, key: "hi" });
    } else {
      cols.push({ name: s.label, s, key: "y" });
    }
    if (s.data.some((d) => d.note)) cols.push({ name: `${s.label} note`, s, key: "note" });
  }
  const xs = [...new Set(spec.series.flatMap((s) => s.data.map((d) => d.x)))]
    .filter((x) => Number.isFinite(x) && (!range || ((range.x0 == null || x >= range.x0) && (range.x1 == null || x <= range.x1))))
    .sort((a, b) => a - b);
  const index = cols.map((c) => new Map(c.s.data.map((d) => [d.x, d])));
  const labelOf = (x) => {
    for (const s of spec.series) {
      const d = s.data.find((p) => p.x === x);
      if (d?.label) return d.label;
    }
    return csvNumber(x);
  };
  const rows = xs.map((x) =>
    [labelOf(x), ...cols.map((c, i) => {
      const d = index[i].get(x);
      if (!d) return "";
      return c.key === "note" ? escape(d.note ?? "") : csvNumber(d[c.key]);
    })].map((v, i) => (i === 0 ? escape(v) : v)).join(","),
  );
  return [...header, [spec.xLabel ?? "x", ...cols.map((c) => c.name)].map(escape).join(","), ...rows].join("\n");
}
