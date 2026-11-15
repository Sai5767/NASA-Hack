import assert from "node:assert/strict";
import test from "node:test";
import { distanceKm, nearestPlace } from "../src/lib/geo.js";
import {
  IMPORT_ERROR,
  INTERESTS,
  MAX_PLACES,
  PROFILE_KEY,
  V1_KEYS,
  addPlace,
  applyImport,
  defaultView,
  emptyProfile,
  exportProfile,
  importProfile,
  interestOf,
  isValidEmail,
  loadProfile,
  maskEmail,
  migrateV1,
  movePlace,
  removePlace,
  resetProfile,
  sanitizeProfile,
  saveProfile,
  setLabel,
  signIn,
  stageOf,
  toggleInterest,
  validateSignIn,
  variablesFor,
  withAccount,
} from "../src/lib/profile.js";

/** A Map-backed stand-in for localStorage that records every write. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map,
    writes,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      writes.push([k, String(v)]);
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

/** Storage that throws on every call, like a browser with storage blocked. */
const blockedStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("SecurityError"); },
  removeItem() { throw new Error("SecurityError"); },
};

const SECRET = "hunter2-correct-horse";

// ---------------------------------------------------------------- sign-in

test("the sign-in form needs a syntactically valid email and a non-empty password", () => {
  assert.ok(isValidEmail("ada@example.com"));
  assert.ok(isValidEmail("  a.b+c@sub.example.org  "));
  for (const bad of ["", "ada", "ada@", "@example.com", "ada@example", "a b@example.com", "ada@example.c", "<x>@example.com"]) {
    assert.ok(!isValidEmail(bad), bad);
  }
  assert.deepEqual(validateSignIn("ada@example.com", "x"), {});
  assert.deepEqual(validateSignIn("nope", ""), { email: "Enter a valid email address.", password: "Enter a password." });
  assert.deepEqual(validateSignIn("ada@example.com", ""), { password: "Enter a password." });
});

test("signing in keeps only a masked display label: the password and full email never reach the profile", () => {
  const out = signIn(emptyProfile(), { email: "Ada.Lovelace@Example.COM", password: SECRET });
  assert.equal(out.ok, true);
  assert.deepEqual(out.profile.account, { label: "A***@example.com" });
  const text = JSON.stringify(out.profile);
  assert.ok(!text.includes(SECRET));
  assert.ok(!/password|token|lovelace/i.test(text));
  assert.equal(signIn(emptyProfile(), { email: "ada@example.com", password: "" }).ok, false);
  assert.equal(maskEmail("bad"), "");
  assert.deepEqual(withAccount(emptyProfile(), "not-an-email").account, null);
});

test("nothing that looks like a password is ever written to storage, whatever the profile carries", () => {
  const storage = memoryStorage();
  const dirty = {
    ...signIn(emptyProfile(), { email: "ada@example.com", password: SECRET }).profile,
    password: SECRET,
    token: "abc",
    account: { label: "ada", password: SECRET, email: "ada@example.com" },
    prefs: { detail: "plain", password: SECRET },
  };
  assert.ok(saveProfile(dirty, storage));
  for (const [, value] of storage.writes) {
    assert.ok(!value.includes(SECRET));
    assert.ok(!/password|token|ada@example\.com/i.test(value));
  }
  assert.ok(!exportProfile(dirty).includes(SECRET));
});

// ---------------------------------------------------------------- v2 shape

