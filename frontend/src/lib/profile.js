/**
 * The local demo profile (`td-profile-v2`). Everything here lives in this browser's localStorage only; nothing about the
 * user is ever sent to the server.
 *
 * The sign-in form is a one-account demo gate, not authentication: the email is checked for shape, the password only for
 * being non-empty, and then the password is dropped. No function in this file accepts a password for storage, and
 * `sanitizeProfile` rebuilds every profile from an allow-list of fields, so a password, token or any other unknown field
 * can never be saved, imported or exported.
 *
 * Every storage function takes the storage object as an argument (defaulting to window.localStorage) so the tests can pass
 * a fake one, a corrupt one or one that throws like a blocked browser.
 */
import { INTAKE_PLACES } from "./cases.js";

export const PROFILE_KEY = "td-profile-v2";
export const PROFILE_VERSION = 2;
/** V1 keys this version migrates from and removes after a successful migration (and on reset). */
export const V1_KEYS = ["td-profile", "td-watch", "td-view", "td-theme"];
export const MAX_PLACES = 5;
export const LABEL_MAX = 60;
const IMPORT_MAX_CHARS = 100_000;

export const ONBOARDING = ["pending", "done", "skipped"];

/** Question 2: the six data types, with their exact labels (spec section 1.4) and the variables each one covers. */
export const INTERESTS = [
  { id: "heat", label: "Heat", groups: ["Heat"], variables: [], first: "T2M" },
  { id: "water", label: "Rain & water", groups: ["Water"], variables: [], first: "PRECTOTCORR" },
  { id: "cloud", label: "Clouds & sunlight", groups: ["Sun & clouds"], variables: [], first: "CLOUD_AMT" },
  { id: "land", label: "Land & plants", groups: ["Land"], variables: [], first: "GWETROOT" },
  { id: "wind", label: "Wind & atmosphere", groups: ["Wind & pressure"], variables: [], first: "WS2M" },
  // NASA POWER has no sea-ice or ocean variable; these are the cold-side signals it does have. Planet-wide sea ice is in Explore ▸ Vitals.
  { id: "ice", label: "Ice & oceans", groups: [], variables: ["T2M", "T2M_MIN", "TS", "PRECSNOLAND"], first: "T2M" },
];
export const INTEREST_IDS = INTERESTS.map((i) => i.id);
export const interestById = (id) => INTERESTS.find((i) => i.id === id) ?? null;

export const DETAIL_LEVELS = [
  { id: "plain", label: "Plain" },
  { id: "balanced", label: "Balanced" },
  { id: "technical", label: "Tech" },
];
const DETAIL_IDS = DETAIL_LEVELS.map((d) => d.id);

export const DEFAULT_PREFS = { reduceMotion: false, detail: "balanced", view: null, variable: "T2M" };

/** A brand-new profile: not signed in, onboarding not done. */
export const emptyProfile = () => ({
  version: PROFILE_VERSION,
  account: null,
  onboarding: "pending",
  places: [],
  interests: [],
  prefs: { ...DEFAULT_PREFS },
});

// ---------------------------------------------------------------- small validators

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
// Control characters and angle brackets are removed from any text the user can type or import.
const cleanText = (s, max) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const round2 = (n) => Math.round(n * 100) / 100;

/** Merges spots that round to the same 0.1 degree. */
export const placeId = (lat, lon) => `${Number(lat).toFixed(1)},${Number(lon).toFixed(1)}`;

