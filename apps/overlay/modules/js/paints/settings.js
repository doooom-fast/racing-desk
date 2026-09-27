// What the livery manager remembers between runs: the two folders and the customer id. Ported from
// apps/paints/src-tauri/src/settings.rs — the shape only. Persistence is main.js's job; it hands in a `store`
// with get() and set(obj), and this module makes sure what goes through it has exactly the Settings shape from
// src/types.ts.
//
// Detection runs every launch regardless. These are overrides, so a user who has pointed the app at an unusual
// install is not re-corrected on every start.

const STRING_KEYS = Object.freeze(['paintDir', 'libraryRoot', 'customerId']);
const BOOL_KEYS = Object.freeze(['includeSpec', 'setReadOnlyAfter', 'clearOtherCooked', 'autoUpdateOnLaunch']);
const KEYS = Object.freeze([...STRING_KEYS, ...BOOL_KEYS]);

// Nothing remembered: every field null, as serde wrote a default Settings.
const DEFAULTS = Object.freeze({
  paintDir: null,
  libraryRoot: null,
  customerId: null,
  includeSpec: null,
  setReadOnlyAfter: null,
  clearOtherCooked: null,
  autoUpdateOnLaunch: null,
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Coerce anything into the Settings shape and say what was dropped. Unknown keys are ignored (an older or newer
// settings file must not stop the app starting), a wrong-typed value becomes null, and something that is not an
// object at all is the defaults. A JSON string is parsed first, since a store may hand the file back raw.
function validate(input) {
  const problems = [];
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      return { settings: { ...DEFAULTS }, problems: [`settings could not be parsed (${e.message}); using defaults.`] };
    }
  }
  if (raw === undefined || raw === null) return { settings: { ...DEFAULTS }, problems };
  if (!isPlainObject(raw)) return { settings: { ...DEFAULTS }, problems: ['settings were not an object; using defaults.'] };

  const settings = { ...DEFAULTS };
  for (const key of STRING_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') settings[key] = v;
    else problems.push(`${key} must be a string; ignoring it.`);
  }
  for (const key of BOOL_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') settings[key] = v;
    else problems.push(`${key} must be true or false; ignoring it.`);
  }
  return { settings, problems };
}

// The Settings shape, no questions asked.
function normalise(input) {
  return validate(input).settings;
}

// `patch` over `base`: keys the patch leaves undefined keep the base value; null clears one. Both sides are
// validated, so the result is always the full shape.
function merge(base, patch) {
  const out = normalise(base);
  if (!isPlainObject(patch)) return out;
  const p = normalise(patch);
  for (const key of KEYS) {
    if (patch[key] === undefined) continue;
    out[key] = p[key];
  }
  return out;
}

// Read through a store: a store that throws or holds rubbish yields the defaults, because a corrupt settings
// file should not stop the app starting — detection will refill it.
function load(store) {
  let raw;
  try {
    raw = store && typeof store.get === 'function' ? store.get() : undefined;
  } catch (e) {
    raw = undefined;
  }
  return normalise(raw);
}

function save(store, settings) {
  if (!store || typeof store.set !== 'function') throw new Error('No settings store to save into.');
  const clean = normalise(settings);
  store.set(clean);
  return clean;
}

module.exports = { DEFAULTS, KEYS, STRING_KEYS, BOOL_KEYS, validate, normalise, merge, load, save };