test("a profile has the documented v2 shape and nothing else", () => {
  const p = sanitizeProfile({
    version: 2,
    account: { label: "  Ada  " },
    onboarding: "done",
    places: [{ name: "Phoenix", lat: 33.449, lon: -112.074, extra: 1 }],
    interests: ["water", "heat", "nonsense"],
    prefs: { reduceMotion: true, detail: "technical", view: "detail", variable: "PRECTOTCORR", theme: "x" },
    junk: true,
  });
  assert.deepEqual(Object.keys(p).sort(), ["account", "interests", "onboarding", "places", "prefs", "version"]);
  assert.equal(p.version, 2);
  assert.deepEqual(p.account, { label: "Ada" });
  assert.deepEqual(p.places, [{ id: "33.4,-112.1", name: "Phoenix", lat: 33.45, lon: -112.07 }]);
  assert.deepEqual(p.interests, ["heat", "water"]); // canonical order, unknown ids dropped
  assert.deepEqual(p.prefs, { reduceMotion: true, detail: "technical", view: "detail", variable: "PRECTOTCORR" });
  assert.equal(stageOf(p), "app");
  assert.equal(stageOf(emptyProfile()), "signin");
  assert.equal(stageOf({ ...p, onboarding: "pending" }), "onboarding");
  assert.equal(stageOf({ ...p, onboarding: "skipped" }), "app");
});

test("the six data types have the exact onboarding labels", () => {
  assert.deepEqual(INTERESTS.map((i) => i.label), ["Heat", "Rain & water", "Clouds & sunlight", "Land & plants", "Wind & atmosphere", "Ice & oceans"]);
});

test("places: at most five, merged at 0.1 degree, removable and reorderable; bad coordinates rejected", () => {
  let p = emptyProfile();
  for (let i = 0; i < MAX_PLACES + 2; i += 1) p = addPlace(p, { name: `p${i}`, lat: i, lon: i });
  assert.equal(p.places.length, MAX_PLACES);
  assert.equal(addPlace(removePlace(p, "0.0,0.0"), { name: "dup", lat: 1.02, lon: 1.01 }).places.length, MAX_PLACES - 1);
  assert.equal(addPlace(emptyProfile(), { lat: 120, lon: 0 }).places.length, 0);
  assert.equal(addPlace(emptyProfile(), { lat: "x", lon: 0 }).places.length, 0);
  const moved = movePlace(p, "1.0,1.0", -1);
  assert.deepEqual(moved.places.slice(0, 2).map((x) => x.name), ["p1", "p0"]);
  assert.equal(movePlace(p, "0.0,0.0", -1), p);
  assert.equal(sanitizeProfile({ places: Array.from({ length: 9 }, (_, i) => ({ lat: i, lon: 0 })) }).places.length, MAX_PLACES);
  assert.equal(addPlace(emptyProfile(), { name: "<script>x", lat: 1, lon: 1 }).places[0].name, "scriptx");
});

test("interests toggle, labels are cleaned, detail level decides the starting view", () => {
  const p = toggleInterest(toggleInterest(emptyProfile(), "ice"), "heat");
  assert.deepEqual(p.interests, ["heat", "ice"]);
  assert.deepEqual(toggleInterest(p, "heat").interests, ["ice"]);
  assert.equal(toggleInterest(p, "bogus"), p);
  const signed = withAccount(emptyProfile(), "ada@example.com");
  assert.equal(setLabel(signed, "  Ada\u0007  ").account.label, "Ada");
  assert.equal(setLabel(signed, "   ").account.label, "a***@example.com");
  assert.equal(defaultView({ prefs: { detail: "technical", view: null } }), "detail");
  assert.equal(defaultView({ prefs: { detail: "plain", view: null } }), "overview");
  assert.equal(defaultView({ prefs: { detail: "technical", view: "overview" } }), "overview");
  assert.equal(defaultView(null), "overview");
});

test("data types map to the server's variables by group, with the ice list explicit", () => {
  const variables = [
    { id: "T2M", group: "Heat" }, { id: "T2M_MIN", group: "Heat" }, { id: "PRECTOTCORR", group: "Water" },
    { id: "CLOUD_AMT", group: "Sun & clouds" }, { id: "GWETROOT", group: "Land" }, { id: "WS2M", group: "Wind & pressure" },
  ];
  assert.deepEqual(variablesFor("heat", variables).map((v) => v.id), ["T2M", "T2M_MIN"]);
  assert.deepEqual(variablesFor("ice", variables).map((v) => v.id), ["T2M", "T2M_MIN"]);
  assert.deepEqual(variablesFor("wind", variables).map((v) => v.id), ["WS2M"]);
  assert.deepEqual(variablesFor("nope", variables), []);
  assert.equal(interestOf("T2M", variables, ["ice"]), "ice");
  assert.equal(interestOf("T2M", variables, []), "heat");
  assert.equal(interestOf("XYZ", variables), null);
});

