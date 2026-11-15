import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, describeVersion } from "../src/lib/version.js";

test("a version is described plainly, with local changes flagged", () => {
  assert.equal(describeVersion({ version: "2428736", dirty: false }), "2428736");
  assert.equal(describeVersion({ version: "2428736", dirty: true }), "2428736 + local changes");
  assert.equal(describeVersion({ version: "unknown" }), "unknown");
  assert.equal(describeVersion(null), "unknown");
});

test("the page and the server are compared by commit", () => {
  assert.equal(compareVersions({ version: "abc1234" }, { version: "abc1234" }), "same");
  assert.equal(compareVersions({ version: "abc1234", dirty: true }, { version: "abc1234", dirty: false }), "same");
  assert.equal(compareVersions({ version: "abc1234" }, { version: "7c67765" }), "different");
});

test("when either side cannot say, nothing is claimed", () => {
  assert.equal(compareVersions({ version: "unknown" }, { version: "abc1234" }), "unknown");
  assert.equal(compareVersions({ version: "abc1234" }, null), "unknown");
  assert.equal(compareVersions(undefined, undefined), "unknown");
});
