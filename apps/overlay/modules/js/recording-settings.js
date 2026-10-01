// The recording keys of overlay-settings.json, and the migration that brings a file from the Electron recorder's
// days to OBS's. Pure: no Electron, no file access of its own (migrateFile takes settings-file.js), so it runs in
// the unit tests.
//
// What the Electron recorder kept — its quality, encoder, output format, the mic, the game audio and the facecam
// devices and their volumes, the facecam's size and corner, the "native" backend and its control port — is OBS's
// now (his profile, his sources, his scene), and is deleted: a key the app no longer reads would otherwise sit in
// the file for ever, and `recordingBackend: "native"` with `hostControlPort: 50965` named a server nothing has
// listened on since July. The replay buffer is OBS's too; its switch keeps its meaning under a new name.
//
// Run once by main.js at start, before anything reads the file; `recordingSettingsVersion` says it has been.
const path = require('path');

const VERSION = 2;

// Deleted: the Electron recorder's own, and the old WinUI app's control server.
const DELETED = Object.freeze([
  'recordingBackend', 'hostControlPort',
  'recordingQuality', 'recordingEncoder', 'recordingOutputFormat', 'recordingDeleteSource',
  'recordingMic', 'recordingMicDevice', 'recordingMicLabel', 'recordingMicVolume',
  'recordingSystemAudioDevice', 'recordingSystemAudioLabel', 'recordingSystemVolume',
  'recordingWebcamDevice', 'recordingWebcamLabel', 'recordingFacecam', 'recordingFacecamSize', 'recordingFacecamPos',
  // The in-RAM buffer's length, which OBS's replay buffer (RecRBTime, 20 s, set by "Set up OBS") replaces.
  'replayBufferDuration', 'replayBufferSeconds',
]);

// Renamed: the same meaning, under the name the OBS keeper reads.
const RENAMED = Object.freeze({
  replayBufferEnabled: 'recordingInstantReplay',
  recordingDirectory: 'recordingFolder',
});

// Added, with the value a file without them is read as.
const ADDED = Object.freeze({
  recordingInstantReplaySeconds: 20,   // OBS's RecRBTime, which Set up OBS writes
  recordingChapters: true,
  obsStartOnRecord: true,              // Record from the desk, the tray or the Stream Deck starts OBS when it is closed
  obsStartWithApp: false,              // never at Racing Desk's start unless he turns this on
  obsPath: null,                       // null: the default install, C:\Program Files\obs-studio
  obsHudSource: false,                 // the HUD as an OBS browser source (a later build)
});

// Kept as they are: recordingAutoRecord, recordingAutoStopOnPit.

const DEFAULT_FOLDER_DRIVE = 'D:\\';
const DEFAULT_FOLDER_ON_D = 'D:\\Racing Desk\\Recordings';

/**
 * The settings with the recording keys as this build reads them. Returns { settings, changed, removed, renamed,
 * added }; `settings` is a new object, the one given is left as it was.
 */
function migrate(settings) {
  const input = settings !== null && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const next = { ...input };
  const removed = [];
  const renamed = [];
  const added = [];
  if ((Number(next.recordingSettingsVersion) || 0) >= VERSION) {
    return { settings: next, changed: false, removed, renamed, added };
  }
  for (const key of DELETED) {
    if (key in next) { delete next[key]; removed.push(key); }
  }
  for (const [from, to] of Object.entries(RENAMED)) {
    if (!(from in next)) continue;
    const value = next[from];
    delete next[from];
    // A folder is kept only when there is one; the old default was an empty string for "the Videos folder".
    const keep = from === 'recordingDirectory' ? typeof value === 'string' && value.trim() !== '' : typeof value === 'boolean';
    if (keep && !(to in next)) { next[to] = from === 'recordingDirectory' ? value.trim() : value; renamed.push([from, to]); }
    else removed.push(from);
  }
  for (const [key, value] of Object.entries(ADDED)) {
    if (!(key in next)) { next[key] = value; added.push(key); }
  }
  next.recordingSettingsVersion = VERSION;
  return { settings: next, changed: true, removed, renamed, added };
}

/**
 * Migrate the file in place, through settings-file.js (atomic, and a file that is there but unreadable is left as
 * it is: nothing is written over what might still be recovered). Returns migrate's result with `state`.
 */
function migrateFile(file, { settingsFile }) {
  const { settings, state } = settingsFile.read(file);
  if (state === 'unreadable') return { settings: {}, changed: false, removed: [], renamed: [], added: [], state };
  const result = migrate(settings);
  if (result.changed) settingsFile.save(file, result.settings);
  return { ...result, state };
}

/**
 * Where recordings go: the folder he set, else D:\Racing Desk\Recordings while there is a D: drive (his 418 GB
 * one; C: holds about ninety minutes at his bitrate), else a Racing Desk folder in his Videos.
 */
function recordingFolder(settings, { exists, home }) {
  const set = settings && typeof settings.recordingFolder === 'string' ? settings.recordingFolder.trim() : '';
  if (set) return set;
  if (exists(DEFAULT_FOLDER_DRIVE)) return DEFAULT_FOLDER_ON_D;
  return path.join(home, 'Videos', 'Racing Desk');
}

module.exports = { VERSION, DELETED, RENAMED, ADDED, DEFAULT_FOLDER_ON_D, migrate, migrateFile, recordingFolder };