// ---------------------------------------------------------------- storage: load, corrupt, blocked

test("first run: nothing stored gives a fresh profile on the sign-in screen", () => {
  const out = loadProfile(memoryStorage());
  assert.equal(out.status, "ok");
  assert.equal(out.migrated, false);
  assert.equal(stageOf(out.profile), "signin");
});

test("a saved profile round-trips through storage", () => {
  const storage = memoryStorage();
  const p = addPlace(toggleInterest(withAccount(emptyProfile(), "ada@example.com"), "heat"), { name: "Delhi", lat: 28.61, lon: 77.21 });
  assert.ok(saveProfile({ ...p, onboarding: "done" }, storage));
  const back = loadProfile(storage);
  assert.equal(back.status, "ok");
  assert.deepEqual(back.profile, sanitizeProfile({ ...p, onboarding: "done" }));
  assert.ok(storage.map.has(PROFILE_KEY));
});

test("corrupt or wrong-version storage is tolerated: a fresh profile and a 'corrupt' status", () => {
  for (const raw of ["{not json", "null", "[]", JSON.stringify({ version: 99, account: { label: "x" } })]) {
    const out = loadProfile(memoryStorage({ [PROFILE_KEY]: raw }));
    assert.equal(out.status, "corrupt", raw);
    assert.equal(stageOf(out.profile), "signin");
  }
  // Wrong field types inside a v2 value are repaired field by field.
  const out = loadProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify({ version: 2, account: { label: "Ada" }, onboarding: "done", places: "x", interests: 7, prefs: [] }) }));
  assert.equal(out.status, "ok");
  assert.deepEqual(out.profile.places, []);
  assert.deepEqual(out.profile.interests, []);
  assert.equal(out.profile.prefs.detail, "balanced");
});

test("blocked storage never throws: load, save and reset report it instead", () => {
  const out = loadProfile(blockedStorage);
  assert.equal(out.status, "blocked");
  assert.equal(stageOf(out.profile), "signin");
  assert.equal(loadProfile(null).status, "blocked");
  assert.equal(saveProfile(withAccount(emptyProfile(), "a@b.co"), blockedStorage), false);
  assert.equal(saveProfile(emptyProfile(), null), false);
  assert.equal(resetProfile(blockedStorage), false);
});

// ---------------------------------------------------------------- V1 migration

const V1 = {
  "td-profile": JSON.stringify({ done: true, who: "student", interests: ["heat", "rain", "humid", "poles", "unknown"], places: ["city", "desert"], level: "technical", goal: "explore" }),
  "td-watch": JSON.stringify([
    { id: "PRECTOTCORR@33.4,-112.1", variable: "PRECTOTCORR", lat: 33.45, lon: -112.07, name: "Phoenix" },
    { id: "T2M@28.6,77.2", variable: "T2M", lat: 28.6, lon: 77.2, name: "Delhi again" },
  ]),
  "td-view": JSON.stringify("detail"),
  "td-theme": JSON.stringify("classic"),
};

