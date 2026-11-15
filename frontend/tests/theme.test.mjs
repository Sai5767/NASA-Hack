import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_THEME, THEMES, THEME_IDS, nextTheme, themeOf } from "../src/lib/theme.js";

test("the default theme exists and unknown ids fall back to it", () => {
  assert.ok(THEMES[DEFAULT_THEME]);
  assert.equal(themeOf("nope"), THEMES[DEFAULT_THEME]);
  assert.equal(themeOf(undefined), THEMES[DEFAULT_THEME]);
});

test("switching cycles through every theme and wraps around", () => {
  let id = THEME_IDS[0];
  const seen = [];
  for (let i = 0; i < THEME_IDS.length; i += 1) {
    seen.push(id);
    id = nextTheme(id);
  }
  assert.deepEqual(seen, THEME_IDS);
  assert.equal(id, THEME_IDS[0]);
  assert.equal(nextTheme("nope"), THEME_IDS[0]);
});

test("every theme defines the same colours, in a usable format", () => {
  const keys = (o) => Object.keys(o).sort().join();
  const ref = THEMES[DEFAULT_THEME];
  for (const [id, t] of Object.entries(THEMES)) {
    assert.equal(keys(t), keys(ref), `${id}: top-level keys differ`);
    assert.equal(keys(t.colors), keys(ref.colors));
    assert.equal(keys(t.globe), keys(ref.globe));
    assert.match(t.colors.a, /^#[0-9a-f]{6}$/i);
    assert.match(t.colors.b, /^#[0-9a-f]{6}$/i);
    assert.match(t.accentRgb, /^\d+,\d+,\d+$/);
    assert.equal(t.globe.atmosphere, t.accentRgb, `${id}: the globe's glow should match the accent`);
  }
});

test("the two pin colours are different in every theme", () => {
  for (const t of Object.values(THEMES)) assert.notEqual(t.colors.a.toLowerCase(), t.colors.b.toLowerCase());
});
