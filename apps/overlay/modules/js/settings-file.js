// overlay-settings.json, read and written so that it can't be lost. main.js's settings helpers are these, pointed
// at the file; they live here, without Electron, so the rules can be tested.
//
// The file is shared: the HUD's settings, the desk's race links and the livery manager's folders are all keys of
// the one object, and every writer replaces the file whole. Two things follow. A reader that falls back to {}
// when the file won't parse hands its caller a blank object to build on — and the caller's save then replaces
// everything with it. And a write that is cut short leaves exactly such a file. So: a write is a temp file and a
// rename; a file that is there but unreadable is copied aside before anything replaces it; and the writers that
// set one key refuse to write over a file they couldn't read.
const fs = require('fs');
const path = require('path');

// { settings, state } — state is 'ok', 'missing' (no file: a first run) or 'unreadable' (a file that won't
// parse, or isn't an object). settings is {} unless ok. A UTF-8 BOM is not an error: Windows tools write one.
function read(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { settings: {}, state: e && e.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw.replace(/^﻿/, ''));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return { settings: parsed, state: 'ok' };
  } catch (e) { /* unreadable, below */ }
  return { settings: {}, state: 'unreadable' };
}

function load(file) {
  return read(file).settings;
}

// Replace the file with `settings`. Returns { kept }: where an unreadable file was copied to first, or null.
function save(file, settings, { now = Date.now } = {}) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Settings must be an object.');
  }
  let kept = null;
  if (read(file).state === 'unreadable') {
    kept = `${file.replace(/\.json$/i, '')}.unreadable-${now()}.json`;
    try { fs.copyFileSync(file, kept); } catch (e) { kept = null; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
  return { kept };
}

// Set one top-level key and keep every other. Refuses when the file is there but can't be read: what it holds
// is still recoverable where it is, and would not be after this.
function setKey(file, key, value, options) {
  const { settings, state } = read(file);
  if (state === 'unreadable') {
    throw new Error(`${path.basename(file)} can't be read, so it was left as it is.`);
  }
  settings[key] = value;
  return save(file, settings, options);
}

module.exports = { read, load, save, setKey };