test("V1 preferences migrate into one v2 profile, and the old keys are removed", () => {
  const storage = memoryStorage(V1);
  const out = loadProfile(storage);
  assert.equal(out.status, "ok");
  assert.equal(out.migrated, true);
  const p = out.profile;
  assert.equal(p.account, null); // sign-in is still required
  assert.equal(p.onboarding, "pending"); // the answers are pre-filled in onboarding
  assert.deepEqual(p.interests, ["heat", "water", "ice"]);
  assert.deepEqual(p.places.map((x) => x.name), ["Delhi", "Central Sahara", "Phoenix"]); // Delhi watch item merged
  assert.equal(p.prefs.detail, "technical");
  assert.equal(p.prefs.view, "detail");
  assert.equal(p.prefs.variable, "PRECTOTCORR");
  for (const k of V1_KEYS) assert.ok(!storage.map.has(k), k);
  assert.ok(storage.map.has(PROFILE_KEY));
  // A second load reads the v2 value and does not migrate again.
  assert.equal(loadProfile(storage).migrated, false);
});

test("corrupt V1 values migrate what they can", () => {
  const out = loadProfile(memoryStorage({ "td-profile": "{broken", "td-watch": JSON.stringify([{ lat: 1, lon: 2, name: "x" }, "junk"]) }));
  assert.equal(out.migrated, true);
  assert.deepEqual(out.profile.places.map((p) => p.name), ["x"]);
  assert.deepEqual(migrateV1(), sanitizeProfile({ account: null, onboarding: "pending" }));
});

test("an existing v2 profile wins over leftover V1 keys", () => {
  const v2 = JSON.stringify(sanitizeProfile({ version: 2, account: { label: "Ada" }, onboarding: "done" }));
  const out = loadProfile(memoryStorage({ ...V1, [PROFILE_KEY]: v2 }));
  assert.equal(out.migrated, false);
  assert.deepEqual(out.profile.places, []);
});

// ---------------------------------------------------------------- reset / export / import

test("reset removes the v2 profile and every V1 key, returning to sign-in", () => {
  const storage = memoryStorage({ ...V1, [PROFILE_KEY]: "{}", "unrelated-key": "keep" });
  assert.ok(resetProfile(storage));
  assert.deepEqual([...storage.map.keys()], ["unrelated-key"]);
  assert.equal(stageOf(loadProfile(storage).profile), "signin");
});

test("export then import round-trips the profile; foreign or tampered files are refused", () => {
  const p = sanitizeProfile({
    version: 2,
    account: { label: "Ada" },
    onboarding: "done",
    places: [{ name: "Delhi", lat: 28.61, lon: 77.21 }],
    interests: ["cloud"],
    prefs: { reduceMotion: true },
  });
  const file = exportProfile(p);
  assert.deepEqual(JSON.parse(file).profile, p);
  assert.deepEqual(importProfile(file), p);
  for (const bad of ["", "nope", "[]", JSON.stringify({ app: "other", kind: "profile", version: 2, profile: {} }), JSON.stringify({ app: "trend-detective", kind: "profile", version: 1, profile: {} }), "x".repeat(200_001)]) {
    assert.throws(() => importProfile(bad), { message: IMPORT_ERROR });
  }
  // An imported file cannot smuggle in a password or unknown fields.
  const tampered = JSON.stringify({ app: "trend-detective", kind: "profile", version: 2, profile: { ...p, password: SECRET, account: { label: "Ada", token: SECRET } } });
  assert.ok(!JSON.stringify(importProfile(tampered)).includes(SECRET));
});

test("an imported profile keeps the current sign-in when it has none and never re-opens onboarding", () => {
  const current = withAccount(emptyProfile(), "ada@example.com");
  const merged = applyImport(current, sanitizeProfile({ onboarding: "pending", interests: ["wind"] }));
  assert.deepEqual(merged.account, current.account);
  assert.equal(merged.onboarding, "done");
  assert.deepEqual(merged.interests, ["wind"]);
});

// ---------------------------------------------------------------- geography helpers used by place picking

test("great-circle distance and nearest place", () => {
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 0.5);
  assert.ok(distanceKm(10, 20, 10, 20) < 1e-9);
  const places = [{ name: "A", lat: 28.6, lon: 77.2 }, { name: "B", lat: 0, lon: 0 }];
  assert.equal(nearestPlace(places, 28.9, 77.4)?.name, "A");
  assert.equal(nearestPlace(places, 60, 120), null);
});