/** A clean place, or null when it is not a valid place. */
export function cleanPlace(p) {
  if (!isObj(p)) return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const name = cleanText(p.name, 80) || `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return { id: placeId(lat, lon), name, lat: round2(lat), lon: round2(lon) };
}

// ---------------------------------------------------------------- email (sign-in form only)

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;.]{2,}$/;
export const isValidEmail = (email) => typeof email === "string" && email.length <= 254 && EMAIL.test(email.trim());

/** `varun@example.com` → `v***@example.com`: the only form of the email that is ever stored. */
export function maskEmail(email) {
  const e = String(email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return "";
  return cleanText(`${e[0]}***@${e.slice(at + 1).toLowerCase()}`, LABEL_MAX);
}

/** Field errors for the sign-in form, using the spec's copy. An empty object means the form is valid. */
export function validateSignIn(email, password) {
  const errors = {};
  if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
  if (typeof password !== "string" || password.length === 0) errors.password = "Enter a password.";
  return errors;
}

/**
 * Check the demo sign-in form and return the signed-in profile. The password is only tested for being non-empty; it is
 * not copied anywhere, and the returned profile holds nothing but the masked email as a display label.
 */
export function signIn(profile, { email, password }) {
  const errors = validateSignIn(email, password);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, profile: withAccount(profile, email) };
}

/**
 * The profile signed in as `email` (already validated by the form, whose password has already been discarded).
 * Only the masked email is kept, as the display label. Returns the profile unchanged when the email is not valid.
 */
export function withAccount(profile, email) {
  const base = sanitizeProfile(profile);
  return isValidEmail(email) ? { ...base, account: { label: maskEmail(email) } } : base;
}

// ---------------------------------------------------------------- shape

/** Rebuild a profile from an allow-list of fields. Anything unknown (a password, a token, junk) is dropped. */
export function sanitizeProfile(raw) {
  const out = emptyProfile();
  if (!isObj(raw)) return out;
  if (isObj(raw.account)) {
    const label = cleanText(raw.account.label, LABEL_MAX);
    if (label) out.account = { label };
  }
  if (ONBOARDING.includes(raw.onboarding)) out.onboarding = raw.onboarding;
  if (Array.isArray(raw.places)) {
    const seen = new Set();
    for (const p of raw.places) {
      const c = cleanPlace(p);
      if (c && !seen.has(c.id) && out.places.length < MAX_PLACES) {
        seen.add(c.id);
        out.places.push(c);
      }
    }
  }
  if (Array.isArray(raw.interests)) out.interests = INTEREST_IDS.filter((id) => raw.interests.includes(id));
  if (isObj(raw.prefs)) {
    const p = raw.prefs;
    out.prefs = {
      reduceMotion: p.reduceMotion === true,
      detail: DETAIL_IDS.includes(p.detail) ? p.detail : DEFAULT_PREFS.detail,
      view: p.view === "overview" || p.view === "detail" ? p.view : null,
      variable: typeof p.variable === "string" && /^[A-Za-z0-9_]{2,32}$/.test(p.variable) ? p.variable : DEFAULT_PREFS.variable,
    };
  }
  return out;
}

/** Which screen a profile opens on. */
export const stageOf = (profile) => (!profile?.account ? "signin" : profile.onboarding === "pending" ? "onboarding" : "app");

/** The Overview/Detail view the case file starts in, unless the user has chosen one. */
export const defaultView = (profile) => profile?.prefs?.view ?? (profile?.prefs?.detail === "technical" ? "detail" : "overview");

// ---------------------------------------------------------------- edits (pure: each returns a new profile)

export function addPlace(profile, place) {
  const c = cleanPlace(place);
  if (!c || profile.places.length >= MAX_PLACES || profile.places.some((p) => p.id === c.id)) return profile;
  return { ...profile, places: [...profile.places, c] };
}
export const removePlace = (profile, id) => ({ ...profile, places: profile.places.filter((p) => p.id !== id) });
export const hasPlace = (profile, lat, lon) => profile.places.some((p) => p.id === placeId(lat, lon));
export function movePlace(profile, id, delta) {
  const i = profile.places.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= profile.places.length) return profile;
  const places = [...profile.places];
  [places[i], places[j]] = [places[j], places[i]];
  return { ...profile, places };
}
export function toggleInterest(profile, id) {
  if (!INTEREST_IDS.includes(id)) return profile;
  const on = profile.interests.includes(id);
  return { ...profile, interests: INTEREST_IDS.filter((x) => (x === id ? !on : profile.interests.includes(x))) };
}
export const setLabel = (profile, label) => {
  const clean = cleanText(label, LABEL_MAX);
  return clean && profile.account ? { ...profile, account: { label: clean } } : profile;
};
export const setPrefs = (profile, patch) => sanitizeProfile({ ...profile, prefs: { ...profile.prefs, ...patch } });

// ---------------------------------------------------------------- data types → variables

/** The variables (from /api/variables) that belong to one data type, in the API's order. */
export function variablesFor(interestId, variables) {
  const it = interestById(interestId);
  if (!it || !Array.isArray(variables)) return [];
  if (it.variables.length) return it.variables.map((id) => variables.find((v) => v.id === id)).filter(Boolean);
  return variables.filter((v) => it.groups.includes(v.group));
}

/** The data type a variable is shown under, given the user's choices (first matching chosen type, else any type). */
export function interestOf(variableId, variables, chosen = INTEREST_IDS) {
  const order = [...chosen, ...INTEREST_IDS.filter((id) => !chosen.includes(id))];
  return order.find((id) => variablesFor(id, variables).some((v) => v.id === variableId)) ?? null;
}

// ---------------------------------------------------------------- V1 migration

const V1_INTERESTS = { heat: "heat", rain: "water", humid: "water", sun: "cloud", wind: "wind", soil: "land", poles: "ice" };
const V1_LEVELS = { plain: "plain", balanced: "balanced", technical: "technical" };

/** Build a V2 profile from the V1 values (`td-profile`, `td-watch`, `td-view`). Sign-in is still required afterwards. */
export function migrateV1({ profile, watch, view } = {}) {
  const v1 = isObj(profile) ? profile : {};
  const places = [];
  for (const id of Array.isArray(v1.places) ? v1.places : []) {
    const p = INTAKE_PLACES.find((x) => x.id === id);
    if (p) places.push({ name: p.hint, lat: p.lat, lon: p.lon });
  }
  for (const w of Array.isArray(watch) ? watch : []) if (isObj(w)) places.push({ name: w.name, lat: w.lat, lon: w.lon });
  const interests = (Array.isArray(v1.interests) ? v1.interests : []).map((id) => V1_INTERESTS[id]).filter(Boolean);
  const firstWatch = (Array.isArray(watch) ? watch : []).find((w) => isObj(w) && typeof w.variable === "string");
  return sanitizeProfile({
    version: PROFILE_VERSION,
    account: null,
    onboarding: "pending",
    places,
    interests,
    prefs: { detail: V1_LEVELS[v1.level] ?? DEFAULT_PREFS.detail, view: view ?? null, variable: firstWatch?.variable ?? DEFAULT_PREFS.variable },
  });
}

// ---------------------------------------------------------------- storage

/** window.localStorage, or null when the browser blocks it (reading the property itself can throw). */
export function browserStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw == null) return { found: false, value: undefined };
  try {
    return { found: true, value: JSON.parse(raw) };
  } catch {
    return { found: true, value: undefined, corrupt: true };
  }
}

/**
 * Load the profile. Returns `{ profile, status, migrated }` where status is
 * `"ok"` (read or nothing stored yet), `"corrupt"` (the stored value was unreadable; a fresh profile is used) or
 * `"blocked"` (storage is unavailable; the profile lasts only for this tab).
 */
export function loadProfile(storage = browserStorage()) {
  if (!storage) return { profile: emptyProfile(), status: "blocked", migrated: false };
  try {
    const v2 = readJson(storage, PROFILE_KEY);
    if (v2.found) {
      const ok = !v2.corrupt && isObj(v2.value) && v2.value.version === PROFILE_VERSION;
      return { profile: sanitizeProfile(ok ? v2.value : null), status: ok ? "ok" : "corrupt", migrated: false };
    }
    const v1 = Object.fromEntries(["td-profile", "td-watch", "td-view"].map((k) => [k, readJson(storage, k)]));
    if (!Object.values(v1).some((r) => r.found)) return { profile: emptyProfile(), status: "ok", migrated: false };
    const profile = migrateV1({ profile: v1["td-profile"].value, watch: v1["td-watch"].value, view: v1["td-view"].value });
    if (saveProfile(profile, storage)) V1_KEYS.forEach((k) => storage.removeItem(k));
    return { profile, status: "ok", migrated: true };
  } catch {
    return { profile: emptyProfile(), status: "blocked", migrated: false };
  }
}

/** Save the profile (sanitised first). Returns false when storage is blocked or full. */
export function saveProfile(profile, storage = browserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(sanitizeProfile(profile)));
    return true;
  } catch {
    return false;
  }
}

/** Remove the V2 profile and every V1 key from this device. Returns false when storage is blocked. */
export function resetProfile(storage = browserStorage()) {
  if (!storage) return false;
  try {
    [PROFILE_KEY, ...V1_KEYS].forEach((k) => storage.removeItem(k));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- export / import

export const IMPORT_ERROR = "That file isn't a Trend Detective profile";

/** The profile as a JSON file body. Only the sanitised fields are written. */
export const exportProfile = (profile) =>
  JSON.stringify({ app: "trend-detective", kind: "profile", version: PROFILE_VERSION, profile: sanitizeProfile(profile) }, null, 2);

/** Parse an exported file. Throws an Error with IMPORT_ERROR when it is not one. The result is always sanitised. */
export function importProfile(text) {
  let parsed;
  try {
    if (typeof text !== "string" || text.length > IMPORT_MAX_CHARS) throw new Error();
    parsed = JSON.parse(text);
  } catch {
    throw new Error(IMPORT_ERROR);
  }
  if (!isObj(parsed) || parsed.app !== "trend-detective" || parsed.kind !== "profile" || parsed.version !== PROFILE_VERSION || !isObj(parsed.profile)) {
    throw new Error(IMPORT_ERROR);
  }
  return sanitizeProfile(parsed.profile);
}

/** Merge an imported profile into the current one: the current sign-in stays unless the file brings a label. */
export function applyImport(current, imported) {
  return sanitizeProfile({
    ...imported,
    account: imported.account ?? current.account,
    onboarding: imported.onboarding === "pending" ? "done" : imported.onboarding,
  });
}
