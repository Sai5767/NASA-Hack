function escape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download text as a file from the browser. */
export function downloadText(filename, text, type = "text/csv") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
