/** Which version of the app is on screen, and whether the page and the analysis server agree. */

const known = (v) => !!v?.version && v.version !== "unknown";

/** "2428736", or "2428736 + local changes", or "unknown". */
export function describeVersion(v) {
  if (!known(v)) return "unknown";
  return v.dirty ? `${v.version} + local changes` : v.version;
}

/** "same" or "different" by commit, or "unknown" when either side cannot say (for example a build outside git). */
export function compareVersions(page, server) {
  if (!known(page) || !known(server)) return "unknown";
  return page.version === server.version ? "same" : "different";
}
