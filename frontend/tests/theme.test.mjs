import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DATA_COLORS, DEFAULT_THEME, THEMES, THEME_IDS, nextTheme, savedTheme, themeOf } from "../src/lib/theme.js";

const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const token = (name) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

test("there is one theme, mission, and unknown or retired ids fall back to it", () => {
  assert.equal(DEFAULT_THEME, "mission");
  assert.deepEqual(THEME_IDS, ["mission"]);
  for (const id of ["nope", undefined, "nebula", "classic"]) assert.equal(themeOf(id), THEMES.mission);
  assert.equal(nextTheme("mission"), "mission");
  assert.equal(nextTheme("nope"), "mission");
  assert.equal(savedTheme(), "mission");
});

test("the JavaScript palette matches the CSS tokens in theme.css", () => {
  const t = THEMES.mission;
  assert.equal(t.colors.a, token("accent"));
  assert.equal(t.colors.b, token("live"));
  assert.equal(t.accentRgb, token("accent-rgb").replace(/\s/g, ""));
  assert.equal(t.globe.atmosphere, token("globe-halo-rgb").replace(/\s/g, ""));
  assert.equal(t.globe.oceanA, token("globe-ocean-lit"));
  assert.equal(t.globe.oceanB, token("globe-ocean-dark"));
  assert.equal(t.globe.flatOcean, token("globe-flat-ocean"));
  assert.equal(t.globe.land, token("globe-land"));
  assert.equal(DATA_COLORS.up, token("up"));
  assert.equal(DATA_COLORS.down, token("down"));
  assert.equal(DATA_COLORS.flat, token("flat"));
  assert.equal(DATA_COLORS.failed, token("missing-fg"));
});

test("legacy token names the existing CSS uses are still defined", () => {
  for (const name of ["bg-0", "bg-1", "bg-2", "panel", "panel-solid", "panel-raised", "line", "line-strong", "text", "text-dim", "text-faint", "accent", "accent-rgb", "accent-dim", "accent-ink", "ink-rgb", "glow-rgb", "up", "down", "flat", "amber", "ok", "font-display", "font-mono", "radius", "ease", "pin-a", "pin-b"]) {
    assert.ok(token(name), `--${name} is missing`);
  }
  assert.ok(!css.includes('[data-theme="classic"]'), "the retired classic theme block is gone");
});

test("colours are usable formats and the two pin colours differ", () => {
  const t = THEMES.mission;
  assert.match(t.colors.a, /^#[0-9a-f]{6}$/i);
  assert.match(t.colors.b, /^#[0-9a-f]{6}$/i);
  assert.match(t.accentRgb, /^\d+,\d+,\d+$/);
  assert.notEqual(t.colors.a.toLowerCase(), t.colors.b.toLowerCase());
});
